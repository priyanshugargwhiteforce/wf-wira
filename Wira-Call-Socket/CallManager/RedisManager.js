const Redis = require("ioredis");

class RedisManager
{
    constructor(redisConfig = {})
    {
        this.client = require("@wira/shared/config/redisConfig");

        this.sessionTTL = redisConfig.sessionTTL ?? 3600;
        this.costTTL = redisConfig.costTTL ?? 86400;

        this.bucketTimers = {};
    }

    #sessionKey(callUUID)
    {
        return `screening:callId:${callUUID}`;
    }

    #costKey(callUUID)
    {
        return `cost:callId:${callUUID}`;
    }

    #emptyBucket(startTime)
    {
        return {
            startTime: startTime,
            endTime: null,
            sarvamTTS: { chars: 0, cost: 0 },
            sarvamSTT: { seconds: 0, cost: 0 },
            plivo: { seconds: 0, cost: 0 },
            gemini: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, cost: 0 },
            totalCost: 0
        };
    }

    #emptyCostRecord(startTime)
    {
        return {
            currentBucket: this.#emptyBucket(startTime),
            buckets: [],
            summary: {
                sarvamTTS: { chars: 0, cost: 0 },
                sarvamSTT: { seconds: 0, cost: 0 },
                plivo: { seconds: 0, cost: 0 },
                gemini: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, cost: 0 },
                totalCost: 0
            },
            currency: "INR",
            updatedAt: null
        };
    }

    async getSession(callUUID)
    {
        try
        {
            const raw = await this.client.get(this.#sessionKey(callUUID));

            if(!raw)
            {
                return null;
            }

            return JSON.parse(raw);
        }
        catch(err)
        {
            console.error(`❌ [Redis] getSession failed for ${callUUID}:`, err.message);
            return null;
        }
    }

    async saveSession(callUUID, session)
    {
        try
        {
            await this.client.set(
                this.#sessionKey(callUUID),
                JSON.stringify(session),
                "EX",
                this.sessionTTL
            );
        }
        catch(err)
        {
            console.error(`❌ [Redis] saveSession failed for ${callUUID}:`, err.message);
        }
    }

    async getIntroAudioAndInit(callUUID)
    {
        try
        {
            const session = await this.getSession(callUUID);

            if(!session)
            {
                return null;
            }

            const introAudio = session.introAudio ?? null;

            session.transcript.push({ role: "assistant", content: session.intro });
            delete session.introAudio;

            await this.saveSession(callUUID, session);

            return introAudio;
        }
        catch(err)
        {
            console.error(`❌ [Redis] getIntroAudioAndInit failed for ${callUUID}:`, err.message);
            return null;
        }
    }

    async #getCostRecord(callUUID)
    {
        try
        {
            const raw = await this.client.get(this.#costKey(callUUID));

            if(!raw)
            {
                return null;
            }

            return JSON.parse(raw);
        }
        catch(err)
        {
            console.error(`❌ [Redis] getCostRecord failed for ${callUUID}:`, err.message);
            return null;
        }
    }

    async #saveCostRecord(callUUID, record)
    {
        try
        {
            record.updatedAt = new Date().toISOString();

            await this.client.set(
                this.#costKey(callUUID),
                JSON.stringify(record),
                "EX",
                this.costTTL
            );
        }
        catch(err)
        {
            console.error(`❌ [Redis] saveCostRecord failed for ${callUUID}:`, err.message);
        }
    }

    #sealCurrentBucket(record)
    {
        const bucket = record.currentBucket;
        bucket.endTime = new Date().toISOString();

        record.buckets.push(bucket);

        record.summary.sarvamTTS.chars += bucket.sarvamTTS.chars;
        record.summary.sarvamTTS.cost += bucket.sarvamTTS.cost;
        record.summary.sarvamSTT.seconds += bucket.sarvamSTT.seconds;
        record.summary.sarvamSTT.cost += bucket.sarvamSTT.cost;
        record.summary.plivo.seconds += bucket.plivo.seconds;
        record.summary.plivo.cost += bucket.plivo.cost;
        record.summary.gemini.inputTokens += bucket.gemini.inputTokens;
        record.summary.gemini.cachedInputTokens += bucket.gemini.cachedInputTokens;
        record.summary.gemini.outputTokens += bucket.gemini.outputTokens;
        record.summary.gemini.cost += bucket.gemini.cost;
        record.summary.totalCost += bucket.totalCost;
        record.currentBucket = this.#emptyBucket(new Date().toISOString());
    }

    async startCostTracking(callUUID, onBucketSeal = null)
    {
        const billingStart = new Date().toISOString();

        const session = await this.getSession(callUUID);

        if(session)
        {
            session.startTime = billingStart;
            await this.saveSession(callUUID, session);
        }

        const record = this.#emptyCostRecord(billingStart);
        await this.#saveCostRecord(callUUID, record);

        if(!this.bucketSealCallbacks)
        {
            this.bucketSealCallbacks = {};
        }

        if(onBucketSeal)
        {
            this.bucketSealCallbacks[callUUID] = onBucketSeal;
        }

        this.bucketTimers[callUUID] = setInterval(async () =>
        {
            if(onBucketSeal)
            {
                await onBucketSeal();
            }

            const currentRecord = await this.#getCostRecord(callUUID);

            if(!currentRecord)
            {
                return;
            }

            this.#sealCurrentBucket(currentRecord);
            await this.#saveCostRecord(callUUID, currentRecord);
        }, 60_000);
    }

    async stopCostTracking(callUUID, outboundScreeningId = null, db = null)
    {
        const timer = this.bucketTimers[callUUID];

        if(timer)
        {
            clearInterval(timer);
            delete this.bucketTimers[callUUID];
        }

        if(this.bucketSealCallbacks && this.bucketSealCallbacks[callUUID])
        {
            await this.bucketSealCallbacks[callUUID]();
            delete this.bucketSealCallbacks[callUUID];
        }

        const record = await this.#getCostRecord(callUUID);

        if(!record)
        {
            return;
        }

        const bucket = record.currentBucket;
        const hasData = bucket.totalCost > 0;

        if(hasData)
        {
            this.#sealCurrentBucket(record);
            await this.#saveCostRecord(callUUID, record);
        }

        if(outboundScreeningId && db)
        {
            await db.insertCostBuckets(outboundScreeningId, record);
        }
    }

    async recordSarvamTTS(callUUID, chars, cost)
    {
        console.log(`🔍 [Redis] recordSarvamTTS called — callUUID: ${callUUID}, chars: ${chars}, cost: ${cost}, at: ${new Date().toISOString()}`);
        const record = await this.#getCostRecord(callUUID);

        if(!record)
        {
            return;
        }

        record.currentBucket.sarvamTTS.chars += chars;
        record.currentBucket.sarvamTTS.cost += cost;
        record.currentBucket.totalCost += cost;

        await this.#saveCostRecord(callUUID, record);
    }

    async recordSarvamSTT(callUUID, seconds, cost)
    {
        console.log(`🔍 [Redis] recordSarvamSTT called — callUUID: ${callUUID}, seconds: ${seconds}, cost: ${cost}, at: ${new Date().toISOString()}`);
        const record = await this.#getCostRecord(callUUID);

        if(!record)
        {
            return;
        }

        record.currentBucket.sarvamSTT.seconds += seconds;
        record.currentBucket.sarvamSTT.cost += cost;
        record.currentBucket.totalCost += cost;

        await this.#saveCostRecord(callUUID, record);
    }

    async recordPlivo(callUUID, seconds, cost)
    {
        const record = await this.#getCostRecord(callUUID);

        if(!record)
        {
            return;
        }

        record.currentBucket.plivo.seconds += seconds;
        record.currentBucket.plivo.cost += cost;
        record.currentBucket.totalCost += cost;

        await this.#saveCostRecord(callUUID, record);
    }

    async recordGemini(callUUID, usage)
    {
        if(!usage)
        {
            return;
        }

        const record = await this.#getCostRecord(callUUID);

        if(!record)
        {
            return;
        }

        record.currentBucket.gemini.inputTokens += usage.inputTokens ?? 0;
        record.currentBucket.gemini.cachedInputTokens += usage.cachedInputTokens ?? 0;
        record.currentBucket.gemini.outputTokens += usage.outputTokens ?? 0;
        record.currentBucket.gemini.cost += usage.cost ?? 0;
        record.currentBucket.totalCost += usage.cost ?? 0;

        await this.#saveCostRecord(callUUID, record);
    }

    async getCostSummary(callUUID)
    {
        return await this.#getCostRecord(callUUID);
    }

    async destroy()
    {
        try
        {
            await this.client.quit();
        }
        catch(err)
        {
            console.error(`❌ [Redis] Failed to close connection:`, err.message);
        }
    }
}

module.exports = RedisManager;