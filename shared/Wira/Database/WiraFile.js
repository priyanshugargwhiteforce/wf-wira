const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — wira_files
================================================================================

Stores metadata for every file uploaded or associated with a candidate.
Tracks extraction status (whether text has been chunked from the file),
chunk count, and the total embedding cost incurred for this file.
wireCandidateId is nullable and uses SET NULL on candidate deletion so file
records survive for audit purposes. storagePath holds the server-side path
or object storage key and is excluded from pg_notify payloads.

fileType is a semantic category (resume, jd, document, etc).
mimeType is the raw MIME string (application/pdf, text/plain, etc).

NOTE ON TYPO: The actual column is "wireCandidateId" (with 'e') — a known
production typo. All SELECTs alias it AS "wiraCandidateId" (with 'a') so
both exist on every returned row. All filter and data methods accept either
spelling and always map to the real column name.

+------------------+--------------+------------------------------------------+
| Column           | Type         | Constraints                              |
+------------------+--------------+------------------------------------------+
| id               | BIGSERIAL    | Primary Key                              |
| wireCandidateId  | BIGINT       | nullable, FK → wira_candidate SET NULL   |
| fileName         | VARCHAR(500) | NOT NULL                                 |
| fileType         | VARCHAR(100) | NOT NULL                                 |
| sizeKb           | NUMERIC      | NOT NULL, DEFAULT 0, >= 0                |
| mimeType         | VARCHAR(255) | nullable                                 |
| extracted        | BOOLEAN      | NOT NULL, DEFAULT false                  |
| extractedAt      | TIMESTAMPTZ  | nullable — set when extraction completes |
| chunkCount       | INTEGER      | NOT NULL, DEFAULT 0, >= 0                |
| embeddingCostInr | NUMERIC      | NOT NULL, DEFAULT 0                      |
| storagePath      | VARCHAR(1000)| nullable — file path or object store key |
| createdAt        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                  |
| updatedAt        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                  |
+------------------+--------------+------------------------------------------+

Notification channel: wira_files_changes (storagePath excluded from payload)

CREATE TABLE wira_files
(
    "id"                BIGSERIAL     PRIMARY KEY,
    "wireCandidateId"   BIGINT        REFERENCES wira_candidate("id") ON DELETE SET NULL,
    "fileName"          VARCHAR(500)  NOT NULL,
    "fileType"          VARCHAR(100)  NOT NULL,
    "sizeKb"            NUMERIC(12,2) NOT NULL DEFAULT 0,
    "mimeType"          VARCHAR(255),
    "extracted"         BOOLEAN       NOT NULL DEFAULT FALSE,
    "extractedAt"       TIMESTAMPTZ,
    "chunkCount"        INTEGER       NOT NULL DEFAULT 0,
    "embeddingCostInr"  NUMERIC(12,6) NOT NULL DEFAULT 0,
    "storagePath"       VARCHAR(1000),
    "createdAt"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT "chk_wiraFiles_sizeKb"     CHECK ("sizeKb"     >= 0),
    CONSTRAINT "chk_wiraFiles_chunkCount" CHECK ("chunkCount" >= 0)
);

CREATE INDEX "idx_wiraFiles_wireCandidateId" ON wira_files("wireCandidateId") WHERE "wireCandidateId" IS NOT NULL;
CREATE INDEX "idx_wiraFiles_fileName"        ON wira_files("fileName");
CREATE INDEX "idx_wiraFiles_fileType"        ON wira_files("fileType");
CREATE INDEX "idx_wiraFiles_extracted"       ON wira_files("extracted");
CREATE INDEX "idx_wiraFiles_extracted_false" ON wira_files("id") WHERE "extracted" = FALSE;
CREATE INDEX "idx_wiraFiles_createdAt"       ON wira_files("createdAt" DESC);
CREATE INDEX "idx_wiraFiles_updatedAt"       ON wira_files("updatedAt" DESC);

CREATE OR REPLACE FUNCTION notify_wira_files_changes()
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
        'data',      row_data - 'storagePath'
    );

    PERFORM pg_notify('wira_files_changes', payload::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_wira_files_changes
AFTER INSERT OR UPDATE OR DELETE ON wira_files
FOR EACH ROW EXECUTE FUNCTION notify_wira_files_changes();

CREATE OR REPLACE TRIGGER trg_wira_files_updated_at
BEFORE UPDATE ON wira_files
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraFileDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES A FILE BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchFileById(id)
    {
        try
        {
            const query = `SELECT *, "wireCandidateId" AS "wiraCandidateId" FROM wira_files WHERE "id" = $1`;
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
                    message: "File not found.",
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
                message: "File fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchFileById at WiraFileDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching file.",
                data: null
            };
        }
    }

    //FETCHES FILES USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS. SUPPORTS OPTIONAL PAGINATION.
    async fetchFile(filters = {}, pagination = {}, strict = true)
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
                conditions.push(`"wireCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
                paramIndex++;
            }

            if(filters.fileName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"fileName" = $${paramIndex}`);
                    params.push(filters.fileName);
                }
                else
                {
                    conditions.push(`"fileName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.fileName}%`);
                }

                paramIndex++;
            }

            if(filters.fileType !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"fileType" = $${paramIndex}`);
                    params.push(filters.fileType);
                }
                else
                {
                    conditions.push(`"fileType" ILIKE $${paramIndex}`);
                    params.push(`%${filters.fileType}%`);
                }

                paramIndex++;
            }

            if(filters.sizeKbMin !== undefined)
            {
                conditions.push(`"sizeKb" >= $${paramIndex}`);
                params.push(filters.sizeKbMin);
                paramIndex++;
            }

            if(filters.sizeKbMax !== undefined)
            {
                conditions.push(`"sizeKb" <= $${paramIndex}`);
                params.push(filters.sizeKbMax);
                paramIndex++;
            }

            if(filters.mimeType !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"mimeType" = $${paramIndex}`);
                    params.push(filters.mimeType);
                }
                else
                {
                    conditions.push(`"mimeType" ILIKE $${paramIndex}`);
                    params.push(`%${filters.mimeType}%`);
                }

                paramIndex++;
            }

            if(filters.extracted !== undefined)
            {
                conditions.push(`"extracted" = $${paramIndex}`);
                params.push(filters.extracted);
                paramIndex++;
            }

            if(filters.extractedAt !== undefined)
            {
                if(filters.extractedAt)
                {
                    conditions.push(`"extractedAt" IS NOT NULL`);
                }
                else
                {
                    conditions.push(`"extractedAt" IS NULL`);
                }
            }

            if(filters.chunkCountMin !== undefined)
            {
                conditions.push(`"chunkCount" >= $${paramIndex}`);
                params.push(filters.chunkCountMin);
                paramIndex++;
            }

            if(filters.chunkCountMax !== undefined)
            {
                conditions.push(`"chunkCount" <= $${paramIndex}`);
                params.push(filters.chunkCountMax);
                paramIndex++;
            }

            if(filters.storagePath !== undefined)
            {
                if(typeof filters.storagePath === "boolean")
                {
                    if(filters.storagePath)
                    {
                        conditions.push(`"storagePath" IS NOT NULL`);
                    }
                    else
                    {
                        conditions.push(`"storagePath" IS NULL`);
                    }
                }
                else
                {
                    if(strict)
                    {
                        conditions.push(`"storagePath" = $${paramIndex}`);
                        params.push(filters.storagePath);
                    }
                    else
                    {
                        conditions.push(`"storagePath" ILIKE $${paramIndex}`);
                        params.push(`%${filters.storagePath}%`);
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
            const countQuery = `SELECT COUNT(*) FROM wira_files ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT *, "wireCandidateId" AS "wiraCandidateId" FROM wira_files ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT *, "wireCandidateId" AS "wiraCandidateId" FROM wira_files ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Files fetched successfully.",
                data:
                {
                    files: result.rows,
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
            console.error("Error occured in fetchFile at WiraFileDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching files.",
                data: null
            };
        }
    }

    //CREATES A NEW FILE RECORD. fileName AND fileType ARE REQUIRED. ALL OTHER FIELDS ARE OPTIONAL.
    async createFile(data = {})
    {
        try
        {
            if(!data.fileName)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "fileName is required.",
                    data: null
                };
            }

            if(!data.fileType)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "fileType is required.",
                    data: null
                };
            }

            //ACCEPT BOTH SPELLINGS — wiraCandidateId (CORRECT) AND wireCandidateId (TYPO).
            const candidateId = data.wiraCandidateId ?? data.wireCandidateId ?? null;

            const query = `
                INSERT INTO wira_files
                (
                    "wireCandidateId",
                    "fileName",
                    "fileType",
                    "sizeKb",
                    "mimeType",
                    "extracted",
                    "extractedAt",
                    "chunkCount",
                    "embeddingCostInr",
                    "storagePath"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *, "wireCandidateId" AS "wiraCandidateId"
            `;

            const params =
            [
                candidateId,
                data.fileName,
                data.fileType,
                data.sizeKb ?? 0,
                data.mimeType ?? null,
                data.extracted ?? false,
                data.extractedAt ?? null,
                data.chunkCount ?? 0,
                data.embeddingCostInr ?? 0,
                data.storagePath ?? null
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "File created successfully.",
                data:
                {
                    file: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createFile at WiraFileDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating file.",
                data: null
            };
        }
    }

    //UPDATES FILES MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async updateFile(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            //ACCEPT BOTH SPELLINGS IN data.
            const candidateIdData = data.wiraCandidateId ?? data.wireCandidateId;
            if(candidateIdData !== undefined)
            {
                setClauses.push(`"wireCandidateId" = $${paramIndex}`);
                params.push(candidateIdData);
                paramIndex++;
            }

            if(data.fileName !== undefined)
            {
                setClauses.push(`"fileName" = $${paramIndex}`);
                params.push(data.fileName);
                paramIndex++;
            }

            if(data.fileType !== undefined)
            {
                setClauses.push(`"fileType" = $${paramIndex}`);
                params.push(data.fileType);
                paramIndex++;
            }

            if(data.sizeKb !== undefined)
            {
                setClauses.push(`"sizeKb" = $${paramIndex}`);
                params.push(data.sizeKb);
                paramIndex++;
            }

            if(data.mimeType !== undefined)
            {
                setClauses.push(`"mimeType" = $${paramIndex}`);
                params.push(data.mimeType);
                paramIndex++;
            }

            if(data.extracted !== undefined)
            {
                setClauses.push(`"extracted" = $${paramIndex}`);
                params.push(data.extracted);
                paramIndex++;
            }

            if(data.extractedAt !== undefined)
            {
                setClauses.push(`"extractedAt" = $${paramIndex}`);
                params.push(data.extractedAt);
                paramIndex++;
            }

            if(data.chunkCount !== undefined)
            {
                setClauses.push(`"chunkCount" = $${paramIndex}`);
                params.push(data.chunkCount);
                paramIndex++;
            }

            if(data.embeddingCostInr !== undefined)
            {
                setClauses.push(`"embeddingCostInr" = $${paramIndex}`);
                params.push(data.embeddingCostInr);
                paramIndex++;
            }

            if(data.storagePath !== undefined)
            {
                setClauses.push(`"storagePath" = $${paramIndex}`);
                params.push(data.storagePath);
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
                conditions.push(`"wireCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
                paramIndex++;
            }

            if(filters.fileName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"fileName" = $${paramIndex}`);
                    params.push(filters.fileName);
                }
                else
                {
                    conditions.push(`"fileName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.fileName}%`);
                }

                paramIndex++;
            }

            if(filters.fileType !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"fileType" = $${paramIndex}`);
                    params.push(filters.fileType);
                }
                else
                {
                    conditions.push(`"fileType" ILIKE $${paramIndex}`);
                    params.push(`%${filters.fileType}%`);
                }

                paramIndex++;
            }

            if(filters.extracted !== undefined)
            {
                conditions.push(`"extracted" = $${paramIndex}`);
                params.push(filters.extracted);
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
            const query = `UPDATE wira_files SET ${setClauses.join(", ")} ${whereClause} RETURNING *, "wireCandidateId" AS "wiraCandidateId"`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Files updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    files: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateFile at WiraFileDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating files.",
                data: null
            };
        }
    }

    //DELETES FILES MATCHING THE GIVEN FILTERS. IF DATA FIELDS ARE PROVIDED AND SET TO TRUE, NULLIFIES THOSE COLUMNS INSTEAD OF DELETING THE ROW. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR TEXT FIELDS.
    async deleteFile(data = {}, filters = {}, strict = true)
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
                conditions.push(`"wireCandidateId" = $${paramIndex}`);
                params.push(candidateIdFilter);
                paramIndex++;
            }

            if(filters.fileName !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"fileName" = $${paramIndex}`);
                    params.push(filters.fileName);
                }
                else
                {
                    conditions.push(`"fileName" ILIKE $${paramIndex}`);
                    params.push(`%${filters.fileName}%`);
                }

                paramIndex++;
            }

            if(filters.fileType !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"fileType" = $${paramIndex}`);
                    params.push(filters.fileType);
                }
                else
                {
                    conditions.push(`"fileType" ILIKE $${paramIndex}`);
                    params.push(`%${filters.fileType}%`);
                }

                paramIndex++;
            }

            if(filters.extracted !== undefined)
            {
                conditions.push(`"extracted" = $${paramIndex}`);
                params.push(filters.extracted);
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

            //NULLABLE COLUMNS THAT CAN BE EMPTIED WITHOUT DELETING THE ROW.
            const nullableCols =
            [
                "wireCandidateId",
                "mimeType",
                "extractedAt",
                "storagePath"
            ];

            const colsToNull = nullableCols.filter((col) =>
                {
                    return data[col] === true;
                }
            );

            if(colsToNull.length > 0)
            {
                const setClauses = colsToNull.map((col) =>
                    {
                        return `"${col}" = NULL`;
                    }
                );

                const query = `UPDATE wira_files SET ${setClauses.join(", ")} ${whereClause} RETURNING *, "wireCandidateId" AS "wiraCandidateId"`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "File columns cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        files: result.rows
                    }
                };
            }

            const query = `DELETE FROM wira_files ${whereClause} RETURNING *, "wireCandidateId" AS "wiraCandidateId"`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Files deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    files: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteFile at WiraFileDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting files.",
                data: null
            };
        }
    }
}

module.exports = WiraFileDB;