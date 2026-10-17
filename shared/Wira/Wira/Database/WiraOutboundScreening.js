const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_outbound_screening
================================================================================

Child of wira_call. Holds data specific to outbound screening calls only.
Contains the job being screened for, questions asked, answers given, and the
AI-generated score with mandatory reasoning. All universal call data (transcript,
costs, duration, hangup) lives in wira_call.

scoreReason is mandatory reasoning — forces the AI to justify its decision and
prevents arbitrary or hallucinated scores.

+--------------------+-------------+-----------------------------------------+
| Column             | Type        | Constraints                             |
+--------------------+-------------+-----------------------------------------+
| id                 | BIGSERIAL   | Primary Key                             |
| wiraCallId         | BIGINT      | NOT NULL, FK → wira_call                |
| jobId              | BIGINT      | nullable                                |
| jobTitle           | VARCHAR(255)| nullable                                |
| jobDescription     | TEXT        | nullable                                |
| companyName        | VARCHAR(255)| nullable                                |
| screeningQuestions | JSONB       | nullable                                |
| screeningQA        | JSONB       | nullable                                |
| score              | SMALLINT    | NOT NULL, DEFAULT 0                     |
| scoreReason        | TEXT        | nullable                                |
| jobInterest        | VARCHAR(20) | nullable, CHECK IN (LOW, MEDIUM, HIGH,  |
|                    |             | UNKNOWN)                                |
| createdAt          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                 |
| updatedAt          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                 |
+--------------------+-------------+-----------------------------------------+

CHECK: jobId IS NOT NULL OR jobDescription IS NOT NULL
Notification channel: wira_outbound_screening_changes (screeningQuestions,
screeningQA and jobDescription excluded from payload)

--- SQL ---

CREATE TABLE wira_outbound_screening
(
    "id"                    BIGSERIAL    PRIMARY KEY,
    "wiraCallId"            BIGINT       NOT NULL REFERENCES wira_call("id") ON DELETE CASCADE,
    "jobId"                 BIGINT,
    "jobTitle"              VARCHAR(255),
    "jobDescription"        TEXT,
    "companyName"           VARCHAR(255),
    "screeningQuestions"    JSONB,
    "screeningQA"           JSONB,
    "score"                 SMALLINT     NOT NULL DEFAULT 0,
    "scoreReason"           TEXT,
    "jobInterest"           VARCHAR(20)  CHECK ("jobInterest" IS NULL OR "jobInterest" IN ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN')),
    "createdAt"             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "chk_wiraOutboundScreening_jobReference"
        CHECK ("jobId" IS NOT NULL OR "jobDescription" IS NOT NULL)
);

CREATE INDEX "idx_wiraOutboundScreening_wiraCallId"   ON wira_outbound_screening("wiraCallId");
CREATE INDEX "idx_wiraOutboundScreening_jobId"        ON wira_outbound_screening("jobId")       WHERE "jobId"      IS NOT NULL;
CREATE INDEX "idx_wiraOutboundScreening_companyName"  ON wira_outbound_screening("companyName") WHERE "companyName" IS NOT NULL;
CREATE INDEX "idx_wiraOutboundScreening_score"        ON wira_outbound_screening("score");
CREATE INDEX "idx_wiraOutboundScreening_jobId_score"  ON wira_outbound_screening("jobId", "score") WHERE "jobId" IS NOT NULL;
CREATE INDEX "idx_wiraOutboundScreening_jobInterest"  ON wira_outbound_screening("jobInterest") WHERE "jobInterest" IS NOT NULL;
CREATE INDEX "idx_wiraOutboundScreening_createdAt"    ON wira_outbound_screening("createdAt" DESC);
CREATE INDEX "idx_wiraOutboundScreening_updatedAt"    ON wira_outbound_screening("updatedAt" DESC);

CREATE OR REPLACE FUNCTION notify_wira_outbound_screening_changes()
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

    row_data := row_data
        - 'screeningQuestions'
        - 'screeningQA'
        - 'jobDescription';

    payload := jsonb_build_object(
        'operation', TG_OP,
        'table',     TG_TABLE_NAME,
        'data',      row_data
    );

    PERFORM pg_notify('wira_outbound_screening_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_outbound_screening_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_outbound_screening
FOR EACH ROW EXECUTE FUNCTION notify_wira_outbound_screening_changes();

CREATE OR REPLACE TRIGGER trg_wira_outbound_screening_updated_at
BEFORE UPDATE ON wira_outbound_screening
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraOutboundScreeningDB
{
    constructor()
    {
        this.db = pgDB;
        this.callColumns = `"id", "wiraCandidateId", "callId", "fromPhone", "bound", "type", "status", "webName", "intro", "language", "transcript", "cleanTranscript", "duration", "recordingUrl", "hangupBy", "hangupReason", "hangupCause", "interest", "startedAt", "endedAt", "preCost", "sarvamTotalCost", "plivoTotalCost", "geminiTotalCost", "geminiPostCost", "totalCost", "summary", "createdAt", "updatedAt"`;
    }

    //FETCHES AN OUTBOUND SCREENING BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchScreeningById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_outbound_screening WHERE "id" = $1`;
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
                    message: "Outbound screening not found.",
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
                message: "Outbound screening fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchScreeningById at WiraOutboundScreeningDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching outbound screening.",
                data: null
            };
        }
    }

    //FETCHES AN OUTBOUND SCREENING BY ITS PARENT wiraCallId. RETURNS 404 IF NOT FOUND.
    async fetchScreeningByCallId(wiraCallId)
    {
        try
        {
            const query = `SELECT * FROM wira_outbound_screening WHERE "wiraCallId" = $1 LIMIT 1`;
            const params =
            [
                wiraCallId
            ];

            const result = await this.db.query(query, params);
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: true,
                    message: "Outbound screening not found.",
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
                message: "Outbound screening fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchScreeningByCallId at WiraOutboundScreeningDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching outbound screening.",
                data: null
            };
        }
    }

    //FETCHES OUTBOUND SCREENINGS USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION.
    async fetchScreening(filters = {}, pagination = {}, strict = true)
    {
        try
        {
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            const conditions = [];
            const params = [];
            let paramIndex = 1;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.wiraCallId !== undefined)
            {
                conditions.push(`"wiraCallId" = $${paramIndex}`);
                params.push(filters.wiraCallId);
                paramIndex++;
            }

            if(filters.jobId !== undefined)
            {
                conditions.push(`"jobId" = $${paramIndex}`);
                params.push(filters.jobId);
                paramIndex++;
            }

            if(filters.jobTitle !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"jobTitle" = $${paramIndex}`);
                    params.push(filters.jobTitle);
                }
                else
                {
                    conditions.push(`"jobTitle" ILIKE $${paramIndex}`);
                    params.push(`%${filters.jobTitle}%`);
                }

                paramIndex++;
            }

            if(filters.jobDescription !== undefined)
            {
                if(typeof filters.jobDescription === "boolean")
                {
                    if(filters.jobDescription)
                    {
                        conditions.push(`"jobDescription" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"jobDescription" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"jobDescription" = $${paramIndex}`);
                        params.push(filters.jobDescription);
                    }
                    else
                    {
                        conditions.push(`"jobDescription" ILIKE $${paramIndex}`);
                        params.push(`%${filters.jobDescription}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.companyName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"companyName" = $${paramIndex}`);
                    params.push(filters.companyName);
                }
                else
                {
                    conditions.push(`"companyName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.companyName}%`);
                }

                paramIndex++;
            }

            if(filters.screeningQuestions !== undefined)
            {
                if(filters.screeningQuestions)
                {
                    conditions.push(`"screeningQuestions" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"screeningQuestions" IS NULL`);
                }
            }

            if(filters.screeningQA !== undefined)
            {
                if(filters.screeningQA)
                {
                    conditions.push(`"screeningQA" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"screeningQA" IS NULL`);
                }
            }

            if(filters.scoreMin !== undefined)
            {
                conditions.push(`"score" >= $${paramIndex}`);
                params.push(filters.scoreMin);
                paramIndex++;
            }

            if(filters.scoreMax !== undefined)
            {
                conditions.push(`"score" <= $${paramIndex}`);
                params.push(filters.scoreMax);
                paramIndex++;
            }

            if(filters.scoreReason !== undefined)
            {
                if(typeof filters.scoreReason === "boolean")
                {
                    if(filters.scoreReason)
                    {
                        conditions.push(`"scoreReason" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"scoreReason" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"scoreReason" = $${paramIndex}`);
                        params.push(filters.scoreReason);
                    }
                    else
                    {
                        conditions.push(`"scoreReason" ILIKE $${paramIndex}`);
                        params.push(`%${filters.scoreReason}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.jobInterest !== undefined)
            {
                conditions.push(`"jobInterest" = $${paramIndex}`);
                params.push(filters.jobInterest);
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
            const countQuery = `SELECT COUNT(*) FROM wira_outbound_screening ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_outbound_screening ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_outbound_screening ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Outbound screenings fetched successfully.",
                data:
                {
                    screenings: result.rows,
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
            console.error("Error occured in fetchScreening at WiraOutboundScreeningDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching outbound screenings.",
                data: null
            };
        }
    }

    //CREATES A NEW OUTBOUND SCREENING. wiraCallId IS REQUIRED. AT LEAST ONE OF jobId OR jobDescription IS REQUIRED (TABLE CHECK CONSTRAINT). ALL OTHER FIELDS ARE OPTIONAL.
    async createScreening(data = {})
    {
        try
        {
            if(!data.wiraCallId)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "wiraCallId is required.",
                    data: null
                };
            }

            if((data.jobId === undefined || data.jobId === null) && !data.jobDescription)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "jobId or jobDescription is required.",
                    data: null
                };
            }

            const query = `
                INSERT INTO wira_outbound_screening
                (
                    "wiraCallId",
                    "jobId",
                    "jobTitle",
                    "jobDescription",
                    "companyName",
                    "screeningQuestions",
                    "screeningQA",
                    "score",
                    "scoreReason",
                    "jobInterest"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            `;

            const params =
            [
                data.wiraCallId,
                data.jobId ?? null,
                data.jobTitle ?? null,
                data.jobDescription ?? null,
                data.companyName ?? null,
                data.screeningQuestions ? JSON.stringify(data.screeningQuestions) : null,
                data.screeningQA ? JSON.stringify(data.screeningQA) : null,
                data.score ?? 0,
                data.scoreReason ?? null,
                data.jobInterest ?? null
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Outbound screening created successfully.",
                data:
                {
                    screening: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createScreening at WiraOutboundScreeningDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating outbound screening.",
                data: null
            };
        }
    }

    //UPDATES OUTBOUND SCREENINGS MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async updateScreening(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.jobId !== undefined)
            {
                setClauses.push(`"jobId" = $${paramIndex}`);
                params.push(data.jobId);
                paramIndex++;
            }

            if(data.jobTitle !== undefined)
            {
                setClauses.push(`"jobTitle" = $${paramIndex}`);
                params.push(data.jobTitle);
                paramIndex++;
            }

            if(data.jobDescription !== undefined)
            {
                setClauses.push(`"jobDescription" = $${paramIndex}`);
                params.push(data.jobDescription);
                paramIndex++;
            }

            if(data.companyName !== undefined)
            {
                setClauses.push(`"companyName" = $${paramIndex}`);
                params.push(data.companyName);
                paramIndex++;
            }

            if(data.screeningQuestions !== undefined)
            {
                setClauses.push(`"screeningQuestions" = $${paramIndex}`);
                params.push(data.screeningQuestions ? JSON.stringify(data.screeningQuestions) : null);
                paramIndex++;
            }

            if(data.screeningQA !== undefined)
            {
                setClauses.push(`"screeningQA" = $${paramIndex}`);
                params.push(data.screeningQA ? JSON.stringify(data.screeningQA) : null);
                paramIndex++;
            }

            if(data.score !== undefined)
            {
                setClauses.push(`"score" = $${paramIndex}`);
                params.push(data.score);
                paramIndex++;
            }

            if(data.scoreReason !== undefined)
            {
                setClauses.push(`"scoreReason" = $${paramIndex}`);
                params.push(data.scoreReason);
                paramIndex++;
            }

            if(data.jobInterest !== undefined)
            {
                setClauses.push(`"jobInterest" = $${paramIndex}`);
                params.push(data.jobInterest);
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

            if(filters.wiraCallId !== undefined)
            {
                conditions.push(`"wiraCallId" = $${paramIndex}`);
                params.push(filters.wiraCallId);
                paramIndex++;
            }

            if(filters.jobId !== undefined)
            {
                conditions.push(`"jobId" = $${paramIndex}`);
                params.push(filters.jobId);
                paramIndex++;
            }

            if(filters.jobTitle !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"jobTitle" = $${paramIndex}`);
                    params.push(filters.jobTitle);
                }
                else
                {
                    conditions.push(`"jobTitle" ILIKE $${paramIndex}`);
                    params.push(`%${filters.jobTitle}%`);
                }

                paramIndex++;
            }

            if(filters.jobDescription !== undefined)
            {
                if(typeof filters.jobDescription === "boolean")
                {
                    if(filters.jobDescription)
                    {
                        conditions.push(`"jobDescription" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"jobDescription" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"jobDescription" = $${paramIndex}`);
                        params.push(filters.jobDescription);
                    }
                    else
                    {
                        conditions.push(`"jobDescription" ILIKE $${paramIndex}`);
                        params.push(`%${filters.jobDescription}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.companyName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"companyName" = $${paramIndex}`);
                    params.push(filters.companyName);
                }
                else
                {
                    conditions.push(`"companyName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.companyName}%`);
                }

                paramIndex++;
            }

            if(filters.screeningQuestions !== undefined)
            {
                if(filters.screeningQuestions)
                {
                    conditions.push(`"screeningQuestions" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"screeningQuestions" IS NULL`);
                }
            }

            if(filters.screeningQA !== undefined)
            {
                if(filters.screeningQA)
                {
                    conditions.push(`"screeningQA" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"screeningQA" IS NULL`);
                }
            }

            if(filters.scoreMin !== undefined)
            {
                conditions.push(`"score" >= $${paramIndex}`);
                params.push(filters.scoreMin);
                paramIndex++;
            }

            if(filters.scoreMax !== undefined)
            {
                conditions.push(`"score" <= $${paramIndex}`);
                params.push(filters.scoreMax);
                paramIndex++;
            }

            if(filters.scoreReason !== undefined)
            {
                if(typeof filters.scoreReason === "boolean")
                {
                    if(filters.scoreReason)
                    {
                        conditions.push(`"scoreReason" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"scoreReason" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"scoreReason" = $${paramIndex}`);
                        params.push(filters.scoreReason);
                    }
                    else
                    {
                        conditions.push(`"scoreReason" ILIKE $${paramIndex}`);
                        params.push(`%${filters.scoreReason}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.jobInterest !== undefined)
            {
                conditions.push(`"jobInterest" = $${paramIndex}`);
                params.push(filters.jobInterest);
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
            const query = `UPDATE wira_outbound_screening SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Outbound screenings updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    screenings: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateScreening at WiraOutboundScreeningDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating outbound screenings.",
                data: null
            };
        }
    }

    //DELETES OUTBOUND SCREENINGS MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. NULLIFYING BOTH jobId AND jobDescription ON THE SAME ROW IS REJECTED BY THE TABLE CHECK CONSTRAINT.
    async deleteScreening(data = {}, filters = {}, strict = true)
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

            if(filters.wiraCallId !== undefined)
            {
                conditions.push(`"wiraCallId" = $${paramIndex}`);
                params.push(filters.wiraCallId);
                paramIndex++;
            }

            if(filters.jobId !== undefined)
            {
                conditions.push(`"jobId" = $${paramIndex}`);
                params.push(filters.jobId);
                paramIndex++;
            }

            if(filters.jobTitle !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"jobTitle" = $${paramIndex}`);
                    params.push(filters.jobTitle);
                }
                else
                {
                    conditions.push(`"jobTitle" ILIKE $${paramIndex}`);
                    params.push(`%${filters.jobTitle}%`);
                }

                paramIndex++;
            }

            if(filters.jobDescription !== undefined)
            {
                if(typeof filters.jobDescription === "boolean")
                {
                    if(filters.jobDescription)
                    {
                        conditions.push(`"jobDescription" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"jobDescription" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"jobDescription" = $${paramIndex}`);
                        params.push(filters.jobDescription);
                    }
                    else
                    {
                        conditions.push(`"jobDescription" ILIKE $${paramIndex}`);
                        params.push(`%${filters.jobDescription}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.companyName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"companyName" = $${paramIndex}`);
                    params.push(filters.companyName);
                }
                else
                {
                    conditions.push(`"companyName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.companyName}%`);
                }

                paramIndex++;
            }

            if(filters.screeningQuestions !== undefined)
            {
                if(filters.screeningQuestions)
                {
                    conditions.push(`"screeningQuestions" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"screeningQuestions" IS NULL`);
                }
            }

            if(filters.screeningQA !== undefined)
            {
                if(filters.screeningQA)
                {
                    conditions.push(`"screeningQA" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"screeningQA" IS NULL`);
                }
            }

            if(filters.scoreMin !== undefined)
            {
                conditions.push(`"score" >= $${paramIndex}`);
                params.push(filters.scoreMin);
                paramIndex++;
            }

            if(filters.scoreMax !== undefined)
            {
                conditions.push(`"score" <= $${paramIndex}`);
                params.push(filters.scoreMax);
                paramIndex++;
            }

            if(filters.scoreReason !== undefined)
            {
                if(typeof filters.scoreReason === "boolean")
                {
                    if(filters.scoreReason)
                    {
                        conditions.push(`"scoreReason" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"scoreReason" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"scoreReason" = $${paramIndex}`);
                        params.push(filters.scoreReason);
                    }
                    else
                    {
                        conditions.push(`"scoreReason" ILIKE $${paramIndex}`);
                        params.push(`%${filters.scoreReason}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.jobInterest !== undefined)
            {
                conditions.push(`"jobInterest" = $${paramIndex}`);
                params.push(filters.jobInterest);
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

            //NULLABLE COLUMNS THAT CAN BE EMPTIED
            const nullableCols =
            [
                "jobId",
                "jobTitle",
                "jobDescription",
                "companyName",
                "screeningQuestions",
                "screeningQA",
                "scoreReason",
                "jobInterest"
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

                const query = `UPDATE wira_outbound_screening SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Outbound screening columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        screenings: result.rows
                    }
                };
            }

            //NO DATA FIELDS — DELETE THE ROWS
            const query = `DELETE FROM wira_outbound_screening ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Outbound screenings deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    screenings: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteScreening at WiraOutboundScreeningDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting outbound screenings.",
                data: null
            };
        }
    }

    //FETCHES OUTBOUND SCREENINGS FOR A CANDIDATE. FIRST RESOLVES THE CANDIDATE FROM candidateFilters, THEN FETCHES THEIR CALLS, THEN FETCHES SCREENINGS MATCHING filters. RETURNS BOTH A STRUCTURED CANDIDATE OBJECT WITH CALLS AND SCREENINGS, AND A FLAT SCREENINGS ARRAY. EMBEDDING EXCLUDED FROM CALLS.
    async fetchScreeningsFromCandidate(candidateFilters = {}, filters = {}, pagination = {}, strict = true)
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

            //STEP 2 — FETCH ALL CALLS FOR THIS CANDIDATE
            const callsQuery = `SELECT ${this.callColumns} FROM wira_call WHERE "wiraCandidateId" = $1 ORDER BY "createdAt" DESC`;
            const callsResult = await this.db.query(callsQuery, [candidate.id]);

            if(callsResult.rows.length === 0)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "No calls found for candidate.",
                    data:
                    {
                        candidate:
                        {
                            ...candidate,
                            calls: []
                        },
                        screenings: [],
                        pagination:
                        {
                            total: 0
                        }
                    }
                };
            }

            const calls = callsResult.rows;

            //STEP 3 — EXTRACT ALL CALL IDS
            const allCallIds = calls.map((call) =>
                {
                    return call.id;
                }
            );

            //STEP 4 — BUILD SCREENING QUERY WITH FILTERS
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            const conditions = [`"wiraCallId" = ANY($1)`];
            const params = [allCallIds];
            let paramIndex = 2;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.wiraCallId !== undefined)
            {
                conditions.push(`"wiraCallId" = $${paramIndex}`);
                params.push(filters.wiraCallId);
                paramIndex++;
            }

            if(filters.jobId !== undefined)
            {
                conditions.push(`"jobId" = $${paramIndex}`);
                params.push(filters.jobId);
                paramIndex++;
            }

            if(filters.jobTitle !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"jobTitle" = $${paramIndex}`);
                    params.push(filters.jobTitle);
                }
                else
                {
                    conditions.push(`"jobTitle" ILIKE $${paramIndex}`);
                    params.push(`%${filters.jobTitle}%`);
                }

                paramIndex++;
            }

            if(filters.jobDescription !== undefined)
            {
                if(typeof filters.jobDescription === "boolean")
                {
                    if(filters.jobDescription)
                    {
                        conditions.push(`"jobDescription" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"jobDescription" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"jobDescription" = $${paramIndex}`);
                        params.push(filters.jobDescription);
                    }
                    else
                    {
                        conditions.push(`"jobDescription" ILIKE $${paramIndex}`);
                        params.push(`%${filters.jobDescription}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.companyName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"companyName" = $${paramIndex}`);
                    params.push(filters.companyName);
                }
                else
                {
                    conditions.push(`"companyName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.companyName}%`);
                }

                paramIndex++;
            }

            if(filters.screeningQuestions !== undefined)
            {
                if(filters.screeningQuestions)
                {
                    conditions.push(`"screeningQuestions" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"screeningQuestions" IS NULL`);
                }
            }

            if(filters.screeningQA !== undefined)
            {
                if(filters.screeningQA)
                {
                    conditions.push(`"screeningQA" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"screeningQA" IS NULL`);
                }
            }

            if(filters.scoreMin !== undefined)
            {
                conditions.push(`"score" >= $${paramIndex}`);
                params.push(filters.scoreMin);
                paramIndex++;
            }

            if(filters.scoreMax !== undefined)
            {
                conditions.push(`"score" <= $${paramIndex}`);
                params.push(filters.scoreMax);
                paramIndex++;
            }

            if(filters.scoreReason !== undefined)
            {
                if(typeof filters.scoreReason === "boolean")
                {
                    if(filters.scoreReason)
                    {
                        conditions.push(`"scoreReason" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"scoreReason" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"scoreReason" = $${paramIndex}`);
                        params.push(filters.scoreReason);
                    }
                    else
                    {
                        conditions.push(`"scoreReason" ILIKE $${paramIndex}`);
                        params.push(`%${filters.scoreReason}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.jobInterest !== undefined)
            {
                conditions.push(`"jobInterest" = $${paramIndex}`);
                params.push(filters.jobInterest);
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

            const whereClause = `WHERE ${conditions.join(" AND ")}`;
            const countQuery = `SELECT COUNT(*) FROM wira_outbound_screening ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_outbound_screening ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_outbound_screening ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const screeningsResult = await this.db.query(dataQuery, params);
            const screenings = screeningsResult.rows;

            //STEP 5 — BUILD CALL+SCREENING TREE, ONLY INCLUDE CALLS THAT HAVE MATCHING SCREENINGS
            const screeningMap = new Map();
            screenings.forEach((screening) =>
                {
                    if(!screeningMap.has(screening.wiraCallId))
                    {
                        screeningMap.set(screening.wiraCallId, []);
                    }

                    screeningMap.get(screening.wiraCallId).push(screening);
                }
            );

            const callsWithScreenings = calls.map((call) =>
                {
                    const callScreenings = screeningMap.get(call.id) ?? [];
                    if(callScreenings.length === 0)
                    {
                        return null;
                    }

                    return {
                        ...call,
                        screenings: callScreenings
                    };
                }
            )
            .filter(Boolean);

            return {
                statusCode: 200,
                success: true,
                message: "Candidate outbound screenings fetched successfully.",
                data:
                {
                    candidate:
                    {
                        ...candidate,
                        calls: callsWithScreenings
                    },
                    screenings: screenings,
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
            console.error("Error occured in fetchScreeningsFromCandidate at WiraOutboundScreeningDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidate outbound screenings.",
                data: null
            };
        }
    }
}

module.exports = WiraOutboundScreeningDB;