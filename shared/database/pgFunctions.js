const db = require("./pgDb");

const inMin = 0.696;
const inMax = 0.86;
const outMin = 0;
const outMax = 1;

function remapSimilarity(x) 
{
    x = Math.max(inMin, Math.min(inMax, x));
    const remapped = ((x - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;

    return parseFloat(remapped.toFixed(4));
}

function createLogicalSimilarity(similarity) 
{
    let normalized = similarity / 2;
    normalized = remapSimilarity(normalized);
    let score = normalized * 100;

    if(score < 0)
    {
        score = 0;
    }

    else if(score > 100)
    {
        score = 100;
    }

    return score;
}

function inverseRemap(y) 
{
    const x = ((y - outMin) / (outMax - outMin)) * (inMax - inMin) + inMin;
    return parseFloat(x.toFixed(4));
}

function extractAllText(obj) 
{
    if(!obj)
    {
        return '';
    }

    if(typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') 
    {
        return obj.toString() + ' ';
    }

    if(Array.isArray(obj))
    {
        return obj.map(extractAllText).join(' ');
    }

    if(typeof obj === 'object')
    {
        return Object.values(obj).map(extractAllText).join(' ');
    }

    return '';
}

// Allocates an empty resume row and returns the id
async function allocateEmptyResume(userId = null)
{
    try
    {
        let query;
        let values;

        if (userId)
        {
            query = `
                INSERT INTO resumes ("userId")
                VALUES ($1)
                RETURNING id;
            `;
            values = [userId];
        }
        else
        {
            query = `
                INSERT INTO resumes DEFAULT VALUES
                RETURNING id;
            `;
            values = [];
        }

        const result = await db.query(query, values);

        return result.rows[0].id;
    }
    catch(err)
    {
        console.error("❌ Error allocating empty resume:", err);
        return null;
    }
}

//Saves Resume and its embedding to postgresql database.
async function saveResume(resumeId, resumeData, embedding) 
{
    try 
    {
        let email = null;
        let name = null;
  
        if(resumeData) 
        {
            email = resumeData.email || null;
            name = resumeData.name || resumeData.fullName || null;
        }
  
        if(email) 
        {
            const existing = await db.query(`SELECT id FROM resumes WHERE email = $1 LIMIT 1`, [email]);
  
            if(existing.rowCount > 0) 
            {
                const existingId = existing.rows[0].id;
                const updateQuery = `UPDATE resumes SET resumedata = $1, embedding = $2, name = COALESCE($3, name), email = $4 WHERE id = $5 RETURNING id;`;

                const updated = await db.query(updateQuery, [resumeData, embedding, name, email, existingId]);
                return updated.rows[0].id;
            }
        }
  
        if(resumeId) 
        {
            const updateQuery = `UPDATE resumes SET resumedata = $1, embedding = $2, name = COALESCE($3, name), email = COALESCE($4, email) WHERE id = $5 RETURNING id;`;
            const result = await db.query(updateQuery, [resumeData, embedding, name, email, resumeId]);
  
            if(result.rowCount > 0) 
            {
                console.log("✅ Resume updated by ID:", result.rows[0].id);
                return result.rows[0].id;
            }
        }
  
        const insertQuery = `INSERT INTO resumes (resumedata, embedding, name, email) VALUES ($1, $2, $3, $4) RETURNING id;`;
        const inserted = await db.query(insertQuery, [resumeData, embedding, name, email]);
  
        console.log("🆕 New resume saved:", inserted.rows[0].id);
        return inserted.rows[0].id;
    } 
    catch(err) 
    {
        console.error("❌ Error saving resume:", err);
        return null;
    }
}  

async function searchResumes(jobEmbedding, limit = 10, threshold = 30) 
{
    let normalized = threshold / 100;
    normalized = inverseRemap(normalized);
    threshold = normalized * 2;

    try 
    {
        const query = `
            SELECT id, email, name, creatorId, resumeData, embedding, 1 - (embedding <#> $1) AS similarity
            FROM resumes
            WHERE 1 - (embedding <#> $1) >= $2
            ORDER BY similarity DESC
            LIMIT $3
            ;
        `;
        const result = await db.query(query, [jobEmbedding, threshold, limit]);
    
        const scored = result.rows.map(row => {
            const similarity = createLogicalSimilarity(row.similarity);

            return {
                id: row.id,
                email: row.email,
                name: row.name,
                creatorId: row.creatorId,
                resumeData: row.resumedata, 
                similarity: similarity,
            };
        });

        return scored;
    } 
    catch(err) 
    {
        console.error("❌ Error searching resumes:", err);
        return [];
    }
}

async function searchResumesWithKeywordMatching(jobEmbedding, jobDescription, limit = 10, threshold = 30) 
{
    let normalized = threshold / 100;
    normalized = inverseRemap(normalized);
    threshold = normalized * 2;

    try 
    {
        const query = `
            SELECT id, email, name, creatorId, resumeData, embedding, 1 - (embedding <#> $1) AS similarity
            FROM resumes
            WHERE 1 - (embedding <#> $1) >= $2
            ORDER BY similarity DESC
            LIMIT $3
        `;
        const result = await db.query(query, [jobEmbedding, threshold, limit]);
        const descriptionWords = [...new Set(jobDescription.toLowerCase().match(/\b\w+\b/g) || [])];

        const scored = result.rows.map(row => {
            const resumeText = extractAllText(row.resumedata).toLowerCase();
            const resumeWords = new Set(resumeText.match(/\b\w+\b/g) || []);
            const matchedWords = descriptionWords.filter(word => resumeWords.has(word));
            const mismatchedWords = descriptionWords.filter(word => !resumeWords.has(word));

            const similarity = createLogicalSimilarity(row.similarity)

            return {
                id: row.id,
                email: row.email,
                name: row.name,
                creatorId: row.creatorId,
                resumeData: row.resumedata,
                similarity: similarity,
                matchedWords: matchedWords,
                mismatchedWords: mismatchedWords,
            };
        });

        return scored;
    } 
    catch(err) 
    {
        console.error("❌ Error searching resumes with keyword matching:", err);
        return [];
    }
}

async function searchResumesWithId(jobEmbedding, resumeId) 
{
    try 
    {
        const query = `
            SELECT id, email, name, creatorId, resumeData, embedding, 1 - (embedding <#> $1) AS similarity
            FROM resumes
            WHERE id = $2;
        `;
        const result = await db.query(query, [jobEmbedding, resumeId]);
        const scored = result.rows.map(row => {
            const similarity = createLogicalSimilarity(row.similarity);

            return {
                id: row.id,
                email: row.email,
                name: row.name,
                creatorId: row.creatorId,
                resumeData: row.resumedata,
                similarity: similarity,
            };
        });

        return scored;
    } 
    catch(err) 
    {
        console.error("❌ Error searching resume with keyword matching:", err);
        return [];
    }
}

async function searchResumesWithKeywordMatchingId(jobEmbedding, jobDescription, resumeId) 
{
    try 
    {
        const query = `
            SELECT id, email, name, creatorId, resumeData, embedding, 1 - (embedding <#> $1) AS similarity
            FROM resumes
            WHERE id = $2;
        `;
        const result = await db.query(query, [jobEmbedding, resumeId]);
        const descriptionWords = [...new Set(jobDescription.toLowerCase().match(/\b\w+\b/g) || [])];

        const scored = result.rows.map(row => {
            const resumeText = extractAllText(row.resumedata).toLowerCase();
            const resumeWords = new Set(resumeText.match(/\b\w+\b/g) || []);
            const matchedWords = descriptionWords.filter(word => resumeWords.has(word));
            const mismatchedWords = descriptionWords.filter(word => !resumeWords.has(word));

            const similarity = createLogicalSimilarity(row.similarity)

            return {
                id: row.id,
                email: row.email,
                name: row.name,
                creatorId: row.creatorId,
                resumeData: row.resumedata,
                similarity: similarity,
                matchedWords: matchedWords,
                mismatchedWords: mismatchedWords,
            };
        });

        return scored;
    } 
    catch(err) 
    {
        console.error("❌ Error searching resume with keyword matching:", err);
        return [];
    }
}

async function saveCompanyData(title, webName, sourceUrl, section, embedding)
{
    try
    {
        const query = `
            INSERT INTO company_data (title, "webName", "sourceUrl", section, embedding)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id;
        `;

        const result = await db.query(query, [title, webName, sourceUrl, section, embedding]);

        console.log(`✅ Saved: "${title}" → id: ${result.rows[0].id}`);
        return result.rows[0].id;
    }
    catch(err)
    {
        console.error(`❌ Error saving "${title}":`, err.message);
        return null;
    }
}

async function searchCompanyData(queryEmbedding, limit = 7, webName = null)
{
    try
    {
        const values = [queryEmbedding, limit];
        let priorityClause = "0";
 
        if (webName)
        {
            values.push(webName);
            // Soft priority: matching webName gets -0.1 bonus on distance
            // This gives preference without eliminating other websites entirely
            // A chunk from correct site needs ~0.1 higher distance to lose to other site
            priorityClause = `CASE WHEN "webName" = $${values.length} THEN 0.1 ELSE 0 END`;
        }
 
        const query = `
            SELECT id, title, "webName", "sourceUrl", section,
                   1 - (embedding <=> $1) AS similarity
            FROM company_data
            ORDER BY (embedding <=> $1) - ${priorityClause} ASC
            LIMIT $2;
        `;
 
        const result = await db.query(query, values);
 
        return result.rows.map(row => ({
            id:         row.id,
            title:      row.title,
            webName:    row.webName,
            sourceUrl:  row.sourceUrl,
            section:    row.section,
            similarity: row.similarity,
        }));
    }
    catch(err)
    {
        console.error("❌ Error searching company data:", err.message);
        return [];
    }
}

module.exports = {
    allocateEmptyResume,
    saveResume,
    searchResumes,
    searchResumesWithKeywordMatching,
    searchResumesWithId,
    searchResumesWithKeywordMatchingId,
    saveCompanyData,
    searchCompanyData,
}