const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_candidate
================================================================================

The central identity record for every candidate in the Wira system. A candidate
is created the first time they interact on any channel — call, WhatsApp, or app
— and every channel-specific table hangs off this record via foreign key.
Identified uniquely by phone number. candidateId links to the matching record on
the central White Force server; it is null until the candidate has registered
there. The hasCall / hasWhatsapp / hasApp flags provide a fast channel presence
check without needing to join child tables. atsResume holds the public URL of
the AI-generated ATS-friendly resume, set when one is created and used to avoid
recreating it. insights holds AI-generated candidate intelligence accumulated
over time across all channels.

+------------------+-------------+--------------------------------------------+
| Column           | Type        | Constraints                                |
+------------------+-------------+--------------------------------------------+
| id               | BIGSERIAL   | Primary Key                                |
| phone            | VARCHAR(20) | NOT NULL, UNIQUE                           |
| candidateId      | BIGINT      | UNIQUE, nullable                           |
| candidateData    | JSONB       | nullable                                   |
| name             | VARCHAR(255)| nullable                                   |
| email            | VARCHAR(255)| UNIQUE, nullable                           |
| atsResume        | TEXT        | nullable                                   |
| hasCall          | BOOLEAN     | NOT NULL, DEFAULT false                    |
| hasWhatsapp      | BOOLEAN     | NOT NULL, DEFAULT false                    |
| hasApp           | BOOLEAN     | NOT NULL, DEFAULT false                    |
| insights         | TEXT        | nullable                                   |
| createdAt        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                    |
| updatedAt        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                    |
+------------------+-------------+--------------------------------------------+

--- SQL ---

CREATE TABLE wira_candidate
(
    "id"            BIGSERIAL    PRIMARY KEY,
    "phone"         VARCHAR(20)  NOT NULL,
    "candidateId"   BIGINT,
    "candidateData" JSONB,
    "name"          VARCHAR(255),
    "email"         VARCHAR(255),
    "atsResume"     TEXT,
    "hasCall"       BOOLEAN      NOT NULL DEFAULT FALSE,
    "hasWhatsapp"   BOOLEAN      NOT NULL DEFAULT FALSE,
    "hasApp"        BOOLEAN      NOT NULL DEFAULT FALSE,
    "insights"      TEXT,
    "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "uq_wiraCandidate_phone"       UNIQUE ("phone"),
    CONSTRAINT "uq_wiraCandidate_email"       UNIQUE ("email"),
    CONSTRAINT "uq_wiraCandidate_candidateId" UNIQUE ("candidateId")
);

CREATE INDEX "idx_wiraCandidate_phone"       ON wira_candidate("phone");
CREATE INDEX "idx_wiraCandidate_email"       ON wira_candidate("email")       WHERE "email"       IS NOT NULL;
CREATE INDEX "idx_wiraCandidate_candidateId" ON wira_candidate("candidateId") WHERE "candidateId" IS NOT NULL;
CREATE INDEX "idx_wiraCandidate_atsResume"   ON wira_candidate("atsResume")   WHERE "atsResume"   IS NOT NULL;
CREATE INDEX "idx_wiraCandidate_name"        ON wira_candidate("name")        WHERE "name"        IS NOT NULL;
CREATE INDEX "idx_wiraCandidate_hasCall"     ON wira_candidate("hasCall")     WHERE "hasCall"     = TRUE;
CREATE INDEX "idx_wiraCandidate_hasWhatsapp" ON wira_candidate("hasWhatsapp") WHERE "hasWhatsapp" = TRUE;
CREATE INDEX "idx_wiraCandidate_hasApp"      ON wira_candidate("hasApp")      WHERE "hasApp"      = TRUE;
CREATE INDEX "idx_wiraCandidate_createdAt"   ON wira_candidate("createdAt"    DESC);
CREATE INDEX "idx_wiraCandidate_updatedAt"   ON wira_candidate("updatedAt"    DESC);

CREATE OR REPLACE FUNCTION notify_wira_candidate_changes()
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

    payload := jsonb_build_object(
        'operation', TG_OP,
        'table',     TG_TABLE_NAME,
        'data',      row_data - 'candidateData'
    );

    PERFORM pg_notify('wira_candidate_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_candidate_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_candidate
FOR EACH ROW EXECUTE FUNCTION notify_wira_candidate_changes();

CREATE OR REPLACE TRIGGER trg_wira_candidate_updated_at
BEFORE UPDATE ON wira_candidate
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraCandidateDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES A CANDIDATE BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchCandidateById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_candidate WHERE "id" = $1`;
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
                    message: "Candidate not found.",
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
                message: "Candidate fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchCandidateById at WiraCandidateDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidate.",
                data: null
            };
        }
    }

    //FETCHES CANDIDATES USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION.
    async fetchCandidate(filters = {}, pagination = {}, strict = true)
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

            if(filters.phone !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"phone" = $${paramIndex}`);
                    params.push(filters.phone);
                }
                else
                {
                    conditions.push(`"phone" ILIKE $${paramIndex}`);
                    params.push(`%${filters.phone}%`);
                }

                paramIndex++;
            }

            if(filters.candidateId !== undefined)
            {
                conditions.push(`"candidateId" = $${paramIndex}`);
                params.push(filters.candidateId);
                paramIndex++;
            }

            if(filters.candidateData !== undefined)
            {
                if(filters.candidateData)
                {
                    conditions.push(`"candidateData" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"candidateData" IS NULL`);
                }
            }

            if(filters.name !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"name" = $${paramIndex}`);
                    params.push(filters.name);
                }
                else
                {
                    conditions.push(`"name" ILIKE $${paramIndex}`);
                    params.push(`%${filters.name}%`);
                }

                paramIndex++;
            }

            if(filters.email !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"email" = $${paramIndex}`);
                    params.push(filters.email);
                }
                else
                {
                    conditions.push(`"email" ILIKE $${paramIndex}`);
                    params.push(`%${filters.email}%`);
                }

                paramIndex++;
            }

            if(filters.atsResume !== undefined)
            {
                if(typeof filters.atsResume === "boolean")
                {
                    if(filters.atsResume)
                    {
                        conditions.push(`"atsResume" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"atsResume" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"atsResume" = $${paramIndex}`);
                        params.push(filters.atsResume);
                    }
                    else
                    {
                        conditions.push(`"atsResume" ILIKE $${paramIndex}`);
                        params.push(`%${filters.atsResume}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.hasCall !== undefined)
            {
                conditions.push(`"hasCall" = $${paramIndex}`);
                params.push(filters.hasCall);
                paramIndex++;
            }

            if(filters.hasWhatsapp !== undefined)
            {
                conditions.push(`"hasWhatsapp" = $${paramIndex}`);
                params.push(filters.hasWhatsapp);
                paramIndex++;
            }

            if(filters.hasApp !== undefined)
            {
                conditions.push(`"hasApp" = $${paramIndex}`);
                params.push(filters.hasApp);
                paramIndex++;
            }

            if(filters.insights !== undefined)
            {
                if(typeof filters.insights === "boolean")
                {
                    if(filters.insights)
                    {
                        conditions.push(`"insights" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"insights" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"insights" = $${paramIndex}`);
                        params.push(filters.insights);
                    }
                    else
                    {
                        conditions.push(`"insights" ILIKE $${paramIndex}`);
                        params.push(`%${filters.insights}%`);
                    }

                    paramIndex++;
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
            const countQuery = `SELECT COUNT(*) FROM wira_candidate ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_candidate ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_candidate ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Candidates fetched successfully.",
                data:
                {
                    candidates: result.rows,
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
            console.error("Error occured in fetchCandidate at WiraCandidateDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidates.",
                data: null
            };
        }
    }

    //CREATES A NEW CANDIDATE. phone IS REQUIRED. ALL OTHER FIELDS ARE OPTIONAL.
    async createCandidate(data = {})
    {
        try
        {
            if(!data.phone)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "phone is required.",
                    data: null
                };
            }

            const query = `
                INSERT INTO wira_candidate
                (
                    "phone",
                    "candidateId",
                    "candidateData",
                    "name",
                    "email",
                    "atsResume",
                    "hasCall",
                    "hasWhatsapp",
                    "hasApp",
                    "insights"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            `;

            const params =
            [
                data.phone,
                data.candidateId ?? null,
                data.candidateData ?? null,
                data.name ?? null,
                data.email ?? null,
                data.atsResume ?? null,
                data.hasCall ?? false,
                data.hasWhatsapp ?? false,
                data.hasApp ?? false,
                data.insights ?? null
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Candidate created successfully.",
                data:
                {
                    candidate: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createCandidate at WiraCandidateDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating candidate.",
                data: null
            };
        }
    }

    //UPDATES CANDIDATES MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async updateCandidate(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.phone !== undefined)
            {
                setClauses.push(`"phone" = $${paramIndex}`);
                params.push(data.phone);
                paramIndex++;
            }

            if(data.candidateId !== undefined)
            {
                setClauses.push(`"candidateId" = $${paramIndex}`);
                params.push(data.candidateId);
                paramIndex++;
            }

            if(data.candidateData !== undefined)
            {
                setClauses.push(`"candidateData" = $${paramIndex}`);
                params.push(data.candidateData);
                paramIndex++;
            }

            if(data.name !== undefined)
            {
                setClauses.push(`"name" = $${paramIndex}`);
                params.push(data.name);
                paramIndex++;
            }

            if(data.email !== undefined)
            {
                setClauses.push(`"email" = $${paramIndex}`);
                params.push(data.email);
                paramIndex++;
            }

            if(data.atsResume !== undefined)
            {
                setClauses.push(`"atsResume" = $${paramIndex}`);
                params.push(data.atsResume);
                paramIndex++;
            }

            if(data.hasCall !== undefined)
            {
                setClauses.push(`"hasCall" = $${paramIndex}`);
                params.push(data.hasCall);
                paramIndex++;
            }

            if(data.hasWhatsapp !== undefined)
            {
                setClauses.push(`"hasWhatsapp" = $${paramIndex}`);
                params.push(data.hasWhatsapp);
                paramIndex++;
            }

            if(data.hasApp !== undefined)
            {
                setClauses.push(`"hasApp" = $${paramIndex}`);
                params.push(data.hasApp);
                paramIndex++;
            }

            if(data.insights !== undefined)
            {
                setClauses.push(`"insights" = $${paramIndex}`);
                params.push(data.insights);
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

            if(filters.phone !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"phone" = $${paramIndex}`);
                    params.push(filters.phone);
                }
                else
                {
                    conditions.push(`"phone" ILIKE $${paramIndex}`);
                    params.push(`%${filters.phone}%`);
                }

                paramIndex++;
            }

            if(filters.candidateId !== undefined)
            {
                conditions.push(`"candidateId" = $${paramIndex}`);
                params.push(filters.candidateId);
                paramIndex++;
            }

            if(filters.name !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"name" = $${paramIndex}`);
                    params.push(filters.name);
                }
                else
                {
                    conditions.push(`"name" ILIKE $${paramIndex}`);
                    params.push(`%${filters.name}%`);
                }

                paramIndex++;
            }

            if(filters.email !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"email" = $${paramIndex}`);
                    params.push(filters.email);
                }
                else
                {
                    conditions.push(`"email" ILIKE $${paramIndex}`);
                    params.push(`%${filters.email}%`);
                }

                paramIndex++;
            }

            if(filters.atsResume !== undefined)
            {
                if(typeof filters.atsResume === "boolean")
                {
                    if(filters.atsResume)
                    {
                        conditions.push(`"atsResume" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"atsResume" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"atsResume" = $${paramIndex}`);
                        params.push(filters.atsResume);
                    }
                    else
                    {
                        conditions.push(`"atsResume" ILIKE $${paramIndex}`);
                        params.push(`%${filters.atsResume}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.hasCall !== undefined)
            {
                conditions.push(`"hasCall" = $${paramIndex}`);
                params.push(filters.hasCall);
                paramIndex++;
            }

            if(filters.hasWhatsapp !== undefined)
            {
                conditions.push(`"hasWhatsapp" = $${paramIndex}`);
                params.push(filters.hasWhatsapp);
                paramIndex++;
            }

            if(filters.hasApp !== undefined)
            {
                conditions.push(`"hasApp" = $${paramIndex}`);
                params.push(filters.hasApp);
                paramIndex++;
            }

            if(filters.insights !== undefined)
            {
                if(typeof filters.insights === "boolean")
                {
                    if(filters.insights)
                    {
                        conditions.push(`"insights" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"insights" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"insights" = $${paramIndex}`);
                        params.push(filters.insights);
                    }
                    else
                    {
                        conditions.push(`"insights" ILIKE $${paramIndex}`);
                        params.push(`%${filters.insights}%`);
                    }

                    paramIndex++;
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
            const query = `UPDATE wira_candidate SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Candidates updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    candidates: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateCandidate at WiraCandidateDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating candidates.",
                data: null
            };
        }
    }

    //DELETES CANDIDATES MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async deleteCandidate(data = {}, filters = {}, strict = true)
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

            if(filters.phone !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"phone" = $${paramIndex}`);
                    params.push(filters.phone);
                }
                else
                {
                    conditions.push(`"phone" ILIKE $${paramIndex}`);
                    params.push(`%${filters.phone}%`);
                }

                paramIndex++;
            }

            if(filters.candidateId !== undefined)
            {
                conditions.push(`"candidateId" = $${paramIndex}`);
                params.push(filters.candidateId);
                paramIndex++;
            }

            if(filters.name !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"name" = $${paramIndex}`);
                    params.push(filters.name);
                }
                else
                {
                    conditions.push(`"name" ILIKE $${paramIndex}`);
                    params.push(`%${filters.name}%`);
                }

                paramIndex++;
            }

            if(filters.email !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"email" = $${paramIndex}`);
                    params.push(filters.email);
                }
                else
                {
                    conditions.push(`"email" ILIKE $${paramIndex}`);
                    params.push(`%${filters.email}%`);
                }

                paramIndex++;
            }

            if(filters.atsResume !== undefined)
            {
                if(typeof filters.atsResume === "boolean")
                {
                    if(filters.atsResume)
                    {
                        conditions.push(`"atsResume" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"atsResume" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"atsResume" = $${paramIndex}`);
                        params.push(filters.atsResume);
                    }
                    else
                    {
                        conditions.push(`"atsResume" ILIKE $${paramIndex}`);
                        params.push(`%${filters.atsResume}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.hasCall !== undefined)
            {
                conditions.push(`"hasCall" = $${paramIndex}`);
                params.push(filters.hasCall);
                paramIndex++;
            }

            if(filters.hasWhatsapp !== undefined)
            {
                conditions.push(`"hasWhatsapp" = $${paramIndex}`);
                params.push(filters.hasWhatsapp);
                paramIndex++;
            }

            if(filters.hasApp !== undefined)
            {
                conditions.push(`"hasApp" = $${paramIndex}`);
                params.push(filters.hasApp);
                paramIndex++;
            }

            if(filters.insights !== undefined)
            {
                if(typeof filters.insights === "boolean")
                {
                    if(filters.insights)
                    {
                        conditions.push(`"insights" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"insights" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"insights" = $${paramIndex}`);
                        params.push(filters.insights);
                    }
                    else
                    {
                        conditions.push(`"insights" ILIKE $${paramIndex}`);
                        params.push(`%${filters.insights}%`);
                    }

                    paramIndex++;
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
                "candidateId",
                "candidateData",
                "name",
                "email",
                "atsResume",
                "insights"
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

                const query = `UPDATE wira_candidate SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Candidate columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        candidates: result.rows
                    }
                };
            }

            //NO DATA FIELDS — DELETE THE ROWS
            const query = `DELETE FROM wira_candidate ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Candidates deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    candidates: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteCandidate at WiraCandidateDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting candidates.",
                data: null
            };
        }
    }
}

module.exports = WiraCandidateDB;