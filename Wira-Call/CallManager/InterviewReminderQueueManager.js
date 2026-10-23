const bull = require("bullmq");
const plivo = require("@wira/shared/Utility/PlivoHandler");

/**
 * InterviewReminderQueueManager — Dedicated BullMQ queue + worker for interview reminder calls.
 *
 * Provides completely isolated queueing on "interview-reminder-call-queue"
 * and active-call tracking on "reminder-active-calls".
 * Guarantees zero regression on screening and payroll queues.
 *
 * Slot model:
 * - Reminder calls dial from the screening numbers, but are counted ONLY in
 *   "reminder-active-calls" (never in "numbers-config"), so screening is unaffected.
 * - At most `maxActiveCalls` reminder calls are live at a time across all numbers.
 * - Each slot is a ZSET member "<number>|<wiraCallId>" scored by allocation time.
 *   Slots older than `slotStaleMs` are dropped automatically, so a missed hangup
 *   webhook can never block the reminder queue permanently.
 */
const ACTIVE_CALLS_KEY = "reminder-active-calls";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

class InterviewReminderQueueManager
{
    constructor(redis, database)
    {
        this.redis = redis;
        this.database = database;

        this.phonePool = null;
        this.perNumberConcurrency = null;

        // Set by InterviewReminderManager before initWorker()
        this.maxActiveCalls = 10;

        this.slotStaleMs = 10 * 60 * 1000;
        this.slotWaitMs = 5000;
        this.maxDialAttempts = 3;

        // IST call window: calls are only dialed between startHour and endHour
        this.callWindow = {
            startHour: 10,
            endHour: 20,
        };

        this.connection = {
            host: "127.0.0.1",
            port: 6379,
            maxRetriesPerRequest: null,
        };

        this.reminderCallQueue = new bull.Queue("interview-reminder-call-queue", {
            connection: this.connection,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: 3000,
                },
                removeOnComplete: true,
                removeOnFail: true,
            },
        });
        this.reminderCallQueue.setMaxListeners(100);
    }

    initWorker()
    {
        this.reminderCallWorker = new bull.Worker(
            "interview-reminder-call-queue",
            async (job, token) =>
            {
                const phone = job.data.phone;
                const wiraCallId = job.data.wiraCallId;

                // Outside IST call window → park the job until the window opens
                const windowDelayMs = this.#msUntilCallWindow();
                if (windowDelayMs > 0)
                {
                    console.log(`🌙 [Reminder Worker] Outside call window — delaying job ${job.id} by ${Math.round(windowDelayMs / 60000)} min`);
                    await job.moveToDelayed(Date.now() + windowDelayMs, token);
                    throw new bull.DelayedError();
                }

                const raw = await this.redis.get(`screening:callId:${wiraCallId}`);
                if (!raw)
                {
                    throw new bull.UnrecoverableError(
                        JSON.stringify({
                            statusCode: 404,
                            success: false,
                            message: "Session not found for interview reminder wiraCallId: " + wiraCallId,
                            data: null,
                        }),
                    );
                }

                const session = JSON.parse(raw);
                const pool = this.phonePool;

                if (!pool || pool.length === 0)
                {
                    throw new Error(
                        JSON.stringify({
                            statusCode: 503,
                            success: false,
                            message: "Reminder phone pool not configured.",
                            data: null,
                        }),
                    );
                }

                const allocationResult = await this.#allocateSlot(
                    pool,
                    wiraCallId,
                    session.fromPhone ?? null,
                );

                console.log("✅ [Reminder Worker] allocationResult:", JSON.stringify(allocationResult));

                if (!allocationResult.success)
                {
                    // All reminder slots busy → wait without consuming a dial attempt
                    if (allocationResult.statusCode === 429)
                    {
                        await job.moveToDelayed(Date.now() + this.slotWaitMs, token);
                        throw new bull.DelayedError();
                    }

                    throw new Error(
                        JSON.stringify({
                            statusCode: 503,
                            success: false,
                            message: "REMINDER_ALLOCATION_FAILED — " + allocationResult.message,
                            data: null,
                        }),
                    );
                }

                const fromPhone = allocationResult.data.allotedNumber;
                let plivoResponse = null;

                try
                {
                    plivoResponse = await plivo.initiateCall(phone, fromPhone, session.type || "outbound-interview-reminder");
                }
                catch (error)
                {
                    await this.#releaseSlot(wiraCallId);

                    // OLD: compared against job.opts.attempts (999) → retried ~999 times
                    // const isLastAttempt = job.attemptsMade >= (job.opts?.attempts || 3) - 1;
                    const isLastAttempt = job.attemptsMade + 1 >= this.maxDialAttempts;
                    if (isLastAttempt)
                    {
                        await this.database.db.updateWiraCalls(
                            { status: "failed" },
                            { id: wiraCallId }
                        );
                        throw new bull.UnrecoverableError(
                            JSON.stringify({
                                statusCode: 502,
                                success: false,
                                message: "Plivo initiate interview reminder call failed: " + error.message,
                                data: null,
                            }),
                        );
                    }

                    throw new Error(
                        JSON.stringify({
                            statusCode: 502,
                            success: false,
                            message: "Plivo initiate interview reminder call transient error: " + error.message,
                            data: null,
                        }),
                    );
                }

                const plivoCallId = plivoResponse.requestUuid ?? plivoResponse.request_uuid ?? null;

                if (!plivoCallId)
                {
                    await this.#releaseSlot(wiraCallId);
                    await this.database.db.updateWiraCalls(
                        { status: "failed" },
                        { id: wiraCallId }
                    );
                    throw new bull.UnrecoverableError(
                        JSON.stringify({
                            statusCode: 502,
                            success: false,
                            message: "No plivo call ID returned for interview reminder call.",
                            data: null,
                        }),
                    );
                }

                const updatedSession = {
                    ...session,
                    callId: plivoCallId,
                    fromPhone: fromPhone,
                };

                await this.redis.set(
                    `screening:callId:${plivoCallId}`,
                    JSON.stringify(updatedSession),
                    "EX",
                    3600,
                );

                console.log(`📞 [Reminder Worker] Call initiated — wiraCallId: ${wiraCallId} | callUUID: ${plivoCallId} | from: ${fromPhone} | active: ${allocationResult.data.activeCalls}/${this.maxActiveCalls}`);

                const dbUpdate = await this.database.db.updateWiraCalls(
                    { callId: plivoCallId, fromPhone: fromPhone },
                    { id: wiraCallId },
                );

                if (!dbUpdate)
                {
                    throw new bull.UnrecoverableError(
                        JSON.stringify({
                            statusCode: 500,
                            success: false,
                            message: "Failed to update wira call in database for reminder wiraCallId: " + wiraCallId,
                            data: null,
                        }),
                    );
                }
            },
            {
                connection: this.connection,
                concurrency: 10,
                lockDuration: 180000,
                lockRenewTime: 30000,
                stalledInterval: 60000,
                maxStalledCount: 2,
                // Max 1 reminder dial per second — keeps Plivo CPS headroom for screening
                limiter: {
                    max: 1,
                    duration: 1000,
                },
            },
        );
        this.reminderCallWorker.setMaxListeners(100);

        this.reminderCallWorker.on("completed", (job, returnValue) =>
        {
            console.log("✅ [Reminder Queue] Job completed:", returnValue);
        });

        this.reminderCallWorker.on("failed", (job, error) =>
        {
            try
            {
                const errorData = JSON.parse(error.message);
                console.log(`❌ [Reminder Queue] Job ${job.id} failed:`, errorData);
            }
            catch (parseError)
            {
                console.log(`❌ [Reminder Queue] Job ${job.id} failed:`, error.message);
            }
        });
    }

    async pushToQueue(phone, wiraCallId, priority = 0)
    {
        try
        {
            const jobOptions = {
                priority: priority,
                jobId: `interview-reminder:${phone}:${wiraCallId}`,
                // OLD: attempts: 999 with 3s fixed backoff
                attempts: this.maxDialAttempts,
                backoff: {
                    type: "fixed",
                    delay: 5000,
                },
            };

            const windowDelayMs = this.#msUntilCallWindow();
            if (windowDelayMs > 0)
            {
                jobOptions.delay = windowDelayMs;
            }

            await this.reminderCallQueue.add(
                "interview-reminder-job",
                { phone, wiraCallId },
                jobOptions,
            );

            return {
                statusCode: 200,
                success: true,
                message: windowDelayMs > 0
                    ? "Interview reminder call scheduled for next call window."
                    : "Interview reminder call job added to queue.",
                data: null,
            };
        }
        catch (error)
        {
            console.error("❌ [Reminder Queue] Error adding job:", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error adding to interview reminder queue.",
                data: null,
            };
        }
    }

    // Release a reminder slot — called by InterviewReminderManager.flushCallEnd
    async releaseSlot(wiraCallId)
    {
        return this.#releaseSlot(wiraCallId);
    }

    /*
    // OLD: per-number counter on "reminder-numbers-config" (35 per number, no global cap, no stale cleanup)
    async deallocateNumber(fromPhone)
    {
        return this.#deallocateNumber(
            this.phonePool,
            this.perNumberConcurrency,
            fromPhone,
        );
    }
    */

    // ─── Private helpers ────────────────────────────────────────────────────────

    // Returns 0 inside the IST call window, otherwise ms until the window next opens
    #msUntilCallWindow()
    {
        const now = new Date();
        const istNow = new Date(now.getTime() + IST_OFFSET_MS);
        const istHour = istNow.getUTCHours();

        if (istHour >= this.callWindow.startHour && istHour < this.callWindow.endHour)
        {
            return 0;
        }

        const windowStart = new Date(istNow);
        if (istHour >= this.callWindow.endHour)
        {
            windowStart.setUTCDate(windowStart.getUTCDate() + 1);
        }
        windowStart.setUTCHours(this.callWindow.startHour, 0, 0, 0);

        return windowStart.getTime() - istNow.getTime();
    }

    async #allocateSlot(numberList, wiraCallId, preferredNumber)
    {
        try
        {
            const resultRaw = await this.redis.eval(
                ALLOCATE_SLOT_SCRIPT,
                1,
                ACTIVE_CALLS_KEY,
                this.maxActiveCalls,
                Date.now(),
                this.slotStaleMs,
                String(wiraCallId),
                JSON.stringify(numberList),
                preferredNumber || "",
            );

            const parsed = JSON.parse(resultRaw);

            if (!parsed.success)
            {
                return {
                    statusCode: 429,
                    success: false,
                    message: `All ${this.maxActiveCalls} reminder slots are currently in use.`,
                    data: { allotedNumber: null, activeCalls: parsed.activeCalls ?? null },
                };
            }

            return {
                statusCode: 200,
                success: true,
                message: parsed.reused ? "Reminder slot already held." : "Reminder slot allocated.",
                data: { allotedNumber: parsed.allotedNumber, activeCalls: parsed.activeCalls },
            };
        }
        catch (error)
        {
            console.error("❌ [Reminder] allocateSlot error:", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error allocating reminder slot.",
                data: null,
            };
        }
    }

    async #releaseSlot(wiraCallId)
    {
        try
        {
            const removed = await this.redis.eval(
                RELEASE_SLOT_SCRIPT,
                1,
                ACTIVE_CALLS_KEY,
                String(wiraCallId),
            );

            return {
                statusCode: 200,
                success: removed > 0,
                message: removed > 0 ? "Reminder slot released." : "Reminder slot not found.",
                data: null,
            };
        }
        catch (error)
        {
            console.error("❌ [Reminder] releaseSlot error:", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error releasing reminder slot.",
                data: null,
            };
        }
    }

    /*
    // OLD: per-number allocation on "reminder-numbers-config"
    async #allocateNumber(numberList, concurrency, preferredNumber)
    {
        const initConfig = JSON.stringify(
            numberList.map((n) => ({
                number: n,
                totalCalls: 0,
                available: true,
            })),
        );

        try
        {
            const resultRaw = await this.redis.eval(
                ALLOCATE_SCRIPT,
                1,
                "reminder-numbers-config",
                concurrency,
                preferredNumber || "",
                initConfig,
            );

            const parsed = JSON.parse(resultRaw);

            if (!parsed.success)
            {
                return {
                    statusCode: 429,
                    success: false,
                    message: "All reminder numbers are currently in use.",
                    data: { allotedNumber: null, config: parsed.config ?? null },
                };
            }

            return {
                statusCode: 200,
                success: true,
                message: "Reminder number allocated.",
                data: { allotedNumber: parsed.allotedNumber, config: parsed.config },
            };
        }
        catch (error)
        {
            console.error("❌ [Reminder] allocateNumber error:", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error allocating reminder number.",
                data: null,
            };
        }
    }

    async #deallocateNumber(numberList, concurrency, targetNumber)
    {
        const initConfig = JSON.stringify(
            (numberList || []).map((n) => ({
                number: n,
                totalCalls: 0,
                available: true,
            })),
        );

        try
        {
            const resultRaw = await this.redis.eval(
                DEALLOCATE_SCRIPT,
                1,
                "reminder-numbers-config",
                concurrency,
                targetNumber || "",
                initConfig,
            );

            const parsed = JSON.parse(resultRaw);

            return {
                statusCode: 200,
                success: parsed.success ?? true,
                message: parsed.success ? "Reminder number deallocated." : "Number not found.",
                data: null,
            };
        }
        catch (error)
        {
            console.error("❌ [Reminder] deallocateNumber error:", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error deallocating reminder number.",
                data: null,
            };
        }
    }
    */
}

// ─── Lua scripts (scoped to reminder-active-calls) ────────────────────────────

const ALLOCATE_SLOT_SCRIPT = `
    local key = KEYS[1]
    local maxActive = tonumber(ARGV[1])
    local nowMs = tonumber(ARGV[2])
    local staleMs = tonumber(ARGV[3])
    local wiraCallId = ARGV[4]
    local numbers = cjson.decode(ARGV[5])
    local preferredNumber = ARGV[6]

    -- Drop slots whose hangup was never flushed
    redis.call('ZREMRANGEBYSCORE', key, '-inf', nowMs - staleMs)

    local members = redis.call('ZRANGE', key, 0, -1)
    local counts = {}

    for _, member in ipairs(members) do
        local number, callId = string.match(member, '^(.-)|(.+)$')

        -- Job retry for a call that already holds a slot → reuse it
        if callId == wiraCallId then
            return cjson.encode({ success = true, reused = true, allotedNumber = number, activeCalls = #members })
        end

        if number then
            counts[number] = (counts[number] or 0) + 1
        end
    end

    if #members >= maxActive then
        return cjson.encode({ success = false, activeCalls = #members })
    end

    local selected = nil

    if preferredNumber ~= '' then
        for _, number in ipairs(numbers) do
            if number == preferredNumber then
                selected = number
                break
            end
        end
    end

    -- Otherwise pick the number with the fewest live reminder calls
    if not selected then
        local minCalls = nil
        for _, number in ipairs(numbers) do
            local calls = counts[number] or 0
            if minCalls == nil or calls < minCalls then
                minCalls = calls
                selected = number
            end
        end
    end

    redis.call('ZADD', key, nowMs, selected .. '|' .. wiraCallId)
    redis.call('PEXPIRE', key, staleMs * 2)

    return cjson.encode({ success = true, allotedNumber = selected, activeCalls = #members + 1 })
`;

const RELEASE_SLOT_SCRIPT = `
    local key = KEYS[1]
    local wiraCallId = ARGV[1]

    local members = redis.call('ZRANGE', key, 0, -1)
    local removed = 0

    for _, member in ipairs(members) do
        local _, callId = string.match(member, '^(.-)|(.+)$')
        if callId == wiraCallId then
            redis.call('ZREM', key, member)
            removed = removed + 1
        end
    end

    return removed
`;

/*
// OLD: Lua scripts scoped to "reminder-numbers-config"
const ALLOCATE_SCRIPT = `
    local configKey = KEYS[1]
    local concurrency = tonumber(ARGV[1])
    local preferredNumber = ARGV[2]
    local initConfigJson = ARGV[3]

    local function cleanDigits(numStr)
        if not numStr then return "" end
        return string.gsub(tostring(numStr), "%D", "")
    end

    local function matchPhones(a, b)
        if not a or not b or a == "" or b == "" then return false end
        if a == b then return true end
        local da = cleanDigits(a)
        local db = cleanDigits(b)
        if da == db then return true end
        if #da >= 10 and #db >= 10 then
            return string.sub(da, -10) == string.sub(db, -10)
        end
        return false
    end

    local raw = redis.call('GET', configKey)
    local config
    local initConfig = cjson.decode(initConfigJson)

    if raw then
        config = cjson.decode(raw)
        for _, initItem in ipairs(initConfig) do
            local exists = false
            for _, item in ipairs(config) do
                if matchPhones(item.number, initItem.number) then
                    exists = true
                    break
                end
            end
            if not exists then
                table.insert(config, { number = initItem.number, totalCalls = 0, available = true })
            end
        end
    else
        config = initConfig
    end

    local selectedIdx = nil

    if preferredNumber ~= '' then
        for i, item in ipairs(config) do
            if matchPhones(item.number, preferredNumber) then
                if item.totalCalls < concurrency then
                    selectedIdx = i
                end
                break
            end
        end
    end

    if not selectedIdx then
        local minCalls = nil
        for i, item in ipairs(config) do
            if item.totalCalls < concurrency then
                if minCalls == nil or item.totalCalls < minCalls then
                    minCalls = item.totalCalls
                    selectedIdx = i
                end
            end
        end
    end

    if not selectedIdx then
        return cjson.encode({ success = false, config = config })
    end

    config[selectedIdx].totalCalls = config[selectedIdx].totalCalls + 1
    config[selectedIdx].available = config[selectedIdx].totalCalls < concurrency

    redis.call('SET', configKey, cjson.encode(config))

    return cjson.encode({
        success = true,
        allotedNumber = config[selectedIdx].number,
        config = config
    })
`;

const DEALLOCATE_SCRIPT = `
    local configKey = KEYS[1]
    local concurrency = tonumber(ARGV[1])
    local targetNumber = ARGV[2]
    local initConfigJson = ARGV[3]

    local function cleanDigits(numStr)
        if not numStr then return "" end
        return string.gsub(tostring(numStr), "%D", "")
    end

    local function matchPhones(a, b)
        if not a or not b or a == "" or b == "" then return false end
        if a == b then return true end
        local da = cleanDigits(a)
        local db = cleanDigits(b)
        if da == db then return true end
        if #da >= 10 and #db >= 10 then
            return string.sub(da, -10) == string.sub(db, -10)
        end
        return false
    end

    local raw = redis.call('GET', configKey)
    local config
    local initConfig = cjson.decode(initConfigJson)

    if raw then
        config = cjson.decode(raw)
    else
        config = initConfig
        redis.call('SET', configKey, cjson.encode(config))
        return cjson.encode({ success = true, wasNew = true, config = config })
    end

    local found = false
    for i, item in ipairs(config) do
        if matchPhones(item.number, targetNumber) then
            found = true
            item.totalCalls = math.max(0, item.totalCalls - 1)
            item.available = item.totalCalls < concurrency
            break
        end
    end

    if not found then
        return cjson.encode({ success = false, reason = 'not_found' })
    end

    redis.call('SET', configKey, cjson.encode(config))
    return cjson.encode({ success = true, config = config })
`;
*/

module.exports = InterviewReminderQueueManager;
