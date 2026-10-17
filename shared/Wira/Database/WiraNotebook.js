const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_notebook
================================================================================

A temporary working asset owned by a candidate. Represents in-progress data
being built across multiple turns — such as a screening session, an exam, or a
profile — that has not yet been finalized and committed to the central database.
Each notebook has a category (free-form, AI-managed) and a fields object for
cases where multiple notebooks of the same category can exist for one candidate
(e.g. screening for job 42 vs job 91). Together, category and fields form the
soft identity of a notebook within a candidate's scope.
Messages store only a reference to the notebook (id, category, label,
description) rather than the full data, to avoid token bloat across turns. The
full data JSONB is loaded on demand. Once finalized, the notebook is deleted —
it is intentionally short-lived. Multiple notebooks can be active per candidate
simultaneously.

+------------------+--------------+------------------------------------------+
| Column           | Type         | Constraints                              |
+------------------+--------------+------------------------------------------+
| id               | BIGSERIAL    | Primary Key                              |
| wiraCandidateId  | BIGINT       | NOT NULL, FK → wira_candidate            |
| category         | VARCHAR(100) | NOT NULL                                 |
| fields           | JSONB        | NOT NULL, DEFAULT '{}'                   |
| label            | VARCHAR(255) | nullable                                 |
| description      | TEXT         | nullable                                 |
| data             | JSONB        | nullable                                 |
| platform         | VARCHAR(10)  | CHECK IN (App, Web, Whatsapp,            |
|                  |              |           Call, Server)                  |
| createdAt        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                  |
| updatedAt        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                  |
+------------------+--------------+------------------------------------------+

Known categories (AI-predictable, not enforced by constraint):
  profile    — fields = {}
  screening  — fields = { "jobId": "42" }
  examiner   — fields = { "jobId": "42" }

Message reference shape (saved per message, not full data):
{
  "id":          1,
  "category":    "screening",
  "fields":      { "jobId": "42" },
  "label":       "Screening for Senior Developer",
  "description": "3 of 5 questions answered, pending final score"
}

--- SQL ---

CREATE TABLE wira_notebook
(
    "id"               BIGSERIAL    PRIMARY KEY,
    "wiraCandidateId"  BIGINT       NOT NULL REFERENCES wira_candidate("id") ON DELETE CASCADE,
    "category"         VARCHAR(100) NOT NULL,
    "fields"           JSONB        NOT NULL DEFAULT '{}',
    "label"            VARCHAR(255),
    "description"      TEXT,
    "data"             JSONB,
    "platform"         VARCHAR(10)  CHECK ("platform" IN ('App', 'Web', 'Whatsapp', 'Call', 'Server')),
    "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_wiraNotebook_wiraCandidateId" ON wira_notebook("wiraCandidateId");
CREATE INDEX "idx_wiraNotebook_category"        ON wira_notebook("category");
CREATE INDEX "idx_wiraNotebook_fields_gin"      ON wira_notebook USING GIN ("fields");
CREATE INDEX "idx_wiraNotebook_platform"        ON wira_notebook("platform") WHERE "platform" IS NOT NULL;
CREATE INDEX "idx_wiraNotebook_updatedAt"       ON wira_notebook("updatedAt" DESC);

CREATE OR REPLACE FUNCTION notify_wira_notebook_changes()
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

    row_data := row_data - 'data';

    payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_data);
    PERFORM pg_notify('wira_notebook_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_notebook_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_notebook
FOR EACH ROW EXECUTE FUNCTION notify_wira_notebook_changes();

CREATE OR REPLACE TRIGGER trg_wira_notebook_updated_at
BEFORE UPDATE ON wira_notebook
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraNotebookDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES A NOTEBOOK BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchNotebookById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_notebook WHERE "id" = $1`;
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
                    message: "Notebook not found.",
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
                message: "Notebook fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchNotebookById at WiraNotebookDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching notebook.",
                data: null
            };
        }
    }

    //FETCHES NOTEBOOKS USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION.
    async fetchNotebook(filters = {}, pagination = {}, strict = true)
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

            if(filters.wiraCandidateId !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(filters.wiraCandidateId);
                paramIndex++;
            }

            if(filters.category !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"category" = $${paramIndex}`);
                    params.push(filters.category);
                }
                else
                {
                    conditions.push(`"category" ILIKE $${paramIndex}`);
                    params.push(`%${filters.category}%`);
                }

                paramIndex++;
            }

            if(filters.fields !== undefined)
            {
                conditions.push(`"fields" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.fields));
                paramIndex++;
            }

            if(filters.label !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"label" = $${paramIndex}`);
                    params.push(filters.label);
                }
                else
                {
                    conditions.push(`"label" ILIKE $${paramIndex}`);
                    params.push(`%${filters.label}%`);
                }

                paramIndex++;
            }

            if(filters.description !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"description" = $${paramIndex}`);
                    params.push(filters.description);
                }
                else
                {
                    conditions.push(`"description" ILIKE $${paramIndex}`);
                    params.push(`%${filters.description}%`);
                }

                paramIndex++;
            }

            if(filters.data !== undefined)
            {
                if(filters.data)
                {
                    conditions.push(`"data" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"data" IS NULL`);
                }
            }

            if(filters.platform !== undefined)
            {
                conditions.push(`"platform" = $${paramIndex}`);
                params.push(filters.platform);
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
            const countQuery = `SELECT COUNT(*) FROM wira_notebook ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_notebook ${whereClause} ORDER BY "updatedAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_notebook ${whereClause} ORDER BY "updatedAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Notebooks fetched successfully.",
                data:
                {
                    notebooks: result.rows,
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
            console.error("Error occured in fetchNotebook at WiraNotebookDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching notebooks.",
                data: null
            };
        }
    }

    //CREATES A NEW NOTEBOOK. wiraCandidateId AND category ARE REQUIRED. ALL OTHER FIELDS ARE OPTIONAL.
    async createNotebook(data = {})
    {
        try
        {
            if(!data.wiraCandidateId)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "wiraCandidateId is required.",
                    data: null
                };
            }

            if(!data.category)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "category is required.",
                    data: null
                };
            }

            const query = `
                INSERT INTO wira_notebook
                (
                    "wiraCandidateId",
                    "category",
                    "fields",
                    "label",
                    "description",
                    "data",
                    "platform"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;

            const params =
            [
                data.wiraCandidateId,
                data.category,
                data.fields ?? {},
                data.label ?? null,
                data.description ?? null,
                data.data ? JSON.stringify(data.data) : null,
                data.platform ?? null
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Notebook created successfully.",
                data:
                {
                    notebook: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createNotebook at WiraNotebookDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating notebook.",
                data: null
            };
        }
    }

    //UPDATES NOTEBOOKS MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async updateNotebook(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.category !== undefined)
            {
                setClauses.push(`"category" = $${paramIndex}`);
                params.push(data.category);
                paramIndex++;
            }

            if(data.fields !== undefined)
            {
                setClauses.push(`"fields" = $${paramIndex}`);
                params.push(JSON.stringify(data.fields));
                paramIndex++;
            }

            if(data.label !== undefined)
            {
                setClauses.push(`"label" = $${paramIndex}`);
                params.push(data.label);
                paramIndex++;
            }

            if(data.description !== undefined)
            {
                setClauses.push(`"description" = $${paramIndex}`);
                params.push(data.description);
                paramIndex++;
            }

            if(data.data !== undefined)
            {
                setClauses.push(`"data" = $${paramIndex}`);
                params.push(data.data ? JSON.stringify(data.data) : null);
                paramIndex++;
            }

            if(data.platform !== undefined)
            {
                setClauses.push(`"platform" = $${paramIndex}`);
                params.push(data.platform);
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

            if(filters.wiraCandidateId !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(filters.wiraCandidateId);
                paramIndex++;
            }

            if(filters.category !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"category" = $${paramIndex}`);
                    params.push(filters.category);
                }
                else
                {
                    conditions.push(`"category" ILIKE $${paramIndex}`);
                    params.push(`%${filters.category}%`);
                }

                paramIndex++;
            }

            if(filters.fields !== undefined)
            {
                conditions.push(`"fields" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.fields));
                paramIndex++;
            }

            if(filters.label !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"label" = $${paramIndex}`);
                    params.push(filters.label);
                }
                else
                {
                    conditions.push(`"label" ILIKE $${paramIndex}`);
                    params.push(`%${filters.label}%`);
                }

                paramIndex++;
            }

            if(filters.platform !== undefined)
            {
                conditions.push(`"platform" = $${paramIndex}`);
                params.push(filters.platform);
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
            const query = `UPDATE wira_notebook SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Notebooks updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    notebooks: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateNotebook at WiraNotebookDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating notebooks.",
                data: null
            };
        }
    }

    //DELETES NOTEBOOKS MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async deleteNotebook(data = {}, filters = {}, strict = true)
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

            if(filters.wiraCandidateId !== undefined)
            {
                conditions.push(`"wiraCandidateId" = $${paramIndex}`);
                params.push(filters.wiraCandidateId);
                paramIndex++;
            }

            if(filters.category !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"category" = $${paramIndex}`);
                    params.push(filters.category);
                }
                else
                {
                    conditions.push(`"category" ILIKE $${paramIndex}`);
                    params.push(`%${filters.category}%`);
                }

                paramIndex++;
            }

            if(filters.fields !== undefined)
            {
                conditions.push(`"fields" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.fields));
                paramIndex++;
            }

            if(filters.label !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"label" = $${paramIndex}`);
                    params.push(filters.label);
                }
                else
                {
                    conditions.push(`"label" ILIKE $${paramIndex}`);
                    params.push(`%${filters.label}%`);
                }

                paramIndex++;
            }

            if(filters.platform !== undefined)
            {
                conditions.push(`"platform" = $${paramIndex}`);
                params.push(filters.platform);
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
                "label",
                "description",
                "data",
                "platform"
            ];

            const colsToNull = nullableCols.filter((col) => { return data[col] === true; });
            if(colsToNull.length > 0)
            {
                const setClauses = colsToNull.map((col) => { return `"${col}" = NULL`; });

                const query = `UPDATE wira_notebook SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Notebook columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        notebooks: result.rows
                    }
                };
            }

            const query = `DELETE FROM wira_notebook ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Notebooks deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    notebooks: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteNotebook at WiraNotebookDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting notebooks.",
                data: null
            };
        }
    }

    //FETCHES NOTEBOOKS FOR A CANDIDATE. FIRST RESOLVES THE CANDIDATE FROM candidateFilters, THEN FETCHES THEIR NOTEBOOKS MATCHING filters. RETURNS BOTH A STRUCTURED CANDIDATE OBJECT WITH NOTEBOOKS AND A FLAT NOTEBOOKS ARRAY.
    async fetchNotebooksFromCandidate(candidateFilters = {}, filters = {}, pagination = {}, strict = true)
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

            //STEP 2 — FETCH NOTEBOOKS FOR THIS CANDIDATE WITH FILTERS
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

            if(filters.category !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"category" = $${paramIndex}`);
                    params.push(filters.category);
                }
                else
                {
                    conditions.push(`"category" ILIKE $${paramIndex}`);
                    params.push(`%${filters.category}%`);
                }

                paramIndex++;
            }

            if(filters.fields !== undefined)
            {
                conditions.push(`"fields" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.fields));
                paramIndex++;
            }

            if(filters.label !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"label" = $${paramIndex}`);
                    params.push(filters.label);
                }
                else
                {
                    conditions.push(`"label" ILIKE $${paramIndex}`);
                    params.push(`%${filters.label}%`);
                }

                paramIndex++;
            }

            if(filters.description !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"description" = $${paramIndex}`);
                    params.push(filters.description);
                }
                else
                {
                    conditions.push(`"description" ILIKE $${paramIndex}`);
                    params.push(`%${filters.description}%`);
                }

                paramIndex++;
            }

            if(filters.data !== undefined)
            {
                if(filters.data)
                {
                    conditions.push(`"data" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"data" IS NULL`);
                }
            }

            if(filters.platform !== undefined)
            {
                conditions.push(`"platform" = $${paramIndex}`);
                params.push(filters.platform);
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
            const countQuery = `SELECT COUNT(*) FROM wira_notebook ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_notebook ${whereClause} ORDER BY "updatedAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_notebook ${whereClause} ORDER BY "updatedAt" DESC`;
            }

            const notebooksResult = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Candidate notebooks fetched successfully.",
                data:
                {
                    candidate:
                    {
                        ...candidate,
                        notebooks: notebooksResult.rows
                    },
                    notebooks: notebooksResult.rows,
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
            console.error("Error occured in fetchNotebooksFromCandidate at WiraNotebookDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidate notebooks.",
                data: null
            };
        }
    }
}

module.exports = WiraNotebookDB;