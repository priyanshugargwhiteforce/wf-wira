const redisClient = require("@wira/shared/config/redisConfig");

const SESSION_TTL = 7200;
const SESSION_BUFFER = 300;
const CACHE_TTL_BUFFER = 30;

const WiraDatabase = require("./WiraDatabase");
const WiraQueue = require("./WiraQueue");

class WiraSession
{
    constructor(database, queue)
    {
        this.redis = redisClient;
        this.database = database ?? new WiraDatabase();
        this.queue = queue ?? new WiraQueue();
    }

    getSessionKey(phone)
    {
        return `wira-ai:${phone}`;
    }

    getUniversalCacheKey(promptName)
    {
        return `universal-cache:${promptName}`;
    }

    getUserCacheKey(phone, promptName)
    {
        return `wira-ai-cache:${phone}:${promptName}`;
    }

    async getSession(phone)
    {
        const raw = await this.redis.get(this.getSessionKey(phone));
        return raw ? JSON.parse(raw) : null;
    }

    async createSession(phone, userData, platform, socketId, webName, fcmToken = null)
    {
        const session = {
            user: userData,
            processing: {
                app: false,
                whatsapp: false
            },
            sockets: socketId ? [{
                platform: platform,
                socketId: socketId,
                fcmToken: fcmToken
            }] : [],
            database: {
                wiraCandidateId: null,
                wiraAppId: null,
                wiraWhatsappId: null
            },
            appConversation: [],
            whatsappConversation: [],
            webName: webName,
            iteration: 1,
            lastOutput: null,
            turnNotebook: null,
            activePrompt: "conversation",
            prompts: {
                conversation: null,
                profile: null,
                examiner: null,
                screening: null
            },
            sessionMetadata: {
                profile: null,
                examiner: null,
                screening: null
            },
            wishlistIds: [],
            appliedJobIds: []
        };

        await this.updateSession(phone, session);
        return session;
    }

    async updateSession(phone, session)
    {
        const previousRaw = await this.redis.get(this.getSessionKey(phone));
        const previousSession = previousRaw ? JSON.parse(previousRaw) : null;
        const metadataChanged = !previousSession || JSON.stringify(session.sessionMetadata) !== JSON.stringify(previousSession.sessionMetadata);

        await this.redis.set(this.getSessionKey(phone), JSON.stringify(session), "EX", SESSION_TTL);

        if(metadataChanged)
        {
            await this.queue.scheduleExpiryJob(
                `session-expiry:${phone}`,
                { 
                    phone: phone 
                },
                (SESSION_TTL - SESSION_BUFFER) * 1000
            );
        }
    }

    async addSocket(phone, platform, socketId, fcmToken = null)
    {
        const session = await this.getSession(phone);

        if(!session)
        {
            return null;
        }

        session.sockets = session.sockets.filter(s => s.socketId !== socketId);

        if(fcmToken)
        {
            session.sockets = session.sockets.filter(s => s.fcmToken !== fcmToken);
        }

        session.sockets.push({
            platform: platform,
            socketId: socketId,
            fcmToken: fcmToken
        });

        await this.updateSession(phone, session);
        return session;
    }

    async removeSocket(phone, socketId)
    {
        const session = await this.getSession(phone);

        if(!session)
        {
            return;
        }

        session.sockets = session.sockets.filter(s => s.socketId !== socketId);
        await this.updateSession(phone, session);
    }

    async getUniversalCache(promptName)
    {
        const raw = await this.redis.get(this.getUniversalCacheKey(promptName));
        return raw ? JSON.parse(raw) : null;
    }

    async setUniversalCache(promptName, cacheData, ttlSeconds)
    {
        const value = {
            cacheId: cacheData.cacheId,
            modelName: cacheData.modelName,
            cachedTokens: cacheData.cachedTokens,
            dbId: cacheData.dbId,
            costPerSecond: cacheData.costPerSecond,
            createdAt: cacheData.createdAt,
            ttlSeconds: ttlSeconds
        };

        await this.redis.set(this.getUniversalCacheKey(promptName), JSON.stringify(value), "EX", ttlSeconds);

        await this.queue.scheduleExpiryJob(
            `universal-cache-expiry:${promptName}`,
            { promptName, cacheData: value },
            (ttlSeconds - CACHE_TTL_BUFFER) * 1000
        );
    }

    async deleteUniversalCache(promptName)
    {
        const raw = await this.redis.get(this.getUniversalCacheKey(promptName));

        if(!raw)
        {
            return null;
        }

        const cacheData = JSON.parse(raw);

        await this.queue.cancelExpiryJob(`universal-cache-expiry:${promptName}`);
        await this.redis.del(this.getUniversalCacheKey(promptName));

        return cacheData;
    }

    async getUserCache(phone, promptName)
    {
        const raw = await this.redis.get(this.getUserCacheKey(phone, promptName));
        return raw ? JSON.parse(raw) : null;
    }

    async setUserCache(phone, promptName, cacheData, ttlSeconds)
    {
        const value = {
            cacheId: cacheData.cacheId,
            modelName: cacheData.modelName,
            cachedTokens: cacheData.cachedTokens,
            dbId: cacheData.dbId,
            costPerSecond: cacheData.costPerSecond,
            createdAt: cacheData.createdAt,
            ttlSeconds: ttlSeconds
        };

        await this.redis.set(this.getUserCacheKey(phone, promptName), JSON.stringify(value), "EX", ttlSeconds);

        await this.queue.scheduleExpiryJob(
            `user-cache-expiry:${phone}:${promptName}`,
            { phone, promptName, cacheData: value },
            (ttlSeconds - CACHE_TTL_BUFFER) * 1000
        );
    }

    async deleteUserCache(phone, promptName)
    {
        const raw = await this.redis.get(this.getUserCacheKey(phone, promptName));

        if(!raw)
        {
            return null;
        }

        const cacheData = JSON.parse(raw);

        await this.queue.cancelExpiryJob(`user-cache-expiry:${phone}:${promptName}`);
        await this.redis.del(this.getUserCacheKey(phone, promptName));

        return cacheData;
    }
}

module.exports = WiraSession;