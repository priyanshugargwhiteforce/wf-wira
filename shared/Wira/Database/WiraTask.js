const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_task
================================================================================

A single atomic command execution within the Wira AI system. Created whenever
the Task class runs a command — either directly by calling code or via the
wira_instruction orchestration layer. Intentionally has no foreign keys so it
can be created from anywhere in the system without dependency on an instruction
or candidate record. status tracks the full lifecycle from creation to
completion. success, statusCode, and message are populated only once the task
finishes. cost captures AI token usage for commands that invoke AI, using the
same promptCosts shape as message tables — null for commands that make no AI
calls. platform records which channel triggered this task. label is an optional
human-readable name for display or debugging purposes.

+------------------+--------------+------------------------------------------+
| Column           | Type         | Constraints                              |
+------------------+--------------+------------------------------------------+
| id               | BIGSERIAL    | Primary Key                              |
| command          | VARCHAR(100) | NOT NULL                                 |
| label            | VARCHAR(255) | nullable                                 |
| instructionData  | JSONB        | nullable                                 |
| status           | VARCHAR(20)  | NOT NULL, DEFAULT 'pending'              |
|                  |              | CHECK IN (pending, processing,           |
|                  |              |           completed, failed)             |
| statusCode       | INT          | nullable                                 |
| success          | BOOLEAN      | nullable                                 |
| message          | TEXT         | nullable                                 |
| cost             | JSONB        | nullable                                 |
| platform         | VARCHAR(10)  | CHECK IN (App, Web, Whatsapp,            |
|                  |              |           Call, Server)                  |
| createdAt        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                  |
| updatedAt        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                  |
| finishedAt       | TIMESTAMPTZ  | nullable                                 |
+------------------+--------------+------------------------------------------+

cost shape (same as promptCosts in message tables):
[
  {
    "promptTitle":  "string",
    "isCache":      true/false,
    "cacheId":      "string or null",
    "inputTokens":  0,
    "outputTokens": 0,
    "cachedTokens": 0,
    "inputCost":    0.000000,
    "outputCost":   0.000000,
    "totalCost":    0.000000
  }
]

--- SQL ---

CREATE TABLE wira_task
(
    "id"              BIGSERIAL    PRIMARY KEY,
    "command"         VARCHAR(100) NOT NULL,
    "label"           VARCHAR(255),
    "instructionData" JSONB,
    "status"          VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'processing', 'completed', 'failed')),
    "statusCode"      INT,
    "success"         BOOLEAN,
    "message"         TEXT,
    "cost"            JSONB,
    "platform"        VARCHAR(10)  CHECK ("platform" IN ('App', 'Web', 'Whatsapp', 'Call', 'Server')),
    "createdAt"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "finishedAt"      TIMESTAMPTZ
);

CREATE INDEX "idx_wiraTask_command"   ON wira_task("command");
CREATE INDEX "idx_wiraTask_status"    ON wira_task("status");
CREATE INDEX "idx_wiraTask_platform"  ON wira_task("platform")  WHERE "platform" IS NOT NULL;
CREATE INDEX "idx_wiraTask_label"     ON wira_task("label")     WHERE "label"    IS NOT NULL;
CREATE INDEX "idx_wiraTask_createdAt" ON wira_task("createdAt"  DESC);
CREATE INDEX "idx_wiraTask_updatedAt" ON wira_task("updatedAt"  DESC);

CREATE OR REPLACE FUNCTION notify_wira_task_changes()
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

    row_data := row_data - 'instructionData' - 'cost';

    payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_data);
    PERFORM pg_notify('wira_task_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_task_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_task
FOR EACH ROW EXECUTE FUNCTION notify_wira_task_changes();

CREATE OR REPLACE TRIGGER trg_wira_task_updated_at
BEFORE UPDATE ON wira_task
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraTaskDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES THE TASK BY IT'S ID, RETURNS 404 IF NOT FOUND.
    async fetchTaskById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_task WHERE "id" = $1`;
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
                    message: "Task not found.",
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
                message: "Task fetched successfully.",
                data: 
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchTaskById at WiraTaskDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching task.",
                data: null
            };
        }
    }

    //FETCHES TASKS USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION.
    async fetchTask(filters = {}, pagination = {}, strict = true)
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

            if(filters.command !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"command" = $${paramIndex}`);
                    params.push(filters.command);
                }
                else
                {
                    conditions.push(`"command" ILIKE $${paramIndex}`);
                    params.push(`%${filters.command}%`);
                }

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

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.statusCode !== undefined)
            {
                conditions.push(`"statusCode" = $${paramIndex}`);
                params.push(filters.statusCode);
                paramIndex++;
            }

            if(filters.success !== undefined)
            {
                conditions.push(`"success" = $${paramIndex}`);
                params.push(filters.success);
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
            const countQuery  = `SELECT COUNT(*) FROM wira_task ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_task ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_task ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Tasks fetched successfully.",
                data:
                {
                    tasks: result.rows,
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
            console.error("Error occured in fetchTask at WiraTaskDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching tasks.",
                data: null
            };
        }
    }

    //UPDATES TASKS MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async updateTask(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.command !== undefined)
            {
                setClauses.push(`"command" = $${paramIndex}`);
                params.push(data.command);
                paramIndex++;
            }

            if(data.label !== undefined)
            {
                setClauses.push(`"label" = $${paramIndex}`);
                params.push(data.label);
                paramIndex++;
            }

            if(data.instructionData !== undefined)
            {
                setClauses.push(`"instructionData" = $${paramIndex}`);
                params.push(data.instructionData ? JSON.stringify(data.instructionData) : null);
                paramIndex++;
            }

            if(data.status !== undefined)
            {
                setClauses.push(`"status" = $${paramIndex}`);
                params.push(data.status);
                paramIndex++;
            }

            if(data.statusCode !== undefined)
            {
                setClauses.push(`"statusCode" = $${paramIndex}`);
                params.push(data.statusCode);
                paramIndex++;
            }

            if(data.success !== undefined)
            {
                setClauses.push(`"success" = $${paramIndex}`);
                params.push(data.success);
                paramIndex++;
            }

            if(data.message !== undefined)
            {
                setClauses.push(`"message" = $${paramIndex}`);
                params.push(data.message);
                paramIndex++;
            }

            if(data.cost !== undefined)
            {
                setClauses.push(`"cost" = $${paramIndex}`);
                params.push(data.cost ? JSON.stringify(data.cost) : null);
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

            if(filters.command !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"command" = $${paramIndex}`);
                    params.push(filters.command);
                }
                else
                {
                    conditions.push(`"command" ILIKE $${paramIndex}`);
                    params.push(`%${filters.command}%`);
                }

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

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.statusCode !== undefined)
            {
                conditions.push(`"statusCode" = $${paramIndex}`);
                params.push(filters.statusCode);
                paramIndex++;
            }

            if(filters.success !== undefined)
            {
                conditions.push(`"success" = $${paramIndex}`);
                params.push(filters.success);
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
            const query  = `UPDATE wira_task SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Tasks updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    tasks: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateTask at WiraTaskDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating tasks.",
                data: null
            };
        }
    }

    //DELETES TASKS MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async deleteTask(data = {}, filters = {}, strict = true)
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

            if(filters.command !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"command" = $${paramIndex}`);
                    params.push(filters.command);
                }
                else
                {
                    conditions.push(`"command" ILIKE $${paramIndex}`);
                    params.push(`%${filters.command}%`);
                }

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

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.statusCode !== undefined)
            {
                conditions.push(`"statusCode" = $${paramIndex}`);
                params.push(filters.statusCode);
                paramIndex++;
            }

            if(filters.success !== undefined)
            {
                conditions.push(`"success" = $${paramIndex}`);
                params.push(filters.success);
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
                "instructionData",
                "statusCode",
                "success",
                "message",
                "cost",
                "platform",
                "finishedAt"
            ];

            const colsToNull = nullableCols.filter(col => data[col] === true);
            if(colsToNull.length > 0)
            {
                //NULLIFY THE REQUESTED COLUMNS INSTEAD OF DELETING
                const setClauses = colsToNull.map((col) =>
                    {
                        const clause = `"${col}" = NULL`;
                        return clause;
                    }
                );

                const query  = `UPDATE wira_task SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Task columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        tasks: result.rows
                    }
                };
            }

            //NO DATA FIELDS — DELETE THE ROWS
            const query  = `DELETE FROM wira_task ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Tasks deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    tasks: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteTask at WiraTaskDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting tasks.",
                data: null
            };
        }
    }

    //CREATES A NEW TASK. ONLY COMMAND IS REQUIRED, ALL OTHER FIELDS ARE OPTIONAL.
    async createTask(data = {})
    {
        try
        {
            if(!data.command)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "Command is required.",
                    data: null
                };
            }

            const query = `
                INSERT INTO wira_task
                (
                    "command",
                    "label",
                    "instructionData",
                    "status",
                    "statusCode",
                    "success",
                    "message",
                    "cost",
                    "platform"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
            `;

            const params =
            [
                data.command,
                data.label ?? null,
                data.instructionData ? JSON.stringify(data.instructionData) : null,
                data.status ?? "pending",
                data.statusCode ?? null,
                data.success ?? null,
                data.message ?? null,
                data.cost ? JSON.stringify(data.cost) : null,
                data.platform ?? null
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Task created successfully.",
                data:
                {
                    task: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createTask at WiraTaskDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating task.",
                data: null
            };
        }
    }

    //FETCHES TASKS FOR A CANDIDATE. FIRST RESOLVES THE CANDIDATE FROM candidateFilters, THEN FETCHES THEIR INSTRUCTIONS, THEN FETCHES TASKS MATCHING filters. RETURNS BOTH A STRUCTURED CANDIDATE OBJECT WITH INSTRUCTIONS AND TASKS, AND A FLAT TASKS ARRAY.
    async fetchTasksFromCandidate(candidateFilters = {}, filters = {}, pagination = {}, strict = true)
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

            //STEP 2 — FETCH ALL INSTRUCTIONS FOR THIS CANDIDATE
            const instructionsQuery = `SELECT * FROM wira_instruction WHERE "wiraCandidateId" = $1 ORDER BY "createdAt" DESC`;
            const instructionsResult = await this.db.query(instructionsQuery, [candidate.id]);

            if(instructionsResult.rows.length === 0)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "No instructions found for candidate.",
                    data:
                    {
                        candidate:
                        {
                            ...candidate,
                            instructions: []
                        },
                        tasks: [],
                        pagination: 
                        { 
                            total: 0 
                        }
                    }
                };
            }

            const instructions = instructionsResult.rows;

            //STEP 3 — EXTRACT ALL TASK IDS FROM iterationData ACROSS ALL INSTRUCTIONS
            const allTaskIds = [];
            instructions.forEach((instruction) =>
                {
                    if(instruction.iterationData && Array.isArray(instruction.iterationData))
                    {
                        instruction.iterationData.forEach(iteration =>
                            {
                                if(iteration.taskIds && Array.isArray(iteration.taskIds))
                                {
                                    allTaskIds.push(...iteration.taskIds);
                                }
                            }
                        );
                    }
                }
            );

            if(allTaskIds.length === 0)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "No tasks found for candidate.",
                    data:
                    {
                        candidate:
                        {
                            ...candidate,
                            instructions: []
                        },
                        tasks: [],
                        pagination: 
                        { 
                            total: 0 
                        }
                    }
                };
            }

            //STEP 4 — BUILD TASK QUERY WITH FILTERS
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            const conditions = [`"id" = ANY($1)`];
            const params = [allTaskIds];
            let paramIndex = 2;

            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.command !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"command" = $${paramIndex}`);
                    params.push(filters.command);
                }
                else
                {
                    conditions.push(`"command" ILIKE $${paramIndex}`);
                    params.push(`%${filters.command}%`);
                }

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

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.statusCode !== undefined)
            {
                conditions.push(`"statusCode" = $${paramIndex}`);
                params.push(filters.statusCode);
                paramIndex++;
            }

            if(filters.success !== undefined)
            {
                conditions.push(`"success" = $${paramIndex}`);
                params.push(filters.success);
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
            const countQuery = `SELECT COUNT(*) FROM wira_task ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_task ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_task ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const tasksResult = await this.db.query(dataQuery, params);
            const tasks = tasksResult.rows;
            const taskMap = new Map(tasks.map((task) => 
                { 
                    return [String(task.id), task];
                }
            ));

            const instructionsWithTasks = instructions.map((instruction) =>
                {
                    const instructionTaskIds = [];
                    if(instruction.iterationData && Array.isArray(instruction.iterationData))
                    {
                        instruction.iterationData.forEach((iteration) =>
                            {
                                if(iteration.taskIds && Array.isArray(iteration.taskIds))
                                {
                                    instructionTaskIds.push(...iteration.taskIds);
                                }
                            }
                        );
                    }

                    const instructionTasks = instructionTaskIds.map((id) => { return taskMap.get(String(id)); }).filter(Boolean);
                    if(instructionTasks.length === 0)
                    {
                        return null;
                    }

                    return {
                        ...instruction,
                        tasks: instructionTasks
                    };
                }
            )
            .filter(Boolean);

            return {
                statusCode: 200,
                success: true,
                message: "Candidate tasks fetched successfully.",
                data:
                {
                    candidate:
                    {
                        ...candidate,
                        instructions: instructionsWithTasks
                    },
                    tasks: tasks,
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
            console.error("Error occured in fetchTasksFromCandidate at WiraTaskDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching candidate tasks.",
                data: null
            };
        }
    }

    //FETCHES TASKS FOR INSTRUCTIONS MATCHING instructionFilters, THEN FILTERS TASKS BY filters. RETURNS INSTRUCTION+TASK TREE AND FLAT TASK LIST.
    async fetchTasksFromInstructions(instructionFilters = {}, filters = {}, pagination = {}, strict = true)
    {
        try
        {
            //STEP 1 — RESOLVE INSTRUCTIONS FROM instructionFilters
            const instructionConditions = [];
            const instructionParams = [];
            let paramIndex = 1;

            if(instructionFilters.ids && instructionFilters.ids.length > 0)
            {
                instructionConditions.push(`"id" = ANY($${paramIndex})`);
                instructionParams.push(instructionFilters.ids);
                paramIndex++;
            }

            if(instructionFilters.wiraCandidateId !== undefined)
            {
                instructionConditions.push(`"wiraCandidateId" = $${paramIndex}`);
                instructionParams.push(instructionFilters.wiraCandidateId);
                paramIndex++;
            }

            if(instructionFilters.label !== undefined)
            {
                if(strict)
                {
                    instructionConditions.push(`"label" = $${paramIndex}`);
                    instructionParams.push(instructionFilters.label);
                }
                else
                {
                    instructionConditions.push(`"label" ILIKE $${paramIndex}`);
                    instructionParams.push(`%${instructionFilters.label}%`);
                }

                paramIndex++;
            }

            if(instructionFilters.description !== undefined)
            {
                if(strict)
                {
                    instructionConditions.push(`"description" = $${paramIndex}`);
                    instructionParams.push(instructionFilters.description);
                }
                else
                {
                    instructionConditions.push(`"description" ILIKE $${paramIndex}`);
                    instructionParams.push(`%${instructionFilters.description}%`);
                }

                paramIndex++;
            }

            if(instructionFilters.status !== undefined)
            {   
                instructionConditions.push(`"status" = $${paramIndex}`);
                instructionParams.push(instructionFilters.status);
                paramIndex++;
            }

            if(instructionFilters.behaviour !== undefined)
            {
                instructionConditions.push(`"behaviour" = $${paramIndex}`);
                instructionParams.push(instructionFilters.behaviour);
                paramIndex++;
            }

            if(instructionFilters.platform !== undefined)
            {
                instructionConditions.push(`"platform" = $${paramIndex}`);
                instructionParams.push(instructionFilters.platform);
                paramIndex++;
            }

            if(instructionFilters.createdAtStart !== undefined)
            {
                instructionConditions.push(`"createdAt" >= $${paramIndex}`);
                instructionParams.push(instructionFilters.createdAtStart);
                paramIndex++;
            }

            if(instructionFilters.createdAtEnd !== undefined)
            {
                instructionConditions.push(`"createdAt" <= $${paramIndex}`);
                instructionParams.push(instructionFilters.createdAtEnd);
                paramIndex++;
            }

            if(instructionFilters.finishedAtStart !== undefined)
            {
                instructionConditions.push(`"finishedAt" >= $${paramIndex}`);
                instructionParams.push(instructionFilters.finishedAtStart);
                paramIndex++;
            }

            if(instructionFilters.finishedAtEnd !== undefined)
            {
                instructionConditions.push(`"finishedAt" <= $${paramIndex}`);
                instructionParams.push(instructionFilters.finishedAtEnd);
                paramIndex++;
            }

            const instructionWhere = instructionConditions.length > 0 ? `WHERE ${instructionConditions.join(" AND ")}` : "";
            const instructionResult = await this.db.query(
                `SELECT * FROM wira_instruction ${instructionWhere} ORDER BY "createdAt" DESC`,
                instructionParams
            );

            if(instructionResult.rows.length === 0)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "No instructions found.",
                    data:
                    {
                        instructions: [],
                        tasks: [],
                        pagination: 
                        { 
                            total: 0 
                        }
                    }
                };
            }

            //STEP 2 — EXTRACT ALL TASK IDS FROM iterationData ACROSS MATCHING INSTRUCTIONS
            const allTaskIds = [];
            instructionResult.rows.forEach((instruction) =>
                {
                    if(instruction.iterationData && Array.isArray(instruction.iterationData))
                    {
                        instruction.iterationData.forEach((iteration) =>
                            {
                                if(iteration.taskIds && Array.isArray(iteration.taskIds))
                                {
                                    allTaskIds.push(...iteration.taskIds);
                                }
                            }
                        );
                    }
                }
            );

            if(allTaskIds.length === 0)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "No tasks found for matching instructions.",
                    data:
                    {
                        instructions: instructionResult.rows.map((i) => ({ ...i, tasks: [] })),
                        tasks: [],
                        pagination: 
                        { 
                            total: 0 
                        }
                    }
                };
            }

            //STEP 3 — BUILD TASK QUERY WITH FILTERS
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            const taskConditions = [`"id" = ANY($1)`];
            const taskParams = [allTaskIds];
            let taskParamIndex = 2;

            if(filters.ids && filters.ids.length > 0)
            {
                taskConditions.push(`"id" = ANY($${taskParamIndex})`);
                taskParams.push(filters.ids);
                taskParamIndex++;
            }

            if(filters.command !== undefined)
            {
                if(strict)
                {
                    taskConditions.push(`"command" = $${taskParamIndex}`);
                    taskParams.push(filters.command);
                }
                else
                {
                    taskConditions.push(`"command" ILIKE $${taskParamIndex}`);
                    taskParams.push(`%${filters.command}%`);
                }

                taskParamIndex++;
            }

            if(filters.label !== undefined)
            {
                if(strict)
                {
                    taskConditions.push(`"label" = $${taskParamIndex}`);
                    taskParams.push(filters.label);
                }
                else
                {
                    taskConditions.push(`"label" ILIKE $${taskParamIndex}`);
                    taskParams.push(`%${filters.label}%`);
                }

                taskParamIndex++;
            }

            if(filters.status !== undefined)
            {
                taskConditions.push(`"status" = $${taskParamIndex}`);
                taskParams.push(filters.status);
                taskParamIndex++;
            }

            if(filters.statusCode !== undefined)
            {
                taskConditions.push(`"statusCode" = $${taskParamIndex}`);
                taskParams.push(filters.statusCode);
                taskParamIndex++;
            }

            if(filters.success !== undefined)
            {
                taskConditions.push(`"success" = $${taskParamIndex}`);
                taskParams.push(filters.success);
                taskParamIndex++;
            }

            if(filters.message !== undefined)
            {
                if(strict)
                {
                    taskConditions.push(`"message" = $${taskParamIndex}`);
                    taskParams.push(filters.message);
                }
                else
                {
                    taskConditions.push(`"message" ILIKE $${taskParamIndex}`);
                    taskParams.push(`%${filters.message}%`);
                }

                taskParamIndex++;
            }

            if(filters.cost !== undefined)
            {
                if(filters.cost)
                {
                    taskConditions.push(`"cost" IS NOT NULL`);
                }
                else
                {
                    taskConditions.push(`"cost" IS NULL`);
                }
            }

            if(filters.platform !== undefined)
            {
                taskConditions.push(`"platform" = $${taskParamIndex}`);
                taskParams.push(filters.platform);
                taskParamIndex++;
            }

            if(filters.createdAtStart !== undefined)
            {
                taskConditions.push(`"createdAt" >= $${taskParamIndex}`);
                taskParams.push(filters.createdAtStart);
                taskParamIndex++;
            }

            if(filters.createdAtEnd !== undefined)
            {
                taskConditions.push(`"createdAt" <= $${taskParamIndex}`);
                taskParams.push(filters.createdAtEnd);
                taskParamIndex++;
            }

            if(filters.updatedAtStart !== undefined)
            {
                taskConditions.push(`"updatedAt" >= $${taskParamIndex}`);
                taskParams.push(filters.updatedAtStart);
                taskParamIndex++;
            }

            if(filters.updatedAtEnd !== undefined)
            {
                taskConditions.push(`"updatedAt" <= $${taskParamIndex}`);
                taskParams.push(filters.updatedAtEnd);
                taskParamIndex++;
            }

            if(filters.finishedAtStart !== undefined)
            {
                taskConditions.push(`"finishedAt" >= $${taskParamIndex}`);
                taskParams.push(filters.finishedAtStart);
                taskParamIndex++;
            }

            if(filters.finishedAtEnd !== undefined)
            {
                taskConditions.push(`"finishedAt" <= $${taskParamIndex}`);
                taskParams.push(filters.finishedAtEnd);
                taskParamIndex++;
            }

            const taskWhere = `WHERE ${taskConditions.join(" AND ")}`;
            const countResult = await this.db.query(
                `SELECT COUNT(*) FROM wira_task ${taskWhere}`,
                taskParams
            );

            const total = parseInt(countResult.rows[0].count);

            let taskQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;
                taskParams.push(perPage);
                taskParams.push(offset);
                taskQuery = `SELECT * FROM wira_task ${taskWhere} ORDER BY "createdAt" DESC LIMIT $${taskParamIndex} OFFSET $${taskParamIndex + 1}`;
            }
            else
            {
                taskQuery = `SELECT * FROM wira_task ${taskWhere} ORDER BY "createdAt" DESC`;
            }

            const taskResult = await this.db.query(taskQuery, taskParams);
            const tasks = taskResult.rows;

            //STEP 4 — BUILD INSTRUCTION+TASK TREE, ONLY INCLUDE INSTRUCTIONS THAT HAVE MATCHING TASKS
            const taskMap = new Map(tasks.map((task) => [String(task.id), task]));
            const instructionsWithTasks = instructionResult.rows
                .map((instruction) =>
                    {
                        const instructionTaskIds = [];
                        if(instruction.iterationData && Array.isArray(instruction.iterationData))
                        {
                            instruction.iterationData.forEach((iteration) =>
                                {
                                    if(iteration.taskIds && Array.isArray(iteration.taskIds))
                                    {
                                        instructionTaskIds.push(...iteration.taskIds);
                                    }
                                }
                            );
                        }

                        const instructionTasks = instructionTaskIds
                            .map((id) => taskMap.get(String(id)))
                            .filter(Boolean);

                        if(instructionTasks.length === 0)
                        {
                            return null;
                        }

                        return {
                            ...instruction,
                            tasks: instructionTasks
                        };
                    }
                )
                .filter(Boolean);

            return {
                statusCode: 200,
                success: true,
                message: "Tasks fetched successfully.",
                data:
                {
                    instructions: instructionsWithTasks,
                    tasks: tasks,
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
            console.error("Error occured in fetchTasksFromInstructions at WiraTaskDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching tasks for instruction.",
                data: null
            };
        }
    }
}

module.exports = WiraTaskDB;