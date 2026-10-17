const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_app
================================================================================

Represents a candidate's app or web chat session. One session per candidate per
webName. Tracks cumulative Gemini cost across all messages so dashboards can
show per-session spend without summing child records.

NOTE ON TYPO: The actual FK column is "wiraCandidateId" (with 'a') — verified
against the live database. Callers may pass either "wiraCandidateId" (correct)
or "wireCandidateId" (typo matching wira_files). All filter and data methods
accept either spelling and always map to the real column name.

trg_wira_app_sync_has_app (AFTER INSERT / DELETE) keeps wira_candidate.hasApp
in sync automatically — no need to set it from code.

createApp is an upsert on (wiraCandidateId, webName) — if the session already
exists it is returned with a refreshed updatedAt instead of failing on the
unique constraint. Every column is NOT NULL — there are no nullable columns to
clear, so deleteApp only deletes rows.

+------------------+-------------+--------------------------------------------+
| Column           | Type        | Constraints                                |
+------------------+-------------+--------------------------------------------+
| id               | BIGSERIAL   | Primary Key                                |
| wiraCandidateId  | BIGINT      | NOT NULL, FK → wira_candidate              |
| webName          | VARCHAR(255)| NOT NULL, DEFAULT White Force              |
| overallGeminiCost| NUMERIC     | NOT NULL, DEFAULT 0                        |
| createdAt        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                    |
| updatedAt        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                    |
+------------------+-------------+--------------------------------------------+

UNIQUE: (wiraCandidateId, webName)
Notification channel: wira_app_changes

--- SQL ---

CREATE TABLE wira_app
(
    "id"                BIGSERIAL     PRIMARY KEY,
    "wiraCandidateId"   BIGINT        NOT NULL REFERENCES wira_candidate("id") ON DELETE CASCADE,
    "webName"           VARCHAR(255)  NOT NULL DEFAULT 'White Force',
    "overallGeminiCost" NUMERIC(12,6) NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT "uq_wiraApp_candidateId_webName" UNIQUE ("wiraCandidateId", "webName")
);

CREATE INDEX "idx_wiraApp_wiraCandidateId"      ON wira_app("wiraCandidateId");
CREATE INDEX "idx_wiraApp_webName"              ON wira_app("webName");
CREATE INDEX "idx_wiraApp_overallGeminiCost"    ON wira_app("overallGeminiCost");
CREATE INDEX "idx_wiraApp_createdAt"            ON wira_app("createdAt" DESC);
CREATE INDEX "idx_wiraApp_updatedAt"            ON wira_app("updatedAt" DESC);

CREATE OR REPLACE FUNCTION notify_wira_app_changes()
RETURNS TRIGGER AS $$
DECLARE
    payload JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_to_json(OLD));
    ELSE
        payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_to_json(NEW));
    END IF;
    PERFORM pg_notify('wira_app_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_app_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_app
FOR EACH ROW EXECUTE FUNCTION notify_wira_app_changes();

CREATE OR REPLACE TRIGGER trg_wira_app_updated_at
BEFORE UPDATE ON wira_app
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraAppDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES AN APP SESSION BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchAppById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_app WHERE "id" = $1`;
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
                    message: "App session not found.",
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
                message: "App session fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchAppById at WiraAppDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching app session.",
                data: null
            };
        }
    }

    //FETCHES AN APP SESSION BY ITS UNIQUE (wiraCandidateId, webName) PAIR. RETURNS 404 IF NOT FOUND. webName DEFAULTS TO White Force.
    async fetchAppByCandidate(wiraCandidateId, webName = "White Force")
    {
        try
        {
            const query = `SELECT * FROM wira_app WHERE "wiraCandidateId" = $1 AND "webName" = $2 LIMIT 1`;
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
                    message: "App session not found.",
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
                message: "App session fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchAppByCandidate at WiraAppDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching app session.",
                data: null
            };
        }
    }

    //FETCHES APP SESSIONS USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS.
    async fetchApp(filters = {}, pagination = {}, strict = true)
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
            const countQuery = `SELECT COUNT(*) FROM wira_app ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_app ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_app ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "App sessions fetched successfully.",
                data:
                {
                    apps: result.rows,
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
            console.error("Error occured in fetchApp at WiraAppDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching app sessions.",
                data: null
            };
        }
    }

    //CREATES AN APP SESSION. wiraCandidateId IS REQUIRED (EITHER SPELLING). webName DEFAULTS TO White Force. UPSERTS ON (wiraCandidateId, webName) — IF THE SESSION ALREADY EXISTS, IT IS RETURNED WITH A REFRESHED updatedAt.
    async createApp(data = {})
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
                INSERT INTO wira_app
                (
                    "wiraCandidateId",
                    "webName",
                    "overallGeminiCost"
                )
                VALUES ($1, $2, $3)
                ON CONFLICT ("wiraCandidateId", "webName") DO UPDATE SET
                    "updatedAt" = NOW()
                RETURNING *
            `;

            const params =
            [
                candidateId,
                data.webName ?? "White Force",
                data.overallGeminiCost ?? 0
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "App session created successfully.",
                data:
                {
                    app: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createApp at WiraAppDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating app session.",
                data: null
            };
        }
    }

    //UPDATES APP SESSIONS MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS IN FILTERS.
    async updateApp(data = {}, filters = {}, strict = true)
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
            const query = `UPDATE wira_app SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "App sessions updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    apps: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateApp at WiraAppDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating app sessions.",
                data: null
            };
        }
    }

    //DELETES APP SESSIONS MATCHING THE GIVEN FILTERS. NO NULLABLE COLUMNS EXIST IN THIS TABLE, SO ROWS ARE ALWAYS DELETED. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. ACCEPTS BOTH wiraCandidateId AND wireCandidateId SPELLINGS.
    async deleteApp(filters = {}, strict = true)
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
            const query = `DELETE FROM wira_app ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "App sessions deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    apps: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteApp at WiraAppDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting app sessions.",
                data: null
            };
        }
    }

    //FETCHES APP SESSIONS FOR A CANDIDATE. FIRST RESOLVES THE CANDIDATE FROM candidateFilters, THEN FETCHES THEIR APP SESSIONS MATCHING filters. RETURNS BOTH A STRUCTURED CANDIDATE OBJECT WITH APPS AND A FLAT APPS ARRAY.
    async fetchAppsFromCandidate(candidateFilters = {}, filters = {}, pagination = {}, strict = true)
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

            //STEP 2 — FETCH APP SESSIONS FOR THIS CANDIDATE WITH FILTERS
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
            const countQuery = `SELECT COUNT(*) FROM wira_app ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_app ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_app ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const appsResult = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Candidate app sessions fetched successfully.",
                data:
                {
                    candidate:
                    {
                        ...candidate,
                        apps: appsResult.rows
                    },
                    apps: appsResult.rows,
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
            console.error("Error occured in fetchAppsFromCandidate at WiraAppDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidate app sessions.",
                data: null
            };
        }
    }
}

module.exports = WiraAppDB;