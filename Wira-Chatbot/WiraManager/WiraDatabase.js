const WiraDB = require("@wira/shared/database/WiraDB");
const sarvam = require("@wira/shared/Utility/sarvamHandler");
const embedder = require("@wira/shared/Utility/embedding");
const AI = require("@wira/shared/AI/executeAI");

const introAudioInProgress = new Map();

class WiraDatabase
{
    constructor()
    {
        this.db = WiraDB;
    }

    async ensureUser(wiraSession, phone, platform, webName, retrieve = false)
    {
        const session = await wiraSession.getSession(phone);

        if(!session)
        {
            return {
                statusCode: 401,
                success: false,
                message: "Session not found.",
                data: null
            };
        }

        const dbIds = session.database ?? {
            wiraCandidateId: null,
            wiraAppId: null,
            wiraWhatsappId: null
        };

        let sessionDirty = false;
        let wasCreated = false;
        let candidate = null;

        if(!dbIds.wiraCandidateId)
        {
            const existing = await this.db.fetchWiraCandidates({ phone });

            if(existing && existing.total > 0)
            {
                candidate = existing.rows[0];
            }
            else
            {
                const insertData = {
                    phone,
                    hasApp: false,
                    hasCall: false,
                    hasWhatsapp: false
                };

                if(session.user.email)
                {
                    insertData.email = session.user.email;
                }

                if(session.user.candidateId)
                {
                    insertData.candidateId = session.user.candidateId;
                }

                if(session.user.fullName)
                {
                    insertData.name = session.user.fullName;
                }

                if(session.user.candidateData)
                {
                    insertData.candidateData = session.user.candidateData;
                }

                candidate = await this.db.insertWiraCandidate(insertData);
                if(!candidate)
                {
                    return {
                        statusCode: 500,
                        success: false,
                        message: "Failed to create candidate.",
                        data: null
                    };
                }
            }

            dbIds.wiraCandidateId = candidate.id;
            sessionDirty = true;
        }

        let appSession = null;
        if(platform === "App" || platform === "Web")
        {
            if(!dbIds.wiraAppId)
            {
                const existing = await this.db.fetchWiraApps(
                    {
                        wiraCandidateId: dbIds.wiraCandidateId,
                        webName
                    }, 
                1, 1);

                if(existing && existing.total > 0)
                {
                    appSession = existing.rows[0];
                }
                else
                {
                    await this.db.updateWiraCandidates(
                        { 
                            hasApp: true 
                        },
                        { 
                            id: dbIds.wiraCandidateId 
                        }
                    );

                    appSession = await this.db.insertWiraApp(
                        {
                            wiraCandidateId: dbIds.wiraCandidateId,
                            webName: webName
                        }
                    );

                    if(!appSession)
                    {
                        return {
                            statusCode: 500,
                            success: false,
                            message: "Failed to create app session.",
                            data: null
                        };
                    }

                    wasCreated = true;
                }

                dbIds.wiraAppId = appSession.id;
                sessionDirty = true;
            }
        }

        let whatsappSession = null;
        if(platform === "Whatsapp")
        {
            if(!dbIds.wiraWhatsappId)
            {
                const existing = await this.db.fetchWiraWhatsapps(
                    {
                        wiraCandidateId: dbIds.wiraCandidateId,
                        webName: webName
                    }, 
                1, 1);

                if(existing && existing.total > 0)
                {
                    whatsappSession = existing.rows[0];
                }
                else
                {
                    await this.db.updateWiraCandidates(
                        { 
                            hasWhatsapp: true 
                        },
                        { 
                            id: dbIds.wiraCandidateId 
                        }
                    );

                    whatsappSession = await this.db.insertWiraWhatsapp(
                        {
                            wiraCandidateId: dbIds.wiraCandidateId,
                            webName: webName
                        }
                    );

                    if(!whatsappSession)
                    {
                        return {
                            statusCode: 500,
                            success: false,
                            message: "Failed to create whatsapp session.",
                            data: null
                        };
                    }
                }

                dbIds.wiraWhatsappId = whatsappSession.id;
                sessionDirty = true;
            }
        }

        if(sessionDirty)
        {
            session.database = dbIds;
            await wiraSession.updateSession(phone, session);
        }

        let fetchedCandidate = null;
        let fetchedAppSession = null;
        let fetchedWaSession = null;

        if(retrieve)
        {
            if(!candidate)
            {
                const result = await this.db.fetchWiraCandidates({ phone });
                fetchedCandidate = result?.rows?.[0] ?? null;
            }
            else
            {
                fetchedCandidate = candidate;
            }

            if((platform === "App" || platform === "Web") && !appSession)
            {
                const result = await this.db.fetchWiraApps(
                    {
                        wiraCandidateId: dbIds.wiraCandidateId,
                        webName
                    }, 
                1, 1);

                fetchedAppSession = result?.rows?.[0] ?? null;
            }
            else
            {
                fetchedAppSession = appSession;
            }

            if(platform === "Whatsapp" && !whatsappSession)
            {
                const result = await this.db.fetchWiraWhatsapps(
                    {
                        wiraCandidateId: dbIds.wiraCandidateId,
                        webName: webName
                    }, 
                1, 1);

                fetchedWaSession = result?.rows?.[0] ?? null;
            }
            else
            {
                fetchedWaSession = whatsappSession;
            }
        }

        return {
            statusCode: 200,
            success: true,
            message: "User ensured successfully.",
            data: {
                session: session,
                dbIds: dbIds,
                wasCreated: wasCreated,
                candidate: retrieve ? fetchedCandidate : null,
                appSession: retrieve ? fetchedAppSession : null,
                whatsappSession: retrieve ? fetchedWaSession : null
            }
        };
    }

    async semanticSearchAllMessages(phone, platform, text, threshold = 30, limit = 5, excludeIds = [])
    {
        try
        {
            const candidateResult = await this.db.fetchWiraCandidates({ phone });
            if(!candidateResult || candidateResult.total === 0)
            {
                return null;
            }

            const candidate = candidateResult.rows[0];
            const embedding = await embedder.getEmbedding(text);

            const searchPromises = [];
            const appSessionResult = await this.db.fetchWiraApps({ wiraCandidateId: candidate.id }, 1, 1);
            const appSession = appSessionResult?.rows?.[0] ?? null;

            if(appSession)
            {
                searchPromises.push(
                    this.db.semanticSearchWiraAppMessages(
                        embedding, 
                        threshold, 
                        1, 
                        limit, 
                        {
                            wiraAppId: appSession.id,
                            excludeIds: (platform === "App" || platform === "Web") ? excludeIds : []
                        }
                    ).then(result => (result?.rows ?? []).map(row => (
                        { 
                            ...row, 
                            source: "App" 
                        }
                    )))
                );  
            }

            if(candidate.hasWhatsapp)
            {
                const whatsappResult = await this.db.fetchWiraWhatsapps({ wiraCandidateId: candidate.id }, 1, 1);
                const whatsappSession = whatsappResult?.rows?.[0] ?? null;

                if(whatsappSession)
                {
                    searchPromises.push(
                        this.db.semanticSearchWiraWhatsappMessages(
                            embedding, 
                            threshold, 
                            1, 
                            limit, 
                            {
                                wiraWhatsappId: whatsappSession.id,
                                excludeIds: platform === "Whatsapp" ? excludeIds : []
                            }
                        ).then(result => (result?.rows ?? []).map(row => (
                            { 
                                ...row, 
                                source: "Whatsapp" 
                            }
                        )))
                    );
                }
            }

            if(candidate.hasCall)
            {
                searchPromises.push(
                    this.db.semanticSearchWiraCalls(
                        embedding, 
                        threshold, 
                        1, 
                        limit, 
                        {
                            wiraCandidateId: candidate.id
                        }   
                    ).then(result => (result?.rows ?? []).map(row => (
                        { 
                            ...row, 
                            source: "Call" 
                        }
                    )))
                );
            }

            const results = await Promise.all(searchPromises);
            const merged = results.flat();
            merged.sort((a, b) => b.similarity - a.similarity);

            return merged.slice(0, limit);
        }
        catch(err)
        {
            console.error("❌ semanticSearchAllMessages failed:", err.message);
            return null;
        }
    }

    async semanticSearchAllFiles(phone, text, threshold = 30, limit = 5, excludeFileNames = [], includeFileNames = [])
    {
        try
        {
            const embedResult = await AI.runWiraEmbedChunks({
                chunks: [text],
                taskType: "RETRIEVAL_QUERY",
                outputDimensionality: 1536
            });

            if(!embedResult || !embedResult.vectors || embedResult.vectors.length === 0)
            {
                return null;
            }

            const embedding = `[${embedResult.vectors[0].join(",")}]`;
            const filters = {
                excludeFileNames: excludeFileNames.length > 0 ? excludeFileNames : null,
                includeFileNames: includeFileNames.length > 0 ? includeFileNames : null
            };

            const searchResult = await this.db.semanticSearchWiraFileChunks(
                embedding,
                threshold,
                1,
                limit,
                filters
            );

            if(!searchResult || searchResult.total === 0)
            {
                return [];
            }

            return searchResult.rows;
        }
        catch(err)
        {
            console.error("❌ semanticSearchAllFiles failed:", err.message);
            return null;
        }
    }

    async fetchFilesContent(fileNames = [])
    {
        try
        {
            if(!fileNames || fileNames.length === 0)
            {
                return [];
            }

            const results = await Promise.all(fileNames.map(async (fileName) =>
            {
                try
                {
                    const fileResult = await this.db.fetchWiraFiles(
                        { 
                            fileName: fileName, 
                            extracted: true 
                        }, 
                        1, 
                        1
                    );

                    if(!fileResult || fileResult.total === 0)
                    {
                        return { 
                            fileName: fileName, 
                            transcript: null 
                        };
                    }

                    const file = fileResult.rows[0];
                    if(!file.extracted || !file.chunkCount || file.chunkCount === 0)
                    {
                        return { 
                            fileName: fileName, 
                            transcript: null 
                        };
                    }

                    const chunksResult = await this.db.fetchWiraFileChunks(
                        { 
                            wiraFileId: file.id 
                        }, 
                        1, 
                        file.chunkCount
                    );

                    if(!chunksResult || chunksResult.total === 0)
                    {
                        return { 
                            fileName: fileName, 
                            transcript: null 
                        };
                    }

                    const sorted = chunksResult.rows.sort((a, b) => a.chunkIndex - b.chunkIndex);
                    const transcript = sorted.map(c => c.content).join(" ");

                    return { 
                        fileName: fileName, 
                        transcript: transcript 
                    };
                }
                catch(err)
                {
                    console.error(`❌ fetchFilesContent: failed for ${fileName}:`, err.message);

                    return { 
                        fileName: fileName, 
                        transcript: null 
                    };
                }
            }));

            return results;
        }
        catch(err)
        {
            console.error("❌ fetchFilesContent failed:", err.message);
            return fileNames.map(fileName => ({ fileName: fileName, transcript: null }));
        }
    }

    async fetchCandidateInsights(phone)
    {
        try
        {
            const candidateResult = await this.db.fetchWiraCandidates({ phone });

            if(!candidateResult || candidateResult.total === 0)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "Candidate not found.",
                    data: null
                };
            }

            const candidate = candidateResult.rows[0];

            return {
                statusCode: 200,
                success: true,
                data: {
                    wiraCandidateId: candidate.id,
                    insights: candidate.insights ?? null
                }
            };
        }
        catch(err)
        {
            console.error("❌ fetchCandidateInsights failed:", err.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async updateCandidateInsights(phone, insights)
    {
        try
        {
            const candidateResult = await this.db.fetchWiraCandidates({ phone });

            if(!candidateResult || candidateResult.total === 0)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "Candidate not found.",
                    data: null
                };
            }

            const candidate = candidateResult.rows[0];
            const updated = await this.db.updateWiraCandidates(
                { insights },
                { id: candidate.id }
            );

            if(!updated)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to update insights.",
                    data: null
                };
            }

            return {
                statusCode: 200,
                success: true,
                data: {
                    wiraCandidateId: candidate.id,
                    insights: updated[0]?.insights ?? null
                }
            };
        }
        catch(err)
        {
            console.error("❌ updateCandidateInsights failed:", err.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async fetchLastMessages(phone, platform, limit = 5, webName = "White Force")
    {
        try
        {
            const candidateResult = await this.db.fetchWiraCandidates({ phone });

            if(!candidateResult || candidateResult.total === 0)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "Candidate not found.",
                    data: null
                };
            }

            const candidate = candidateResult.rows[0];
            if(platform === "App" || platform === "Web")
            {
                const appSessionResult = await this.db.fetchWiraApps({
                    wiraCandidateId: candidate.id,
                    webName: webName
                }, 1, 1);

                if(!appSessionResult || appSessionResult.total === 0)
                {
                    return {
                        statusCode: 404,
                        success: false,
                        message: "App session not found.",
                        data: null
                    };
                }

                const appSession = appSessionResult.rows[0];
                const messagesResult = await this.db.fetchWiraAppMessages({ wiraAppId: appSession.id }, 1, limit);

                console.log("fetchLastMessages result:", JSON.stringify({
                    wiraAppId: appSession.id,
                    limit: limit,
                    total: messagesResult?.total,
                    rows: messagesResult?.rows?.map(r => ({ id: r.id, role: r.role, createdAt: r.createdAt }))
                }));

                return {
                    statusCode: 200,
                    success: true,
                    data: {
                        messages: messagesResult?.rows ?? [],
                        total: messagesResult?.total ?? 0
                    }
                };
            }

            if(platform === "Whatsapp")
            {
                const whatsappResult = await this.db.fetchWiraWhatsapps({
                    wiraCandidateId: candidate.id,
                    webName: webName
                }, 1, 1);

                if(!whatsappResult || whatsappResult.total === 0)
                {
                    return {
                        statusCode: 404,
                        success: false,
                        message: "Whatsapp session not found.",
                        data: null
                    };
                }

                const whatsappSession = whatsappResult.rows[0];
                const messagesResult = await this.db.fetchWiraWhatsappMessages({ wiraWhatsappId: whatsappSession.id }, 1, limit);

                return {
                    statusCode: 200,
                    success: true,
                    data: {
                        messages: messagesResult?.rows ?? [],
                        total: messagesResult?.total ?? 0
                    }
                };
            }

            return {
                statusCode: 400,
                success: false,
                message: `Unsupported platform: ${platform}`,
                data: null
            };
        }
        catch(err)
        {
            console.error("❌ fetchLastMessages failed:", err.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async createCacheCost(cacheId, promptName, modelName, cachedTokens, createdAt)
    {
        try
        {
            const inserted = await this.db.insertWiraCacheCost({
                cacheId: cacheId,
                promptName: promptName,
                modelName: modelName,
                cachedTokens: cachedTokens,
                cost: 0,
                createdAt: createdAt,
                deletedAt: new Date().toISOString()
            });

            if(!inserted)
            {
                console.error("❌ createCacheCost: Failed to insert cache cost.");
                return null;
            }

            return inserted.id;
        }
        catch(err)
        {
            console.error("❌ createCacheCost failed:", err.message);
            return null;
        }
    }

    async finalizeCacheCost(dbId, cost, deletedAt)
    {
        try
        {
            const updated = await this.db.updateWiraCacheCosts(
                {
                    cost: cost,
                    deletedAt: deletedAt
                },
                {
                    id: dbId
                }
            );

            if(!updated)
            {
                console.error("❌ finalizeCacheCost: Failed to update cache cost.");
                return null;
            }

            return updated[0];
        }
        catch(err)
        {
            console.error("❌ finalizeCacheCost failed:", err.message);
            return null;
        }
    }

    async fetchCandidateFiles(phone, webName = "White Force")
    {
        try
        {
            const candidateResult = await this.db.fetchWiraCandidates({ phone });

            if(!candidateResult || candidateResult.total === 0)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "Candidate not found.",
                    data: null
                };
            }

            const candidate = candidateResult.rows[0];
            const files = [];

            function formatDateTime(dateInput) 
            {
                const date = new Date(dateInput);

                const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

                const dayName = dayNames[date.getDay()];
                const day = date.getDate();
                const month = monthNames[date.getMonth()];
                const year = date.getFullYear();

                let hours = date.getHours();
                const minutes = date.getMinutes().toString().padStart(2, "0");
                const ampm = hours >= 12 ? "pm" : "am";
                hours = hours % 12 || 12;

                function daySuffix(d)
                {
                    if(d >= 11 && d <= 13)
                    {
                        return "th";
                    }

                    switch(d % 10)
                    {
                        case 1: 
                            return "st";

                        case 2: 
                            return "nd";

                        case 3: 
                            return "rd";

                        default: 
                            return "th";
                    }
                }

                return `${dayName}, ${day}${daySuffix(day)} ${month} ${year}, ${hours}:${minutes}${ampm}`;
            };

            const appSessionResult = await this.db.fetchWiraApps({
                wiraCandidateId: candidate.id,
                webName
            }, 1, 1);

            const appSession = appSessionResult?.rows?.[0] ?? null;
            if(appSession)
            {
                const appMessages = await this.db.fetchWiraAppMessages({ wiraAppId: appSession.id }, 1, 1000);

                for(const msg of (appMessages?.rows ?? []))
                {
                    if(msg.files && Array.isArray(msg.files) && msg.files.length > 0)
                    {
                        for(const file of msg.files)
                        {
                            if(!file.fileName || !file.fileType)
                            {
                                continue;
                            }

                            files.push({
                                messageId: msg.id,
                                fileName: file.fileName,
                                fileType: file.fileType,
                                platform: msg.platform ?? "App",
                                sentAt: formatDateTime(msg.createdAt),
                                createdAt: msg.createdAt
                            });
                        }
                    }
                }
            }

            if(candidate.hasWhatsapp)
            {
                const whatsappResult = await this.db.fetchWiraWhatsapps({
                    wiraCandidateId: candidate.id,
                    webName
                }, 1, 1);

                const whatsappSession = whatsappResult?.rows?.[0] ?? null;
                if(whatsappSession)
                {
                    const waMessages = await this.db.fetchWiraWhatsappMessages({ wiraWhatsappId: whatsappSession.id }, 1, 1000);

                    for(const msg of (waMessages?.rows ?? []))
                    {
                        if(msg.files && Array.isArray(msg.files) && msg.files.length > 0)
                        {
                            for(const file of msg.files)
                            {
                                if(!file.fileName || !file.fileType)
                                {
                                    continue;
                                }

                                files.push({
                                    messageId: msg.id,
                                    fileName: file.fileName,
                                    fileType: file.fileType,
                                    platform: "Whatsapp",
                                    sentAt: formatDateTime(msg.createdAt),
                                    createdAt: msg.createdAt
                                });
                            }
                        }
                    }
                }
            }

            files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const cleanFiles = files.map(({ createdAt, ...rest }) => rest);

            return {
                statusCode: 200,
                success: true,
                message: "Candidate files fetched successfully.",
                data: {
                    files: cleanFiles,
                    total: cleanFiles.length
                }
            };
        }
        catch(err)
        {
            console.error("❌ fetchCandidateFiles failed:", err.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async onWindow(wiraSession, email = null, phone = null, candidateId = null, webName = "White Force", platform = "App", candidateData = null, window = "App")
    {
        try
        {
            const ensured = await this.ensureUser(wiraSession, phone, platform, webName, true);

            if(!ensured.success)
            {
                return ensured;
            }

            const { 
                session, 
                dbIds, 
                wasCreated,
                candidate, 
                appSession, 
                whatsappSession 
            } = ensured.data;

            if(window === "App" || window === "Web")
            {
                const conversationKey = "appConversation";
                const AIName = webName === "AstroBuddy" ? "Mira AI" : "Wira AI";

                if(wasCreated)
                {
                    const baseIntroMessage = `Welcome to ${webName}. I'm ${AIName}, your assistant here to help you with your queries. How can I help you today?`;
                    const embedding = await embedder.getEmbedding(baseIntroMessage);

                    const inserted = await this.db.insertWiraAppMessage({
                        wiraAppId: dbIds.wiraAppId,
                        role: "assistant",
                        content: baseIntroMessage,
                        urls: [],
                        jobIds: [],
                        files: null,
                        instructionData: null,
                        platform,
                        isServer: false,
                        metadata: null,
                        promptCosts: null,
                        cancelled: false,
                        cleanContent: baseIntroMessage,
                        embedding: embedding
                    });

                    session[conversationKey] = inserted ? [inserted] : [];
                    await wiraSession.updateSession(phone, session);

                    return {
                        statusCode: 200,
                        success: true,
                        data: {
                            candidate: candidate,
                            appSession: appSession,
                            messages: inserted ? [{
                                ...inserted,
                                options: [
                                    "What can you help me with?",
                                    "Find me relevant jobs",
                                    "Update my profile",
                                    "Tell me about White Force",
                                    "Create my ATS friendly resume"
                                ]
                            }] : [],
                            isNew: true
                        }
                    };
                }

                if(!session[conversationKey] || session[conversationKey].length < 5)
                {
                    const fetched = await this.fetchLastMessages(phone, platform, 20);

                    if(fetched.success && fetched.data.messages.length > 0)
                    {
                        session[conversationKey] = fetched.data.messages;
                        await wiraSession.updateSession(phone, session);
                    }
                }

                const messagesResult = await this.db.fetchWiraAppMessages({ wiraAppId: dbIds.wiraAppId }, 1, 40);

                return {
                    statusCode: 200,
                    success: true,
                    data: {
                        candidate: candidate,
                        appSession: appSession,
                        messages: messagesResult?.rows ?? [],
                        isNew: false
                    }
                };
            }

            if(window === "Whatsapp")
            {
                const conversationKey = "whatsappConversation";

                if(!candidate.hasWhatsapp)
                {
                    return {
                        statusCode: 200,
                        success: true,
                        message: "No whatsapp conversation found.",
                        data: {
                            messages: [],
                            hasWhatsapp: false
                        }
                    };
                }

                if(!session[conversationKey] || session[conversationKey].length < 5)
                {
                    const fetched = await this.fetchLastMessages(phone, "Whatsapp", 20);

                    if(fetched.success && fetched.data.messages.length > 0)
                    {
                        session[conversationKey] = fetched.data.messages;
                        await wiraSession.updateSession(phone, session);
                    }
                }

                const messagesResult = await this.db.fetchWiraWhatsappMessages({ wiraWhatsappId: dbIds.wiraWhatsappId }, 1, 40);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Whatsapp conversations fetched successfully.",
                    data: {
                        candidate: candidate,
                        whatsappSession: whatsappSession,
                        messages: messagesResult?.rows ?? [],
                        hasWhatsapp: true
                    }
                };
            }

            if(window === "Call")
            {
                if(!candidate.hasCall)
                {
                    return {
                        statusCode: 200,
                        success: true,
                        message: "No call conversation found.",
                        data: {
                            candidate: candidate,
                            calls: [],
                            hasCall: false
                        }
                    };
                }

                const callsResult = await this.db.fetchWiraCalls({ wiraCandidateId: dbIds.wiraCandidateId }, 1, 40);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Call conversations fetched successfully.",
                    data: {
                        candidate: candidate,
                        calls: callsResult?.rows ?? [],
                        total: callsResult?.total ?? 0,
                        hasCall: true
                    }
                };
            }

            if(window === "Artifacts")
            {
                const artifacts = [];
                const appSessionResult = await this.db.fetchWiraApps({ wiraCandidateId: dbIds.wiraCandidateId, webName }, 1, 1);
                const appSessionRow = appSessionResult?.rows?.[0] ?? null;

                if(appSessionRow)
                {
                    const appMessages = await this.db.fetchWiraAppMessages({ wiraAppId: appSessionRow.id }, 1, 1000);

                    for(const msg of (appMessages?.rows ?? []))
                    {
                        if(msg.files && Array.isArray(msg.files) && msg.files.length > 0)
                        {
                            artifacts.push({
                                role: msg.role,
                                files: msg.files,
                                platform: msg.platform ?? "App",
                                createdAt: msg.createdAt
                            });
                        }
                    }
                }

                if(candidate.hasWhatsapp)
                {
                    const whatsappResult = await this.db.fetchWiraWhatsapps({ wiraCandidateId: dbIds.wiraCandidateId, webName }, 1, 1);
                    const whatsappSessionRow = whatsappResult?.rows?.[0] ?? null;

                    if(whatsappSessionRow)
                    {
                        const waMessages = await this.db.fetchWiraWhatsappMessages({ wiraWhatsappId: whatsappSessionRow.id }, 1, 1000);

                        for(const msg of (waMessages?.rows ?? []))
                        {
                            if(msg.files && Array.isArray(msg.files) && msg.files.length > 0)
                            {
                                artifacts.push({
                                    role: msg.role,
                                    files: msg.files,
                                    platform: "Whatsapp",
                                    createdAt: msg.createdAt
                                });
                            }
                        }
                    }
                }

                artifacts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                const latest = artifacts.slice(0, 40);

                return {
                    statusCode: 200,
                    success: true,
                    data: {
                        candidate: candidate,
                        artifacts: latest,
                        total: latest.length
                    }
                };
            }

            return {
                statusCode: 400,
                success: false,
                message: `Unknown window type: ${window}`,
                data: null
            };
        }
        catch(err)
        {
            console.error("❌ onWindow failed:", err.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async onScroll(wiraSession, email = null, phone = null, candidateId = null, webName = "White Force", window = "App", page = 1, limit = 40)
    {   
        try
        {
            const ensured = await this.ensureUser(wiraSession, phone, window === "Whatsapp" ? "Whatsapp" : "App", webName, true);
            if(!ensured.success)
            {
                return ensured;
            }

            const { dbIds, candidate } = ensured.data;     
            if(window === "App" || window === "Web")
            {
                const messagesResult = await this.db.fetchWiraAppMessages({ wiraAppId: dbIds.wiraAppId }, page, limit);

                return {
                    statusCode: 200,
                    success: true,
                    data: {
                        messages: messagesResult?.rows ?? [],
                        total: messagesResult?.total ?? 0,
                        page: messagesResult?.page ?? page,
                        limit: messagesResult?.limit ?? limit,
                        pages: Math.ceil((messagesResult?.total ?? 0) / limit)
                    }
                };
            }

            if(window === "Whatsapp")
            {
                const messagesResult = await this.db.fetchWiraWhatsappMessages({ wiraWhatsappId: dbIds.wiraWhatsappId }, page, limit);

                return {
                    statusCode: 200,
                    success: true,
                    data: {
                        messages: messagesResult?.rows ?? [],
                        total: messagesResult?.total ?? 0,
                        page: messagesResult?.page ?? page,
                        limit: messagesResult?.limit ?? limit,
                        pages: Math.ceil((messagesResult?.total ?? 0) / limit)
                    }
                };
            }

            if(window === "Call")
            {
                const callsResult = await this.db.fetchWiraCalls({ wiraCandidateId: dbIds.wiraCandidateId }, page, limit);

                return {
                    statusCode: 200,
                    success: true,
                    data: {
                        calls: callsResult?.rows ?? [],
                        total: callsResult?.total ?? 0,
                        page: callsResult?.page ?? page,
                        limit: callsResult?.limit ?? limit,
                        pages: Math.ceil((callsResult?.total ?? 0) / limit)
                    }
                };
            }

            if(window === "Artifacts")
            {
                const artifacts = [];

                const appSessionResult = await this.db.fetchWiraApps({ wiraCandidateId: dbIds.wiraCandidateId, webName }, 1, 1);
                const appSessionRow = appSessionResult?.rows?.[0] ?? null;

                if(appSessionRow)
                {
                    const appMessages = await this.db.fetchWiraAppMessages({ wiraAppId: appSessionRow.id }, 1, 1000);

                    for(const msg of (appMessages?.rows ?? []))
                    {
                        if(msg.files && Array.isArray(msg.files) && msg.files.length > 0)
                        {
                            artifacts.push({
                                role: msg.role,
                                files: msg.files,
                                platform: msg.platform ?? "App",
                                createdAt: msg.createdAt
                            });
                        }
                    }
                }

                if(candidate.hasWhatsapp)
                {
                    const whatsappResult = await this.db.fetchWiraWhatsapps({ wiraCandidateId: dbIds.wiraCandidateId, webName }, 1, 1);
                    const whatsappSessionRow = whatsappResult?.rows?.[0] ?? null;

                    if(whatsappSessionRow)
                    {
                        const waMessages = await this.db.fetchWiraWhatsappMessages({ wiraWhatsappId: whatsappSessionRow.id }, 1, 1000);

                        for(const msg of (waMessages?.rows ?? []))
                        {
                            if(msg.files && Array.isArray(msg.files) && msg.files.length > 0)
                            {
                                artifacts.push({
                                    role: msg.role,
                                    files: msg.files,
                                    platform: "Whatsapp",
                                    createdAt: msg.createdAt
                                });
                            }
                        }
                    }
                }

                artifacts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                const offset = (page - 1) * limit;
                const paged = artifacts.slice(offset, offset + limit);

                return {
                    statusCode: 200,
                    success: true,
                    data: {
                        artifacts: paged,
                        total: artifacts.length,
                        page: page,
                        limit: limit,
                        pages: Math.ceil(artifacts.length / limit)
                    }
                };
            }

            return {
                statusCode: 400,
                success: false,
                message: `Unknown window type: ${window}`,
                data: null
            };
        }
        catch(err)
        {
            console.error("❌ onScroll failed:", err.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async saveMessage(wiraSession, phone, platform, webName = "White Force", messageData = {})
    {
        try
        {
            const ensured = await this.ensureUser(wiraSession, phone, platform, webName, false);

            console.log("saveMessage ensured:", JSON.stringify({
                success: ensured.success,
                statusCode: ensured.statusCode,
                message: ensured.message,
                wiraAppId: ensured.data?.dbIds?.wiraAppId ?? null
            }));

            if(!ensured.success)
            {
                return ensured;
            }

            const { session, dbIds } = ensured.data;
            const conversationKey = platform === "Whatsapp" ? "whatsappConversation" : "appConversation";

            if(!session[conversationKey] || session[conversationKey].length < 5)
            {
                const fetched = await this.fetchLastMessages(phone, platform, 20);

                if(fetched.success && fetched.data.messages.length > 0)
                {
                    session[conversationKey] = fetched.data.messages;
                }
            }

            if(platform === "App" || platform === "Web")
            {
                const embedding = messageData.content ? await embedder.getEmbedding(messageData.content) : null;

                const inserted = await this.db.insertWiraAppMessage({
                    wiraAppId: dbIds.wiraAppId,
                    role: messageData.role,
                    content: messageData.content,
                    urls: messageData.urls ?? [],
                    jobIds: messageData.jobIds ?? [],
                    files: messageData.files ?? null,
                    instructionData: messageData.instructionData ?? null,
                    platform: platform,
                    isServer: messageData.isServer ?? false,
                    metadata: messageData.metadata ?? null,
                    promptCosts: messageData.promptCosts ?? null,
                    cancelled: messageData.cancelled ?? false,
                    cleanContent: messageData.cleanContent ?? null,
                    embedding: embedding
                });

                console.log("insertWiraAppMessage result:", JSON.stringify({
                    inserted: inserted ?? null
                }));

                if(!inserted)
                {
                    console.error("❌ saveMessage: Failed to insert app message.");

                    return {
                        statusCode: 500,
                        success: false,
                        message: "Failed to save message.",
                        data: null
                    };
                }

                session[conversationKey].push(inserted);

                if(session[conversationKey].length > 20)
                {
                    session[conversationKey] = session[conversationKey].slice(-20);
                }

                await wiraSession.updateSession(phone, session);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Message saved successfully.",
                    data: inserted
                };
            }

            if(platform === "Whatsapp")
            {
                const embedding = messageData.content ? await embedder.getEmbedding(messageData.content) : null;

                const inserted = await this.db.insertWiraWhatsappMessage({
                    wiraWhatsappId: dbIds.wiraWhatsappId,
                    role: messageData.role,
                    content: messageData.content,
                    urls: messageData.urls ?? [],
                    jobIds: messageData.jobIds ?? [],
                    files: messageData.files ?? null,
                    instructionData: messageData.instructionData ?? null,
                    isServer: messageData.isServer ?? false,
                    metadata: messageData.metadata ?? null,
                    promptCosts: messageData.promptCosts ?? null,
                    cancelled: messageData.cancelled ?? false,
                    whatsappMessageId: messageData.whatsappMessageId ?? null,
                    whatsappRawPayload: messageData.whatsappRawPayload ?? null,
                    cleanContent: messageData.cleanContent ?? null,
                    embedding: embedding
                });

                if(!inserted)
                {
                    console.error("❌ saveMessage: Failed to insert whatsapp message.");

                    return {
                        statusCode: 500,
                        success: false,
                        message: "Failed to save message.",
                        data: null
                    };
                }

                session[conversationKey].push(inserted);

                if(session[conversationKey].length > 20)
                {
                    session[conversationKey] = session[conversationKey].slice(-20);
                }

                await wiraSession.updateSession(phone, session);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Message saved successfully.",
                    data: inserted
                };
            }

            return {
                statusCode: 400,
                success: false,
                message: `Unsupported platform: ${platform}`,
                data: null
            };
        }
        catch(err)
        {
            console.error("❌ saveMessage failed:", err.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal error.",
                data: null
            };
        }
    }

    async setReminder(reminder)
    {
        const platformTableMap = {
            "App": "wira_app_message",
            "Web": "wira_app_message",
            "Whatsapp": "wira_whatsapp_message",
            "Call": "wira_call"
        };

        try
        {
            const results = await Promise.all(reminder.platforms.map(async (platform) =>
            {
                const queue = await this.db.insertWiraQueue({
                    queueName: "user-reminder",
                    promptName: null,
                    triggerAt: reminder.triggerAt,
                    data: {
                        title: reminder.title,
                        message: reminder.message,
                        options: reminder.options ?? [],
                        platforms: reminder.platforms,
                        metadata: reminder.metadata ?? null
                    },
                    platform: platform,
                    setBy: "assistant",
                    referenceTable: platformTableMap[platform] ?? null,
                    referenceId: null,
                    executed: false,
                    status: "pending",
                    message: reminder.message
                });

                return { 
                    platform: platform, 
                    id: queue?.id ?? null 
                };
            }));

            const queueIds = {};
            for(const entry of results)
            {
                queueIds[entry.platform] = entry.id;
            }

            return {
                statusCode: 200,
                success: true,
                message: "Reminder set successfully.",
                data: queueIds
            };
        }   
        catch(error)
        {
            console.error("Error occured setting reminder: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured setting reminder.",
                data: null
            };
        }
    }

    //CALLING-------------------------------

    async candidateFindOrCreate(phone, email = null, candidateId = null, name = null, candidateData = null)
    {
        try
        {
            let existing = null;

            const byPhone = await this.db.fetchWiraCandidates({ phone });
            if(byPhone === null)
            {
                console.error("❌ candidateFindOrCreate: DB error on phone lookup.");
                return null;
            }

            if(byPhone.total > 0)
            {
                existing = byPhone.rows[0];
            }

            if(!existing && email)
            {
                const byEmail = await this.db.fetchWiraCandidates({ email });

                if(byEmail === null)
                {
                    console.error("❌ candidateFindOrCreate: DB error on email lookup.");
                    return null;
                }

                if(byEmail.total > 0)
                {
                    existing = byEmail.rows[0];
                }
            }

            if(existing)
            {
                if(!existing.hasCall)
                {
                    const updated = await this.db.updateWiraCandidates(
                        { hasCall: true },
                        { id: existing.id }
                    );

                    if(!updated)
                    {
                        console.error("❌ candidateFindOrCreate: DB error updating hasCall.");
                        return null;
                    }

                    return updated[0];
                }

                return existing;
            }

            const insertData = { 
                phone: phone, 
                hasCall: true, 
                hasWhatsapp: false, 
                hasApp: false 
            };

            if(candidateId)
            {
                insertData.candidateId = candidateId;
            }

            if(name)
            {
                insertData.name = name;
            }

            if(email)
            {
                insertData.email = email;
            }

            if(candidateData)
            {
                insertData.candidateData = candidateData;
            }

            const created = await this.db.insertWiraCandidate(insertData);

            if(!created)
            {
                console.error("❌ candidateFindOrCreate: DB error inserting candidate.");
                return null;
            }

            return created;
        }
        catch(err)
        {
            console.error("❌ candidateFindOrCreate failed:", err.message);
            return null;
        }
    }

    async createCallWithScreening({ wiraCandidateId, fromPhone, type, jobId, jobTitle, jobDescription, companyName, intro, screeningQuestions, preCost, language = "hi" })
    {
        try
        {
            const call = await this.db.insertWiraCall({
                wiraCandidateId: wiraCandidateId,
                fromPhone: fromPhone,
                bound: "outbound",
                type: type,
                status: "initiated",
                language: language,
                intro: intro,
                preCost: preCost ?? 0
            });

            if(!call)
            {
                console.error("❌ createCallWithScreening: DB error inserting wira call.");
                return null;
            }

            const screening = await this.db.insertWiraOutboundScreening({
                wiraCallId: call.id,
                jobId: jobId ?? null,
                jobTitle: jobTitle ?? null,
                jobDescription: jobDescription ?? null,
                companyName: companyName ?? null,
                screeningQuestions: screeningQuestions ?? []
            });

            if(!screening)
            {
                console.error("❌ createCallWithScreening: DB error inserting outbound screening.");
                return null;
            }

            return { 
                call: call, 
                screening: screening 
            };
        }
        catch(err)
        {
            console.error("❌ createCallWithScreening failed:", err.message);
            return null;
        }
    }

    async persistCallEnd({ session, analysisResult, costSummary, callUUID, callStatus, hangupBy, durationSeconds, endedAt, startedAt, buckets = [] })
    {
        try
        {
            const { 
                sarvamTotal, 
                plivoTotal, 
                geminiTotal, 
                updatedPreCost, 
                updatedGeminiPostCost, 
                grandTotal 
            } = costSummary;

            let embedding = null;

            if(analysisResult && analysisResult.summary)
            {
                embedding  = await embedder.getEmbedding(analysisResult.summary)
            }

            const screeningUpdates = {
                screeningQuestions: session.screeningQuestions ?? [],
                screeningQA: analysisResult ? analysisResult.qna : null,
                score: analysisResult ? analysisResult.score : 0,
                scoreReason: analysisResult ? analysisResult.scoreReason : null,
                jobInterest: analysisResult ? analysisResult.jobInterest : null
            };

            const screeningResult = await this.db.updateWiraOutboundScreenings(
                screeningUpdates,
                { wiraCallId: session.wiraCallId }
            );

            if(!screeningResult)
            {
                console.error("❌ persistCallEnd: DB error updating outbound screening.");
                return null;
            }

            const screeningId = screeningResult[0]?.id ?? null;

            if(screeningId && buckets.length > 0)
            {
                await Promise.all(buckets.map((bucket, i) =>
                    this.db.insertWiraCallCost({
                        wiraOutboundScreeningId: screeningId,
                        bucketIndex: i,
                        startTime: bucket.startTime || new Date().toISOString(),
                        endTime: bucket.endTime || endedAt.toISOString(),
                        ttsChars: bucket.ttsChars ?? bucket.sarvamTTS?.chars ?? 0,
                        ttsCost: bucket.ttsCost ?? bucket.sarvamTTS?.cost ?? 0,
                        sttSeconds: bucket.sttSeconds ?? bucket.sarvamSTT?.seconds ?? 0,
                        sttCost: bucket.sttCost ?? bucket.sarvamSTT?.cost ?? 0,
                        plivoSeconds: bucket.plivoSeconds ?? bucket.plivo?.seconds ?? 0,
                        plivoCost: bucket.plivoCost ?? bucket.plivo?.cost ?? 0,
                        geminiInputTokens: bucket.geminiInputTokens ?? bucket.gemini?.inputTokens ?? 0,
                        geminiCachedTokens: bucket.geminiCachedTokens ?? bucket.gemini?.cachedTokens ?? 0,
                        geminiOutputTokens: bucket.geminiOutputTokens ?? bucket.gemini?.outputTokens ?? 0,
                        geminiCost: bucket.geminiCost ?? bucket.gemini?.cost ?? 0,
                        bucketTotal: bucket.bucketTotal ?? bucket.totalCost ?? 0
                    })
                ));
            }

            function mapInterestToCallInterest(val)
            {
                if(!val) return null;
                const upper = String(val).toUpperCase();
                if(upper === "HIGH" || upper === "INTERESTED") return "HIGH";
                if(upper === "MED" || upper === "MEDIUM") return "MEDIUM";
                if(upper === "LOW" || upper === "NOT_INTERESTED") return "LOW";
                return "UNKNOWN";
            }

            const callUpdates = {
                callId: callUUID,
                status: callStatus,
                transcript: session.transcript ?? [],
                cleanTranscript: analysisResult ? analysisResult.cleanTranscript : null,
                hangupBy: hangupBy ?? null,
                hangupCause: analysisResult ? analysisResult.hangupCause : callStatus,
                interest: analysisResult ? mapInterestToCallInterest(analysisResult.interest) : null,
                summary: analysisResult ? analysisResult.summary : null,
                startedAt: startedAt ? startedAt.toISOString() : null,
                endedAt: endedAt.toISOString(),
                duration: durationSeconds,
                sarvamTotalCost: sarvamTotal,
                plivoTotalCost: plivoTotal,
                geminiTotalCost: geminiTotal,
                totalCost: grandTotal,
                preCost: updatedPreCost,
                geminiPostCost: updatedGeminiPostCost,
                embedding: embedding ?? null
            };

            const callResult = await this.db.updateWiraCalls(
                callUpdates,
                { id: session.wiraCallId }
            );

            if(!callResult)
            {
                console.error("❌ persistCallEnd: DB error updating wira call.");
                return null;
            }

            return { 
                screeningResult: screeningResult, 
                callResult: callResult 
            };
        }
        catch(err)
        {
            console.error("❌ persistCallEnd failed:", err.message);
            return null;
        }
    }

    async saveRecordingUrl(callUUID, recordingUrl)
    {
        try
        {
            const callResult = await this.db.fetchWiraCalls({ callId: callUUID });
            if(!callResult || callResult.total === 0)
            {
                console.error(`❌ saveRecordingUrl: No wira_call found for callUUID: ${callUUID}`);
                return null;
            }

            const call = callResult.rows[0];

            const updated = await this.db.updateWiraCalls(
                { recordingUrl },
                { id: call.id }
            );

            if(!updated)
            {
                console.error("❌ saveRecordingUrl: DB error updating recording URL.");
                return null;
            }

            return updated[0];
        }
        catch(err)
        {
            console.error("❌ saveRecordingUrl failed:", err.message);
            return null;
        }
    }

    async getOrBuildAudioBatch(textsWithLanguages, ttsSpeaker)
    {
        const cacheMap = new Map();
        let preCostChars = 0;

        const uniqueLanguageCodes = [...new Set(textsWithLanguages.map(e => e.languageCode))];

        await Promise.all(uniqueLanguageCodes.map(async (languageCode) =>
        {
            const textsForCode = textsWithLanguages.filter(e => e.languageCode === languageCode).map(e => e.text);

            if(textsForCode.length === 0)
            {
                return;
            }

            const rows = await this.db.fetchWiraIntroAudios({ language: languageCode, speaker: ttsSpeaker });

            if(!rows)
            {
                return;
            }

            for(const row of rows.rows)
            {
                if(textsForCode.includes(row.text))
                {
                    cacheMap.set(`${languageCode}:${row.text}`, row.segments[0].audio);
                }
            }
        }));

        const missing = textsWithLanguages.filter(e => !cacheMap.has(`${e.languageCode}:${e.text}`));

        for(const e of missing)
        {
            const inProgressKey = `batch:${e.languageCode}:${ttsSpeaker}:${e.text}`;

            if(introAudioInProgress.has(inProgressKey))
            {
                const audio = await introAudioInProgress.get(inProgressKey);
                cacheMap.set(`${e.languageCode}:${e.text}`, audio);
                continue;
            }

            const buildPromise = (async () =>
            {
                for(let attempt = 1; attempt <= 3; attempt++)
                {
                    try
                    {
                        const result = await sarvam.sarvamTTS({ text: e.text, languageCode: e.languageCode, speaker: ttsSpeaker });
                        const audio = result.audios[0];

                        await this.db.insertWiraIntroAudio({
                            text: e.text,
                            language: e.languageCode,
                            speaker: ttsSpeaker,
                            segments: [{ audio }]
                        });

                        return audio;
                    }
                    catch(err)
                    {
                        if(attempt === 3)
                        {
                            throw err;
                        }

                        await new Promise(r => setTimeout(r, 1000 * attempt));
                    }
                }
            })();

            introAudioInProgress.set(inProgressKey, buildPromise);

            try
            {
                const audio = await buildPromise;
                cacheMap.set(`${e.languageCode}:${e.text}`, audio);
                preCostChars += e.text.length;
            }
            finally
            {
                introAudioInProgress.delete(inProgressKey);
            }
        }

        return {
            cacheMap,
            preCostChars
        };
    }

    async getOrBuildIntroAudio(normalizedTemplate, ttsLanguage, ttsSpeaker, segments)
    {
        try
        {
            let preCostChars = 0;

            const existing = await this.db.fetchWiraIntroAudios({ language: ttsLanguage, speaker: ttsSpeaker });
            const templateRecord = existing?.rows?.find(r => r.text === normalizedTemplate) ?? null;

            if(templateRecord)
            {
                for(let i = 0; i < segments.length; i++)
                {
                    if(segments[i].type === "static")
                    {
                        segments[i].audio = templateRecord.segments[i]?.audio ?? null;
                    }
                }

                return {
                    segments: segments,
                    preCostChars: preCostChars
                };
            }

            const inProgressKey = `${ttsLanguage}:${ttsSpeaker}:${normalizedTemplate}`;

            if(introAudioInProgress.has(inProgressKey))
            {
                const built = await introAudioInProgress.get(inProgressKey);

                for(let i = 0; i < segments.length; i++)
                {
                    if(segments[i].type === "static")
                    {
                        segments[i].audio = built[i]?.audio ?? null;
                    }   
                }

                return {
                    segments: segments,
                    preCostChars: 0
                };
            }

            const buildPromise = (async () =>
            {
                for(const segment of segments)
                {
                    if(segment.type === "static")
                    {
                        for(let attempt = 1; attempt <= 3; attempt++)
                        {
                            try
                            {
                                const result = await sarvam.sarvamTTS({
                                    text: segment.text,
                                    languageCode: ttsLanguage,
                                    speaker: ttsSpeaker
                                });

                                segment.audio = result.audios[0];
                                preCostChars += segment.text.length;
                                break;
                            }
                            catch(err)
                            {
                                if(attempt === 3)
                                {
                                    throw err;
                                }

                                await new Promise(r => setTimeout(r, 1000 * attempt));
                            }
                        }
                    }
                }

                await this.db.insertWiraIntroAudio({
                    text: normalizedTemplate,
                    language: ttsLanguage,
                    speaker: ttsSpeaker,
                    segments: segments.map(segment => segment.type === "static" ? { type: "static", text: segment.text, audio: segment.audio ?? null } : { type: "dynamic", index: segment.index })
                });

                return segments;
            })();

            introAudioInProgress.set(inProgressKey, buildPromise);

            try
            {
                await buildPromise;
            }
            finally
            {
                introAudioInProgress.delete(inProgressKey);
            }

            return {
                segments: segments,
                preCostChars: preCostChars
            };
        }
        catch(err)
        {
            console.error("❌ getOrBuildIntroAudio failed:", err.message);
            return null;
        }
    }

    async getFullCallByCallId(callUUID)
    {
        try
        {
            let callResult = await this.db.fetchWiraCalls({ callId: callUUID });

            if(callResult === null)
            {
                console.error("❌ getFullCallByCallId: DB error fetching call.");
                return null;
            }

            if((!callResult || callResult.total === 0) && !isNaN(parseInt(callUUID)))
            {
                callResult = await this.db.fetchWiraCalls({ id: parseInt(callUUID) });
            }

            if(!callResult || callResult.total === 0)
            {
                return null;
            }

            const call = callResult.rows[0];

            const [candidateResult, screeningResult] = await Promise.all([
                this.db.fetchWiraCandidates({ id: call.wiraCandidateId }),
                this.db.fetchWiraOutboundScreenings({ wiraCallId: call.id })
            ]);

            const screeningId = screeningResult?.rows?.[0]?.id ?? null;

            const costsResult = screeningId ? await this.db.fetchWiraCallCosts({ wiraOutboundScreeningId: screeningId }) : { rows: [], total: 0 };

            return {
                wiraCandidate: candidateResult?.rows?.[0] ?? null,
                wiraCall: call,
                outboundScreening: screeningResult?.rows?.[0] ?? null,
                callCosts: costsResult.rows
            };
        }
        catch(err)
        {
            console.error("❌ getFullCallByCallId failed:", err.message);
            return null;
        }
    }

    async getCandidateCallsFull(wiraCandidateId, filters = {}, page = 1, limit = 50)
    {
        try
        {
            const result = await this.db.fetchCandidateCallsWithScreening(wiraCandidateId, filters, page, limit);

            if(result === null)
            {
                console.error("❌ getCandidateCallsFull: DB error fetching candidate calls.");
                return null;
            }

            return result;
        }
        catch(err)
        {
            console.error("❌ getCandidateCallsFull failed:", err.message);
            return null;
        }
    }

    async getCandidatesWithCalls(filters = {}, page = 1, limit = 40)
    {
        try
        {
            const result = await this.db.searchCandidatesWithCallsFull(filters, page, limit);
            return result;
        }
        catch(err)
        {
            console.error("getCandidatesWithCalls failed:", err.message);
            return null;
        }
    }

    //-------------------------------------
}

module.exports = WiraDatabase;