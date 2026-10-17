const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_queue
================================================================================

Flexible queue for all scheduled and deferred tasks. Covers user-requested
reminders triggered via AI and system-initiated background tasks. queueName
identifies the task type. setBy distinguishes who created the entry. pg_cron
fires a notification every minute for due items, and a daily cleanup marks
pending items older than 24h as failed.

updatedAt is maintained by the set_updated_at() trigger — never set manually.

+----------------+--------------+--------------------------------------------+
| Column         | Type         | Constraints                                |
+----------------+--------------+--------------------------------------------+
| id             | BIGSERIAL    | Primary Key                                |
| queueName      | VARCHAR(255) | NOT NULL                                   |
| promptName     | VARCHAR(255) | nullable                                   |
| triggerAt      | TIMESTAMPTZ  | NOT NULL                                   |
| data           | JSONB        | NOT NULL                                   |
| platform       | VARCHAR(20)  | nullable, CHECK IN (App, Web, Whatsapp, Call)|
| setBy          | VARCHAR(20)  | NOT NULL, CHECK IN (system, assistant, server)|
| referenceTable | VARCHAR(255) | nullable                                   |
| referenceId    | BIGINT       | nullable                                   |
| executed       | BOOLEAN      | NOT NULL, DEFAULT false                    |
| status         | VARCHAR(20)  | NOT NULL, DEFAULT pending                  |
|                |              | CHECK IN (pending, success, failed)        |
| message        | TEXT         | nullable                                   |
| promptCosts    | JSONB        | nullable                                   |
| createdAt      | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                    |
| updatedAt      | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                    |
+----------------+--------------+--------------------------------------------+

Notification channels: wira_queue_changes (data and promptCosts excluded from
payload), wira_queue_due (pg_cron, every minute, { ids: [...] })

--- SQL ---

CREATE TABLE wira_queue
(
    "id"                BIGSERIAL    PRIMARY KEY,
    "queueName"         VARCHAR(255) NOT NULL,
    "promptName"        VARCHAR(255),
    "triggerAt"         TIMESTAMPTZ  NOT NULL,
    "data"              JSONB        NOT NULL,
    "platform"          VARCHAR(20)  CHECK ("platform" IN ('App', 'Web', 'Whatsapp', 'Call')),
    "setBy"             VARCHAR(20)  NOT NULL CHECK ("setBy" IN ('system', 'assistant', 'server')),
    "referenceTable"    VARCHAR(255),
    "referenceId"       BIGINT,
    "executed"          BOOLEAN      NOT NULL DEFAULT FALSE,
    "status"            VARCHAR(20)  NOT NULL DEFAULT 'pending'
                            CHECK ("status" IN ('pending', 'success', 'failed')),
    "message"           TEXT,
    "promptCosts"       JSONB,
    "createdAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_wiraQueue_pending_triggerAt" ON wira_queue("triggerAt") WHERE "executed" = FALSE AND "status" = 'pending';
CREATE INDEX "idx_wiraQueue_queueName"         ON wira_queue("queueName");
CREATE INDEX "idx_wiraQueue_queueName_status"  ON wira_queue("queueName", "status");
CREATE INDEX "idx_wiraQueue_promptName"        ON wira_queue("promptName") WHERE "promptName" IS NOT NULL;
CREATE INDEX "idx_wiraQueue_executed"          ON wira_queue("executed");
CREATE INDEX "idx_wiraQueue_status"            ON wira_queue("status");
CREATE INDEX "idx_wiraQueue_setBy"             ON wira_queue("setBy");
CREATE INDEX "idx_wiraQueue_platform"          ON wira_queue("platform")       WHERE "platform"       IS NOT NULL;
CREATE INDEX "idx_wiraQueue_referenceTable"    ON wira_queue("referenceTable") WHERE "referenceTable" IS NOT NULL;
CREATE INDEX "idx_wiraQueue_refTable_refId"    ON wira_queue("referenceTable", "referenceId") WHERE "referenceTable" IS NOT NULL;
CREATE INDEX "idx_wiraQueue_triggerAt"         ON wira_queue("triggerAt");
CREATE INDEX "idx_wiraQueue_createdAt"         ON wira_queue("createdAt" DESC);
CREATE INDEX "idx_wiraQueue_updatedAt"         ON wira_queue("updatedAt" DESC);

CREATE OR REPLACE FUNCTION notify_wira_queue_changes()
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

    row_data := row_data - 'data' - 'promptCosts';

    payload := jsonb_build_object('operation', TG_OP, 'table', TG_TABLE_NAME, 'data', row_data);
    PERFORM pg_notify('wira_queue_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_queue_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_queue
FOR EACH ROW EXECUTE FUNCTION notify_wira_queue_changes();

CREATE OR REPLACE TRIGGER trg_wira_queue_updated_at
BEFORE UPDATE ON wira_queue
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- pg_cron: every minute, find pending due items and fire a single notification
SELECT cron.schedule(
    'wira-queue-poll',
    '* * * * *',
    $cron$
        DO $block$
        DECLARE
            due_ids BIGINT[];
        BEGIN
            SELECT ARRAY_AGG(id)
            INTO due_ids
            FROM wira_queue
            WHERE executed  = FALSE
              AND status    = 'pending'
              AND "triggerAt" <= NOW();

            IF due_ids IS NOT NULL THEN
                PERFORM pg_notify(
                    'wira_queue_due',
                    jsonb_build_object('ids', to_jsonb(due_ids))::TEXT
                );
            END IF;
        END;
        $block$ LANGUAGE plpgsql;
    $cron$
);

-- pg_cron: daily at 02:00 UTC — mark stale queue items as failed
SELECT cron.schedule(
    'wira-queue-stale-cleanup',
    '0 2 * * *',
    $$
        UPDATE wira_queue
        SET
            "status"    = 'failed',
            "message"   = 'Marked failed by stale cleanup — triggerAt exceeded 24h threshold',
            "updatedAt" = NOW()
        WHERE executed    = FALSE
          AND status      = 'pending'
          AND "triggerAt" < NOW() - INTERVAL '24 hours';
    $$
);
*/

class WiraQueueDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES A QUEUE ENTRY BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchQueueById(id)
    {
        try
        {
            const query = `SELECT * FROM wira_queue WHERE "id" = $1`;
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
                    message: "Queue not found.",
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
                message: "Queue fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchQueueById at WiraQueueDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching queue.",
                data: null
            };
        }
    }

    //FETCHES ALL QUEUE ENTRIES THAT ARE DUE — NOT EXECUTED, STATUS pending, AND triggerAt <= NOW(). ORDERED BY triggerAt ASC SO THE OLDEST DUE ENTRY RUNS FIRST.
    async fetchPendingQueues()
    {
        try
        {
            const query = `SELECT * FROM wira_queue WHERE "executed" = FALSE AND "status" = 'pending' AND "triggerAt" <= NOW() ORDER BY "triggerAt" ASC`;
            const result = await this.db.query(query);

            return {
                statusCode: 200,
                success: true,
                message: "Pending queues fetched successfully.",
                data:
                {
                    queues: result.rows,
                    total: result.rows.length
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchPendingQueues at WiraQueueDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching pending queues.",
                data: null
            };
        }
    }

    //FETCHES QUEUE ENTRIES USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. IF filters.executed IS false AND filters.status IS pending, ORDERS BY triggerAt ASC, OTHERWISE BY createdAt DESC. SUPPORTS OPTIONAL PAGINATION.
    async fetchQueue(filters = {}, pagination = {}, strict = true)
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

            if(filters.queueName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"queueName" = $${paramIndex}`);
                    params.push(filters.queueName);
                }
                else
                {
                    conditions.push(`"queueName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.queueName}%`);
                }

                paramIndex++;
            }

            if(filters.promptName !== undefined)
            {
                if(typeof filters.promptName === "boolean")
                {
                    if(filters.promptName)
                    {
                        conditions.push(`"promptName" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"promptName" IS NULL`);
                    }
                }
                else
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
            }

            if(filters.platform !== undefined)
            {
                if(typeof filters.platform === "boolean")
                {
                    if(filters.platform)
                    {
                        conditions.push(`"platform" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"platform" IS NULL`);
                    }
                }
                else
                {
                    conditions.push(`"platform" = $${paramIndex}`);
                    params.push(filters.platform);
                    paramIndex++;
                }
            }

            if(filters.setBy !== undefined)
            {
                conditions.push(`"setBy" = $${paramIndex}`);
                params.push(filters.setBy);
                paramIndex++;
            }

            if(filters.referenceTable !== undefined)
            {
                if(typeof filters.referenceTable === "boolean")
                {
                    if(filters.referenceTable)
                    {
                        conditions.push(`"referenceTable" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"referenceTable" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"referenceTable" = $${paramIndex}`);
                        params.push(filters.referenceTable);
                    }
                    else
                    {
                        conditions.push(`"referenceTable" ILIKE $${paramIndex}`);
                        params.push(`%${filters.referenceTable}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.referenceId !== undefined)
            {
                if(typeof filters.referenceId === "boolean")
                {
                    if(filters.referenceId)
                    {
                        conditions.push(`"referenceId" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"referenceId" IS NULL`);
                    }
                }
                else
                {
                    conditions.push(`"referenceId" = $${paramIndex}`);
                    params.push(filters.referenceId);
                    paramIndex++;
                }
            }

            if(filters.executed !== undefined)
            {
                conditions.push(`"executed" = $${paramIndex}`);
                params.push(filters.executed);
                paramIndex++;
            }

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.message !== undefined)
            {
                if(typeof filters.message === "boolean")
                {
                    if(filters.message)
                    {
                        conditions.push(`"message" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"message" IS NULL`);
                    }
                }
                else
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
            }

            if(filters.data !== undefined)
            {
                conditions.push(`"data" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.data));
                paramIndex++;
            }

            if(filters.promptCosts !== undefined)
            {
                if(filters.promptCosts)
                {
                    conditions.push(`"promptCosts" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"promptCosts" IS NULL`);
                }
            }

            if(filters.triggerAtStart !== undefined)
            {
                conditions.push(`"triggerAt" >= $${paramIndex}`);
                params.push(filters.triggerAtStart);
                paramIndex++;
            }

            if(filters.triggerAtEnd !== undefined)
            {
                conditions.push(`"triggerAt" <= $${paramIndex}`);
                params.push(filters.triggerAtEnd);
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

            //PENDING EXECUTION QUEUES ARE ORDERED BY triggerAt ASC, EVERYTHING ELSE BY createdAt DESC
            const isPendingExecution = filters.executed === false && filters.status === "pending";
            const orderBy = isPendingExecution ? `"triggerAt" ASC` : `"createdAt" DESC`;

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const countQuery = `SELECT COUNT(*) FROM wira_queue ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM wira_queue ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM wira_queue ${whereClause} ORDER BY ${orderBy}`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Queues fetched successfully.",
                data:
                {
                    queues: result.rows,
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
            console.error("Error occured in fetchQueue at WiraQueueDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching queues.",
                data: null
            };
        }
    }

    //CREATES A QUEUE ENTRY. queueName, triggerAt, data AND setBy ARE REQUIRED. executed DEFAULTS TO false AND status TO pending. data AND promptCosts ARE STORED AS JSONB.
    async createQueue(data = {})
    {
        try
        {
            if(!data.queueName)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "queueName is required.",
                    data: null
                };
            }

            if(!data.triggerAt)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "triggerAt is required.",
                    data: null
                };
            }

            if(!data.data)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "data is required.",
                    data: null
                };
            }

            if(!data.setBy)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "setBy is required.",
                    data: null
                };
            }

            const query = `
                INSERT INTO wira_queue
                (
                    "queueName",
                    "promptName",
                    "triggerAt",
                    "data",
                    "platform",
                    "setBy",
                    "referenceTable",
                    "referenceId",
                    "executed",
                    "status",
                    "message",
                    "promptCosts"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *
            `;

            const params =
            [
                data.queueName,
                data.promptName ?? null,
                data.triggerAt,
                JSON.stringify(data.data),
                data.platform ?? null,
                data.setBy,
                data.referenceTable ?? null,
                data.referenceId ?? null,
                data.executed ?? false,
                data.status ?? "pending",
                data.message ?? null,
                data.promptCosts ? JSON.stringify(data.promptCosts) : null
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Queue created successfully.",
                data:
                {
                    queue: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createQueue at WiraQueueDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating queue.",
                data: null
            };
        }
    }

    //UPDATES QUEUE ENTRIES MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. data AND promptCosts ARE STORED AS JSONB.
    async updateQueue(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.queueName !== undefined)
            {
                setClauses.push(`"queueName" = $${paramIndex}`);
                params.push(data.queueName);
                paramIndex++;
            }

            if(data.promptName !== undefined)
            {
                setClauses.push(`"promptName" = $${paramIndex}`);
                params.push(data.promptName);
                paramIndex++;
            }

            if(data.triggerAt !== undefined)
            {
                setClauses.push(`"triggerAt" = $${paramIndex}`);
                params.push(data.triggerAt);
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

            if(data.setBy !== undefined)
            {
                setClauses.push(`"setBy" = $${paramIndex}`);
                params.push(data.setBy);
                paramIndex++;
            }

            if(data.referenceTable !== undefined)
            {
                setClauses.push(`"referenceTable" = $${paramIndex}`);
                params.push(data.referenceTable);
                paramIndex++;
            }

            if(data.referenceId !== undefined)
            {
                setClauses.push(`"referenceId" = $${paramIndex}`);
                params.push(data.referenceId);
                paramIndex++;
            }

            if(data.executed !== undefined)
            {
                setClauses.push(`"executed" = $${paramIndex}`);
                params.push(data.executed);
                paramIndex++;
            }

            if(data.status !== undefined)
            {
                setClauses.push(`"status" = $${paramIndex}`);
                params.push(data.status);
                paramIndex++;
            }

            if(data.message !== undefined)
            {
                setClauses.push(`"message" = $${paramIndex}`);
                params.push(data.message);
                paramIndex++;
            }

            if(data.promptCosts !== undefined)
            {
                setClauses.push(`"promptCosts" = $${paramIndex}`);
                params.push(data.promptCosts ? JSON.stringify(data.promptCosts) : null);
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

            if(filters.queueName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"queueName" = $${paramIndex}`);
                    params.push(filters.queueName);
                }
                else
                {
                    conditions.push(`"queueName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.queueName}%`);
                }

                paramIndex++;
            }

            if(filters.promptName !== undefined)
            {
                if(typeof filters.promptName === "boolean")
                {
                    if(filters.promptName)
                    {
                        conditions.push(`"promptName" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"promptName" IS NULL`);
                    }
                }
                else
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
            }

            if(filters.platform !== undefined)
            {
                if(typeof filters.platform === "boolean")
                {
                    if(filters.platform)
                    {
                        conditions.push(`"platform" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"platform" IS NULL`);
                    }
                }
                else
                {
                    conditions.push(`"platform" = $${paramIndex}`);
                    params.push(filters.platform);
                    paramIndex++;
                }
            }

            if(filters.setBy !== undefined)
            {
                conditions.push(`"setBy" = $${paramIndex}`);
                params.push(filters.setBy);
                paramIndex++;
            }

            if(filters.referenceTable !== undefined)
            {
                if(typeof filters.referenceTable === "boolean")
                {
                    if(filters.referenceTable)
                    {
                        conditions.push(`"referenceTable" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"referenceTable" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"referenceTable" = $${paramIndex}`);
                        params.push(filters.referenceTable);
                    }
                    else
                    {
                        conditions.push(`"referenceTable" ILIKE $${paramIndex}`);
                        params.push(`%${filters.referenceTable}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.referenceId !== undefined)
            {
                if(typeof filters.referenceId === "boolean")
                {
                    if(filters.referenceId)
                    {
                        conditions.push(`"referenceId" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"referenceId" IS NULL`);
                    }
                }
                else
                {
                    conditions.push(`"referenceId" = $${paramIndex}`);
                    params.push(filters.referenceId);
                    paramIndex++;
                }
            }

            if(filters.executed !== undefined)
            {
                conditions.push(`"executed" = $${paramIndex}`);
                params.push(filters.executed);
                paramIndex++;
            }

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.message !== undefined)
            {
                if(typeof filters.message === "boolean")
                {
                    if(filters.message)
                    {
                        conditions.push(`"message" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"message" IS NULL`);
                    }
                }
                else
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
            }

            if(filters.data !== undefined)
            {
                conditions.push(`"data" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.data));
                paramIndex++;
            }

            if(filters.promptCosts !== undefined)
            {
                if(filters.promptCosts)
                {
                    conditions.push(`"promptCosts" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"promptCosts" IS NULL`);
                }
            }

            if(filters.triggerAtStart !== undefined)
            {
                conditions.push(`"triggerAt" >= $${paramIndex}`);
                params.push(filters.triggerAtStart);
                paramIndex++;
            }

            if(filters.triggerAtEnd !== undefined)
            {
                conditions.push(`"triggerAt" <= $${paramIndex}`);
                params.push(filters.triggerAtEnd);
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
            const query = `UPDATE wira_queue SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Queues updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    queues: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateQueue at WiraQueueDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating queues.",
                data: null
            };
        }
    }

    //MARKS A QUEUE ENTRY AS EXECUTED WITH THE GIVEN status (success OR failed) AND message. RETURNS 404 IF NOT FOUND.
    async markQueueDone(id, status, message = null)
    {
        try
        {
            const query = `UPDATE wira_queue SET "executed" = TRUE, "status" = $1, "message" = $2 WHERE "id" = $3 RETURNING *`;
            const params =
            [
                status,
                message,
                id
            ];

            const result = await this.db.query(query, params);
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: true,
                    message: "Queue not found.",
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
                message: "Queue marked done successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in markQueueDone at WiraQueueDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured marking queue done.",
                data: null
            };
        }
    }

    //DELETES QUEUE ENTRIES MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async deleteQueue(data = {}, filters = {}, strict = true)
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

            if(filters.queueName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"queueName" = $${paramIndex}`);
                    params.push(filters.queueName);
                }
                else
                {
                    conditions.push(`"queueName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.queueName}%`);
                }

                paramIndex++;
            }

            if(filters.promptName !== undefined)
            {
                if(typeof filters.promptName === "boolean")
                {
                    if(filters.promptName)
                    {
                        conditions.push(`"promptName" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"promptName" IS NULL`);
                    }
                }
                else
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
            }

            if(filters.platform !== undefined)
            {
                if(typeof filters.platform === "boolean")
                {
                    if(filters.platform)
                    {
                        conditions.push(`"platform" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"platform" IS NULL`);
                    }
                }
                else
                {
                    conditions.push(`"platform" = $${paramIndex}`);
                    params.push(filters.platform);
                    paramIndex++;
                }
            }

            if(filters.setBy !== undefined)
            {
                conditions.push(`"setBy" = $${paramIndex}`);
                params.push(filters.setBy);
                paramIndex++;
            }

            if(filters.referenceTable !== undefined)
            {
                if(typeof filters.referenceTable === "boolean")
                {
                    if(filters.referenceTable)
                    {
                        conditions.push(`"referenceTable" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"referenceTable" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"referenceTable" = $${paramIndex}`);
                        params.push(filters.referenceTable);
                    }
                    else
                    {
                        conditions.push(`"referenceTable" ILIKE $${paramIndex}`);
                        params.push(`%${filters.referenceTable}%`);
                    }

                    paramIndex++;
                }
            }

            if(filters.referenceId !== undefined)
            {
                if(typeof filters.referenceId === "boolean")
                {
                    if(filters.referenceId)
                    {
                        conditions.push(`"referenceId" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"referenceId" IS NULL`);
                    }
                }
                else
                {
                    conditions.push(`"referenceId" = $${paramIndex}`);
                    params.push(filters.referenceId);
                    paramIndex++;
                }
            }

            if(filters.executed !== undefined)
            {
                conditions.push(`"executed" = $${paramIndex}`);
                params.push(filters.executed);
                paramIndex++;
            }

            if(filters.status !== undefined)
            {
                conditions.push(`"status" = $${paramIndex}`);
                params.push(filters.status);
                paramIndex++;
            }

            if(filters.message !== undefined)
            {
                if(typeof filters.message === "boolean")
                {
                    if(filters.message)
                    {
                        conditions.push(`"message" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"message" IS NULL`);
                    }
                }
                else
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
            }

            if(filters.data !== undefined)
            {
                conditions.push(`"data" @> $${paramIndex}`);
                params.push(JSON.stringify(filters.data));
                paramIndex++;
            }

            if(filters.promptCosts !== undefined)
            {
                if(filters.promptCosts)
                {
                    conditions.push(`"promptCosts" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"promptCosts" IS NULL`);
                }
            }

            if(filters.triggerAtStart !== undefined)
            {
                conditions.push(`"triggerAt" >= $${paramIndex}`);
                params.push(filters.triggerAtStart);
                paramIndex++;
            }

            if(filters.triggerAtEnd !== undefined)
            {
                conditions.push(`"triggerAt" <= $${paramIndex}`);
                params.push(filters.triggerAtEnd);
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
                "promptName",
                "platform",
                "referenceTable",
                "referenceId",
                "message",
                "promptCosts"
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

                const query = `UPDATE wira_queue SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "Queue columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        queues: result.rows
                    }
                };
            }

            //NO DATA FIELDS — DELETE THE ROWS
            const query = `DELETE FROM wira_queue ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Queues deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    queues: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteQueue at WiraQueueDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting queues.",
                data: null
            };
        }
    }
}

module.exports = WiraQueueDB;