const axios = require("axios");
const redisClient = require("../config/redisConfig");
const db = require("../database/WiraDB");
const Task = require("../Engine/Inner/Task");

class Session
{
    constructor(phone)
    {
        this.phone = phone;
        this.redis = redisClient;
    }

    getSessionKey()
    {
        return `wira-ai:${this.phone}`;
    }

    async getSession()
    {
        const raw = await this.redis.get(this.getSessionKey());
        return raw ? JSON.parse(raw) : null;
    }

    async setSession(session)
    {
        await this.redis.set(this.getSessionKey(), JSON.stringify(session));
    }

    async createSession(rawUserData = null, platform = null, immediate = false)
    {
        let session = await this.getSession();

        if(!session)
        {
            let userData = 
            {
                candidateId: rawUserData?.candidateId ?? null,
                fullName: rawUserData?.candidateName ?? null,
                phone: this.phone ?? null,
                email: rawUserData?.email ?? null,
                resume: null,
                resumeParserJson: null,
                preferredLocation: null,
                noticePeriod: null,
                industry: null,
                expectedSalary: null,
                experience: null,
                totalExperience: null,
                experienceData: null,
                educationData: null,
                gender: null,
                maritalStatus: null,
                relocate: null,
                language: null,
                communication: null,
                dateOfBirth: null,
                skills: null,
                country: null,
                state: null,
                city: null,
                address: null,
                postelCode: null,
                atsResume: null
            };

            session = 
            {
                user: userData,
                stillFetchingData: true,
                wishlistIds: [],
                appliedJobIds: [],
                database: 
                {
                    wiraCandidateId: null,
                    wiraAppId: null,
                    wiraWhatsappId: null
                },
                chat: 
                {
                    common: 
                    {
                        prompts: 
                        {
                            conversation: null,
                            profile: null,
                            examiner: null,
                            screening: null
                        }
                    },
                    app: 
                    {
                        processing: false,
                        iteration: 1,
                        activePrompt: "conversation"
                    },
                    web: 
                    {
                        processing: false,
                        iteration: 1,
                        activePrompt: "conversation"
                    },
                    whatsapp: 
                    {
                        processing: false,
                        iteration: 1,
                        activePrompt: "conversation"
                    }
                },
                call: 
                {

                },
                temporary: 
                {

                }
            };

            await this.redis.set(this.getSessionKey(), JSON.stringify(session));

            if(immediate)
            {
                await this.updateSessionFireAndForget(true, platform);
                session = await this.getSession();
            }
            else
            {
                this.updateSessionFireAndForget(false, platform);
            }
        }

        return session;
    }

    async updateSessionFireAndForget(immediate = false, platform = null)
    {
        const fetchCandidateTask = new Task(this.phone, "fetch-candidate");

        const fetchSecondaryData = async () =>
        {
            try
            {
                const [wishlistResult, appliedResult] = await Promise.all(
                    [
                        axios.post(
                            "https://white-force.com/plus/api/candidate-wishlist-ids", 
                            { 
                                mobile: this.phone 
                            }, 
                            { 
                                headers: 
                                { 
                                    "x-api-key": process.env.WIRA_API_KEY 
                                } 
                            }
                        ),
                        axios.post(
                            "https://white-force.com/plus/api/candidate-applied-ids", 
                            { 
                                mobile: this.phone 
                            }, 
                            { 
                                headers: 
                                { 
                                    "x-api-key": process.env.WIRA_API_KEY 
                                } 
                            }
                        )
                    ]
                );

                const currentSession = await this.getSession();
                if(currentSession)
                {
                    currentSession.wishlistIds = wishlistResult.data?.status && Array.isArray(wishlistResult.data?.data) ? wishlistResult.data.data : [];
                    currentSession.appliedJobIds = appliedResult.data?.status && Array.isArray(appliedResult.data?.data) ? appliedResult.data.data : [];
                    currentSession.stillFetchingData = false;

                    await this.redis.set(this.getSessionKey(), JSON.stringify(currentSession));
                }
            }
            catch(err)
            {
                console.error("Error fetching secondary session data:", err);
                const currentSession = await this.getSession();
                if(currentSession)
                {
                    currentSession.stillFetchingData = false;
                    await this.redis.set(this.getSessionKey(), JSON.stringify(currentSession));
                }
            }
        };

        if(immediate)
        {
            fetchSecondaryData();

            try
            {
                const fetchCandidateResult = await fetchCandidateTask.execute();
                const session = await this.getSession();

                if(session && fetchCandidateResult && fetchCandidateResult.success)
                {
                    session.user = fetchCandidateResult.data;
                    await this.redis.set(this.getSessionKey(), JSON.stringify(session));
                }
            }
            catch(err)
            {
                console.error("Error fetching candidate profile immediately:", err);
            }
        }
        else
        {
            try
            {
                const [fetchCandidateResult, wishlistResult, appliedResult] = await Promise.all(
                    [
                        fetchCandidateTask.execute(),
                        axios.post(
                            "https://white-force.com/plus/api/candidate-wishlist-ids", 
                            { 
                                mobile: this.phone 
                            }, 
                            { 
                                headers: 
                                { 
                                    "x-api-key": process.env.WIRA_API_KEY 
                                } 
                            }
                        ),
                        axios.post(
                            "https://white-force.com/plus/api/candidate-applied-ids", 
                            { 
                                mobile: this.phone 
                            }, 
                            { 
                                headers: 
                                { 
                                    "x-api-key": process.env.WIRA_API_KEY 
                                } 
                            }
                        )
                    ]
                );

                const session = await this.getSession();

                if(!session)
                {
                    console.error("No Session Found for update.");
                    return;
                }

                if(fetchCandidateResult && fetchCandidateResult.success)
                {
                    session.user = fetchCandidateResult.data;
                }

                session.wishlistIds = wishlistResult.data?.status && Array.isArray(wishlistResult.data?.data) ? wishlistResult.data.data : [];
                session.appliedJobIds = appliedResult.data?.status && Array.isArray(appliedResult.data?.data) ? appliedResult.data.data : [];
                session.stillFetchingData = false;

                await this.redis.set(this.getSessionKey(), JSON.stringify(session));
            }
            catch(err)
            {
                console.error("Error updating session in background:", err);
                const session = await this.getSession();
                if(session)
                {
                    session.stillFetchingData = false;
                    await this.redis.set(this.getSessionKey(), JSON.stringify(session));
                }
            }
        }
    }

    async getNotebook(category, fields)
    {
        try
        {

        }
        catch(error)
        {
            console.error("Error fetching notebook in getNotebook in Wira/Session:", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching notebook from session.",
                result: null
            };
        }
    }

    async setNotebook(id, category, fields, label, description, platform, data)
    {
        try
        {
            
        }
        catch(error)
        {
            console.error("Error setting notebook in setNotebook in Wira/Session:", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured setting notebook in session.",
                data: null
            };
        }
    }

    async deleteNotebook(category, fields)
    {
        try
        {

        }
        catch(error)
        {
            console.error("Error deleting notebook in deleteNotebook in Wira/Session:", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting notebook from session.",
                result: null
            };
        }
    }
}

module.exports = Session;