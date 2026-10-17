const pgDB = require("../../database/pgDb");

//DATABASE
/*
================================================================================
TABLE — intro_audio_template (shared, unchanged)
================================================================================

Stores pre-generated TTS audio segments for intro messages at the start of
outbound calls. Shared across all architectures. Do not modify its structure.

The unique constraint on (text, language, speaker) ensures duplicate audio is
never generated for the same combination. createIntroAudio is an upsert — on
conflict the existing row's segments are replaced in place.

updatedAt is maintained by the set_updated_at() trigger — never set manually.
No notify trigger on this table. No nullable columns, so deleteIntroAudio only
deletes rows.

+------------+-------------+--------------------------------------------------+
| Column     | Type        | Constraints                                      |
+------------+-------------+--------------------------------------------------+
| id         | BIGSERIAL   | Primary Key                                      |
| text       | TEXT        | NOT NULL                                         |
| language   | VARCHAR(10) | NOT NULL, DEFAULT hi-IN                          |
| speaker    | VARCHAR(50) | NOT NULL, DEFAULT anushka                        |
| segments   | JSONB       | NOT NULL                                         |
| createdAt  | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                          |
| updatedAt  | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                          |
+------------+-------------+--------------------------------------------------+

UNIQUE: (text, language, speaker)

--- SQL ---

CREATE TABLE intro_audio_template
(
    "id"        BIGSERIAL    PRIMARY KEY,
    "text"      TEXT         NOT NULL,
    "language"  VARCHAR(10)  NOT NULL DEFAULT 'hi-IN',
    "speaker"   VARCHAR(50)  NOT NULL DEFAULT 'anushka',
    "segments"  JSONB        NOT NULL,
    "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "uq_introAudioTemplate_text_lang_speaker"
    ON intro_audio_template("text", "language", "speaker");

CREATE OR REPLACE TRIGGER trg_intro_audio_template_updated_at
BEFORE UPDATE ON intro_audio_template
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
*/

class WiraIntroAudioDB
{
    constructor()
    {
        this.db = pgDB;
    }

    //FETCHES AN INTRO AUDIO TEMPLATE BY ITS ID. RETURNS 404 IF NOT FOUND.
    async fetchIntroAudioById(id)
    {
        try
        {
            const query = `SELECT * FROM intro_audio_template WHERE "id" = $1`;
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
                    message: "Intro audio not found.",
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
                message: "Intro audio fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchIntroAudioById at WiraIntroAudioDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching intro audio.",
                data: null
            };
        }
    }

    //FETCHES AN INTRO AUDIO TEMPLATE BY ITS UNIQUE (text, language, speaker). language DEFAULTS TO hi-IN AND speaker TO anushka, SAME AS THE TABLE DEFAULTS. RETURNS 404 IF NOT FOUND.
    async fetchIntroAudioByText(text, language = "hi-IN", speaker = "anushka")
    {
        try
        {
            const query = `SELECT * FROM intro_audio_template WHERE "text" = $1 AND "language" = $2 AND "speaker" = $3 LIMIT 1`;
            const params =
            [
                text,
                language,
                speaker
            ];

            const result = await this.db.query(query, params);
            if(result.rows.length === 0)
            {
                return {
                    statusCode: 404,
                    success: true,
                    message: "Intro audio not found.",
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
                message: "Intro audio fetched successfully.",
                data:
                {
                    found: true,
                    data: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in fetchIntroAudioByText at WiraIntroAudioDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching intro audio.",
                data: null
            };
        }
    }

    //FETCHES INTRO AUDIO TEMPLATES USING FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR text. ORDERED BY createdAt DESC. SUPPORTS OPTIONAL PAGINATION.
    async fetchIntroAudio(filters = {}, pagination = {}, strict = true)
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

            if(filters.text !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"text" = $${paramIndex}`);
                    params.push(filters.text);
                }
                else
                {
                    conditions.push(`"text" ILIKE $${paramIndex}`);
                    params.push(`%${filters.text}%`);
                }

                paramIndex++;
            }

            if(filters.language !== undefined)
            {
                conditions.push(`"language" = $${paramIndex}`);
                params.push(filters.language);
                paramIndex++;
            }

            if(filters.speaker !== undefined)
            {
                conditions.push(`"speaker" = $${paramIndex}`);
                params.push(filters.speaker);
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
            const countQuery = `SELECT COUNT(*) FROM intro_audio_template ${whereClause}`;
            const countResult = await this.db.query(countQuery, params);
            const total = parseInt(countResult.rows[0].count);

            let dataQuery;
            if(paginated)
            {
                const offset = (pageNo - 1) * perPage;

                params.push(perPage);
                params.push(offset);

                dataQuery = `SELECT * FROM intro_audio_template ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            }
            else
            {
                dataQuery = `SELECT * FROM intro_audio_template ${whereClause} ORDER BY "createdAt" DESC`;
            }

            const result = await this.db.query(dataQuery, params);

            return {
                statusCode: 200,
                success: true,
                message: "Intro audios fetched successfully.",
                data:
                {
                    introAudios: result.rows,
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
            console.error("Error occured in fetchIntroAudio at WiraIntroAudioDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured fetching intro audios.",
                data: null
            };
        }
    }

    //CREATES AN INTRO AUDIO TEMPLATE. text AND segments ARE REQUIRED. language DEFAULTS TO hi-IN AND speaker TO anushka. UPSERTS ON (text, language, speaker) — IF THE TEMPLATE ALREADY EXISTS, ITS segments ARE REPLACED.
    async createIntroAudio(data = {})
    {
        try
        {
            if(!data.text)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "text is required.",
                    data: null
                };
            }

            if(!data.segments)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "segments is required.",
                    data: null
                };
            }

            const query = `
                INSERT INTO intro_audio_template
                (
                    "text",
                    "language",
                    "speaker",
                    "segments"
                )
                VALUES ($1, $2, $3, $4)
                ON CONFLICT ("text", "language", "speaker") DO UPDATE SET
                    "segments" = EXCLUDED."segments"
                RETURNING *
            `;

            const params =
            [
                data.text,
                data.language ?? "hi-IN",
                data.speaker ?? "anushka",
                JSON.stringify(data.segments)
            ];

            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Intro audio created successfully.",
                data:
                {
                    introAudio: result.rows[0]
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in createIntroAudio at WiraIntroAudioDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating intro audio.",
                data: null
            };
        }
    }

    //UPDATES INTRO AUDIO TEMPLATES MATCHING THE GIVEN FILTERS. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR text. segments IS STORED AS JSONB.
    async updateIntroAudio(data = {}, filters = {}, strict = true)
    {
        try
        {
            const setClauses = [];
            const params = [];
            let paramIndex = 1;

            if(data.text !== undefined)
            {
                setClauses.push(`"text" = $${paramIndex}`);
                params.push(data.text);
                paramIndex++;
            }

            if(data.language !== undefined)
            {
                setClauses.push(`"language" = $${paramIndex}`);
                params.push(data.language);
                paramIndex++;
            }

            if(data.speaker !== undefined)
            {
                setClauses.push(`"speaker" = $${paramIndex}`);
                params.push(data.speaker);
                paramIndex++;
            }

            if(data.segments !== undefined)
            {
                setClauses.push(`"segments" = $${paramIndex}`);
                params.push(data.segments ? JSON.stringify(data.segments) : null);
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

            if(filters.text !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"text" = $${paramIndex}`);
                    params.push(filters.text);
                }
                else
                {
                    conditions.push(`"text" ILIKE $${paramIndex}`);
                    params.push(`%${filters.text}%`);
                }

                paramIndex++;
            }

            if(filters.language !== undefined)
            {
                conditions.push(`"language" = $${paramIndex}`);
                params.push(filters.language);
                paramIndex++;
            }

            if(filters.speaker !== undefined)
            {
                conditions.push(`"speaker" = $${paramIndex}`);
                params.push(filters.speaker);
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
            const query = `UPDATE intro_audio_template SET ${setClauses.join(", ")} ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Intro audios updated successfully.",
                data:
                {
                    updated: result.rowCount,
                    introAudios: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in updateIntroAudio at WiraIntroAudioDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured updating intro audios.",
                data: null
            };
        }
    }

    //DELETES INTRO AUDIO TEMPLATES MATCHING THE GIVEN FILTERS. NO NULLABLE COLUMNS EXIST IN THIS TABLE, SO ROWS ARE ALWAYS DELETED. STRICT MODE USES EXACT MATCHING. NON-STRICT USES ILIKE FOR text.
    async deleteIntroAudio(filters = {}, strict = true)
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

            if(filters.text !== undefined)
            {
                if(strict)
                {
                    conditions.push(`"text" = $${paramIndex}`);
                    params.push(filters.text);
                }
                else
                {
                    conditions.push(`"text" ILIKE $${paramIndex}`);
                    params.push(`%${filters.text}%`);
                }

                paramIndex++;
            }

            if(filters.language !== undefined)
            {
                conditions.push(`"language" = $${paramIndex}`);
                params.push(filters.language);
                paramIndex++;
            }

            if(filters.speaker !== undefined)
            {
                conditions.push(`"speaker" = $${paramIndex}`);
                params.push(filters.speaker);
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
            const query = `DELETE FROM intro_audio_template ${whereClause} RETURNING *`;
            const result = await this.db.query(query, params);

            return {
                statusCode: 200,
                success: true,
                message: "Intro audios deleted successfully.",
                data:
                {
                    deleted: result.rowCount,
                    introAudios: result.rows
                }
            };
        }
        catch(error)
        {
            console.error("Error occured in deleteIntroAudio at WiraIntroAudioDB in Wira/Database: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting intro audios.",
                data: null
            };
        }
    }
}

module.exports = WiraIntroAudioDB;