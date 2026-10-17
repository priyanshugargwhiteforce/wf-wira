const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_cache_costs
================================================================================

Tracks the lifetime cost of every Gemini prompt cache. A record is inserted
when a cache is created. A single UPDATE is made on deletion — writing the
final cost, total tokens, and deletedAt. This gives a permanent audit trail of
what each cache cost across its lifetime.

deletedAt is nullable — it starts as NULL on insert and is populated on the
UPDATE that marks the cache deleted. filters.deletedAt = false returns caches
that are still alive, true returns caches already deleted.

createdAt has NO database default — createCacheCost sends data.createdAt if
given, otherwise NOW(). No updatedAt column. cacheId is unique — creating a
duplicate cacheId fails.

+---------------+--------------+----------------------------------------------+
| Column        | Type         | Constraints                                  |
+---------------+--------------+----------------------------------------------+
| id            | BIGSERIAL    | Primary Key                                  |
| cacheId       | VARCHAR(255) | NOT NULL, UNIQUE                             |
| promptName    | VARCHAR(255) | NOT NULL                                     |
| modelName     | VARCHAR(255) | NOT NULL                                     |
| cachedTokens  | INTEGER      | NOT NULL                                     |
| cost          | NUMERIC      | NOT NULL, DEFAULT 0                          |
| createdAt     | TIMESTAMPTZ  | NOT NULL                                     |
| deletedAt     | TIMESTAMPTZ  | nullable — null until cache is deleted       |
+---------------+--------------+----------------------------------------------+

Notification channel: wira_cache_costs_changes

--- SQL ---

CREATE TABLE wira_cache_costs
(
    "id"            BIGSERIAL     PRIMARY KEY,
    "cacheId"       VARCHAR(255)  NOT NULL,
    "promptName"    VARCHAR(255)  NOT NULL,
    "modelName"     VARCHAR(255)  NOT NULL,
    "cachedTokens"  INTEGER       NOT NULL,
    "cost"          NUMERIC(12,6) NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMPTZ   NOT NULL,
    "deletedAt"     TIMESTAMPTZ
);

CREATE UNIQUE INDEX "uq_wiraCacheCosts_cacheId"   ON wira_cache_costs("cacheId");
CREATE INDEX "idx_wiraCacheCosts_promptName"      ON wira_cache_costs("promptName");
CREATE INDEX "idx_wiraCacheCosts_modelName"       ON wira_cache_costs("modelName");
CREATE INDEX "idx_wiraCacheCosts_promptName_cost" ON wira_cache_costs("promptName", "cost");
CREATE INDEX "idx_wiraCacheCosts_modelName_cost"  ON wira_cache_costs("modelName",  "cost");
CREATE INDEX "idx_wiraCacheCosts_createdAt"       ON wira_cache_costs("createdAt" DESC);
CREATE INDEX "idx_wiraCacheCosts_deletedAt"       ON wira_cache_costs("deletedAt" DESC) WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "idx_wiraCacheCosts_lifetime"        ON wira_cache_costs("createdAt", "deletedAt");

CREATE OR REPLACE FUNCTION notify_wira_cache_costs_changes()
RETURNS TRIGGER AS $$
DECLARE
    payload JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_to_json(OLD));
    ELSE
        payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_to_json(NEW));
    END IF;
    PERFORM pg_notify('wira_cache_costs_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_cache_costs_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_cache_costs
FOR EACH ROW EXECUTE FUNCTION notify_wira_cache_costs_changes();
*/

class WiraCacheCostsDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES A CACHE COST BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchCacheCostById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_cache_costs WHERE "id" = $1`;
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
                    message: "Cache cost not found.",
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
                message: "Cache cost fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchCacheCostById at WiraCacheCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching cache cost.",
                data: null
            };
        }
    }

    //FETCHES A CACHE COST BY ITS GEMINI cacheId. RETURNS 404 IF NOT FOUND.
    async fetchCacheCostByCacheId(cacheId)
    {
        try
        {
            const query = `SELECT * FROM wira_cache_costs WHERE "cacheId" = $1`;
            const params =
            [
                cacheId
            ];

            const result = await this.db.query(query, params);
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: true,
                    message: "Cache cost not found.",
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
                message: "Cache cost fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchCacheCostByCacheId at WiraCacheCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching cache cost.",
                data: null
            };
        }
    }

    //FETCHES CACHE COSTS USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. ORDERED BY createdAt DESC. SUPPORTS OPTIONAL PAGINATION.
    async fetchCacheCost(filters = {}, pagination = {}, strict = true)
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

            if(filters.cacheId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"cacheId" = $${paramIndex}`);
                    params.push(filters.cacheId);
                }
                else
                {
                    conditions.push(`"cacheId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.cacheId}%`);
                }

                paramIndex++;
            }

            if(filters.promptName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"promptName" = $${paramIndex}`);
                    params.push(filters.promptName);
                }
                else
                {
                    conditions.push(`"promptName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.promptName}%`);
                }

                paramIndex++;
            }

            if(filters.modelName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"modelName" = $${paramIndex}`);
                    params.push(filters.modelName);
                }
                else
                {
                    conditions.push(`"modelName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.modelName}%`);
                }

                paramIndex++;
            }

            if(filters.cachedTokensMin !== undefined)
            {
                conditions.push(`"cachedTokens" >= $${paramIndex}`);
                params.push(filters.cachedTokensMin);
                paramIndex++;
            }

            if(filters.cachedTokensMax !== undefined)
            {
                conditions.push(`"cachedTokens" <= $${paramIndex}`);
                params.push(filters.cachedTokensMax);
                paramIndex++;
            }

            if(filters.costMin !== undefined)
            {
                conditions.push(`"cost" >= $${paramIndex}`);
                params.push(filters.costMin);
                paramIndex++;
            }

            if(filters.costMax !== undefined)
            {
                conditions.push(`"cost" <= $${paramIndex}`);
                params.push(filters.costMax);
                paramIndex++;
            }

            if(filters.deletedAt !== undefined)
            {
                if(filters.deletedAt)
                {
                    conditions.push(`"deletedAt" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"deletedAt" IS NULL`);
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

            if(filters.deletedAtStart !== undefined)
            {
                conditions.push(`"deletedAt" >= $${paramIndex}`);
                params.push(filters.deletedAtStart);
                paramIndex++;
            }

            if(filters.deletedAtEnd !== undefined)
            {
                conditions.push(`"deletedAt" <= $${paramIndex}`);
                params.push(filters.deletedAtEnd);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const countQuery = `SELECT COUNT(*) FROM wira_cache_costs ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_cache_costs ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_cache_costs ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Cache costs fetched successfully.",
                data:
                {
                    cacheCosts: result.rows,
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
            console.error("Error occured in fetchCacheCost at WiraCacheCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching cache costs.",
                data: null
            };
        }
    }

    //CREATES A CACHE COST RECORD WHEN A CACHE IS CREATED. cacheId, promptName, modelName AND cachedTokens ARE REQUIRED. createdAt DEFAULTS TO NOW() BECAUSE THE TABLE HAS NO DEFAULT. deletedAt STARTS AS NULL UNLESS GIVEN.
    async createCacheCost(data = {})
    {
        try
        {
            if(!data.cacheId)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "cacheId is required.",
                    data: null
                };
            }

            if(!data.promptName)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "promptName is required.",
                    data: null
                };
            }

            if(!data.modelName)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "modelName is required.",
                    data: null
                };
            }

            if(data.cachedTokens === undefined || data.cachedTokens === null)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "cachedTokens is required.",
                    data: null
                };
            }

            const query = `
                INSERT INTO wira_cache_costs
                (
                    "cacheId",
                    "promptName",
                    "modelName",
                    "cachedTokens",
                    "cost",
                    "createdAt",
                    "deletedAt"
                )
                VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), $7)
                RETURNING *
            `;

            const params =
            [
                data.cacheId,
                data.promptName,
                data.modelName,
                data.cachedTokens,
                data.cost ?? 0,
                data.createdAt ?? null,
                data.deletedAt ?? null
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Cache cost created successfully.",
                data:
                {
                    cacheCost: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createCacheCost at WiraCacheCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating cache cost.",
                data: null
            };
        }
    }

    //UPDATES CACHE COSTS MATCHING THE GIVEN FILTERS. USED ON CACHE DELETION TO WRITE THE FINAL cost, cachedTokens AND deletedAt. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async updateCacheCost(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.cacheId !== undefined)
            {
                setClauses.push(`"cacheId" = $${paramIndex}`);
                params.push(data.cacheId);
                paramIndex++;
            }

            if(data.promptName !== undefined)
            {
                setClauses.push(`"promptName" = $${paramIndex}`);
                params.push(data.promptName);
                paramIndex++;
            }

            if(data.modelName !== undefined)
            {
                setClauses.push(`"modelName" = $${paramIndex}`);
                params.push(data.modelName);
                paramIndex++;
            }

            if(data.cachedTokens !== undefined)
            {
                setClauses.push(`"cachedTokens" = $${paramIndex}`);
                params.push(data.cachedTokens);
                paramIndex++;
            }

            if(data.cost !== undefined)
            {
                setClauses.push(`"cost" = $${paramIndex}`);
                params.push(data.cost);
                paramIndex++;
            }

            if(data.createdAt !== undefined)
            {
                setClauses.push(`"createdAt" = $${paramIndex}`);
                params.push(data.createdAt);
                paramIndex++;
            }

            if(data.deletedAt !== undefined)
            {
                setClauses.push(`"deletedAt" = $${paramIndex}`);
                params.push(data.deletedAt);
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

            if(filters.cacheId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"cacheId" = $${paramIndex}`);
                    params.push(filters.cacheId);
                }
                else
                {
                    conditions.push(`"cacheId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.cacheId}%`);
                }

                paramIndex++;
            }

            if(filters.promptName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"promptName" = $${paramIndex}`);
                    params.push(filters.promptName);
                }
                else
                {
                    conditions.push(`"promptName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.promptName}%`);
                }

                paramIndex++;
            }

            if(filters.modelName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"modelName" = $${paramIndex}`);
                    params.push(filters.modelName);
                }
                else
                {
                    conditions.push(`"modelName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.modelName}%`);
                }

                paramIndex++;
            }

            if(filters.cachedTokensMin !== undefined)
            {
                conditions.push(`"cachedTokens" >= $${paramIndex}`);
                params.push(filters.cachedTokensMin);
                paramIndex++;
            }

            if(filters.cachedTokensMax !== undefined)
            {
                conditions.push(`"cachedTokens" <= $${paramIndex}`);
                params.push(filters.cachedTokensMax);
                paramIndex++;
            }

            if(filters.costMin !== undefined)
            {
                conditions.push(`"cost" >= $${paramIndex}`);
                params.push(filters.costMin);
                paramIndex++;
            }

            if(filters.costMax !== undefined)
            {
                conditions.push(`"cost" <= $${paramIndex}`);
                params.push(filters.costMax);
                paramIndex++;
            }

            if(filters.deletedAt !== undefined)
            {
                if(filters.deletedAt)
                {
                    conditions.push(`"deletedAt" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"deletedAt" IS NULL`);
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

            if(filters.deletedAtStart !== undefined)
            {
                conditions.push(`"deletedAt" >= $${paramIndex}`);
                params.push(filters.deletedAtStart);
                paramIndex++;
            }

            if(filters.deletedAtEnd !== undefined)
            {
                conditions.push(`"deletedAt" <= $${paramIndex}`);
                params.push(filters.deletedAtEnd);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const query = `UPDATE wira_cache_costs SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Cache costs updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    cacheCosts: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateCacheCost at WiraCacheCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating cache costs.",
                data: null
            };
        }
    }

    //DELETES CACHE COSTS MATCHING THE GIVEN FILTERS. IF data.deletedAt IS SET TO TRUE, NULLIFIES deletedAt INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async deleteCacheCost(data = {}, filters = {}, strict = true)
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

            if(filters.cacheId !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"cacheId" = $${paramIndex}`);
                    params.push(filters.cacheId);
                }
                else
                {
                    conditions.push(`"cacheId" ILIKE $${paramIndex}`);
                    params.push(`%${filters.cacheId}%`);
                }

                paramIndex++;
            }

            if(filters.promptName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"promptName" = $${paramIndex}`);
                    params.push(filters.promptName);
                }
                else
                {
                    conditions.push(`"promptName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.promptName}%`);
                }

                paramIndex++;
            }

            if(filters.modelName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"modelName" = $${paramIndex}`);
                    params.push(filters.modelName);
                }
                else
                {
                    conditions.push(`"modelName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.modelName}%`);
                }

                paramIndex++;
            }

            if(filters.cachedTokensMin !== undefined)
            {
                conditions.push(`"cachedTokens" >= $${paramIndex}`);
                params.push(filters.cachedTokensMin);
                paramIndex++;
            }

            if(filters.cachedTokensMax !== undefined)
            {
                conditions.push(`"cachedTokens" <= $${paramIndex}`);
                params.push(filters.cachedTokensMax);
                paramIndex++;
            }

            if(filters.costMin !== undefined)
            {
                conditions.push(`"cost" >= $${paramIndex}`);
                params.push(filters.costMin);
                paramIndex++;
            }

            if(filters.costMax !== undefined)
            {
                conditions.push(`"cost" <= $${paramIndex}`);
                params.push(filters.costMax);
                paramIndex++;
            }

            if(filters.deletedAt !== undefined)
            {
                if(filters.deletedAt)
                {
                    conditions.push(`"deletedAt" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"deletedAt" IS NULL`);
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

            if(filters.deletedAtStart !== undefined)
            {
                conditions.push(`"deletedAt" >= $${paramIndex}`);
                params.push(filters.deletedAtStart);
                paramIndex++;
            }

            if(filters.deletedAtEnd !== undefined)
            {
                conditions.push(`"deletedAt" <= $${paramIndex}`);
                params.push(filters.deletedAtEnd);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

            //NULLABLE COLUMNS THAT CAN BE EMPTIED
            const nullableCols =
            [
                "deletedAt"
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

                const query = `UPDATE wira_cache_costs SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Cache cost columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        cacheCosts: result.rows
                    }
                };
            }

            //NO DATA FIELDS — DELETE THE ROWS
            const query = `DELETE FROM wira_cache_costs ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Cache costs deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    cacheCosts: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteCacheCost at WiraCacheCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting cache costs.",
                data: null
            };
        }
    }
}

module.exports = WiraCacheCostsDB;