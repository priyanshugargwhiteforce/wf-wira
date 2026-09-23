const WiraRetrieve = require("../../Wira-Chatbot/WiraManager/WiraRetrieve");
const RedisManager = require("./RedisManager");

class InboundManager
{
    constructor(redis, database, phonePool, perNumberConcurrency, languageToSarvamCodes, defaultVad, availableCallTypes)
    {
        this.redis = redis
        this.database = database;
        this.phonePool = phonePool;
        this.perNumberConcurrency = perNumberConcurrency;
        this.languageToSarvamCodes = languageToSarvamCodes;
        this.defaultVad = defaultVad;
        this.availableCallTypes = availableCallTypes;

        this.retrieve = new WiraRetrieve();
        this.redisManager = new RedisManager(this.database, this.phonePool, this.perNumberConcurrency);
        this.tableName = "wira_inbound";

        //DEFAULTS
        this.defaultIntroMessage = "हेलो, मैं वीरा एआई बात कर रही हूँ व्हाइट फोर्स की तरफ से। मैं आपसे एक जॉब के बारे में बात करना चाहती हूँ। क्या अभी बात करने का सही समय है?"
    }

    async buildSession(callUUID, fromPhone, toPhone) 
    {
        try
        {
            return {
                statusCode: 200,
                success: true,
                message: "Session built successfully.",
                data: null
            };
        }
        catch(error)
        {
            console.error("Error occured in inbound call build session: ", error);
            
            return {
                statusCode: 500,
                success: false,
                message: "Error occured building incoming call session.",
                data: null
            };
        }
    }
}

module.exports = InboundManager;