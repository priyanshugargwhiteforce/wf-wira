const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_call_costs
================================================================================

Per-bucket cost breakdown for outbound screening calls. Each bucket is a
60-second time window within the call. Allows precise cost attribution across
TTS (Sarvam), STT (Sarvam), Plivo telephony, and Gemini AI at bucket level
rather than just a call-level total. Cascades on delete from
wira_outbound_screening.

No notify trigger on this table intentionally — cost buckets are written
frequently mid-call and consumers should read aggregates from wira_call totals.

No updatedAt column. Every column is NOT NULL — there are no nullable columns
to clear, so deleteCallCost only deletes rows. createCallCost is an upsert on
(wiraOutboundScreeningId, bucketIndex) — re-writing an existing bucket replaces
its values instead of failing on the unique index.

+------------------------+-------------+--------------------------------------+
| Column                 | Type        | Constraints                          |
+------------------------+-------------+--------------------------------------+
| id                     | BIGSERIAL   | Primary Key                          |
| wiraOutboundScreeningId| BIGINT      | NOT NULL, FK → wira_outbound_screening|
|                        |             | ON DELETE CASCADE                    |
| bucketIndex            | SMALLINT    | NOT NULL                             |
| startTime              | TIMESTAMPTZ | NOT NULL                             |
| endTime                | TIMESTAMPTZ | NOT NULL                             |
| ttsChars               | INTEGER     | NOT NULL, DEFAULT 0                  |
| ttsCost                | NUMERIC     | NOT NULL, DEFAULT 0                  |
| sttSeconds             | NUMERIC     | NOT NULL, DEFAULT 0                  |
| sttCost                | NUMERIC     | NOT NULL, DEFAULT 0                  |
| plivoSeconds           | NUMERIC     | NOT NULL, DEFAULT 0                  |
| plivoCost              | NUMERIC     | NOT NULL, DEFAULT 0                  |
| geminiInputTokens      | INTEGER     | NOT NULL, DEFAULT 0                  |
| geminiCachedTokens     | INTEGER     | NOT NULL, DEFAULT 0                  |
| geminiOutputTokens     | INTEGER     | NOT NULL, DEFAULT 0                  |
| geminiCost             | NUMERIC     | NOT NULL, DEFAULT 0                  |
| bucketTotal            | NUMERIC     | NOT NULL, DEFAULT 0                  |
| createdAt              | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()              |
+------------------------+-------------+--------------------------------------+

UNIQUE: (wiraOutboundScreeningId, bucketIndex)

--- SQL ---

CREATE TABLE wira_call_costs
(
    "id"                        BIGSERIAL     PRIMARY KEY,
    "wiraOutboundScreeningId"   BIGINT        NOT NULL REFERENCES wira_outbound_screening("id") ON DELETE CASCADE,
    "bucketIndex"               SMALLINT      NOT NULL,
    "startTime"                 TIMESTAMPTZ   NOT NULL,
    "endTime"                   TIMESTAMPTZ   NOT NULL,
    "ttsChars"                  INTEGER       NOT NULL DEFAULT 0,
    "ttsCost"                   NUMERIC(12,6) NOT NULL DEFAULT 0,
    "sttSeconds"                NUMERIC(10,4) NOT NULL DEFAULT 0,
    "sttCost"                   NUMERIC(12,6) NOT NULL DEFAULT 0,
    "plivoSeconds"              NUMERIC(10,4) NOT NULL DEFAULT 0,
    "plivoCost"                 NUMERIC(12,6) NOT NULL DEFAULT 0,
    "geminiInputTokens"         INTEGER       NOT NULL DEFAULT 0,
    "geminiCachedTokens"        INTEGER       NOT NULL DEFAULT 0,
    "geminiOutputTokens"        INTEGER       NOT NULL DEFAULT 0,
    "geminiCost"                NUMERIC(12,6) NOT NULL DEFAULT 0,
    "bucketTotal"               NUMERIC(12,6) NOT NULL DEFAULT 0,
    "createdAt"                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_wiraCallCosts_screeningId"          ON wira_call_costs("wiraOutboundScreeningId");
CREATE UNIQUE INDEX "uq_wiraCallCosts_screening_bucket" ON wira_call_costs("wiraOutboundScreeningId", "bucketIndex");
CREATE INDEX "idx_wiraCallCosts_startTime"            ON wira_call_costs("startTime" DESC);
CREATE INDEX "idx_wiraCallCosts_endTime"              ON wira_call_costs("endTime"   DESC);
CREATE INDEX "idx_wiraCallCosts_bucketTotal"          ON wira_call_costs("bucketTotal");
CREATE INDEX "idx_wiraCallCosts_geminiCost"           ON wira_call_costs("geminiCost");
CREATE INDEX "idx_wiraCallCosts_plivoCost"            ON wira_call_costs("plivoCost");
CREATE INDEX "idx_wiraCallCosts_createdAt"            ON wira_call_costs("createdAt" DESC);
*/

class WiraCallCostsDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES A CALL COST BUCKET BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchCallCostById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_call_costs WHERE "id" = $1`;
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
                    message: "Call cost not found.",
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
                message: "Call cost fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchCallCostById at WiraCallCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching call cost.",
                data: null
            };
        }
    }

    //FETCHES CALL COST BUCKETS USING FILTERS. ORDERED BY bucketIndex ASC TO PRESERVE CALL TIMELINE ORDER. SUPPORTS OPTIONAL PAGINATION. bucketIndex FILTER REQUIRES wiraOutboundScreeningId.
    async fetchCallCost(filters = {}, pagination = {})
    {
        try
        {
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            if(filters.bucketIndex !== undefined && filters.wiraOutboundScreeningId === undefined)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "bucketIndex filter requires wiraOutboundScreeningId.",
                    data: null
                };
            }

            const conditions = [];
            const params = [];
            let paramIndex = 1;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.wiraOutboundScreeningId !== undefined)
            {
                conditions.push(`"wiraOutboundScreeningId" = $${paramIndex}`);
                params.push(filters.wiraOutboundScreeningId);
                paramIndex++;
            }

            if(filters.bucketIndex !== undefined)
            {
                conditions.push(`"bucketIndex" = $${paramIndex}`);
                params.push(filters.bucketIndex);
                paramIndex++;
            }

            if(filters.startTimeStart !== undefined)
            {
                conditions.push(`"startTime" >= $${paramIndex}`);
                params.push(filters.startTimeStart);
                paramIndex++;
            }

            if(filters.startTimeEnd !== undefined)
            {
                conditions.push(`"startTime" <= $${paramIndex}`);
                params.push(filters.startTimeEnd);
                paramIndex++;
            }

            if(filters.endTimeStart !== undefined)
            {
                conditions.push(`"endTime" >= $${paramIndex}`);
                params.push(filters.endTimeStart);
                paramIndex++;
            }

            if(filters.endTimeEnd !== undefined)
            {
                conditions.push(`"endTime" <= $${paramIndex}`);
                params.push(filters.endTimeEnd);
                paramIndex++;
            }

            if(filters.bucketTotalMin !== undefined)
            {
                conditions.push(`"bucketTotal" >= $${paramIndex}`);
                params.push(filters.bucketTotalMin);
                paramIndex++;
            }

            if(filters.bucketTotalMax !== undefined)
            {
                conditions.push(`"bucketTotal" <= $${paramIndex}`);
                params.push(filters.bucketTotalMax);
                paramIndex++;
            }

            if(filters.geminiCostMin !== undefined)
            {
                conditions.push(`"geminiCost" >= $${paramIndex}`);
                params.push(filters.geminiCostMin);
                paramIndex++;
            }

            if(filters.geminiCostMax !== undefined)
            {
                conditions.push(`"geminiCost" <= $${paramIndex}`);
                params.push(filters.geminiCostMax);
                paramIndex++;
            }

            if(filters.plivoCostMin !== undefined)
            {
                conditions.push(`"plivoCost" >= $${paramIndex}`);
                params.push(filters.plivoCostMin);
                paramIndex++;
            }

            if(filters.plivoCostMax !== undefined)
            {
                conditions.push(`"plivoCost" <= $${paramIndex}`);
                params.push(filters.plivoCostMax);
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

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const countQuery = `SELECT COUNT(*) FROM wira_call_costs ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_call_costs ${whereClause} ORDER BY "bucketIndex" ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_call_costs ${whereClause} ORDER BY "bucketIndex" ASC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Call costs fetched successfully.",
                data:
                {
                    callCosts: result.rows,
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
            console.error("Error occured in fetchCallCost at WiraCallCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching call costs.",
                data: null
            };
        }
    }

    //CREATES A CALL COST BUCKET. wiraOutboundScreeningId, bucketIndex, startTime, AND endTime ARE REQUIRED. UPSERTS ON (wiraOutboundScreeningId, bucketIndex) — IF THE BUCKET ALREADY EXISTS, ITS VALUES ARE REPLACED.
    async createCallCost(data = {})
    {
        try
        {
            if(!data.wiraOutboundScreeningId)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "wiraOutboundScreeningId is required.",
                    data: null
                };
            }

            if(data.bucketIndex === undefined || data.bucketIndex === null)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "bucketIndex is required.",
                    data: null
                };
            }

            if(!data.startTime)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "startTime is required.",
                    data: null
                };
            }

            if(!data.endTime)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "endTime is required.",
                    data: null
                };
            }

            const query = `
                INSERT INTO wira_call_costs
                (
                    "wiraOutboundScreeningId",
                    "bucketIndex",
                    "startTime",
                    "endTime",
                    "ttsChars",
                    "ttsCost",
                    "sttSeconds",
                    "sttCost",
                    "plivoSeconds",
                    "plivoCost",
                    "geminiInputTokens",
                    "geminiCachedTokens",
                    "geminiOutputTokens",
                    "geminiCost",
                    "bucketTotal"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                ON CONFLICT ("wiraOutboundScreeningId", "bucketIndex") DO UPDATE SET
                    "startTime"          = EXCLUDED."startTime",
                    "endTime"            = EXCLUDED."endTime",
                    "ttsChars"           = EXCLUDED."ttsChars",
                    "ttsCost"            = EXCLUDED."ttsCost",
                    "sttSeconds"         = EXCLUDED."sttSeconds",
                    "sttCost"            = EXCLUDED."sttCost",
                    "plivoSeconds"       = EXCLUDED."plivoSeconds",
                    "plivoCost"          = EXCLUDED."plivoCost",
                    "geminiInputTokens"  = EXCLUDED."geminiInputTokens",
                    "geminiCachedTokens" = EXCLUDED."geminiCachedTokens",
                    "geminiOutputTokens" = EXCLUDED."geminiOutputTokens",
                    "geminiCost"         = EXCLUDED."geminiCost",
                    "bucketTotal"        = EXCLUDED."bucketTotal"
                RETURNING *
            `;

            const params =
            [
                data.wiraOutboundScreeningId,
                data.bucketIndex,
                data.startTime,
                data.endTime,
                data.ttsChars ?? 0,
                data.ttsCost ?? 0,
                data.sttSeconds ?? 0,
                data.sttCost ?? 0,
                data.plivoSeconds ?? 0,
                data.plivoCost ?? 0,
                data.geminiInputTokens ?? 0,
                data.geminiCachedTokens ?? 0,
                data.geminiOutputTokens ?? 0,
                data.geminiCost ?? 0,
                data.bucketTotal ?? 0
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Call cost created successfully.",
                data:
                {
                    callCost: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createCallCost at WiraCallCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating call cost.",
                data: null
            };
        }
    }

    //UPDATES CALL COST BUCKETS MATCHING THE GIVEN FILTERS. wiraOutboundScreeningId AND bucketIndex ARE THE BUCKET IDENTITY AND CANNOT BE UPDATED. bucketIndex FILTER REQUIRES wiraOutboundScreeningId.
    async updateCallCost(data = {}, filters = {})
    {
        try
        {
            if(filters.bucketIndex !== undefined && filters.wiraOutboundScreeningId === undefined)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "bucketIndex filter requires wiraOutboundScreeningId.",
                    data: null
                };
            }

            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.startTime !== undefined)
            {
                setClauses.push(`"startTime" = $${paramIndex}`);
                params.push(data.startTime);
                paramIndex++;
            }

            if(data.endTime !== undefined)
            {
                setClauses.push(`"endTime" = $${paramIndex}`);
                params.push(data.endTime);
                paramIndex++;
            }

            if(data.ttsChars !== undefined)
            {
                setClauses.push(`"ttsChars" = $${paramIndex}`);
                params.push(data.ttsChars);
                paramIndex++;
            }

            if(data.ttsCost !== undefined)
            {
                setClauses.push(`"ttsCost" = $${paramIndex}`);
                params.push(data.ttsCost);
                paramIndex++;
            }

            if(data.sttSeconds !== undefined)
            {
                setClauses.push(`"sttSeconds" = $${paramIndex}`);
                params.push(data.sttSeconds);
                paramIndex++;
            }

            if(data.sttCost !== undefined)
            {
                setClauses.push(`"sttCost" = $${paramIndex}`);
                params.push(data.sttCost);
                paramIndex++;
            }

            if(data.plivoSeconds !== undefined)
            {
                setClauses.push(`"plivoSeconds" = $${paramIndex}`);
                params.push(data.plivoSeconds);
                paramIndex++;
            }

            if(data.plivoCost !== undefined)
            {
                setClauses.push(`"plivoCost" = $${paramIndex}`);
                params.push(data.plivoCost);
                paramIndex++;
            }

            if(data.geminiInputTokens !== undefined)
            {
                setClauses.push(`"geminiInputTokens" = $${paramIndex}`);
                params.push(data.geminiInputTokens);
                paramIndex++;
            }

            if(data.geminiCachedTokens !== undefined)
            {
                setClauses.push(`"geminiCachedTokens" = $${paramIndex}`);
                params.push(data.geminiCachedTokens);
                paramIndex++;
            }

            if(data.geminiOutputTokens !== undefined)
            {
                setClauses.push(`"geminiOutputTokens" = $${paramIndex}`);
                params.push(data.geminiOutputTokens);
                paramIndex++;
            }

            if(data.geminiCost !== undefined)
            {
                setClauses.push(`"geminiCost" = $${paramIndex}`);
                params.push(data.geminiCost);
                paramIndex++;
            }

            if(data.bucketTotal !== undefined)
            {
                setClauses.push(`"bucketTotal" = $${paramIndex}`);
                params.push(data.bucketTotal);
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

            if(filters.wiraOutboundScreeningId !== undefined)
            {
                conditions.push(`"wiraOutboundScreeningId" = $${paramIndex}`);
                params.push(filters.wiraOutboundScreeningId);
                paramIndex++;
            }

            if(filters.bucketIndex !== undefined)
            {
                conditions.push(`"bucketIndex" = $${paramIndex}`);
                params.push(filters.bucketIndex);
                paramIndex++;
            }

            if(filters.startTimeStart !== undefined)
            {
                conditions.push(`"startTime" >= $${paramIndex}`);
                params.push(filters.startTimeStart);
                paramIndex++;
            }

            if(filters.startTimeEnd !== undefined)
            {
                conditions.push(`"startTime" <= $${paramIndex}`);
                params.push(filters.startTimeEnd);
                paramIndex++;
            }

            if(filters.endTimeStart !== undefined)
            {
                conditions.push(`"endTime" >= $${paramIndex}`);
                params.push(filters.endTimeStart);
                paramIndex++;
            }

            if(filters.endTimeEnd !== undefined)
            {
                conditions.push(`"endTime" <= $${paramIndex}`);
                params.push(filters.endTimeEnd);
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

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const query = `UPDATE wira_call_costs SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Call costs updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    callCosts: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateCallCost at WiraCallCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating call costs.",
                data: null
            };
        }
    }

    //DELETES CALL COST BUCKETS MATCHING THE GIVEN FILTERS. NO NULLABLE COLUMNS EXIST IN THIS TABLE, SO ROWS ARE ALWAYS DELETED. bucketIndex FILTER REQUIRES wiraOutboundScreeningId.
    async deleteCallCost(filters = {})
    {
        try
        {
            if(filters.bucketIndex !== undefined && filters.wiraOutboundScreeningId === undefined)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "bucketIndex filter requires wiraOutboundScreeningId.",
                    data: null
                };
            }

            const conditions = [];
            const params = [];
            let paramIndex = 1;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.wiraOutboundScreeningId !== undefined)
            {
                conditions.push(`"wiraOutboundScreeningId" = $${paramIndex}`);
                params.push(filters.wiraOutboundScreeningId);
                paramIndex++;
            }

            if(filters.bucketIndex !== undefined)
            {
                conditions.push(`"bucketIndex" = $${paramIndex}`);
                params.push(filters.bucketIndex);
                paramIndex++;
            }

            if(filters.startTimeStart !== undefined)
            {
                conditions.push(`"startTime" >= $${paramIndex}`);
                params.push(filters.startTimeStart);
                paramIndex++;
            }

            if(filters.startTimeEnd !== undefined)
            {
                conditions.push(`"startTime" <= $${paramIndex}`);
                params.push(filters.startTimeEnd);
                paramIndex++;
            }

            if(filters.endTimeStart !== undefined)
            {
                conditions.push(`"endTime" >= $${paramIndex}`);
                params.push(filters.endTimeStart);
                paramIndex++;
            }

            if(filters.endTimeEnd !== undefined)
            {
                conditions.push(`"endTime" <= $${paramIndex}`);
                params.push(filters.endTimeEnd);
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

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const query = `DELETE FROM wira_call_costs ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Call costs deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    callCosts: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteCallCost at WiraCallCostsDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting call costs.",
                data: null
            };
        }
    }
}

module.exports = WiraCallCostsDB;