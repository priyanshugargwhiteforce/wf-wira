const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_whatsapp_message
================================================================================

Every message in a wira_whatsapp session. No platform column — all messages
here are WhatsApp by definition. whatsappMessageId is the ID from the Meta
WhatsApp API. whatsappRawPayload is the full raw webhook payload from Meta kept
for complete traceability. Has updatedAt because WhatsApp delivery status
updates after send.

CHECK: content IS NOT NULL OR files IS NOT NULL — a message may be file-only.

Embedding is auto-generated on create/update from cleanContent if it exists,
otherwise from content. File-only messages (no text) get no embedding. The
embedding column is excluded from all SELECT queries in this class — use
filters.embed for semantic search.

+--------------------+--------------+----------------------------------------+
| Column             | Type         | Constraints                            |
+--------------------+--------------+----------------------------------------+
| id                 | BIGSERIAL    | Primary Key                            |
| wiraWhatsappId     | BIGINT       | NOT NULL, FK → wira_whatsapp           |
| role               | VARCHAR(20)  | NOT NULL, CHECK IN (assistant, user)   |
| content            | TEXT         | nullable — content OR files required   |
| urls               | JSONB        | NOT NULL, DEFAULT []                   |
| jobIds             | JSONB        | NOT NULL, DEFAULT []                   |
| queueIds           | JSONB        | NOT NULL, DEFAULT []                   |
| files              | JSONB        | nullable                               |
| instructionData    | JSONB        | nullable                               |
| isServer           | BOOLEAN      | NOT NULL, DEFAULT false                |
| metadata           | JSONB        | nullable                               |
| promptCosts        | JSONB        | nullable                               |
| cancelled          | BOOLEAN      | NOT NULL, DEFAULT false                |
| whatsappMessageId  | VARCHAR(255) | nullable, UNIQUE where not null        |
| whatsappRawPayload | JSONB        | nullable                               |
| cleanContent       | TEXT         | nullable                               |
| embedding          | vector(1024) | nullable                               |
| createdAt          | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                |
| updatedAt          | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                |
+--------------------+--------------+----------------------------------------+

promptCosts shape: same as wira_app_message
Notification channel: wira_whatsapp_message_changes (embedding, metadata,
promptCosts and whatsappRawPayload excluded from payload)

--- SQL ---

CREATE TABLE wira_whatsapp_message
(
    "id"                    BIGSERIAL     PRIMARY KEY,
    "wiraWhatsappId"        BIGINT        NOT NULL REFERENCES wira_whatsapp("id") ON DELETE CASCADE,
    "role"                  VARCHAR(20)   NOT NULL CHECK ("role" IN ('assistant', 'user')),
    "content"               TEXT,
    "urls"                  JSONB         NOT NULL DEFAULT '[]'::jsonb,
    "jobIds"                JSONB         NOT NULL DEFAULT '[]'::jsonb,
    "queueIds"              JSONB         NOT NULL DEFAULT '[]'::jsonb,
    "files"                 JSONB,
    "instructionData"       JSONB,
    "isServer"              BOOLEAN       NOT NULL DEFAULT FALSE,
    "metadata"              JSONB,
    "promptCosts"           JSONB,
    "cancelled"             BOOLEAN       NOT NULL DEFAULT FALSE,
    "whatsappMessageId"     VARCHAR(255),
    "whatsappRawPayload"    JSONB,
    "cleanContent"          TEXT,
    "embedding"             vector(1024),
    "createdAt"             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updatedAt"             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT "chk_wiraWhatsappMessage_content_or_file" CHECK ("content" IS NOT NULL OR "files" IS NOT NULL)
);

CREATE INDEX "idx_wiraWhatsappMsg_wiraWhatsappId"       ON wira_whatsapp_message("wiraWhatsappId");
CREATE INDEX "idx_wiraWhatsappMsg_whatsappId_createdAt" ON wira_whatsapp_message("wiraWhatsappId", "createdAt" DESC);
CREATE INDEX "idx_wiraWhatsappMsg_createdAt"            ON wira_whatsapp_message("createdAt" DESC);
CREATE INDEX "idx_wiraWhatsappMsg_updatedAt"            ON wira_whatsapp_message("updatedAt" DESC);
CREATE UNIQUE INDEX "uq_wiraWhatsappMsg_whatsappMessageId" ON wira_whatsapp_message("whatsappMessageId") WHERE "whatsappMessageId" IS NOT NULL;
CREATE INDEX "idx_wiraWhatsappMsg_role"                 ON wira_whatsapp_message("role");
CREATE INDEX "idx_wiraWhatsappMsg_isServer"             ON wira_whatsapp_message("isServer")  WHERE "isServer"  = TRUE;
CREATE INDEX "idx_wiraWhatsappMsg_cancelled"            ON wira_whatsapp_message("cancelled") WHERE "cancelled" = TRUE;
CREATE INDEX "idx_wiraWhatsappMsg_instructionData"      ON wira_whatsapp_message USING gin("instructionData" jsonb_path_ops) WHERE "instructionData" IS NOT NULL;
CREATE INDEX "idx_wiraWhatsappMsg_jobIds"               ON wira_whatsapp_message USING gin("jobIds");
CREATE INDEX "idx_wiraWhatsappMsg_queueIds"             ON wira_whatsapp_message USING gin("queueIds");
CREATE INDEX "idx_wiraWhatsappMsg_embedding"            ON wira_whatsapp_message USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE FUNCTION notify_wira_whatsapp_message_changes()
RETURNS TRIGGER AS $$
DECLARE
    payload  JSONB;
    row_data JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        row_data := row_to_json(OLD)::JSONB;
    ELSE
        row_data := row_to_json(NEW)::JSONB;
    END IF;

    row_data := row_data - 'embedding' - 'metadata' - 'promptCosts' - 'whatsappRawPayload';

    payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_data);
    PERFORM pg_notify('wira_whatsapp_message_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_whatsapp_message_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_whatsapp_message
FOR EACH ROW EXECUTE FUNCTION notify_wira_whatsapp_message_changes();

CREATE OR REPLACE TRIGGER trg_wira_whatsapp_message_updated_at
BEFORE UPDATE ON wira_whatsapp_message
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraWhatsappMessageDB
{
    constructor()
    {
        this.db = pgDB;

        this.messageColumns = `"id", "wiraWhatsappId", "role", "content", "urls", "jobIds", "queueIds", "files", "instructionData", "isServer", "metadata", "promptCosts", "cancelled", "whatsappMessageId", "whatsappRawPayload", "cleanContent", "createdAt", "updatedAt"`;

        this.similarityInMin = 0.50;
        this.similarityInMax = 0.70;
        this.similarityOutMin = 0;
        this.similarityOutMax = 1;
    }

    #remapSimilarity(x)
    {
        x = Math.max(this.similarityInMin, Math.min(this.similarityInMax, x));
        const remapped = ((x - this.similarityInMin) / (this.similarityInMax - this.similarityInMin)) * (this.similarityOutMax - this.similarityOutMin) + this.similarityOutMin;
        return parseFloat(remapped.toFixed(4));
    }

    #inverseRemap(y)
    {
        const x = ((y - this.similarityOutMin) / (this.similarityOutMax - this.similarityOutMin)) * (this.similarityInMax - this.similarityInMin) + this.similarityInMin;
        return parseFloat(x.toFixed(4));
    }

    #createLogicalSimilarity(rawSimilarity)
    {
        let score = this.#remapSimilarity(rawSimilarity) * 100;

        if(score < 0)
        {
            score = 0;
        }

        if(score > 100)
        {
            score = 100;
        }

        return parseFloat(score.toFixed(2));
    }

    //FETCHES A WHATSAPP MESSAGE BY ITS ID. RETURNS 404 IF NOT FOUND. EMBEDDING EXCLUDED FROM RESULT.
    async fetchWhatsappMessageById(id)
    {
        try
        {
            const query = `SELECT ${this.messageColumns} FROM wira_whatsapp_message WHERE "id" = $1`;
            const params =
            [
                id
            ];

            const result = await this.db.query(query, params);
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: true,
                    message: "WhatsApp message not found.",
                    data:
                    {
                        found: false,
                        data: null
                    }
                };
            }

            return {
                statusCode: 200,
                success: true,
                message: "WhatsApp message fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchWhatsappMessageById at WiraWhatsappMessageDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching WhatsApp message.",
                data: null
            };
        }
    }

    //FETCHES A WHATSAPP MESSAGE BY ITS META WHATSAPP MESSAGE ID. RETURNS 404 IF NOT FOUND. EMBEDDING EXCLUDED FROM RESULT.
    async fetchWhatsappMessageByWhatsappMessageId(whatsappMessageId)
    {
        try
        {
            const query = `SELECT ${this.messageColumns} FROM wira_whatsapp_message WHERE "whatsappMessageId" = $1`;
            const params =
            [
                whatsappMessageId
            ];

            const result = await this.db.query(query, params);
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: true,
                    message: "WhatsApp message not found.",
                    data:
                    {
                        found: false,
                        data: null
                    }
                };
            }

            return {
                statusCode: 200,
                success: true,
                message: "WhatsApp message fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchWhatsappMessageByWhatsappMessageId at WiraWhatsappMessageDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching WhatsApp message.",
                data: null
            };
        }
    }

    //FETCHES WHATSAPP MESSAGES USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION. EMBEDDING EXCLUDED FROM RESULTS. IF filters.embed IS PROVIDED AS { text, threshold? }, PERFORMS SEMANTIC SEARCH INSTEAD — OTHER FILTERS STILL APPLY.
    async fetchWhatsappMessage(filters = {}, pagination = {}, strict = true)
    {
        try
        {
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            //SEMANTIC SEARCH PREPENDS $1 (EMBEDDING) AND $2 (THRESHOLD) — FILTER PLACEHOLDERS MUST START AT $3 IN THAT CASE.
            const isSemantic = filters.embed && filters.embed.text;

            const conditions = [];
            const params = [];
            let paramIndex = isSemantic ? 3 : 1;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.excludeIds && filters.excludeIds.length > 0)
            {
                conditions.push(`"id" != ALL($${paramIndex})`);
                params.push(filters.excludeIds);
                paramIndex++;
            }

            if(filters.wiraWhatsappId !== undefined)
            {
                conditions.push(`"wiraWhatsappId" = $${paramIndex}`);
                params.push(filters.wiraWhatsappId);
                paramIndex++;
            }

            if(filters.role !== undefined)
            {
                conditions.push(`"role" = $${paramIndex}`);
                params.push(filters.role);
                paramIndex++;
            }

            if(filters.content !== undefined)
            {
                if(typeof filters.content === "boolean")
                {
                    if(filters.content)
                    {
                        conditions.push(`"content" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"content" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"content" = $${paramIndex}`);
                        params.push(filters.content);
                    }
                    else
                    {
                        conditions.push(`"content" ILIKE $${paramIndex}`);
                        params.push(`%${filters.content}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.cleanContent !== undefined)
            {
                if(typeof filters.cleanContent === "boolean")
                {
                    if(filters.cleanContent)
                    {
                        conditions.push(`"cleanContent" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"cleanContent" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"cleanContent" = $${paramIndex}`);
                        params.push(filters.cleanContent);
                    }
                    else
                    {
                        conditions.push(`"cleanContent" ILIKE $${paramIndex}`);
                        params.push(`%${filters.cleanContent}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.jobIds !== undefined)
            {
                conditions.push(`"jobIds" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.jobIds));
                paramIndex++;
            }

            if(filters.files !== undefined)
            {
                if(filters.files)
                {
                    conditions.push(`"files" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"files" IS NULL`);
                }
            }

            if(filters.instructionData !== undefined)
            {
                if(filters.instructionData)
                {
                    conditions.push(`"instructionData" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"instructionData" IS NULL`);
                }
            }

            if(filters.isServer !== undefined)
            {
                conditions.push(`"isServer" = $${paramIndex}`);
                params.push(filters.isServer);
                paramIndex++;
            }

            if(filters.metadata !== undefined)
            {
                if(filters.metadata)
                {
                    conditions.push(`"metadata" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"metadata" IS NULL`);
                }
            }

            if(filters.promptCosts !== undefined)
            {
                if(filters.promptCosts)
                {
                    conditions.push(`"promptCosts" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"promptCosts" IS NULL`);
                }
            }

            if(filters.cancelled !== undefined)
            {
                conditions.push(`"cancelled" = $${paramIndex}`);
                params.push(filters.cancelled);
                paramIndex++;
            }

            if(filters.whatsappMessageId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"whatsappMessageId" = $${paramIndex}`);
                    params.push(filters.whatsappMessageId);
                }
                else
                {
                    conditions.push(`"whatsappMessageId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.whatsappMessageId}%`);
                }

                paramIndex++;
            }

            if(filters.whatsappRawPayload !== undefined)
            {
                if(filters.whatsappRawPayload)
                {
                    conditions.push(`"whatsappRawPayload" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"whatsappRawPayload" IS NULL`);
                }
            }

            if(filters.createdAtStart !== undefined)
            {
                conditions.push(`"createdAt" >= $${paramIndex}`);
                params.push(filters.createdAtStart);
                paramIndex++;
            }

            if(filters.createdAtEnd !== undefined)
            {
                conditions.push(`"createdAt" <= $${paramIndex}`);
                params.push(filters.createdAtEnd);
                paramIndex++;
            }

            if(filters.updatedAtStart !== undefined)
            {
                conditions.push(`"updatedAt" >= $${paramIndex}`);
                params.push(filters.updatedAtStart);
                paramIndex++;
            }

            if(filters.updatedAtEnd !== undefined)
            {
                conditions.push(`"updatedAt" <= $${paramIndex}`);
                params.push(filters.updatedAtEnd);
                paramIndex++;
            }

            //SEMANTIC SEARCH BRANCH — TRIGGERED WHEN filters.embed IS PROVIDED.
            if(isSemantic)
            {
                const threshold = filters.embed.threshold ?? 30;
                const rawThreshold = this.#inverseRemap(threshold / 100);

                const queryEmbedding = await this.embedder.getEmbedding(filters.embed.text);
                if(!queryEmbedding)
                {
                    return {
                        statusCode: 500,
                        success: false,
                        message: "Error occured embedding search query.",
                        data: null
                    };
                }

                const extraWhere = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
                const offset = (pageNo - 1) * perPage;
                const semanticParams = [queryEmbedding, rawThreshold, ...params];
                const limitParamIndex = semanticParams.length + 1;

                const semanticDataQuery = `
                    SELECT ${this.messageColumns}, 1 - (embedding <=> $1::vector) AS "rawSimilarity"
                    FROM wira_whatsapp_message
                    WHERE "embedding" IS NOT NULL
                    AND 1 - (embedding <=> $1::vector) >= $2
                    ${extraWhere}
                    ORDER BY "rawSimilarity" DESC
                    LIMIT $${limitParamIndex} OFFSET $${limitParamIndex + 1}
                `;

                const semanticCountQuery = `
                    SELECT COUNT(*) FROM wira_whatsapp_message
                    WHERE "embedding" IS NOT NULL
                    AND 1 - (embedding <=> $1::vector) >= $2
                    ${extraWhere}
                `;

                const [semanticResult, semanticCountResult] = await Promise.all(
                    [
                        this.db.query(semanticDataQuery, [...semanticParams, perPage, offset]),
                        this.db.query(semanticCountQuery, semanticParams)
                    ]
                );

                const total = parseInt(semanticCountResult.rows[0].count);

                const rows = semanticResult.rows.map((row) =>
                    {
                        const rawSimilarity = row.rawSimilarity;
                        const { rawSimilarity: _, ...rest } = row;

                        return {
                            ...rest,
                            similarity: this.#createLogicalSimilarity(rawSimilarity),
                            rawSimilarity: rawSimilarity
                        };
                    }
                );

                return {
                    statusCode: 200,
                    success: true,
                    message: "WhatsApp messages fetched successfully.",
                    data:
                    {
                        messages: rows,
                        pagination: paginated ?
                        {
                            currentPage: pageNo,
                            lastPage: Math.ceil(total / perPage),
                            perPage: perPage,
                            total: total
                        } :
                        {
                            total: total
                        }
                    }
                };
            }

            //STANDARD FETCH BRANCH.
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const countQuery = `SELECT COUNT(*) FROM wira_whatsapp_message ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT ${this.messageColumns} FROM wira_whatsapp_message ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT ${this.messageColumns} FROM wira_whatsapp_message ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "WhatsApp messages fetched successfully.",
                data:
                {
                    messages: result.rows,
                    pagination: paginated ?
                    {
                        currentPage: pageNo,
                        lastPage: Math.ceil(total / perPage),
                        perPage: perPage,
                        total: total
                    } :
                    {
                        total: total
                    }
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchWhatsappMessage at WiraWhatsappMessageDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching WhatsApp messages.",
                data: null
            };
        }
    }

    //CREATES A NEW WHATSAPP MESSAGE. wiraWhatsappId AND role ARE REQUIRED, PLUS AT LEAST ONE OF content OR files (TABLE CHECK CONSTRAINT). EMBEDDING IS AUTO-GENERATED FROM cleanContent IF PROVIDED, OTHERWISE FROM content — FILE-ONLY MESSAGES GET NO EMBEDDING.
    async createWhatsappMessage(data = {})
    {
        try
        {
            if(!data.wiraWhatsappId)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "wiraWhatsappId is required.",
                    data: null
                };
            }

            if(!data.role)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "role is required.",
                    data: null
                };
            }

            if(!data.content && !data.files)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "content or files is required.",
                    data: null
                };
            }

            let embedding = null;
            const embedText = data.cleanContent || data.content;
            if(embedText)
            {
                try
                {
                    embedding = await this.embedder.getEmbedding(embedText);
                }
                catch(embedError)
                {
                    console.error("Error occured embedding message in createWhatsappMessage at WiraWhatsappMessageDB in Wira/Database: ", embedError);
                }
            }

            const query = `
                INSERT INTO wira_whatsapp_message
                (
                    "wiraWhatsappId",
                    "role",
                    "content",
                    "urls",
                    "jobIds",
                    "queueIds",
                    "files",
                    "instructionData",
                    "isServer",
                    "metadata",
                    "promptCosts",
                    "cancelled",
                    "whatsappMessageId",
                    "whatsappRawPayload",
                    "cleanContent",
                    "embedding"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING ${this.messageColumns}
            `;

            const params =
            [
                data.wiraWhatsappId,
                data.role,
                data.content ?? null,
                JSON.stringify(data.urls ?? []),
                JSON.stringify(data.jobIds ?? []),
                JSON.stringify(data.queueIds ?? []),
                data.files ? JSON.stringify(data.files) : null,
                data.instructionData ? JSON.stringify(data.instructionData) : null,
                data.isServer ?? false,
                data.metadata ? JSON.stringify(data.metadata) : null,
                data.promptCosts ? JSON.stringify(data.promptCosts) : null,
                data.cancelled ?? false,
                data.whatsappMessageId ?? null,
                data.whatsappRawPayload ? JSON.stringify(data.whatsappRawPayload) : null,
                data.cleanContent ?? null,
                embedding
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "WhatsApp message created successfully.",
                data:
                {
                    message: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createWhatsappMessage at WiraWhatsappMessageDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating WhatsApp message.",
                data: null
            };
        }
    }

    //UPDATES WHATSAPP MESSAGES MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. IF content OR cleanContent IS UPDATED, EMBEDDING IS AUTO-REGENERATED — cleanContent WINS WHEN BOTH EXIST. IF ONLY content IS UPDATED, ROWS THAT ALREADY HAVE cleanContent KEEP THEIR EXISTING EMBEDDING.
    async updateWhatsappMessage(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.role !== undefined)
            {
                setClauses.push(`"role" = $${paramIndex}`);
                params.push(data.role);
                paramIndex++;
            }

            if(data.content !== undefined)
            {
                setClauses.push(`"content" = $${paramIndex}`);
                params.push(data.content);
                paramIndex++;
            }

            if(data.urls !== undefined)
            {
                setClauses.push(`"urls" = $${paramIndex}`);
                params.push(JSON.stringify(data.urls ?? []));
                paramIndex++;
            }

            if(data.jobIds !== undefined)
            {
                setClauses.push(`"jobIds" = $${paramIndex}`);
                params.push(JSON.stringify(data.jobIds ?? []));
                paramIndex++;
            }

            if(data.queueIds !== undefined)
            {
                setClauses.push(`"queueIds" = $${paramIndex}`);
                params.push(JSON.stringify(data.queueIds ?? []));
                paramIndex++;
            }

            if(data.files !== undefined)
            {
                setClauses.push(`"files" = $${paramIndex}`);
                params.push(data.files ? JSON.stringify(data.files) : null);
                paramIndex++;
            }

            if(data.instructionData !== undefined)
            {
                setClauses.push(`"instructionData" = $${paramIndex}`);
                params.push(data.instructionData ? JSON.stringify(data.instructionData) : null);
                paramIndex++;
            }

            if(data.isServer !== undefined)
            {
                setClauses.push(`"isServer" = $${paramIndex}`);
                params.push(data.isServer);
                paramIndex++;
            }

            if(data.metadata !== undefined)
            {
                setClauses.push(`"metadata" = $${paramIndex}`);
                params.push(data.metadata ? JSON.stringify(data.metadata) : null);
                paramIndex++;
            }

            if(data.promptCosts !== undefined)
            {
                setClauses.push(`"promptCosts" = $${paramIndex}`);
                params.push(data.promptCosts ? JSON.stringify(data.promptCosts) : null);
                paramIndex++;
            }

            if(data.cancelled !== undefined)
            {
                setClauses.push(`"cancelled" = $${paramIndex}`);
                params.push(data.cancelled);
                paramIndex++;
            }

            if(data.whatsappMessageId !== undefined)
            {
                setClauses.push(`"whatsappMessageId" = $${paramIndex}`);
                params.push(data.whatsappMessageId);
                paramIndex++;
            }

            if(data.whatsappRawPayload !== undefined)
            {
                setClauses.push(`"whatsappRawPayload" = $${paramIndex}`);
                params.push(data.whatsappRawPayload ? JSON.stringify(data.whatsappRawPayload) : null);
                paramIndex++;
            }

            if(data.cleanContent !== undefined)
            {
                setClauses.push(`"cleanContent" = $${paramIndex}`);
                params.push(data.cleanContent);
                paramIndex++;
            }

            //AUTO-EMBED — cleanContent IF PROVIDED, OTHERWISE content.
            if(data.cleanContent)
            {
                let embedding = null;
                try
                {
                    embedding = await this.embedder.getEmbedding(data.cleanContent);
                }
                catch(embedError)
                {
                    console.error("Error occured embedding message in updateWhatsappMessage at WiraWhatsappMessageDB in Wira/Database: ", embedError);
                }

                setClauses.push(`"embedding" = $${paramIndex}`);
                params.push(embedding);
                paramIndex++;
            }
            else if(data.content)
            {
                let embedding = null;
                try
                {
                    embedding = await this.embedder.getEmbedding(data.content);
                }
                catch(embedError)
                {
                    console.error("Error occured embedding message in updateWhatsappMessage at WiraWhatsappMessageDB in Wira/Database: ", embedError);
                }

                if(data.cleanContent === null)
                {
                    //cleanContent IS BEING CLEARED IN THIS SAME UPDATE — content BECOMES THE EMBEDDING SOURCE FOR EVERY ROW.
                    setClauses.push(`"embedding" = $${paramIndex}`);
                }
                else
                {
                    //ONLY RE-EMBED ROWS THAT HAVE NO cleanContent — ROWS WITH cleanContent KEEP THEIR EMBEDDING.
                    setClauses.push(`"embedding" = CASE WHEN "cleanContent" IS NULL THEN $${paramIndex}::vector ELSE "embedding" END`);
                }

                params.push(embedding);
                paramIndex++;
            }

            if(setClauses.length === 0)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "No data provided to update.",
                    data: null
                };
            }

            const conditions = [];

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.excludeIds && filters.excludeIds.length > 0)
            {
                conditions.push(`"id" != ALL($${paramIndex})`);
                params.push(filters.excludeIds);
                paramIndex++;
            }

            if(filters.wiraWhatsappId !== undefined)
            {
                conditions.push(`"wiraWhatsappId" = $${paramIndex}`);
                params.push(filters.wiraWhatsappId);
                paramIndex++;
            }

            if(filters.role !== undefined)
            {
                conditions.push(`"role" = $${paramIndex}`);
                params.push(filters.role);
                paramIndex++;
            }

            if(filters.content !== undefined)
            {
                if(typeof filters.content === "boolean")
                {
                    if(filters.content)
                    {
                        conditions.push(`"content" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"content" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"content" = $${paramIndex}`);
                        params.push(filters.content);
                    }
                    else
                    {
                        conditions.push(`"content" ILIKE $${paramIndex}`);
                        params.push(`%${filters.content}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.cleanContent !== undefined)
            {
                if(typeof filters.cleanContent === "boolean")
                {
                    if(filters.cleanContent)
                    {
                        conditions.push(`"cleanContent" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"cleanContent" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"cleanContent" = $${paramIndex}`);
                        params.push(filters.cleanContent);
                    }
                    else
                    {
                        conditions.push(`"cleanContent" ILIKE $${paramIndex}`);
                        params.push(`%${filters.cleanContent}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.jobIds !== undefined)
            {
                conditions.push(`"jobIds" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.jobIds));
                paramIndex++;
            }

            if(filters.files !== undefined)
            {
                if(filters.files)
                {
                    conditions.push(`"files" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"files" IS NULL`);
                }
            }

            if(filters.instructionData !== undefined)
            {
                if(filters.instructionData)
                {
                    conditions.push(`"instructionData" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"instructionData" IS NULL`);
                }
            }

            if(filters.isServer !== undefined)
            {
                conditions.push(`"isServer" = $${paramIndex}`);
                params.push(filters.isServer);
                paramIndex++;
            }

            if(filters.metadata !== undefined)
            {
                if(filters.metadata)
                {
                    conditions.push(`"metadata" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"metadata" IS NULL`);
                }
            }

            if(filters.promptCosts !== undefined)
            {
                if(filters.promptCosts)
                {
                    conditions.push(`"promptCosts" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"promptCosts" IS NULL`);
                }
            }

            if(filters.cancelled !== undefined)
            {
                conditions.push(`"cancelled" = $${paramIndex}`);
                params.push(filters.cancelled);
                paramIndex++;
            }

            if(filters.whatsappMessageId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"whatsappMessageId" = $${paramIndex}`);
                    params.push(filters.whatsappMessageId);
                }
                else
                {
                    conditions.push(`"whatsappMessageId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.whatsappMessageId}%`);
                }

                paramIndex++;
            }

            if(filters.whatsappRawPayload !== undefined)
            {
                if(filters.whatsappRawPayload)
                {
                    conditions.push(`"whatsappRawPayload" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"whatsappRawPayload" IS NULL`);
                }
            }

            if(filters.createdAtStart !== undefined)
            {
                conditions.push(`"createdAt" >= $${paramIndex}`);
                params.push(filters.createdAtStart);
                paramIndex++;
            }

            if(filters.createdAtEnd !== undefined)
            {
                conditions.push(`"createdAt" <= $${paramIndex}`);
                params.push(filters.createdAtEnd);
                paramIndex++;
            }

            if(filters.updatedAtStart !== undefined)
            {
                conditions.push(`"updatedAt" >= $${paramIndex}`);
                params.push(filters.updatedAtStart);
                paramIndex++;
            }

            if(filters.updatedAtEnd !== undefined)
            {
                conditions.push(`"updatedAt" <= $${paramIndex}`);
                params.push(filters.updatedAtEnd);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const query = `UPDATE wira_whatsapp_message SET ${setClauses.join(", ")} ${whereClause} RETURNING ${this.messageColumns}`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "WhatsApp messages updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    messages: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateWhatsappMessage at WiraWhatsappMessageDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating WhatsApp messages.",
                data: null
            };
        }
    }

    //DELETES WHATSAPP MESSAGES MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. NULLIFYING BOTH content AND files ON THE SAME ROW IS REJECTED BY THE TABLE CHECK CONSTRAINT.
    async deleteWhatsappMessage(data = {}, filters = {}, strict = true)
    {
        try
        {
            const conditions = [];
            const params = [];
            let paramIndex = 1;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.excludeIds && filters.excludeIds.length > 0)
            {
                conditions.push(`"id" != ALL($${paramIndex})`);
                params.push(filters.excludeIds);
                paramIndex++;
            }

            if(filters.wiraWhatsappId !== undefined)
            {
                conditions.push(`"wiraWhatsappId" = $${paramIndex}`);
                params.push(filters.wiraWhatsappId);
                paramIndex++;
            }

            if(filters.role !== undefined)
            {
                conditions.push(`"role" = $${paramIndex}`);
                params.push(filters.role);
                paramIndex++;
            }

            if(filters.content !== undefined)
            {
                if(typeof filters.content === "boolean")
                {
                    if(filters.content)
                    {
                        conditions.push(`"content" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"content" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"content" = $${paramIndex}`);
                        params.push(filters.content);
                    }
                    else
                    {
                        conditions.push(`"content" ILIKE $${paramIndex}`);
                        params.push(`%${filters.content}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.cleanContent !== undefined)
            {
                if(typeof filters.cleanContent === "boolean")
                {
                    if(filters.cleanContent)
                    {
                        conditions.push(`"cleanContent" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"cleanContent" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"cleanContent" = $${paramIndex}`);
                        params.push(filters.cleanContent);
                    }
                    else
                    {
                        conditions.push(`"cleanContent" ILIKE $${paramIndex}`);
                        params.push(`%${filters.cleanContent}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.jobIds !== undefined)
            {
                conditions.push(`"jobIds" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.jobIds));
                paramIndex++;
            }

            if(filters.files !== undefined)
            {
                if(filters.files)
                {
                    conditions.push(`"files" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"files" IS NULL`);
                }
            }

            if(filters.instructionData !== undefined)
            {
                if(filters.instructionData)
                {
                    conditions.push(`"instructionData" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"instructionData" IS NULL`);
                }
            }

            if(filters.isServer !== undefined)
            {
                conditions.push(`"isServer" = $${paramIndex}`);
                params.push(filters.isServer);
                paramIndex++;
            }

            if(filters.metadata !== undefined)
            {
                if(filters.metadata)
                {
                    conditions.push(`"metadata" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"metadata" IS NULL`);
                }
            }

            if(filters.promptCosts !== undefined)
            {
                if(filters.promptCosts)
                {
                    conditions.push(`"promptCosts" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"promptCosts" IS NULL`);
                }
            }

            if(filters.cancelled !== undefined)
            {
                conditions.push(`"cancelled" = $${paramIndex}`);
                params.push(filters.cancelled);
                paramIndex++;
            }

            if(filters.whatsappMessageId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"whatsappMessageId" = $${paramIndex}`);
                    params.push(filters.whatsappMessageId);
                }
                else
                {
                    conditions.push(`"whatsappMessageId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.whatsappMessageId}%`);
                }

                paramIndex++;
            }

            if(filters.whatsappRawPayload !== undefined)
            {
                if(filters.whatsappRawPayload)
                {
                    conditions.push(`"whatsappRawPayload" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"whatsappRawPayload" IS NULL`);
                }
            }

            if(filters.createdAtStart !== undefined)
            {
                conditions.push(`"createdAt" >= $${paramIndex}`);
                params.push(filters.createdAtStart);
                paramIndex++;
            }

            if(filters.createdAtEnd !== undefined)
            {
                conditions.push(`"createdAt" <= $${paramIndex}`);
                params.push(filters.createdAtEnd);
                paramIndex++;
            }

            if(filters.updatedAtStart !== undefined)
            {
                conditions.push(`"updatedAt" >= $${paramIndex}`);
                params.push(filters.updatedAtStart);
                paramIndex++;
            }

            if(filters.updatedAtEnd !== undefined)
            {
                conditions.push(`"updatedAt" <= $${paramIndex}`);
                params.push(filters.updatedAtEnd);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

            //NULLABLE COLUMNS THAT CAN BE EMPTIED
            const nullableCols =
            [
                "content",
                "files",
                "instructionData",
                "metadata",
                "promptCosts",
                "whatsappMessageId",
                "whatsappRawPayload",
                "cleanContent",
                "embedding"
            ];

            const colsToNull = nullableCols.filter((col) =>
                {
                    return data[col] === true;
                }
            );

            if(colsToNull.length > 0)
            {
                //NULLIFY THE REQUESTED COLUMNS INSTEAD OF DELETING
                const setClauses = colsToNull.map((col) =>
                    {
                        return `"${col}" = NULL`;
                    }
                );

                const query = `UPDATE wira_whatsapp_message SET ${setClauses.join(", ")} ${whereClause} RETURNING ${this.messageColumns}`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "WhatsApp message columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        messages: result.rows
                    }
                };
            }

            //NO DATA FIELDS — DELETE THE ROWS
            const query = `DELETE FROM wira_whatsapp_message ${whereClause} RETURNING ${this.messageColumns}`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "WhatsApp messages deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    messages: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteWhatsappMessage at WiraWhatsappMessageDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting WhatsApp messages.",
                data: null
            };
        }
    }

    //FETCHES WHATSAPP MESSAGES FOR A CANDIDATE. FIRST RESOLVES THE CANDIDATE FROM candidateFilters, THEN FETCHES THEIR WHATSAPP SESSIONS, THEN FETCHES MESSAGES MATCHING filters. RETURNS BOTH A STRUCTURED CANDIDATE OBJECT WITH WHATSAPPS AND MESSAGES, AND A FLAT MESSAGES ARRAY. EMBEDDING EXCLUDED FROM RESULTS.
    async fetchWhatsappMessagesFromCandidate(candidateFilters = {}, filters = {}, pagination = {}, strict = true)
    {
        try
        {
            //STEP 1 — RESOLVE CANDIDATE
            const candidateConditions = [];
            const candidateParams = [];
            let candidateParamIndex = 1;

            if(candidateFilters.phone !== undefined)
            {
                candidateConditions.push(`"phone" = $${candidateParamIndex}`);
                candidateParams.push(candidateFilters.phone);
                candidateParamIndex++;
            }

            if(candidateFilters.email !== undefined)
            {
                candidateConditions.push(`"email" = $${candidateParamIndex}`);
                candidateParams.push(candidateFilters.email);
                candidateParamIndex++;
            }

            if(candidateFilters.candidateId !== undefined)
            {
                candidateConditions.push(`"candidateId" = $${candidateParamIndex}`);
                candidateParams.push(candidateFilters.candidateId);
                candidateParamIndex++;
            }

            if(candidateConditions.length === 0)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "At least one candidate filter is required.",
                    data: null
                };
            }

            const candidateQuery = `SELECT * FROM wira_candidate WHERE ${candidateConditions.join(" AND ")} LIMIT 1`;
            const candidateResult = await this.db.query(candidateQuery, candidateParams);

            if(candidateResult.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: false,
                    message: "Candidate not found.",
                    data: null
                };
            }

            const candidate = candidateResult.rows[0];

            //STEP 2 — FETCH ALL WHATSAPP SESSIONS FOR THIS CANDIDATE
            const whatsappsQuery = `SELECT * FROM wira_whatsapp WHERE "wiraCandidateId" = $1 ORDER BY "createdAt" DESC`;
            const whatsappsResult = await this.db.query(whatsappsQuery, [candidate.id]);

            if(whatsappsResult.rows.length === 0)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "No WhatsApp sessions found for candidate.",
                    data:
                    {
                        candidate:
                        {
                            ...candidate,
                            whatsapps: []
                        },
                        messages: [],
                        pagination:
                        {
                            total: 0
                        }
                    }
                };
            }

            const whatsapps = whatsappsResult.rows;

            //STEP 3 — EXTRACT ALL WHATSAPP IDS
            const allWhatsappIds = whatsapps.map((whatsapp) =>
                {
                    return whatsapp.id;
                }
            );

            //STEP 4 — BUILD MESSAGE QUERY WITH FILTERS
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            const conditions = [`"wiraWhatsappId" = ANY($1)`];
            const params = [allWhatsappIds];
            let paramIndex = 2;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.excludeIds && filters.excludeIds.length > 0)
            {
                conditions.push(`"id" != ALL($${paramIndex})`);
                params.push(filters.excludeIds);
                paramIndex++;
            }

            if(filters.wiraWhatsappId !== undefined)
            {
                conditions.push(`"wiraWhatsappId" = $${paramIndex}`);
                params.push(filters.wiraWhatsappId);
                paramIndex++;
            }

            if(filters.role !== undefined)
            {
                conditions.push(`"role" = $${paramIndex}`);
                params.push(filters.role);
                paramIndex++;
            }

            if(filters.content !== undefined)
            {
                if(typeof filters.content === "boolean")
                {
                    if(filters.content)
                    {
                        conditions.push(`"content" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"content" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"content" = $${paramIndex}`);
                        params.push(filters.content);
                    }
                    else
                    {
                        conditions.push(`"content" ILIKE $${paramIndex}`);
                        params.push(`%${filters.content}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.cleanContent !== undefined)
            {
                if(typeof filters.cleanContent === "boolean")
                {
                    if(filters.cleanContent)
                    {
                        conditions.push(`"cleanContent" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"cleanContent" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"cleanContent" = $${paramIndex}`);
                        params.push(filters.cleanContent);
                    }
                    else
                    {
                        conditions.push(`"cleanContent" ILIKE $${paramIndex}`);
                        params.push(`%${filters.cleanContent}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.jobIds !== undefined)
            {
                conditions.push(`"jobIds" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.jobIds));
                paramIndex++;
            }

            if(filters.files !== undefined)
            {
                if(filters.files)
                {
                    conditions.push(`"files" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"files" IS NULL`);
                }
            }

            if(filters.instructionData !== undefined)
            {
                if(filters.instructionData)
                {
                    conditions.push(`"instructionData" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"instructionData" IS NULL`);
                }
            }

            if(filters.isServer !== undefined)
            {
                conditions.push(`"isServer" = $${paramIndex}`);
                params.push(filters.isServer);
                paramIndex++;
            }

            if(filters.metadata !== undefined)
            {
                if(filters.metadata)
                {
                    conditions.push(`"metadata" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"metadata" IS NULL`);
                }
            }

            if(filters.promptCosts !== undefined)
            {
                if(filters.promptCosts)
                {
                    conditions.push(`"promptCosts" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"promptCosts" IS NULL`);
                }
            }

            if(filters.cancelled !== undefined)
            {
                conditions.push(`"cancelled" = $${paramIndex}`);
                params.push(filters.cancelled);
                paramIndex++;
            }

            if(filters.whatsappMessageId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"whatsappMessageId" = $${paramIndex}`);
                    params.push(filters.whatsappMessageId);
                }
                else
                {
                    conditions.push(`"whatsappMessageId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.whatsappMessageId}%`);
                }

                paramIndex++;
            }

            if(filters.whatsappRawPayload !== undefined)
            {
                if(filters.whatsappRawPayload)
                {
                    conditions.push(`"whatsappRawPayload" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"whatsappRawPayload" IS NULL`);
                }
            }

            if(filters.createdAtStart !== undefined)
            {
                conditions.push(`"createdAt" >= $${paramIndex}`);
                params.push(filters.createdAtStart);
                paramIndex++;
            }

            if(filters.createdAtEnd !== undefined)
            {
                conditions.push(`"createdAt" <= $${paramIndex}`);
                params.push(filters.createdAtEnd);
                paramIndex++;
            }

            if(filters.updatedAtStart !== undefined)
            {
                conditions.push(`"updatedAt" >= $${paramIndex}`);
                params.push(filters.updatedAtStart);
                paramIndex++;
            }

            if(filters.updatedAtEnd !== undefined)
            {
                conditions.push(`"updatedAt" <= $${paramIndex}`);
                params.push(filters.updatedAtEnd);
                paramIndex++;
            }

            const whereClause = `WHERE ${conditions.join(" AND ")}`;
            const countQuery = `SELECT COUNT(*) FROM wira_whatsapp_message ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT ${this.messageColumns} FROM wira_whatsapp_message ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT ${this.messageColumns} FROM wira_whatsapp_message ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const messagesResult = await this.db.query(dataQuery, params);
            const messages = messagesResult.rows;

            //STEP 5 — BUILD WHATSAPP+MESSAGE TREE, ONLY INCLUDE WHATSAPPS THAT HAVE MATCHING MESSAGES
            const messageMap = new Map();
            messages.forEach((message) =>
                {
                    if(!messageMap.has(message.wiraWhatsappId))
                    {
                        messageMap.set(message.wiraWhatsappId, []);
                    }

                    messageMap.get(message.wiraWhatsappId).push(message);
                }
            );

            const whatsappsWithMessages = whatsapps.map((whatsapp) =>
                {
                    const whatsappMessages = messageMap.get(whatsapp.id) ?? [];
                    if(whatsappMessages.length === 0)
                    {
                        return null;
                    }

                    return {
                        ...whatsapp,
                        messages: whatsappMessages
                    };
                }
            )
            .filter(Boolean);

            return {
                statusCode: 200,
                success: true,
                message: "Candidate WhatsApp messages fetched successfully.",
                data:
                {
                    candidate:
                    {
                        ...candidate,
                        whatsapps: whatsappsWithMessages
                    },
                    messages: messages,
                    pagination: paginated ?
                    {
                        currentPage: pageNo,
                        lastPage: Math.ceil(total / perPage),
                        perPage: perPage,
                        total: total
                    } :
                    {
                        total: total
                    }
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchWhatsappMessagesFromCandidate at WiraWhatsappMessageDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidate WhatsApp messages.",
                data: null
            };
        }
    }
}

module.exports = WiraWhatsappMessageDB;