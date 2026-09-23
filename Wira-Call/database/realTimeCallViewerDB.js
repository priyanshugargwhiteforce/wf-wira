const { Client } = require("pg");

class RealtimeCallViewerDB
{
    constructor(socket)
    {
        this.socket = socket;
        this.client = null;

        this.channels = [
            "wira_candidate_changes",
            "wira_call_changes",
            "wira_outbound_screening_changes",
            "wira_app_changes",
            "wira_app_message_changes",
            "wira_whatsapp_changes",
            "wira_whatsapp_message_changes",
            "wira_cache_costs_changes",
            "wira_queue_changes",
            "wira_queue_due",
            "intro_audio_template_changes"
        ];

        this.init();
    }

    buildDbConfig()
    {
        return {
            host : process.env.DB_HOST,
            port : process.env.DB_PORT,
            database : process.env.DB_DATABASE,
            user : process.env.DB_USER,
            password : process.env.DB_PASSWORD
        };
    }

    shapeCandidatePayload(raw)
    {
        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                phone : raw.data.phone,
                candidateId : raw.data.candidateId ?? null,
                name : raw.data.name ?? null,
                email : raw.data.email ?? null,
                hasCall : raw.data.hasCall,
                hasWhatsapp : raw.data.hasWhatsapp,
                hasApp : raw.data.hasApp,
                insights : raw.data.insights ?? null,
                createdAt : raw.data.createdAt,
                updatedAt : raw.data.updatedAt
            }
        };
    }

    shapeScreeningSummary(rawScreening)
    {
        if(!rawScreening)
        {
            return null;
        }

        return {
            id : rawScreening.id,
            jobId : rawScreening.jobId ?? null,
            jobTitle : rawScreening.jobTitle ?? null,
            companyName : rawScreening.companyName ?? null,
            score : rawScreening.score,
            scoreReason : rawScreening.scoreReason ?? null,
            jobInterest : rawScreening.jobInterest ?? null
        };
    }

    shapeCallPayload(raw)
    {
        const candidateId = raw.data.wiraCandidateId ?? raw.data.wireCandidateId ?? null;

        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                wiraCandidateId : candidateId,
                wireCandidateId : candidateId,
                conversationCandidateId : candidateId,
                callId : raw.data.callId ?? null,
                fromPhone : raw.data.fromPhone,
                bound : raw.data.bound,
                type : raw.data.type,
                status : raw.data.status,
                webName : raw.data.webName,
                intro : raw.data.intro ?? null,
                language : raw.data.language,
                duration : raw.data.duration ?? null,
                recordingUrl : raw.data.recordingUrl ?? null,
                hangupBy : raw.data.hangupBy ?? null,
                hangupReason : raw.data.hangupReason ?? null,
                hangupCause : raw.data.hangupCause ?? null,
                interest : raw.data.interest ?? null,
                startedAt : raw.data.startedAt ?? null,
                endedAt : raw.data.endedAt ?? null,
                preCost : raw.data.preCost,
                sarvamTotalCost : raw.data.sarvamTotalCost,
                plivoTotalCost : raw.data.plivoTotalCost,
                geminiTotalCost : raw.data.geminiTotalCost,
                geminiPostCost : raw.data.geminiPostCost,
                totalCost : raw.data.totalCost,
                summary : raw.data.summary ?? null,
                createdAt : raw.data.createdAt,
                updatedAt : raw.data.updatedAt
            },
            outboundScreening : this.shapeScreeningSummary(raw.outboundScreening)
        };
    }

    shapeOutboundScreeningPayload(raw)
    {
        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                wiraCallId : raw.data.wiraCallId,
                jobId : raw.data.jobId ?? null,
                jobTitle : raw.data.jobTitle ?? null,
                companyName : raw.data.companyName ?? null,
                score : raw.data.score,
                scoreReason : raw.data.scoreReason ?? null,
                jobInterest : raw.data.jobInterest ?? null,
                createdAt : raw.data.createdAt,
                updatedAt : raw.data.updatedAt
            }
        };
    }

    shapeAppPayload(raw)
    {
        const candidateId = raw.data.wiraCandidateId ?? raw.data.wireCandidateId ?? null;

        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                wiraCandidateId : candidateId,
                wireCandidateId : candidateId,
                webName : raw.data.webName,
                overallGeminiCost : raw.data.overallGeminiCost,
                createdAt : raw.data.createdAt,
                updatedAt : raw.data.updatedAt
            }
        };
    }

    shapeAppMessagePayload(raw)
    {
        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                wiraAppId : raw.data.wiraAppId,
                role : raw.data.role,
                content : raw.data.content ?? null,
                urls : raw.data.urls ?? [],
                jobIds : raw.data.jobIds ?? [],
                queueIds : raw.data.queueIds ?? [],
                files : raw.data.files ?? null,
                instructionData : raw.data.instructionData ?? null,
                platform : raw.data.platform ?? null,
                isServer : raw.data.isServer,
                cancelled : raw.data.cancelled,
                cleanContent : raw.data.cleanContent ?? null,
                createdAt : raw.data.createdAt
            }
        };
    }

    shapeWhatsappPayload(raw)
    {
        const candidateId = raw.data.wiraCandidateId ?? raw.data.wireCandidateId ?? null;

        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                wiraCandidateId : candidateId,
                wireCandidateId : candidateId,
                webName : raw.data.webName,
                overallGeminiCost : raw.data.overallGeminiCost,
                overallWhatsappCost : raw.data.overallWhatsappCost,
                createdAt : raw.data.createdAt,
                updatedAt : raw.data.updatedAt
            }
        };
    }

    shapeWhatsappMessagePayload(raw)
    {
        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                wiraWhatsappId : raw.data.wiraWhatsappId,
                role : raw.data.role,
                content : raw.data.content ?? null,
                urls : raw.data.urls ?? [],
                jobIds : raw.data.jobIds ?? [],
                queueIds : raw.data.queueIds ?? [],
                files : raw.data.files ?? null,
                instructionData : raw.data.instructionData ?? null,
                isServer : raw.data.isServer,
                cancelled : raw.data.cancelled,
                whatsappMessageId : raw.data.whatsappMessageId ?? null,
                cleanContent : raw.data.cleanContent ?? null,
                createdAt : raw.data.createdAt,
                updatedAt : raw.data.updatedAt
            }
        };
    }

    shapeCacheCostsPayload(raw)
    {
        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                cacheId : raw.data.cacheId,
                promptName : raw.data.promptName,
                modelName : raw.data.modelName,
                cachedTokens : raw.data.cachedTokens,
                cost : raw.data.cost,
                createdAt : raw.data.createdAt,
                deletedAt : raw.data.deletedAt ?? null
            }
        };
    }

    shapeQueuePayload(raw)
    {
        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                queueName : raw.data.queueName,
                promptName : raw.data.promptName ?? null,
                triggerAt : raw.data.triggerAt,
                platform : raw.data.platform ?? null,
                setBy : raw.data.setBy,
                referenceTable : raw.data.referenceTable ?? null,
                referenceId : raw.data.referenceId ?? null,
                executed : raw.data.executed,
                status : raw.data.status,
                message : raw.data.message ?? null,
                createdAt : raw.data.createdAt,
                updatedAt : raw.data.updatedAt
            }
        };
    }

    shapeQueueDuePayload(raw)
    {
        return {
            ids : raw.ids
        };
    }

    shapeIntroAudioTemplatePayload(raw)
    {
        return {
            operation : raw.operation,
            table : raw.table,
            data : 
            {
                id : raw.data.id,
                text : raw.data.text,
                language : raw.data.language,
                speaker : raw.data.speaker,
                segments : raw.data.segments,
                createdAt : raw.data.createdAt,
                updatedAt : raw.data.updatedAt
            }
        };
    }

    channelShaper()
    {
        return {
            "wira_candidate_changes" : (raw) => this.shapeCandidatePayload(raw),
            "wira_call_changes" : (raw) => this.shapeCallPayload(raw),
            "wira_outbound_screening_changes" : (raw) => this.shapeOutboundScreeningPayload(raw),
            "wira_app_changes" : (raw) => this.shapeAppPayload(raw),
            "wira_app_message_changes" : (raw) => this.shapeAppMessagePayload(raw),
            "wira_whatsapp_changes" : (raw) => this.shapeWhatsappPayload(raw),
            "wira_whatsapp_message_changes" : (raw) => this.shapeWhatsappMessagePayload(raw),
            "wira_cache_costs_changes" : (raw) => this.shapeCacheCostsPayload(raw),
            "wira_queue_changes" : (raw) => this.shapeQueuePayload(raw),
            "wira_queue_due" : (raw) => this.shapeQueueDuePayload(raw),
            "intro_audio_template_changes" : (raw) => this.shapeIntroAudioTemplatePayload(raw)
        };
    }

    handleNotification(msg)
    {
        try
        {
            const raw = JSON.parse(msg.payload);
            const shaper = this.channelShaper()[msg.channel];
            const shaped = shaper(raw);

            this.socket.emit(msg.channel, shaped);
        }
        catch(error)
        {
            console.error(`❌ [RealtimeCallViewerDB] Failed on channel ${msg.channel}:`, error.message);
        }
    }

    async init()
    {
        this.client = new Client(this.buildDbConfig());

        await this.client.connect();
        for(const channel of this.channels)
        {
            await this.client.query(`LISTEN "${channel}"`);
        }

        this.client.on("notification", (msg) => this.handleNotification(msg));
        this.client.on("error", (err) => console.error("❌ [RealtimeCallViewerDB] Client error:", err.message));

        this.socket.on("disconnect", () => this.destroy());

        console.log(`✅ [RealtimeCallViewerDB] Listening on ${this.channels.length} channels for socket: ${this.socket.id}`);
    }

    async destroy()
    {
        if(!this.client)
        {
            return;
        }

        for(const channel of this.channels)
        {
            await this.client.query(`UNLISTEN "${channel}"`);
        }

        await this.client.end();
        this.client = null;

        console.log(`🔌 [RealtimeCallViewerDB] Destroyed for socket: ${this.socket.id}`);
    }
}

module.exports = RealtimeCallViewerDB;