const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_instruction
================================================================================

The orchestration layer above wira_task. An instruction represents a high-level
intent initiated by the AI system for a specific candidate — for example,
"find matching jobs" or "apply to selected jobs". Each instruction can spawn
multiple tasks across multiple iterations, with each iteration being one round
of task execution. iterationData tracks which tasks were created per iteration
as an ordered array. behaviour controls whether the chat channel must wait for
the instruction to finish (sync) or can continue immediately (async). Has a
foreign key to wira_candidate since every instruction belongs to a candidate,
unlike wira_task which is intentionally standalone.

+------------------+--------------+------------------------------------------+
| Column           | Type         | Constraints                              |
+------------------+--------------+------------------------------------------+
| id               | BIGSERIAL    | Primary Key                              |
| wiraCandidateId  | BIGINT       | NOT NULL, FK → wira_candidate            |
| label            | VARCHAR(255) | nullable                                 |
| description      | TEXT         | nullable                                 |
| status           | VARCHAR(20)  | NOT NULL, DEFAULT 'pending'              |
|                  |              | CHECK IN (pending, processing,           |
|                  |              |           completed, failed)             |
| behaviour        | VARCHAR(10)  | NOT NULL, DEFAULT 'async'                |
|                  |              | CHECK IN (sync, async)                   |
| iterationData    | JSONB        | nullable                                 |
| cost             | JSONB        | nullable                                 |
| message          | TEXT         | nullable                                 |
| platform         | VARCHAR(10)  | CHECK IN (App, Web, Whatsapp,            |
|                  |              |           Call, Server)                  |
| createdAt        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                  |
| updatedAt        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                  |
| finishedAt       | TIMESTAMPTZ  | nullable                                 |
+------------------+--------------+------------------------------------------+

iterationData shape:
[
  { "taskIds": [1, 2, 3] },
  { "taskIds": [4, 5] }
]
Each index represents one iteration. Index 0 is the first round of tasks,
index 1 is the second round, and so on.

--- SQL ---

CREATE TABLE wira_instruction
(
    "id"               BIGSERIAL    PRIMARY KEY,
    "wiraCandidateId"  BIGINT       NOT NULL REFERENCES wira_candidate("id") ON DELETE CASCADE,
    "label"            VARCHAR(255),
    "description"      TEXT,
    "status"           VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'processing', 'completed', 'failed')),
    "behaviour"        VARCHAR(10)  NOT NULL DEFAULT 'async'   CHECK ("behaviour" IN ('sync', 'async')),
    "iterationData"    JSONB,
    "cost"             JSONB,
    "message"          TEXT,
    "platform"         VARCHAR(10)  CHECK ("platform" IN ('App', 'Web', 'Whatsapp', 'Call', 'Server')),
    "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "finishedAt"       TIMESTAMPTZ
);

CREATE INDEX "idx_wiraInstruction_wiraCandidateId" ON wira_instruction("wiraCandidateId");
CREATE INDEX "idx_wiraInstruction_status"          ON wira_instruction("status");
CREATE INDEX "idx_wiraInstruction_behaviour"       ON wira_instruction("behaviour");
CREATE INDEX "idx_wiraInstruction_platform"        ON wira_instruction("platform")  WHERE "platform" IS NOT NULL;
CREATE INDEX "idx_wiraInstruction_label"           ON wira_instruction("label")     WHERE "label"    IS NOT NULL;
CREATE INDEX "idx_wiraInstruction_createdAt"       ON wira_instruction("createdAt"  DESC);
CREATE INDEX "idx_wiraInstruction_updatedAt"       ON wira_instruction("updatedAt"  DESC);

CREATE OR REPLACE FUNCTION notify_wira_instruction_changes()
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

    row_data := row_data - 'iterationData';

    payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_data);
    PERFORM pg_notify('wira_instruction_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_instruction_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_instruction
FOR EACH ROW EXECUTE FUNCTION notify_wira_instruction_changes();

CREATE OR REPLACE TRIGGER trg_wira_instruction_updated_at
BEFORE UPDATE ON wira_instruction
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraInstructionDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES THE INSTRUCTION BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchInstructionById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_instruction WHERE "id" = $1`;
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
                    message: "Instruction not found.",
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
                message: "Instruction fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchInstructionById at WiraInstructionDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching instruction.",
                data: null
            };
        }
    }

    //FETCHES INSTRUCTIONS USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION.
    async fetchInstruction(filters = {}, pagination = {}, strict = true)
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

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.behaviour !== undefined)
            {
                conditions.push(`"behaviour" = $${paramIndex}`);
                params.push(filters.behaviour);
                paramIndex++;
            }

            if(filters.message !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"message" = $${paramIndex}`);
                    params.push(filters.message);
                }
                else
                {
                    conditions.push(`"message" ILIKE $${paramIndex}`);
                    params.push(`%${filters.message}%`);
                }

                paramIndex++;
            }

            if(filters.cost !== undefined)
            {
                if(filters.cost)
                {
                    conditions.push(`"cost" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"cost" IS NULL`);
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

            if(filters.finishedAtStart !== undefined)
            {
                conditions.push(`"finishedAt" >= $${paramIndex}`);
                params.push(filters.finishedAtStart);
                paramIndex++;
            }

            if(filters.finishedAtEnd !== undefined)
            {
                conditions.push(`"finishedAt" <= $${paramIndex}`);
                params.push(filters.finishedAtEnd);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const countQuery = `SELECT COUNT(*) FROM wira_instruction ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_instruction ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_instruction ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Instructions fetched successfully.",
                data:
                {
                    instructions: result.rows,
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
            console.error("Error occured in fetchInstruction at WiraInstructionDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching instructions.",
                data: null
            };
        }
    }

    //CREATES A NEW INSTRUCTION. wiraCandidateId IS REQUIRED, ALL OTHER FIELDS ARE OPTIONAL.
    async createInstruction(data = {})
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

            const query = `
                INSERT INTO wira_instruction
                (
                    "wiraCandidateId",
                    "label",
                    "description",
                    "status",
                    "behaviour",
                    "iterationData",
                    "cost",
                    "message",
                    "platform"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
            `;

            const params =
            [
                data.wiraCandidateId,
                data.label ?? null,
                data.description ?? null,
                data.status ?? "pending",
                data.behaviour ?? "async",
                data.iterationData ? JSON.stringify(data.iterationData) : null,
                data.cost ? JSON.stringify(data.cost) : null,
                data.message ?? null,
                data.platform ?? null
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Instruction created successfully.",
                data:
                {
                    instruction: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createInstruction at WiraInstructionDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating instruction.",
                data: null
            };
        }
    }

    //UPDATES INSTRUCTIONS MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async updateInstruction(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

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

            if(data.status !== undefined)
            {
                setClauses.push(`"status" = $${paramIndex}`);
                params.push(data.status);
                paramIndex++;
            }

            if(data.behaviour !== undefined)
            {
                setClauses.push(`"behaviour" = $${paramIndex}`);
                params.push(data.behaviour);
                paramIndex++;
            }

            if(data.iterationData !== undefined)
            {
                setClauses.push(`"iterationData" = $${paramIndex}`);
                params.push(data.iterationData ? JSON.stringify(data.iterationData) : null);
                paramIndex++;
            }

            if(data.cost !== undefined)
            {
                setClauses.push(`"cost" = $${paramIndex}`);
                params.push(data.cost ? JSON.stringify(data.cost) : null);
                paramIndex++;
            }

            if(data.message !== undefined)
            {
                setClauses.push(`"message" = $${paramIndex}`);
                params.push(data.message);
                paramIndex++;
            }

            if(data.platform !== undefined)
            {
                setClauses.push(`"platform" = $${paramIndex}`);
                params.push(data.platform);
                paramIndex++;
            }

            if(data.finishedAt !== undefined)
            {
                setClauses.push(`"finishedAt" = $${paramIndex}`);
                params.push(data.finishedAt);
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

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.behaviour !== undefined)
            {
                conditions.push(`"behaviour" = $${paramIndex}`);
                params.push(filters.behaviour);
                paramIndex++;
            }

            if(filters.message !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"message" = $${paramIndex}`);
                    params.push(filters.message);
                }
                else
                {
                    conditions.push(`"message" ILIKE $${paramIndex}`);
                    params.push(`%${filters.message}%`);
                }

                paramIndex++;
            }

            if(filters.cost !== undefined)
            {
                if(filters.cost)
                {
                    conditions.push(`"cost" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"cost" IS NULL`);
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

            if(filters.finishedAtStart !== undefined)
            {
                conditions.push(`"finishedAt" >= $${paramIndex}`);
                params.push(filters.finishedAtStart);
                paramIndex++;
            }

            if(filters.finishedAtEnd !== undefined)
            {
                conditions.push(`"finishedAt" <= $${paramIndex}`);
                params.push(filters.finishedAtEnd);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const query = `UPDATE wira_instruction SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Instructions updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    instructions: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateInstruction at WiraInstructionDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating instructions.",
                data: null
            };
        }
    }

    //DELETES INSTRUCTIONS MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async deleteInstruction(data = {}, filters = {}, strict = true)
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

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.behaviour !== undefined)
            {
                conditions.push(`"behaviour" = $${paramIndex}`);
                params.push(filters.behaviour);
                paramIndex++;
            }

            if(filters.message !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"message" = $${paramIndex}`);
                    params.push(filters.message);
                }
                else
                {
                    conditions.push(`"message" ILIKE $${paramIndex}`);
                    params.push(`%${filters.message}%`);
                }

                paramIndex++;
            }

            if(filters.cost !== undefined)
            {
                if(filters.cost)
                {
                    conditions.push(`"cost" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"cost" IS NULL`);
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

            if(filters.finishedAtStart !== undefined)
            {
                conditions.push(`"finishedAt" >= $${paramIndex}`);
                params.push(filters.finishedAtStart);
                paramIndex++;
            }

            if(filters.finishedAtEnd !== undefined)
            {
                conditions.push(`"finishedAt" <= $${paramIndex}`);
                params.push(filters.finishedAtEnd);
                paramIndex++;
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

            //NULLABLE COLUMNS THAT CAN BE EMPTIED
            const nullableCols =
            [
                "label",
                "description",
                "iterationData",
                "cost",
                "message",
                "platform",
                "finishedAt"
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

                const query = `UPDATE wira_instruction SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Instruction columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        instructions: result.rows
                    }
                };
            }

            //NO DATA FIELDS — DELETE THE ROWS
            const query = `DELETE FROM wira_instruction ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Instructions deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    instructions: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteInstruction at WiraInstructionDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting instructions.",
                data: null
            };
        }
    }

    //FETCHES INSTRUCTIONS FOR A CANDIDATE. FIRST RESOLVES THE CANDIDATE FROM candidateFilters, THEN FETCHES INSTRUCTIONS MATCHING filters. RETURNS BOTH A STRUCTURED CANDIDATE OBJECT WITH INSTRUCTIONS AND A FLAT INSTRUCTIONS ARRAY.
    async fetchInstructionsFromCandidate(candidateFilters = {}, filters = {}, pagination = {}, strict = true)
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

            //STEP 2 — BUILD INSTRUCTION FILTERS SCOPED TO THIS CANDIDATE
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

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.behaviour !== undefined)
            {
                conditions.push(`"behaviour" = $${paramIndex}`);
                params.push(filters.behaviour);
                paramIndex++;
            }

            if(filters.message !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"message" = $${paramIndex}`);
                    params.push(filters.message);
                }
                else
                {
                    conditions.push(`"message" ILIKE $${paramIndex}`);
                    params.push(`%${filters.message}%`);
                }

                paramIndex++;
            }

            if(filters.cost !== undefined)
            {
                if(filters.cost)
                {
                    conditions.push(`"cost" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"cost" IS NULL`);
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

            if(filters.finishedAtStart !== undefined)
            {
                conditions.push(`"finishedAt" >= $${paramIndex}`);
                params.push(filters.finishedAtStart);
                paramIndex++;
            }

            if(filters.finishedAtEnd !== undefined)
            {
                conditions.push(`"finishedAt" <= $${paramIndex}`);
                params.push(filters.finishedAtEnd);
                paramIndex++;
            }

            const whereClause = `WHERE ${conditions.join(" AND ")}`;
            const countQuery = `SELECT COUNT(*) FROM wira_instruction ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_instruction ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_instruction ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);
            const instructions = result.rows;

            return {
                statusCode: 200,
                success: true,
                message: "Candidate instructions fetched successfully.",
                data:
                {
                    candidate:
                    {
                        ...candidate,
                        instructions: instructions
                    },
                    instructions: instructions,
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
            console.error("Error occured in fetchInstructionsFromCandidate at WiraInstructionDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidate instructions.",
                data: null
            };
        }
    }
}

module.exports = WiraInstructionDB;