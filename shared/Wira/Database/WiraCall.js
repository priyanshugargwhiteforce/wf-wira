const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_call
================================================================================

Top-level call record for every phone call regardless of type. Holds all data
universal to any call — transcript, cost breakdown, AI-generated summary,
hangup details, and a 1024-dimension semantic embedding of the summary.
Call-type-specific data (e.g. screening results) lives in child tables.

hangupBy: what Plivo reported as the party who ended the call.
hangupReason: raw Plivo hangup reason string.
hangupCause: what the AI independently classified.

NOTE ON TYPO: The actual FK column is "wiraCandidateId" (with 'a') in wira_call,
but callers may pass either "wiraCandidateId" (correct) or "wireCandidateId"
(typo matching wira_files). All filter and data methods accept either spelling
and always map to the real column name "wiraCandidateId".

STATUS VALUES (constraint enforced):
    initiated    — call record created, Plivo has not dialled yet
    in_progress  — candidate picked up, WebSocket streaming active
    finalizing   — call ended, post-call analysis running
    completed    — analysis done, all costs recorded
    failed       — Plivo reported failed
    no_answer    — carrier reported NO_USER_RESPONSE
    busy         — carrier reported USER_BUSY
    canceled     — call canceled before connecting

+-------------------+-------------+-------------------------------------------+
| Column            | Type        | Constraints                               |
+-------------------+-------------+-------------------------------------------+
| id                | BIGSERIAL   | Primary Key                               |
| wiraCandidateId   | BIGINT      | NOT NULL, FK → wira_candidate             |
| callId            | VARCHAR(255)| nullable — Plivo UUID                     |
| fromPhone         | VARCHAR(20) | NOT NULL                                  |
| bound             | VARCHAR(10) | NOT NULL, CHECK IN (inbound, outbound)    |
| type              | VARCHAR(100)| NOT NULL                                  |
| status            | VARCHAR(20) | NOT NULL, DEFAULT initiated               |
|                   |             | CHECK IN (initiated, in_progress,         |
|                   |             | finalizing, completed, failed, no_answer, |
|                   |             | busy, canceled)                           |
| webName           | VARCHAR(255)| NOT NULL, DEFAULT White Force             |
| intro             | TEXT        | nullable                                  |
| language          | VARCHAR(20) | DEFAULT hi                                |
| transcript        | JSONB       | nullable                                  |
| cleanTranscript   | JSONB       | nullable — English translation            |
| duration          | INTEGER     | nullable — total seconds                  |
| recordingUrl      | VARCHAR(500)| nullable                                  |
| hangupBy          | VARCHAR(50) | nullable                                  |
| hangupReason      | VARCHAR(255)| nullable — raw Plivo string               |
| hangupCause       | VARCHAR(50) | nullable — AI classification              |
| interest          | VARCHAR(20) | nullable, CHECK IN (interested,           |
|                   |             | not_interested, unknown)                  |
| startedAt         | TIMESTAMPTZ | nullable                                  |
| endedAt           | TIMESTAMPTZ | nullable                                  |
| preCost           | NUMERIC     | NOT NULL, DEFAULT 0                       |
| sarvamTotalCost   | NUMERIC     | NOT NULL, DEFAULT 0                       |
| plivoTotalCost    | NUMERIC     | NOT NULL, DEFAULT 0                       |
| geminiTotalCost   | NUMERIC     | NOT NULL, DEFAULT 0                       |
| geminiPostCost    | NUMERIC     | NOT NULL, DEFAULT 0                       |
| totalCost         | NUMERIC     | NOT NULL, DEFAULT 0                       |
| summary           | TEXT        | nullable — AI generated summary           |
| embedding         | vector(1024)| nullable — semantic embedding of summary  |
| createdAt         | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                   |
| updatedAt         | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                   |
+-------------------+-------------+-------------------------------------------+

Embedding is auto-generated from summary on create/update. The embedding column
is excluded from all SELECT queries in this class — use filters.embed for
semantic search.
Notification channel: wira_call_changes

--- SQL ---

CREATE TABLE wira_call
(
    "id"                BIGSERIAL    PRIMARY KEY,
    "wiraCandidateId"   BIGINT       NOT NULL REFERENCES wira_candidate("id") ON DELETE CASCADE,
    "callId"            VARCHAR(255),
    "fromPhone"         VARCHAR(20)  NOT NULL,
    "bound"             VARCHAR(10)  NOT NULL CHECK ("bound" IN ('inbound', 'outbound')),
    "type"              VARCHAR(100) NOT NULL,
    "status"            VARCHAR(20)  NOT NULL DEFAULT 'initiated'
                            CONSTRAINT "wira_call_status_check"
                            CHECK ("status" IN ('initiated', 'in_progress', 'finalizing', 'completed', 'failed', 'no_answer', 'busy', 'canceled')),
    "webName"           VARCHAR(255) NOT NULL DEFAULT 'White Force',
    "intro"             TEXT,
    "language"          VARCHAR(20)  DEFAULT 'hi',
    "transcript"        JSONB,
    "cleanTranscript"   JSONB,
    "duration"          INTEGER,
    "recordingUrl"      VARCHAR(500),
    "hangupBy"          VARCHAR(50),
    "hangupReason"      VARCHAR(255),
    "hangupCause"       VARCHAR(50),
    "interest"          VARCHAR(20) CHECK ("interest" IN ('interested', 'not_interested', 'unknown')),
    "startedAt"         TIMESTAMPTZ,
    "endedAt"           TIMESTAMPTZ,
    "preCost"           NUMERIC(12,6) NOT NULL DEFAULT 0,
    "sarvamTotalCost"   NUMERIC(12,6) NOT NULL DEFAULT 0,
    "plivoTotalCost"    NUMERIC(12,6) NOT NULL DEFAULT 0,
    "geminiTotalCost"   NUMERIC(12,6) NOT NULL DEFAULT 0,
    "geminiPostCost"    NUMERIC(12,6) NOT NULL DEFAULT 0,
    "totalCost"         NUMERIC(12,6) NOT NULL DEFAULT 0,
    "summary"           TEXT,
    "embedding"         vector(1024),
    "createdAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "chk_wiraCall_duration" CHECK ("duration" IS NULL OR "duration" >= 0),
    CONSTRAINT "chk_wiraCall_endedAt"  CHECK ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt")
);

CREATE INDEX "idx_wiraCall_wiraCandidateId"        ON wira_call("wiraCandidateId");
CREATE UNIQUE INDEX "uq_wiraCall_callId"            ON wira_call("callId")     WHERE "callId"     IS NOT NULL;
CREATE INDEX "idx_wiraCall_fromPhone"               ON wira_call("fromPhone");
CREATE INDEX "idx_wiraCall_bound"                   ON wira_call("bound");
CREATE INDEX "idx_wiraCall_type"                    ON wira_call("type");
CREATE INDEX "idx_wiraCall_status"                  ON wira_call("status");
CREATE INDEX "idx_wiraCall_webName"                 ON wira_call("webName");
CREATE INDEX "idx_wiraCall_language"                ON wira_call("language");
CREATE INDEX "idx_wiraCall_candidateId_status"      ON wira_call("wiraCandidateId", "status");
CREATE INDEX "idx_wiraCall_hangupCause"             ON wira_call("hangupCause")  WHERE "hangupCause"  IS NOT NULL;
CREATE INDEX "idx_wiraCall_interest"                ON wira_call("interest")     WHERE "interest"     IS NOT NULL;
CREATE INDEX "idx_wiraCall_totalCost"               ON wira_call("totalCost");
CREATE INDEX "idx_wiraCall_startedAt"               ON wira_call("startedAt"    DESC) WHERE "startedAt" IS NOT NULL;
CREATE INDEX "idx_wiraCall_endedAt"                 ON wira_call("endedAt"      DESC) WHERE "endedAt"   IS NOT NULL;
CREATE INDEX "idx_wiraCall_createdAt"               ON wira_call("createdAt"    DESC);
CREATE INDEX "idx_wiraCall_updatedAt"               ON wira_call("updatedAt"    DESC);
CREATE INDEX "idx_wiraCall_embedding"               ON wira_call USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE FUNCTION notify_wira_call_changes()
RETURNS TRIGGER AS $$
DECLARE
    payload     JSONB;
    call_row    JSONB;
    screening   JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        call_row := row_to_json(OLD)::JSONB;
    ELSE
        call_row := row_to_json(NEW)::JSONB;
    END IF;

    call_row := call_row
        - 'transcript'
        - 'cleanTranscript'
        - 'embedding';

    IF TG_OP != 'DELETE' AND NEW.status IN ('completed', 'failed', 'no_answer', 'busy', 'canceled') THEN
        SELECT jsonb_build_object(
            'id',           os.id,
            'jobId',        os."jobId",
            'jobTitle',     os."jobTitle",
            'companyName',  os."companyName",
            'score',        os.score,
            'scoreReason',  os."scoreReason"
        )
        INTO screening
        FROM wira_outbound_screening os
        WHERE os."wiraCallId" = NEW.id
        LIMIT 1;
    END IF;

    payload := jsonb_build_object(
        'operation',         TG_OP,
        'table',             TG_TABLE_NAME,
        'data',              call_row,
        'outboundScreening', COALESCE(screening, 'null'::JSONB)
    );

    PERFORM pg_notify('wira_call_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_call_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_call
FOR EACH ROW EXECUTE FUNCTION notify_wira_call_changes();

CREATE OR REPLACE TRIGGER trg_wira_call_updated_at
BEFORE UPDATE ON wira_call
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraCallDB
{
    constructor()
    {
        this.db = pgDB;

        this.callColumns = `"id", "wiraCandidateId", "callId", "fromPhone", "bound", "type", "status", "webName", "intro", "language", "transcript", "cleanTranscript", "duration", "recordingUrl", "hangupBy", "hangupReason", "hangupCause", "interest", "startedAt", "endedAt", "preCost", "sarvamTotalCost", "plivoTotalCost", "geminiTotalCost", "geminiPostCost", "totalCost", "summary", "createdAt", "updatedAt"`;

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

    //FETCHES A CALL BY ITS ID. RETURNS 404 IF NOT FOUND. EMBEDDING EXCLUDED FROM RESULT.
    async fetchCallById(id)
    {
        try
        {
            const query = `SELECT ${this.callColumns} FROM wira_call WHERE "id" = $1`;
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
                    message: "Call not found.",
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
                message: "Call fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchCallById at WiraCallDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching call.",
                data: null
            };
        }
    }

    //FETCHES A CALL BY ITS PLIVO callId. RETURNS 404 IF NOT FOUND. EMBEDDING EXCLUDED FROM RESULT.
    async fetchCallByCallId(callId)
    {
        try
        {
            const query = `SELECT ${this.callColumns} FROM wira_call WHERE "callId" = $1`;
            const params =
            [
                callId
            ];

            const result = await this.db.query(query, params);
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: true,
                    message: "Call not found.",
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
                message: "Call fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchCallByCallId at WiraCallDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching call.",
                data: null
            };
        }
    }

    //FETCHES CALLS USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION. EMBEDDING EXCLUDED FROM RESULTS. IF filters.embed IS PROVIDED AS { text, threshold? }, PERFORMS SEMANTIC SEARCH INSTEAD — OTHER FILTERS STILL APPLY. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS.
    async fetchCall(filters = {}, pagination = {}, strict = true)
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

            //ACCEPT BOTH SPELLINGS — wiraCandidateId (CORRECT) AND wireCandidateId (TYPO).
            const candidateIdFilter = filters.wiraCandidateId ?? filters.wireCandidateId;
            if(candidateIdFilter !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
                paramIndex++;
            }

            if(filters.callId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"callId" = $${paramIndex}`);
                    params.push(filters.callId);
                }
                else
                {
                    conditions.push(`"callId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.callId}%`);
                }

                paramIndex++;
            }

            if(filters.fromPhone !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"fromPhone" = $${paramIndex}`);
                    params.push(filters.fromPhone);
                }
                else
                {
                    conditions.push(`"fromPhone" ILIKE $${paramIndex}`);
                    params.push(`%${filters.fromPhone}%`);
                }

                paramIndex++;
            }

            if(filters.bound !== undefined)
            {
                conditions.push(`"bound" = $${paramIndex}`);
                params.push(filters.bound);
                paramIndex++;
            }

            if(filters.type !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"type" = $${paramIndex}`);
                    params.push(filters.type);
                }
                else
                {
                    conditions.push(`"type" ILIKE $${paramIndex}`);
                    params.push(`%${filters.type}%`);
                }

                paramIndex++;
            }

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.webName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"webName" = $${paramIndex}`);
                    params.push(filters.webName);
                }
                else
                {
                    conditions.push(`"webName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.webName}%`);
                }

                paramIndex++;
            }

            if(filters.language !== undefined)
            {
                conditions.push(`"language" = $${paramIndex}`);
                params.push(filters.language);
                paramIndex++;
            }

            if(filters.hangupBy !== undefined)
            {
                conditions.push(`"hangupBy" = $${paramIndex}`);
                params.push(filters.hangupBy);
                paramIndex++;
            }

            if(filters.hangupCause !== undefined)
            {
                conditions.push(`"hangupCause" = $${paramIndex}`);
                params.push(filters.hangupCause);
                paramIndex++;
            }

            if(filters.interest !== undefined)
            {
                conditions.push(`"interest" = $${paramIndex}`);
                params.push(filters.interest);
                paramIndex++;
            }

            if(filters.durationMin !== undefined)
            {
                conditions.push(`"duration" >= $${paramIndex}`);
                params.push(filters.durationMin);
                paramIndex++;
            }

            if(filters.durationMax !== undefined)
            {
                conditions.push(`"duration" <= $${paramIndex}`);
                params.push(filters.durationMax);
                paramIndex++;
            }

            if(filters.totalCostMin !== undefined)
            {
                conditions.push(`"totalCost" >= $${paramIndex}`);
                params.push(filters.totalCostMin);
                paramIndex++;
            }

            if(filters.totalCostMax !== undefined)
            {
                conditions.push(`"totalCost" <= $${paramIndex}`);
                params.push(filters.totalCostMax);
                paramIndex++;
            }

            if(filters.startedAtStart !== undefined)
            {
                conditions.push(`"startedAt" >= $${paramIndex}`);
                params.push(filters.startedAtStart);
                paramIndex++;
            }

            if(filters.startedAtEnd !== undefined)
            {
                conditions.push(`"startedAt" <= $${paramIndex}`);
                params.push(filters.startedAtEnd);
                paramIndex++;
            }

            if(filters.endedAtStart !== undefined)
            {
                conditions.push(`"endedAt" >= $${paramIndex}`);
                params.push(filters.endedAtStart);
                paramIndex++;
            }

            if(filters.endedAtEnd !== undefined)
            {
                conditions.push(`"endedAt" <= $${paramIndex}`);
                params.push(filters.endedAtEnd);
                paramIndex++;
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
                    SELECT ${this.callColumns}, 1 - (embedding <=> $1::vector) AS "rawSimilarity"
                    FROM wira_call
                    WHERE "embedding" IS NOT NULL
                    AND 1 - (embedding <=> $1::vector) >= $2
                    ${extraWhere}
                    ORDER BY "rawSimilarity" DESC
                    LIMIT $${limitParamIndex} OFFSET $${limitParamIndex + 1}
                `;

                const semanticCountQuery = `
                    SELECT COUNT(*) FROM wira_call
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
                    message: "Calls fetched successfully.",
                    data:
                    {
                        calls: rows,
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
            const countQuery = `SELECT COUNT(*) FROM wira_call ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT ${this.callColumns} FROM wira_call ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT ${this.callColumns} FROM wira_call ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Calls fetched successfully.",
                data:
                {
                    calls: result.rows,
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
            console.error("Error occured in fetchCall at WiraCallDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching calls.",
                data: null
            };
        }
    }

    //CREATES A NEW CALL. wiraCandidateId, fromPhone, bound, AND type ARE REQUIRED. EMBEDDING IS AUTO-GENERATED FROM summary IF PROVIDED. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS.
    async createCall(data = {})
    {
        try
        {
            //ACCEPT BOTH SPELLINGS — wiraCandidateId (CORRECT) AND wireCandidateId (TYPO).
            const candidateId = data.wiraCandidateId ?? data.wireCandidateId;

            if(!candidateId)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "wiraCandidateId is required.",
                    data: null
                };
            }

            if(!data.fromPhone)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "fromPhone is required.",
                    data: null
                };
            }

            if(!data.bound)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "bound is required.",
                    data: null
                };
            }

            if(!data.type)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "type is required.",
                    data: null
                };
            }

            let embedding = null;
            if(data.summary)
            {
                try
                {
                    embedding = await this.embedder.getEmbedding(data.summary);
                }
                catch(embedError)
                {
                    console.error("Error occured embedding summary in createCall at WiraCallDB in Wira/Database: ", embedError);
                }
            }

            const query = `
                INSERT INTO wira_call
                (
                    "wiraCandidateId",
                    "callId",
                    "fromPhone",
                    "bound",
                    "type",
                    "status",
                    "webName",
                    "intro",
                    "language",
                    "transcript",
                    "cleanTranscript",
                    "duration",
                    "recordingUrl",
                    "hangupBy",
                    "hangupReason",
                    "hangupCause",
                    "interest",
                    "startedAt",
                    "endedAt",
                    "preCost",
                    "sarvamTotalCost",
                    "plivoTotalCost",
                    "geminiTotalCost",
                    "geminiPostCost",
                    "totalCost",
                    "summary",
                    "embedding"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
                RETURNING ${this.callColumns}
            `;

            const params =
            [
                candidateId,
                data.callId ?? null,
                data.fromPhone,
                data.bound,
                data.type,
                data.status ?? "initiated",
                data.webName ?? "White Force",
                data.intro ?? null,
                data.language ?? "hi",
                data.transcript ? JSON.stringify(data.transcript) : null,
                data.cleanTranscript ? JSON.stringify(data.cleanTranscript) : null,
                data.duration ?? null,
                data.recordingUrl ?? null,
                data.hangupBy ?? null,
                data.hangupReason ?? null,
                data.hangupCause ?? null,
                data.interest ?? null,
                data.startedAt ?? null,
                data.endedAt ?? null,
                data.preCost ?? 0,
                data.sarvamTotalCost ?? 0,
                data.plivoTotalCost ?? 0,
                data.geminiTotalCost ?? 0,
                data.geminiPostCost ?? 0,
                data.totalCost ?? 0,
                data.summary ?? null,
                embedding
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Call created successfully.",
                data:
                {
                    call: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createCall at WiraCallDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating call.",
                data: null
            };
        }
    }

    //UPDATES CALLS MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. IF summary IS UPDATED, EMBEDDING IS AUTO-REGENERATED. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS IN FILTERS.
    async updateCall(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.callId !== undefined)
            {
                setClauses.push(`"callId" = $${paramIndex}`);
                params.push(data.callId);
                paramIndex++;
            }

            if(data.fromPhone !== undefined)
            {
                setClauses.push(`"fromPhone" = $${paramIndex}`);
                params.push(data.fromPhone);
                paramIndex++;
            }

            if(data.bound !== undefined)
            {
                setClauses.push(`"bound" = $${paramIndex}`);
                params.push(data.bound);
                paramIndex++;
            }

            if(data.type !== undefined)
            {
                setClauses.push(`"type" = $${paramIndex}`);
                params.push(data.type);
                paramIndex++;
            }

            if(data.status !== undefined)
            {
                setClauses.push(`"status" = $${paramIndex}`);
                params.push(data.status);
                paramIndex++;
            }

            if(data.webName !== undefined)
            {
                setClauses.push(`"webName" = $${paramIndex}`);
                params.push(data.webName);
                paramIndex++;
            }

            if(data.intro !== undefined)
            {
                setClauses.push(`"intro" = $${paramIndex}`);
                params.push(data.intro);
                paramIndex++;
            }

            if(data.language !== undefined)
            {
                setClauses.push(`"language" = $${paramIndex}`);
                params.push(data.language);
                paramIndex++;
            }

            if(data.transcript !== undefined)
            {
                setClauses.push(`"transcript" = $${paramIndex}`);
                params.push(data.transcript ? JSON.stringify(data.transcript) : null);
                paramIndex++;
            }

            if(data.cleanTranscript !== undefined)
            {
                setClauses.push(`"cleanTranscript" = $${paramIndex}`);
                params.push(data.cleanTranscript ? JSON.stringify(data.cleanTranscript) : null);
                paramIndex++;
            }

            if(data.duration !== undefined)
            {
                setClauses.push(`"duration" = $${paramIndex}`);
                params.push(data.duration);
                paramIndex++;
            }

            if(data.recordingUrl !== undefined)
            {
                setClauses.push(`"recordingUrl" = $${paramIndex}`);
                params.push(data.recordingUrl);
                paramIndex++;
            }

            if(data.hangupBy !== undefined)
            {
                setClauses.push(`"hangupBy" = $${paramIndex}`);
                params.push(data.hangupBy);
                paramIndex++;
            }

            if(data.hangupReason !== undefined)
            {
                setClauses.push(`"hangupReason" = $${paramIndex}`);
                params.push(data.hangupReason);
                paramIndex++;
            }

            if(data.hangupCause !== undefined)
            {
                setClauses.push(`"hangupCause" = $${paramIndex}`);
                params.push(data.hangupCause);
                paramIndex++;
            }

            if(data.interest !== undefined)
            {
                setClauses.push(`"interest" = $${paramIndex}`);
                params.push(data.interest);
                paramIndex++;
            }

            if(data.startedAt !== undefined)
            {
                setClauses.push(`"startedAt" = $${paramIndex}`);
                params.push(data.startedAt);
                paramIndex++;
            }

            if(data.endedAt !== undefined)
            {
                setClauses.push(`"endedAt" = $${paramIndex}`);
                params.push(data.endedAt);
                paramIndex++;
            }

            if(data.preCost !== undefined)
            {
                setClauses.push(`"preCost" = $${paramIndex}`);
                params.push(data.preCost);
                paramIndex++;
            }

            if(data.sarvamTotalCost !== undefined)
            {
                setClauses.push(`"sarvamTotalCost" = $${paramIndex}`);
                params.push(data.sarvamTotalCost);
                paramIndex++;
            }

            if(data.plivoTotalCost !== undefined)
            {
                setClauses.push(`"plivoTotalCost" = $${paramIndex}`);
                params.push(data.plivoTotalCost);
                paramIndex++;
            }

            if(data.geminiTotalCost !== undefined)
            {
                setClauses.push(`"geminiTotalCost" = $${paramIndex}`);
                params.push(data.geminiTotalCost);
                paramIndex++;
            }

            if(data.geminiPostCost !== undefined)
            {
                setClauses.push(`"geminiPostCost" = $${paramIndex}`);
                params.push(data.geminiPostCost);
                paramIndex++;
            }

            if(data.totalCost !== undefined)
            {
                setClauses.push(`"totalCost" = $${paramIndex}`);
                params.push(data.totalCost);
                paramIndex++;
            }

            if(data.summary !== undefined)
            {
                setClauses.push(`"summary" = $${paramIndex}`);
                params.push(data.summary);
                paramIndex++;

                //AUTO-EMBED NEW SUMMARY.
                let embedding = null;
                if(data.summary)
                {
                    try
                    {
                        embedding = await this.embedder.getEmbedding(data.summary);
                    }
                    catch(embedError)
                    {
                        console.error("Error occured embedding summary in updateCall at WiraCallDB in Wira/Database: ", embedError);
                    }
                }

                setClauses.push(`"embedding" = $${paramIndex}`);
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

            //ACCEPT BOTH SPELLINGS — wiraCandidateId (CORRECT) AND wireCandidateId (TYPO).
            const candidateIdFilter = filters.wiraCandidateId ?? filters.wireCandidateId;
            if(candidateIdFilter !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
                paramIndex++;
            }

            if(filters.callId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"callId" = $${paramIndex}`);
                    params.push(filters.callId);
                }
                else
                {
                    conditions.push(`"callId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.callId}%`);
                }

                paramIndex++;
            }

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.bound !== undefined)
            {
                conditions.push(`"bound" = $${paramIndex}`);
                params.push(filters.bound);
                paramIndex++;
            }

            if(filters.type !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"type" = $${paramIndex}`);
                    params.push(filters.type);
                }
                else
                {
                    conditions.push(`"type" ILIKE $${paramIndex}`);
                    params.push(`%${filters.type}%`);
                }

                paramIndex++;
            }

            if(filters.webName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"webName" = $${paramIndex}`);
                    params.push(filters.webName);
                }
                else
                {
                    conditions.push(`"webName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.webName}%`);
                }

                paramIndex++;
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
            const query = `UPDATE wira_call SET ${setClauses.join(", ")} ${whereClause} RETURNING ${this.callColumns}`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Calls updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    calls: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateCall at WiraCallDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating calls.",
                data: null
            };
        }
    }

    //DELETES CALLS MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS.
    async deleteCall(data = {}, filters = {}, strict = true)
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

            //ACCEPT BOTH SPELLINGS — wiraCandidateId (CORRECT) AND wireCandidateId (TYPO).
            const candidateIdFilter = filters.wiraCandidateId ?? filters.wireCandidateId;
            if(candidateIdFilter !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
                paramIndex++;
            }

            if(filters.callId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"callId" = $${paramIndex}`);
                    params.push(filters.callId);
                }
                else
                {
                    conditions.push(`"callId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.callId}%`);
                }

                paramIndex++;
            }

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.bound !== undefined)
            {
                conditions.push(`"bound" = $${paramIndex}`);
                params.push(filters.bound);
                paramIndex++;
            }

            if(filters.type !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"type" = $${paramIndex}`);
                    params.push(filters.type);
                }
                else
                {
                    conditions.push(`"type" ILIKE $${paramIndex}`);
                    params.push(`%${filters.type}%`);
                }

                paramIndex++;
            }

            if(filters.webName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"webName" = $${paramIndex}`);
                    params.push(filters.webName);
                }
                else
                {
                    conditions.push(`"webName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.webName}%`);
                }

                paramIndex++;
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

            //NULLABLE COLUMNS THAT CAN BE EMPTIED.
            const nullableCols =
            [
                "callId",
                "intro",
                "transcript",
                "cleanTranscript",
                "duration",
                "recordingUrl",
                "hangupBy",
                "hangupReason",
                "hangupCause",
                "interest",
                "startedAt",
                "endedAt",
                "summary",
                "embedding"
            ];

            const colsToNull = nullableCols.filter((col) =>
                {
                    return data[col] === true;
                }
            );

            if(colsToNull.length > 0)
            {
                const setClauses = colsToNull.map((col) =>
                    {
                        return `"${col}" = NULL`;
                    }
                );

                const query = `UPDATE wira_call SET ${setClauses.join(", ")} ${whereClause} RETURNING ${this.callColumns}`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Call columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        calls: result.rows
                    }
                };
            }

            const query = `DELETE FROM wira_call ${whereClause} RETURNING ${this.callColumns}`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Calls deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    calls: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteCall at WiraCallDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting calls.",
                data: null
            };
        }
    }
}

module.exports = WiraCallDB;