const bull = require("bullmq");
const plivo = require("@wira/shared/Utility/PlivoHandler");

/**
 * PayrollQueueManager — Dedicated BullMQ queue + worker for payroll calls only.
 *
 * Purpose: Replaces the previous pattern where PayrollManager created a full
 * RedisManager (which spawned duplicate screening workers on "call-queue" and
 * "screening-questions-queue"). This class ONLY manages "payroll-call-queue"
 * and its worker — zero impact on screening infrastructure.
 */
class PayrollQueueManager
{
    constructor(redis, database)
    {
        this.redis = redis;
        this.database = database;

        // Payroll phone pool — set by PayrollManager before initWorker()
        this.payrollPhonePool = null;
        this.perNumberConcurrency = null;

        this.connection = {
            host: "127.0.0.1",
            port: 6379,
            maxRetriesPerRequest: null,
        };

        this.payrollCallQueue = new bull.Queue("payroll-call-queue", {
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
    }

    // Called by PayrollManager after payrollPhonePool and perNumberConcurrency are set.
    initWorker()
    {
        this.payrollCallWorker = new bull.Worker(
            "payroll-call-queue",
            async (job) =>
            {
                const phone = job.data.phone;
                const wiraCallId = job.data.wiraCallId;

                const raw = await this.redis.get(`screening:callId:${wiraCallId}`);
                if (!raw)
                {
                    throw new bull.UnrecoverableError(
                        JSON.stringify({
                            statusCode: 404,
                            success: false,
                            message: "Session not found for payroll wiraCallId: " + wiraCallId,
                            data: null,
                        }),
                    );
                }

                const session = JSON.parse(raw);
                const payrollPool = this.payrollPhonePool;

                if (!payrollPool || payrollPool.length === 0)
                {
                    throw new Error(
                        JSON.stringify({
                            statusCode: 503,
                            success: false,
                            message: "Payroll phone pool not configured.",
                            data: null,
                        }),
                    );
                }

                // Allocate from payroll-numbers-config only — never touches numbers-config
                const allocationResult = await this.#allocateNumber(
                    payrollPool,
                    this.perNumberConcurrency,
                    session.fromPhone ?? null,
                );

                console.log("✅ [Payroll Worker] allocationResult:", JSON.stringify(allocationResult));

                if (!allocationResult.success)
                {
                    throw new Error(
                        JSON.stringify({
                            statusCode: 503,
                            success: false,
                            message: "PAYROLL_ALLOCATION_FAILED — no slots available, retrying...",
                            data: null,
                        }),
                    );
                }

                const fromPhone = allocationResult.data.allotedNumber;
                let plivoResponse = null;

                try
                {
                    plivoResponse = await plivo.initiateCall(phone, fromPhone, session.type);
                }
                catch (error)
                {
                    await this.#deallocateNumber(
                        payrollPool,
                        this.perNumberConcurrency,
                        fromPhone,
                    );
                    await this.database.db.updateWiraCalls(
                        { status: "failed" },
                        { id: wiraCallId }
                    );
                    throw new bull.UnrecoverableError(
                        JSON.stringify({
                            statusCode: 502,
                            success: false,
                            message: "Plivo initiate payroll call failed: " + error.message,
                            data: null,
                        }),
                    );
                }

                const plivoCallId =
                    plivoResponse.requestUuid ?? plivoResponse.request_uuid ?? null;

                if (!plivoCallId)
                {
                    await this.#deallocateNumber(
                        payrollPool,
                        this.perNumberConcurrency,
                        fromPhone,
                    );
                    await this.database.db.updateWiraCalls(
                        { status: "failed" },
                        { id: wiraCallId }
                    );
                    throw new bull.UnrecoverableError(
                        JSON.stringify({
                            statusCode: 502,
                            success: false,
                            message: "No plivo call ID returned for payroll call.",
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

                const dbUpdate = await this.database.db.updateWiraCalls(
                    { callId: plivoCallId },
                    { id: wiraCallId },
                );

                if (!dbUpdate)
                {
                    throw new bull.UnrecoverableError(
                        JSON.stringify({
                            statusCode: 500,
                            success: false,
                            message:
                                "Failed to update wira call in database for payroll wiraCallId: " +
                                wiraCallId,
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
            },
        );

        this.payrollCallWorker.on("completed", (job, returnValue) =>
        {
            console.log("✅ [Payroll Queue] Job completed:", returnValue);
        });

        this.payrollCallWorker.on("failed", (job, error) =>
        {
            try
            {
                const errorData = JSON.parse(error.message);
                console.log(`❌ [Payroll Queue] Job ${job.id} failed:`, errorData);
            }
            catch (parseError)
            {
                console.log(`❌ [Payroll Queue] Job ${job.id} failed:`, error.message);
            }
        });
    }

    async pushToQueue(phone, wiraCallId, priority = 0)
    {
        try
        {
            const jobOptions = {
                priority: priority,
                jobId: `payroll:${phone}:${wiraCallId}`,
                attempts: 999,
                backoff: {
                    type: "fixed",
                    delay: 3000,
                },
            };

            await this.payrollCallQueue.add(
                "payroll-calling-job",
                { phone, wiraCallId },
                jobOptions,
            );

            return {
                statusCode: 200,
                success: true,
                message: "Payroll call job added to queue.",
                data: null,
            };
        }
        catch (error)
        {
            console.error("❌ [Payroll Queue] Error adding job:", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error adding to payroll call queue.",
                data: null,
            };
        }
    }

    // Deallocate a payroll number slot — called by PayrollManager.flushCallEnd
    async deallocateNumber(fromPhone)
    {
        return this.#deallocateNumber(
            this.payrollPhonePool,
            this.perNumberConcurrency,
            fromPhone,
        );
    }

    // ─── Private Lua-backed allocation helpers ─────────────────────────────────

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
                "payroll-numbers-config",
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
                    message: "All payroll numbers are currently in use.",
                    data: { allotedNumber: null, config: parsed.config ?? null },
                };
            }

            return {
                statusCode: 200,
                success: true,
                message: "Payroll number allocated.",
                data: { allotedNumber: parsed.allotedNumber, config: parsed.config },
            };
        }
        catch (error)
        {
            console.error("❌ [Payroll] allocateNumber error:", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error allocating payroll number.",
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
                "payroll-numbers-config",
                concurrency,
                targetNumber || "",
                initConfig,
            );

            const parsed = JSON.parse(resultRaw);

            return {
                statusCode: 200,
                success: parsed.success ?? true,
                message: parsed.success ? "Payroll number deallocated." : "Number not found.",
                data: null,
            };
        }
        catch (error)
        {
            console.error("❌ [Payroll] deallocateNumber error:", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error deallocating payroll number.",
                data: null,
            };
        }
    }
}

// ─── Lua scripts (same logic as RedisManager, scoped to payroll-numbers-config) ──

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

module.exports = PayrollQueueManager;
