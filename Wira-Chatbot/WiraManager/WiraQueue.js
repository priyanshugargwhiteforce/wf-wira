const { Queue, Worker } = require("bullmq");

const bullMQConnection = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null
};

class WiraQueue
{
    constructor(database, session, onSessionExpiry)
    {
        this.database = database;
        this.session = session;
        this.onSessionExpiry = onSessionExpiry;

        WiraQueue.shared.database = database;
        WiraQueue.shared.onSessionExpiry = onSessionExpiry;

        if(session)
        {
            WiraQueue.shared.session = session;
        }

        if(!WiraQueue.initialized)
        {
            WiraQueue.queues = {};
            WiraQueue.workers = {};

            WiraQueue.queues.reminders = new Queue("wira-reminders", 
                { 
                    connection: bullMQConnection 
                }
            );

            WiraQueue.queues.expiry = new Queue("wira-expiry", 
                { 
                    connection: bullMQConnection 
                }
            );

            WiraQueue.workers.reminders = new Worker("wira-reminders", async (job) =>
                {
                    const handler = new WiraQueue(
                        WiraQueue.shared.database,
                        WiraQueue.shared.session,
                        WiraQueue.shared.onSessionExpiry
                    );

                    await handler.#processReminder(job.data);
                },
                { 
                    connection: bullMQConnection 
                }
            );

            WiraQueue.workers.expiry = new Worker("wira-expiry", async (job) =>
                {
                    const handler = new WiraQueue(
                        WiraQueue.shared.database,
                        WiraQueue.shared.session,
                        WiraQueue.shared.onSessionExpiry
                    );

                    await handler.#processExpiry(job.name, job.data);
                },
                { 
                    connection: bullMQConnection 
                }
            );

            WiraQueue.initialized = true;
        }
    }

    setSession(session)
    {
        this.session = session;
        WiraQueue.shared.session = session;
    }

    async #processExpiry(jobName, data)
    {
        try
        {
            if(jobName.startsWith("session-expiry:"))
            {
                await this.#processSessionExpiry(data);
            }
            else if(jobName.startsWith("user-cache-expiry:"))
            {
                await this.#processUserCacheExpiry(data);
            }
            else if(jobName.startsWith("universal-cache-expiry:"))
            {
                await this.#processUniversalCacheExpiry(data);
            }
            else
            {
                console.error(`❌ processExpiry: Unknown job name: ${jobName}`);
            }
        }
        catch(err)
        {
            console.error(`❌ processExpiry failed for ${jobName}:`, err.message);
        }
    }

    async #processSessionExpiry(data)
    {
        const { phone } = data;
        const session = await this.session.getSession(phone);

        if(!session)
        {
            return;
        }

        const hasMetadata = session.sessionMetadata && (
            session.sessionMetadata.profile !== null ||
            session.sessionMetadata.examiner !== null ||
            session.sessionMetadata.screening !== null
        );

        if(!hasMetadata)
        {
            return;
        }

        await this.onSessionExpiry(phone, session.activePrompt, session.sessionMetadata);
    }

    async #processUserCacheExpiry(data)
    {
        const { cacheData } = data;
        await this.#finalizeCacheCost(cacheData);
    }

    async #processUniversalCacheExpiry(data)
    {
        const { cacheData } = data;
        await this.#finalizeCacheCost(cacheData);
    }

    async #finalizeCacheCost(cacheData)
    {
        const now = new Date();
        const elapsedSeconds = Math.floor((now - new Date(cacheData.createdAt)) / 1000);
        const finalCost = cacheData.costPerSecond * elapsedSeconds;

        await this.database.finalizeCacheCost(cacheData.dbId, finalCost, now.toISOString());
    }

    async #processReminder(data)
    {
        try
        {
            const { queueId, phone, fcmToken, platform, webName } = data;

            const queueResult = await this.database.db.fetchWiraQueues({ id: queueId }, 1, 1);

            if(!queueResult || queueResult.total === 0)
            {
                console.error(`❌ processReminder: Queue not found for id ${queueId}`);
                return;
            }

            const queueEntry = queueResult.rows[0];

            if(queueEntry.executed || queueEntry.status !== "pending")
            {
                console.error(`❌ processReminder: Queue ${queueId} already executed or not pending.`);
                return;
            }

            if(platform === "App" || platform === "Web")
            {
                await this.#reminderApp(queueEntry, phone, fcmToken, webName);
            }
            else if(platform === "Whatsapp")
            {
                await this.#reminderWhatsapp(queueEntry, phone, webName);
            }
            else if(platform === "Call")
            {
                await this.#reminderCall(queueEntry, phone, webName);
            }

            await this.database.db.updateWiraQueues(
                { executed: true, status: "success" },
                { id: queueId }
            );
        }
        catch(err)
        {
            console.error("❌ processReminder failed:", err.message);

            await this.database.db.updateWiraQueues(
                { executed: true, status: "failed", message: err.message },
                { id: data.queueId }
            );
        }
    }

    async #reminderApp(queueEntry, phone, fcmToken, webName)
    {
        return;
    }

    async #reminderWhatsapp(queueEntry, phone, webName)
    {
        return;
    }

    async #reminderCall(queueEntry, phone, webName)
    {
        return;
    }

    async setUserReminder(phone, fcmToken, triggerAt, queueId, platform, webName)
    {
        try
        {
            const delay = new Date(triggerAt).getTime() - Date.now();

            if(delay <= 0)
            {
                console.error(`❌ setUserReminder: triggerAt is in the past for queueId ${queueId}`);
                return;
            }

            await WiraQueue.queues.reminders.add(
                `reminder-${queueId}`,
                {
                    queueId: queueId,
                    phone: phone,
                    fcmToken: fcmToken ?? null,
                    platform: platform,
                    webName: webName ?? "White Force"
                },
                {
                    delay: delay,
                    jobId: `reminder-${queueId}`,
                    removeOnComplete: true,
                    removeOnFail: false
                }
            );

            console.log(`✅ setUserReminder: Scheduled reminder ${queueId} for ${triggerAt} on ${platform}`);
        }
        catch(err)
        {
            console.error("❌ setUserReminder failed:", err.message);
        }
    }

    async scheduleExpiryJob(jobName, data, delayMs)
    {
        try
        {
            const jobId = jobName.replace(/:/g, "_");
            const existing = await WiraQueue.queues.expiry.getJob(jobId);

            if(existing)
            {
                await existing.remove();
            }

            await WiraQueue.queues.expiry.add(
                jobName,
                data,
                {
                    delay: delayMs,
                    jobId: jobId,
                    removeOnComplete: true,
                    removeOnFail: false
                }
            );
        }
        catch(err)
        {
            console.error(`❌ scheduleExpiryJob failed for ${jobName}:`, err.message);
        }
    }

    async cancelExpiryJob(jobName)
    {
        try
        {
            const jobId = jobName.replace(/:/g, "_");
            const job = await WiraQueue.queues.expiry.getJob(jobId);

            if(job)
            {
                await job.remove();
            }
        }
        catch(err)
        {
            console.error(`❌ cancelExpiryJob failed for ${jobName}:`, err.message);
        }
    }
}

WiraQueue.initialized = false;
WiraQueue.queues = {};
WiraQueue.workers = {};
WiraQueue.shared = {
    database: null,
    session: null,
    onSessionExpiry: null
};

module.exports = WiraQueue;