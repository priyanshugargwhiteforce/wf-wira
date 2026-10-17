const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_whatsapp
================================================================================

Candidate's WhatsApp conversation session. Mirrors wira_app but tracks
WhatsApp API delivery cost separately via overallWhatsappCost. One session per
candidate per webName.

NOTE ON TYPO: The actual FK column is "wiraCandidateId" (with 'a') — verified
against the live database. Callers may pass either "wiraCandidateId" (correct)
or "wireCandidateId" (typo matching wira_files). All filter and data methods
accept either spelling and always map to the real column name.

trg_wira_whatsapp_sync_has_whatsapp (AFTER INSERT / DELETE) keeps
wira_candidate.hasWhatsapp in sync automatically — no need to set it from code.

createWhatsapp is an upsert on (wiraCandidateId, webName) — if the session
already exists it is returned with a refreshed updatedAt instead of failing on
the unique constraint. Every column is NOT NULL — there are no nullable columns
to clear, so deleteWhatsapp only deletes rows.

+---------------------+-------------+-----------------------------------------+
| Column              | Type        | Constraints                             |
+---------------------+-------------+-----------------------------------------+
| id                  | BIGSERIAL   | Primary Key                             |
| wiraCandidateId     | BIGINT      | NOT NULL, FK → wira_candidate           |
| webName             | VARCHAR(255)| NOT NULL, DEFAULT White Force           |
| overallGeminiCost   | NUMERIC     | NOT NULL, DEFAULT 0                     |
| overallWhatsappCost | NUMERIC     | NOT NULL, DEFAULT 0                     |
| createdAt           | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                 |
| updatedAt           | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                 |
+---------------------+-------------+-----------------------------------------+

UNIQUE: (wiraCandidateId, webName)
Notification channel: wira_whatsapp_changes

--- SQL ---

CREATE TABLE wira_whatsapp
(
    "id"                    BIGSERIAL     PRIMARY KEY,
    "wiraCandidateId"       BIGINT        NOT NULL REFERENCES wira_candidate("id") ON DELETE CASCADE,
    "webName"               VARCHAR(255)  NOT NULL DEFAULT 'White Force',
    "overallGeminiCost"     NUMERIC(12,6) NOT NULL DEFAULT 0,
    "overallWhatsappCost"   NUMERIC(12,6) NOT NULL DEFAULT 0,
    "createdAt"             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updatedAt"             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT "uq_wiraWhatsapp_candidateId_webName" UNIQUE ("wiraCandidateId", "webName")
);

CREATE INDEX "idx_wiraWhatsapp_wiraCandidateId"     ON wira_whatsapp("wiraCandidateId");
CREATE INDEX "idx_wiraWhatsapp_webName"             ON wira_whatsapp("webName");
CREATE INDEX "idx_wiraWhatsapp_overallGeminiCost"   ON wira_whatsapp("overallGeminiCost");
CREATE INDEX "idx_wiraWhatsapp_overallWhatsappCost" ON wira_whatsapp("overallWhatsappCost");
CREATE INDEX "idx_wiraWhatsapp_createdAt"           ON wira_whatsapp("createdAt" DESC);
CREATE INDEX "idx_wiraWhatsapp_updatedAt"           ON wira_whatsapp("updatedAt" DESC);

CREATE OR REPLACE FUNCTION notify_wira_whatsapp_changes()
RETURNS TRIGGER AS $$
DECLARE
    payload JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_to_json(OLD));
    ELSE
        payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_to_json(NEW));
    END IF;
    PERFORM pg_notify('wira_whatsapp_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_whatsapp_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_whatsapp
FOR EACH ROW EXECUTE FUNCTION notify_wira_whatsapp_changes();

CREATE OR REPLACE TRIGGER trg_wira_whatsapp_updated_at
BEFORE UPDATE ON wira_whatsapp
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraWhatsappDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES A WHATSWHATSAPP SESSION BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchWhatsappById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_whatsapp WHERE "id" = $1`;
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
                    message: "WhatsApp session not found.",
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
                message: "WhatsApp session fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchWhatsappById at WiraWhatsappDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching WhatsApp session.",
                data: null
            };
        }
    }

    //FETCHES A WHATSWHATSAPP SESSION BY ITS UNIQUE (wiraCandidateId, webName) PAIR. RETURNS 404 IF NOT FOUND. webName DEFAULTS TO White Force.
    async fetchWhatsappByCandidate(wiraCandidateId, webName = "White Force")
    {
        try
        {
            const query = `SELECT * FROM wira_whatsapp WHERE "wiraCandidateId" = $1 AND "webName" = $2 LIMIT 1`;
            const params =
            [
                wiraCandidateId,
                webName
            ];

            const result = await this.db.query(query, params);
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: true,
                    message: "WhatsApp session not found.",
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
                message: "WhatsApp session fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchWhatsappByCandidate at WiraWhatsappDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching WhatsApp session.",
                data: null
            };
        }
    }

    //FETCHES WHATSWHATSAPP SESSIONS USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS.
    async fetchWhatsapp(filters = {}, pagination = {}, strict = true)
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

            //ACCEPT BOTH SPELLINGS — wiraCandidateId (CORRECT) AND wireCandidateId (TYPO).
            const candidateIdFilter = filters.wiraCandidateId ?? filters.wireCandidateId;
            if(candidateIdFilter !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
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

            if(filters.overallGeminiCostMin !== undefined)
            {
                conditions.push(`"overallGeminiCost" >= $${paramIndex}`);
                params.push(filters.overallGeminiCostMin);
                paramIndex++;
            }

            if(filters.overallGeminiCostMax !== undefined)
            {
                conditions.push(`"overallGeminiCost" <= $${paramIndex}`);
                params.push(filters.overallGeminiCostMax);
                paramIndex++;
            }

            if(filters.overallWhatsappCostMin !== undefined)
            {
                conditions.push(`"overallWhatsappCost" >= $${paramIndex}`);
                params.push(filters.overallWhatsappCostMin);
                paramIndex++;
            }

            if(filters.overallWhatsappCostMax !== undefined)
            {
                conditions.push(`"overallWhatsappCost" <= $${paramIndex}`);
                params.push(filters.overallWhatsappCostMax);
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
            const countQuery = `SELECT COUNT(*) FROM wira_whatsapp ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_whatsapp ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_whatsapp ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "WhatsWhatsApp sessions fetched successfully.",
                data:
                {
                    whatsapps: result.rows,
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
            console.error("Error occured in fetchWhatsapp at WiraWhatsappDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching WhatsApp sessions.",
                data: null
            };
        }
    }

    //CREATES A WHATSWHATSAPP SESSION. wiraCandidateId IS REQUIRED (EITHER SPELLING). webName DEFAULTS TO White Force. UPSERTS ON (wiraCandidateId, webName) — IF THE SESSION ALREADY EXISTS, IT IS RETURNED WITH A REFRESHED updatedAt.
    async createWhatsapp(data = {})
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

            const query = `
                INSERT INTO wira_whatsapp
                (
                    "wiraCandidateId",
                    "webName",
                    "overallGeminiCost",
                    "overallWhatsappCost"
                )
                VALUES ($1, $2, $3, $4)
                ON CONFLICT ("wiraCandidateId", "webName") DO UPDATE SET
                    "updatedAt" = NOW()
                RETURNING *
            `;

            const params =
            [
                candidateId,
                data.webName ?? "White Force",
                data.overallGeminiCost ?? 0,
                data.overallWhatsappCost ?? 0
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "WhatsApp session created successfully.",
                data:
                {
                    whatsapp: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createWhatsapp at WiraWhatsappDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating WhatsApp session.",
                data: null
            };
        }
    }

    //UPDATES WHATSWHATSAPP SESSIONS MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS IN FILTERS.
    async updateWhatsapp(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.webName !== undefined)
            {
                setClauses.push(`"webName" = $${paramIndex}`);
                params.push(data.webName);
                paramIndex++;
            }

            if(data.overallGeminiCost !== undefined)
            {
                setClauses.push(`"overallGeminiCost" = $${paramIndex}`);
                params.push(data.overallGeminiCost);
                paramIndex++;
            }

            if(data.overallWhatsappCost !== undefined)
            {
                setClauses.push(`"overallWhatsappCost" = $${paramIndex}`);
                params.push(data.overallWhatsappCost);
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

            //ACCEPT BOTH SPELLINGS IN filters.
            const candidateIdFilter = filters.wiraCandidateId ?? filters.wireCandidateId;
            if(candidateIdFilter !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
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

            if(filters.overallGeminiCostMin !== undefined)
            {
                conditions.push(`"overallGeminiCost" >= $${paramIndex}`);
                params.push(filters.overallGeminiCostMin);
                paramIndex++;
            }

            if(filters.overallGeminiCostMax !== undefined)
            {
                conditions.push(`"overallGeminiCost" <= $${paramIndex}`);
                params.push(filters.overallGeminiCostMax);
                paramIndex++;
            }

            if(filters.overallWhatsappCostMin !== undefined)
            {
                conditions.push(`"overallWhatsappCost" >= $${paramIndex}`);
                params.push(filters.overallWhatsappCostMin);
                paramIndex++;
            }

            if(filters.overallWhatsappCostMax !== undefined)
            {
                conditions.push(`"overallWhatsappCost" <= $${paramIndex}`);
                params.push(filters.overallWhatsappCostMax);
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
            const query = `UPDATE wira_whatsapp SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "WhatsWhatsApp sessions updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    whatsapps: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateWhatsapp at WiraWhatsappDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating WhatsApp sessions.",
                data: null
            };
        }
    }

    //DELETES WHATSWHATSAPP SESSIONS MATCHING THE GIVEN FILTERS. NO NULLABLE COLUMNS EXIST IN THIS TABLE, SO ROWS ARE ALWAYS DELETED. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS.
    async deleteWhatsapp(filters = {}, strict = true)
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

            //ACCEPT BOTH SPELLINGS IN filters.
            const candidateIdFilter = filters.wiraCandidateId ?? filters.wireCandidateId;
            if(candidateIdFilter !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
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

            if(filters.overallGeminiCostMin !== undefined)
            {
                conditions.push(`"overallGeminiCost" >= $${paramIndex}`);
                params.push(filters.overallGeminiCostMin);
                paramIndex++;
            }

            if(filters.overallGeminiCostMax !== undefined)
            {
                conditions.push(`"overallGeminiCost" <= $${paramIndex}`);
                params.push(filters.overallGeminiCostMax);
                paramIndex++;
            }

            if(filters.overallWhatsappCostMin !== undefined)
            {
                conditions.push(`"overallWhatsappCost" >= $${paramIndex}`);
                params.push(filters.overallWhatsappCostMin);
                paramIndex++;
            }

            if(filters.overallWhatsappCostMax !== undefined)
            {
                conditions.push(`"overallWhatsappCost" <= $${paramIndex}`);
                params.push(filters.overallWhatsappCostMax);
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
            const query = `DELETE FROM wira_whatsapp ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "WhatsWhatsApp sessions deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    whatsapps: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteWhatsapp at WiraWhatsappDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting WhatsApp sessions.",
                data: null
            };
        }
    }

    //FETCHES WHATSWHATSAPP SESSIONS FOR A CANDIDATE. FIRST RESOLVES THE CANDIDATE FROM candidateFilters, THEN FETCHES THEIR WHATSWHATSAPP SESSIONS MATCHING filters. RETURNS BOTH A STRUCTURED CANDIDATE OBJECT WITH WHATSAPPS AND A FLAT WHATSAPPS ARRAY.
    async fetchWhatsappsFromCandidate(candidateFilters = {}, filters = {}, pagination = {}, strict = true)
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

            //STEP 2 — FETCH WHATSWHATSAPP SESSIONS FOR THIS CANDIDATE WITH FILTERS
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            const conditions = [`"wiraCandidateId" = $1`];
            const params = [candidate.id];
            let paramIndex = 2;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
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

            if(filters.overallGeminiCostMin !== undefined)
            {
                conditions.push(`"overallGeminiCost" >= $${paramIndex}`);
                params.push(filters.overallGeminiCostMin);
                paramIndex++;
            }

            if(filters.overallGeminiCostMax !== undefined)
            {
                conditions.push(`"overallGeminiCost" <= $${paramIndex}`);
                params.push(filters.overallGeminiCostMax);
                paramIndex++;
            }

            if(filters.overallWhatsappCostMin !== undefined)
            {
                conditions.push(`"overallWhatsappCost" >= $${paramIndex}`);
                params.push(filters.overallWhatsappCostMin);
                paramIndex++;
            }

            if(filters.overallWhatsappCostMax !== undefined)
            {
                conditions.push(`"overallWhatsappCost" <= $${paramIndex}`);
                params.push(filters.overallWhatsappCostMax);
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
            const countQuery = `SELECT COUNT(*) FROM wira_whatsapp ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_whatsapp ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_whatsapp ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const whatsappsResult = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Candidate WhatsApp sessions fetched successfully.",
                data:
                {
                    candidate:
                    {
                        ...candidate,
                        whatsapps: whatsappsResult.rows
                    },
                    whatsapps: whatsappsResult.rows,
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
            console.error("Error occured in fetchWhatsappsFromCandidate at WiraWhatsappDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidate WhatsApp sessions.",
                data: null
            };
        }
    }
}

module.exports = WiraWhatsappDB;