const pgDB = require("../../database/pgDb");
const AI = require("../AI");

//DATABASE
/*
================================================================================
TABLE — wira_file_chunks
================================================================================

Stores the individual text chunks extracted from a wira_files record along
with their vector embeddings. Each chunk is a segment of up to 250 words.
chunkIndex is zero-based and unique per file. The unique constraint on
(wiraFileId, chunkIndex) allows safe upserts when re-embedding a file.
embedding is vector(1536) using gemini-embedding-001. Chunks are immutable
once written — no updatedAt column. embedding is excluded from all SELECT
queries in this class — use a dedicated semantic search function for vector
queries. No pg_notify trigger — chunks are high-volume writes and consumers
should read file-level status from wira_files instead.

+------------+--------------+------------------------------------------------+
| Column     | Type         | Constraints                                    |
+------------+--------------+------------------------------------------------+
| id         | BIGSERIAL    | Primary Key                                    |
| wiraFileId | BIGINT       | NOT NULL, FK → wira_files ON DELETE CASCADE    |
| chunkIndex | INTEGER      | NOT NULL — zero-based position in file         |
| content    | TEXT         | NOT NULL — raw text, max ~250 words            |
| wordCount  | SMALLINT     | NOT NULL, DEFAULT 0, >= 0                      |
| embedding  | vector(1536) | nullable — excluded from all SELECTs here      |
| createdAt  | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                        |
+------------+--------------+------------------------------------------------+

UNIQUE: (wiraFileId, chunkIndex)
IVFFlat index on embedding with cosine ops, lists = 100

CREATE TABLE wira_file_chunks
(
    "id"            BIGSERIAL     PRIMARY KEY,
    "wiraFileId"    BIGINT        NOT NULL REFERENCES wira_files("id") ON DELETE CASCADE,
    "chunkIndex"    INTEGER       NOT NULL,
    "content"       TEXT          NOT NULL,
    "wordCount"     SMALLINT      NOT NULL DEFAULT 0,
    "embedding"     vector(1536),
    "createdAt"     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT "uq_wiraFileChunks_fileId_chunkIndex" UNIQUE ("wiraFileId", "chunkIndex"),
    CONSTRAINT "chk_wiraFileChunks_wordCount"        CHECK  ("wordCount" >= 0)
);

CREATE INDEX "idx_wiraFileChunks_wiraFileId"            ON wira_file_chunks("wiraFileId");
CREATE INDEX "idx_wiraFileChunks_wiraFileId_chunkIndex" ON wira_file_chunks("wiraFileId", "chunkIndex" ASC);
CREATE INDEX "idx_wiraFileChunks_createdAt"             ON wira_file_chunks("createdAt" DESC);
CREATE INDEX "idx_wiraFileChunks_embedding"             ON wira_file_chunks USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
*/

class WiraFileChunksDB
{
    constructor()
    {
        this.db = pgDB;
        this.ai = new AI();

        this.chunkColumns = `"id", "wiraFileId", "chunkIndex", "content", "wordCount", "createdAt"`;

        this.similarityInMin = 0.50;
        this.similarityInMax = 0.70;
        this.similarityOutMin = 0;
        this.similarityOutMax = 1;
    }

    #remapSimilarity(x)
    {
        x = Math.max(this.similarityInMin, Math.min(this.similarityInMax, x));
        const remapped = ((x - this.similarityInMin) / (this.similarityInMax - this.similarityInMin)) * (this.similarityOutMax - this.similarityOutMin) + this.similarityOutMin;
        return parseFloat(remapped.toFixed(4));
    }

    #inverseRemap(y)
    {
        const x = ((y - this.similarityOutMin) / (this.similarityOutMax - this.similarityOutMin)) * (this.similarityInMax - this.similarityInMin) + this.similarityInMin;
        return parseFloat(x.toFixed(4));
    }

    #createLogicalSimilarity(rawSimilarity)
    {
        let score = this.#remapSimilarity(rawSimilarity) * 100;

        if(score < 0)
        {
            score = 0;
        }

        if(score > 100)
        {
            score = 100;
        }

        return parseFloat(score.toFixed(2));
    }

    //FETCHES A FILE CHUNK BY ITS ID. RETURNS 404 IF NOT FOUND. EMBEDDING EXCLUDED FROM RESULT.
    async fetchFileChunkById(id)
    {
        try
        {
            const query = `SELECT ${this.chunkColumns} FROM wira_file_chunks WHERE "id" = $1`;
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
                    message: "File chunk not found.",
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
                message: "File chunk fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchFileChunkById at WiraFileChunksDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching file chunk.",
                data: null
            };
        }
    }

    //FETCHES FILE CHUNKS USING FILTERS. ORDERED BY chunkIndex ASC TO PRESERVE DOCUMENT ORDER. SUPPORTS OPTIONAL PAGINATION. EMBEDDING EXCLUDED FROM RESULTS. IF filters.embed IS PROVIDED AS { text, threshold? }, PERFORMS SEMANTIC SEARCH INSTEAD — OTHER FILTERS STILL APPLY.
    async fetchFileChunk(filters = {}, pagination = {})
    {
        try
        {
            const paginated = pagination.paginated ?? true;
            const pageNo = pagination.pageNo ?? 1;
            const perPage = pagination.perPage ?? 20;

            //SEMANTIC SEARCH PREPENDS $1 (EMBEDDING) AND $2 (THRESHOLD) — FILTER PLACEHOLDERS MUST START AT $3 IN THAT CASE.
            const isSemantic = filters.embed && filters.embed.text;

            const conditions = [];
            const params = [];
            let paramIndex = isSemantic ? 3 : 1;
            if(filters.ids && filters.ids.length > 0)
            {
                conditions.push(`"id" = ANY($${paramIndex})`);
                params.push(filters.ids);
                paramIndex++;
            }

            if(filters.wiraFileId !== undefined)
            {
                conditions.push(`"wiraFileId" = $${paramIndex}`);
                params.push(filters.wiraFileId);
                paramIndex++;
            }

            if(filters.chunkIndex !== undefined)
            {
                conditions.push(`"chunkIndex" = $${paramIndex}`);
                params.push(filters.chunkIndex);
                paramIndex++;
            }

            if(filters.wordCountMin !== undefined)
            {
                conditions.push(`"wordCount" >= $${paramIndex}`);
                params.push(filters.wordCountMin);
                paramIndex++;
            }

            if(filters.wordCountMax !== undefined)
            {
                conditions.push(`"wordCount" <= $${paramIndex}`);
                params.push(filters.wordCountMax);
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

            //SEMANTIC SEARCH BRANCH — TRIGGERED WHEN filters.embed IS PROVIDED.
            if(isSemantic)
            {
                const threshold = filters.embed.threshold ?? 30;
                const rawThreshold = this.#inverseRemap(threshold / 100);

                let queryEmbedding = null;
                try
                {
                    const embedResult = await this.ai.gemini.models.embedContent(
                        {
                            model: "gemini-embedding-001",
                            contents: filters.embed.text,
                            config:
                            {
                                outputDimensionality: 1536
                            }
                        }
                    );

                    queryEmbedding = JSON.stringify(embedResult.embeddings[0].values);
                }
                catch(embedError)
                {
                    console.error("Error occured embedding query in fetchFileChunk at WiraFileChunksDB in Wira/Database: ", embedError);

                    return {
                        statusCode: 500,
                        success: false,
                        message: "Error occured embedding search query.",
                        data: null
                    };
                }

                const extraWhere = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
                const offset = (pageNo - 1) * perPage;
                const semanticParams = [queryEmbedding, rawThreshold, ...params];
                const limitParamIndex = semanticParams.length + 1;

                const semanticDataQuery = `
                    SELECT ${this.chunkColumns}, 1 - (embedding <=> $1::vector) AS "rawSimilarity"
                    FROM wira_file_chunks
                    WHERE "embedding" IS NOT NULL
                    AND 1 - (embedding <=> $1::vector) >= $2
                    ${extraWhere}
                    ORDER BY "rawSimilarity" DESC
                    LIMIT $${limitParamIndex} OFFSET $${limitParamIndex + 1}
                `;

                const semanticCountQuery = `
                    SELECT COUNT(*) FROM wira_file_chunks
                    WHERE "embedding" IS NOT NULL
                    AND 1 - (embedding <=> $1::vector) >= $2
                    ${extraWhere}
                `;

                const [semanticResult, semanticCountResult] = await Promise.all(
                    [
                        this.db.query(semanticDataQuery, [...semanticParams, perPage, offset]),
                        this.db.query(semanticCountQuery, semanticParams)
                    ]
                );

                const total = parseInt(semanticCountResult.rows[0].count);

                const rows = semanticResult.rows.map((row) =>
                    {
                        const rawSimilarity = row.rawSimilarity;
                        const { rawSimilarity: _, ...rest } = row;

                        return {
                            ...rest,
                            similarity: this.#createLogicalSimilarity(rawSimilarity),
                            rawSimilarity: rawSimilarity
                        };
                    }
                );

                return {
                    statusCode: 200,
                    success: true,
                    message: "File chunks fetched successfully.",
                    data:
                    {
                        chunks: rows,
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

            //STANDARD FETCH BRANCH.
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
            const countQuery = `SELECT COUNT(*) FROM wira_file_chunks ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT ${this.chunkColumns} FROM wira_file_chunks ${whereClause} ORDER BY "chunkIndex" ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT ${this.chunkColumns} FROM wira_file_chunks ${whereClause} ORDER BY "chunkIndex" ASC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "File chunks fetched successfully.",
                data:
                {
                    chunks: result.rows,
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
            console.error("Error occured in fetchFileChunk at WiraFileChunksDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching file chunks.",
                data: null
            };
        }
    }

    //CREATES A SINGLE FILE CHUNK. wiraFileId, chunkIndex, AND content ARE REQUIRED. EMBEDDING IS AUTO-GENERATED FROM content.
    async createFileChunk(data = {})
    {
        try
        {
            if(!data.wiraFileId)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "wiraFileId is required.",
                    data: null
                };
            }

            if(data.chunkIndex === undefined || data.chunkIndex === null)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "chunkIndex is required.",
                    data: null
                };
            }

            if(!data.content)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "content is required.",
                    data: null
                };
            }

            let embedding = null;
            try
            {
                const embedResult = await this.ai.gemini.models.embedContent(
                    {
                        model: "gemini-embedding-001",
                        contents: data.content,
                        config:
                        {
                            outputDimensionality: 1536
                        }
                    }
                );

                embedding = JSON.stringify(embedResult.embeddings[0].values);
            }
            catch(embedError)
            {
                console.error("Error occured embedding chunk in createFileChunk at WiraFileChunksDB in Wira/Database: ", embedError);
            }

            const query = `
                INSERT INTO wira_file_chunks
                (
                    "wiraFileId",
                    "chunkIndex",
                    "content",
                    "wordCount",
                    "embedding"
                )
                VALUES ($1, $2, $3, $4, $5)
                RETURNING ${this.chunkColumns}
            `;

            const params =
            [
                data.wiraFileId,
                data.chunkIndex,
                data.content,
                data.wordCount ?? 0,
                embedding
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "File chunk created successfully.",
                data:
                {
                    chunk: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createFileChunk at WiraFileChunksDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating file chunk.",
                data: null
            };
        }
    }

    //BATCH INSERTS MULTIPLE FILE CHUNKS IN A SINGLE QUERY. MORE EFFICIENT THAN INDIVIDUAL INSERTS FOR LARGE FILES. EMBEDDINGS ARE AUTO-GENERATED FROM content VIA Promise.all.
    async createFileChunks(chunks = [])
    {
        try
        {
            if(!chunks || chunks.length === 0)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "No chunks provided.",
                    data: null
                };
            }

            let embeddings = [];
            try
            {
                const embedResults = await Promise.all(
                    chunks.map(chunk =>
                        this.ai.gemini.models.embedContent(
                            {
                                model: "gemini-embedding-001",
                                contents: chunk.content,
                                config:
                                {
                                    outputDimensionality: 1536
                                }
                            }
                        )
                    )
                );

                embeddings = embedResults.map(r => JSON.stringify(r.embeddings[0].values));
            }
            catch(embedError)
            {
                console.error("Error occured embedding chunks in createFileChunks at WiraFileChunksDB in Wira/Database: ", embedError);
                embeddings = chunks.map(() => null);
            }

            const valueSets = [];
            const params = [];
            let paramIndex = 1;

            for(let i = 0; i < chunks.length; i++)
            {
                const chunk = chunks[i];
                valueSets.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
                params.push(
                    chunk.wiraFileId,
                    chunk.chunkIndex,
                    chunk.content,
                    chunk.wordCount ?? 0,
                    embeddings[i] ?? null
                );

                paramIndex += 5;
            }

            const query = `
                INSERT INTO wira_file_chunks
                (
                    "wiraFileId",
                    "chunkIndex",
                    "content",
                    "wordCount",
                    "embedding"
                )
                VALUES ${valueSets.join(", ")}
                RETURNING ${this.chunkColumns}
            `;

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "File chunks created successfully.",
                data:
                {
                    inserted: result.rowCount,
                    chunks: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createFileChunks at WiraFileChunksDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating file chunks.",
                data: null
            };
        }
    }

    //UPDATES FILE CHUNKS MATCHING THE GIVEN FILTERS. IF content IS UPDATED, EMBEDDING IS AUTO-REGENERATED.
    async updateFileChunk(data = {}, filters = {})
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.content !== undefined)
            {
                setClauses.push(`"content" = $${paramIndex}`);
                params.push(data.content);
                paramIndex++;

                //AUTO-EMBED NEW CONTENT.
                let embedding = null;
                try
                {
                    const embedResult = await this.ai.gemini.models.embedContent(
                        {
                            model: "gemini-embedding-001",
                            contents: data.content,
                            config:
                            {
                                outputDimensionality: 1536
                            }
                        }
                    );

                    embedding = JSON.stringify(embedResult.embeddings[0].values);
                }
                catch(embedError)
                {
                    console.error("Error occured embedding chunk in updateFileChunk at WiraFileChunksDB in Wira/Database: ", embedError);
                }

                setClauses.push(`"embedding" = $${paramIndex}`);
                params.push(embedding);
                paramIndex++;
            }

            if(data.wordCount !== undefined)
            {
                setClauses.push(`"wordCount" = $${paramIndex}`);
                params.push(data.wordCount);
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

            if(filters.wiraFileId !== undefined)
            {
                conditions.push(`"wiraFileId" = $${paramIndex}`);
                params.push(filters.wiraFileId);
                paramIndex++;
            }

            if(filters.chunkIndex !== undefined)
            {
                conditions.push(`"chunkIndex" = $${paramIndex}`);
                params.push(filters.chunkIndex);
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
            const query = `UPDATE wira_file_chunks SET ${setClauses.join(", ")} ${whereClause} RETURNING ${this.chunkColumns}`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "File chunks updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    chunks: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateFileChunk at WiraFileChunksDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating file chunks.",
                data: null
            };
        }
    }

    //DELETES FILE CHUNKS MATCHING THE GIVEN FILTERS. IF data.embedding IS TRUE, NULLIFIES THE EMBEDDING COLUMN INSTEAD OF DELETING THE ROW.
    async deleteFileChunk(data = {}, filters = {})
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

            if(filters.wiraFileId !== undefined)
            {
                conditions.push(`"wiraFileId" = $${paramIndex}`);
                params.push(filters.wiraFileId);
                paramIndex++;
            }

            if(filters.chunkIndex !== undefined)
            {
                conditions.push(`"chunkIndex" = $${paramIndex}`);
                params.push(filters.chunkIndex);
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

            //EMBEDDING IS THE ONLY NULLABLE COLUMN — CLEAR IT WITHOUT DELETING THE ROW.
            if(data.embedding === true)
            {
                const query = `UPDATE wira_file_chunks SET "embedding" = NULL ${whereClause} RETURNING ${this.chunkColumns}`;
                const result = await this.db.query(query, params);

                return {
                    statusCode: 200,
                    success: true,
                    message: "File chunk embeddings cleared successfully.",
                    data:
                    {
                        affected: result.rowCount,
                        chunks: result.rows
                    }
                };
            }

            const query = `DELETE FROM wira_file_chunks ${whereClause} RETURNING ${this.chunkColumns}`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "File chunks deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    chunks: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteFileChunk at WiraFileChunksDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting file chunks.",
                data: null
            };
        }
    }
}

module.exports = WiraFileChunksDB;