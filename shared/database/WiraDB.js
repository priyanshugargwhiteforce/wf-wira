const pgDb = require("./pgDb");
 
const SIMILARITY_IN_MIN = 0.50;
const SIMILARITY_IN_MAX = 0.70;
const SIMILARITY_OUT_MIN = 0;
const SIMILARITY_OUT_MAX = 1;
 
function remapSimilarity(x)
{
    x = Math.max(SIMILARITY_IN_MIN, Math.min(SIMILARITY_IN_MAX, x));
    const remapped = ((x - SIMILARITY_IN_MIN) / (SIMILARITY_IN_MAX - SIMILARITY_IN_MIN)) * (SIMILARITY_OUT_MAX - SIMILARITY_OUT_MIN) + SIMILARITY_OUT_MIN;
    return parseFloat(remapped.toFixed(4));
}

function normalizePhone(phone)
{
    if(!phone)
    {
        return phone;
    }

    return String(phone).replace(/^\+91/, "").trim();
}
 
function createLogicalSimilarity(rawSimilarity)
{
    let score = remapSimilarity(rawSimilarity) * 100;
 
    if (score < 0)
    {
        score = 0;
    }
 
    if (score > 100)
    {
        score = 100;
    }
 
    return parseFloat(score.toFixed(2));
}
 
function inverseRemap(y)
{
    const x = ((y - SIMILARITY_OUT_MIN) / (SIMILARITY_OUT_MAX - SIMILARITY_OUT_MIN)) * (SIMILARITY_IN_MAX - SIMILARITY_IN_MIN) + SIMILARITY_IN_MIN;
    return parseFloat(x.toFixed(4));
}

function createLogicalSimilarity(rawSimilarity)
{
    let score = remapSimilarity(rawSimilarity) * 100;

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

async function checkWiraCandidateExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.candidateId !== undefined && filters.candidateId !== null)
        {
            conditions.push(`"candidateId" = $${paramIndex++}`);
            values.push(filters.candidateId);
        }

        if(filters.phone !== undefined && filters.phone !== null)
        {
            conditions.push(`"phone" LIKE '%' || $${paramIndex++}`);
            values.push(normalizePhone(filters.phone));
        }

        if(filters.email !== undefined && filters.email !== null)
        {
            conditions.push(`"email" = $${paramIndex++}`);
            values.push(filters.email);
        }

        if(conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_candidate ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraCandidateExists failed:", err.message);
        return false;
    }
}

async function fetchWiraCandidates(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.candidateId !== undefined && filters.candidateId !== null)
        {
            conditions.push(`"candidateId" = $${paramIndex++}`);
            values.push(filters.candidateId);
        }

        if(filters.phone !== undefined && filters.phone !== null)
        {
            conditions.push(`"phone" LIKE '%' || $${paramIndex++}`);
            values.push(normalizePhone(filters.phone));
        }

        if(filters.email !== undefined && filters.email !== null)
        {
            conditions.push(`"email" = $${paramIndex++}`);
            values.push(filters.email);
        }

        if(filters.name !== undefined && filters.name !== null)
        {
            conditions.push(`"name" = $${paramIndex++}`);
            values.push(filters.name);
        }

        if(filters.hasCall !== undefined && filters.hasCall !== null)
        {
            conditions.push(`"hasCall" = $${paramIndex++}`);
            values.push(filters.hasCall);
        }

        if(filters.hasWhatsapp !== undefined && filters.hasWhatsapp !== null)
        {
            conditions.push(`"hasWhatsapp" = $${paramIndex++}`);
            values.push(filters.hasWhatsapp);
        }

        if(filters.hasApp !== undefined && filters.hasApp !== null)
        {
            conditions.push(`"hasApp" = $${paramIndex++}`);
            values.push(filters.hasApp);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_candidate ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_candidate ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ fetchWiraCandidates failed:", err.message);
        return null;
    }
}

async function searchWiraCandidates(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.candidateId !== undefined && filters.candidateId !== null)
        {
            conditions.push(`"candidateId"::TEXT ILIKE $${paramIndex++}`);
            values.push(`${filters.candidateId}%`);
        }

        if (filters.phone !== undefined && filters.phone !== null)
        {
            conditions.push(`"phone" LIKE '%' || $${paramIndex++}`);
            values.push(normalizePhone(filters.phone));
        }

        if (filters.email !== undefined && filters.email !== null)
        {
            conditions.push(`"email" ILIKE $${paramIndex++}`);
            values.push(`%${filters.email}%`);
        }

        if (filters.name !== undefined && filters.name !== null)
        {
            conditions.push(`"name" ILIKE $${paramIndex++}`);
            values.push(`%${filters.name}%`);
        }

        if (filters.hasCall !== undefined && filters.hasCall !== null)
        {
            conditions.push(`"hasCall" = $${paramIndex++}`);
            values.push(filters.hasCall);
        }

        if (filters.hasWhatsapp !== undefined && filters.hasWhatsapp !== null)
        {
            conditions.push(`"hasWhatsapp" = $${paramIndex++}`);
            values.push(filters.hasWhatsapp);
        }

        if (filters.hasApp !== undefined && filters.hasApp !== null)
        {
            conditions.push(`"hasApp" = $${paramIndex++}`);
            values.push(filters.hasApp);
        }

        if (filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if (filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        if (filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }

        if (filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_candidate ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_candidate ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch (err)
    {
        console.error("❌ searchWiraCandidates failed:", err.message);
        return null;
    }
}

async function insertWiraCandidate(data = {})
{
    try
    {
        const keys = Object.keys(data);
        const values = keys.map(k => k === "candidateData" ? JSON.stringify(data[k]) : data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgDb.query(
            `INSERT INTO wira_candidate (${columns}) VALUES (${placeholders}) 
            ON CONFLICT ("phone") DO UPDATE SET "updatedAt" = NOW() 
            RETURNING *`,
            values
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraCandidate failed:", err.message);
        return null;
    }
}

async function updateWiraCandidates(data = {}, filters = {})
{
    try
    {
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraCandidates blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(key === "candidateData" ? JSON.stringify(data[key]) : data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.candidateId !== undefined && filters.candidateId !== null)
        {
            conditions.push(`"candidateId" = $${paramIndex++}`);
            values.push(filters.candidateId);
        }

        if (filters.phone !== undefined && filters.phone !== null)
        {
            conditions.push(`"phone" LIKE '%' || $${paramIndex++}`);
            values.push(normalizePhone(filters.phone));
        }

        if (filters.email !== undefined && filters.email !== null)
        {
            conditions.push(`"email" = $${paramIndex++}`);
            values.push(filters.email);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraCandidates blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE wira_candidate SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraCandidates failed:", err.message);
        return null;
    }
}

async function deleteWiraCandidates(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.candidateId !== undefined && filters.candidateId !== null)
        {
            conditions.push(`"candidateId" = $${paramIndex++}`);
            values.push(filters.candidateId);
        }

        if (filters.phone !== undefined && filters.phone !== null)
        {
            conditions.push(`"phone" LIKE '%' || $${paramIndex++}`);
            values.push(normalizePhone(filters.phone));
        }

        if (filters.email !== undefined && filters.email !== null)
        {
            conditions.push(`"email" = $${paramIndex++}`);
            values.push(filters.email);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM wira_candidate ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraCandidates failed:", err.message);
        return null;
    }
}

async function checkWiraCallExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.callId !== undefined && filters.callId !== null)
        {
            conditions.push(`"callId" = $${paramIndex++}`);
            values.push(filters.callId);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_call ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraCallExists failed:", err.message);
        return false;
    }
}

async function fetchWiraCalls(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.callId !== undefined && filters.callId !== null)
        {
            conditions.push(`"callId" = $${paramIndex++}`);
            values.push(filters.callId);
        }

        if (filters.fromPhone !== undefined && filters.fromPhone !== null)
        {
            conditions.push(`"fromPhone" = $${paramIndex++}`);
            values.push(filters.fromPhone);
        }

        if (filters.bound !== undefined && filters.bound !== null)
        {
            conditions.push(`"bound" = $${paramIndex++}`);
            values.push(filters.bound);
        }

        if (filters.type !== undefined && filters.type !== null)
        {
            conditions.push(`"type" = $${paramIndex++}`);
            values.push(filters.type);
        }

        if (filters.status !== undefined && filters.status !== null)
        {
            conditions.push(`"status" = $${paramIndex++}`);
            values.push(filters.status);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            conditions.push(`"language" = $${paramIndex++}`);
            values.push(filters.language);
        }

        if (filters.hangupBy !== undefined && filters.hangupBy !== null)
        {
            conditions.push(`"hangupBy" = $${paramIndex++}`);
            values.push(filters.hangupBy);
        }

        if (filters.hangupCause !== undefined && filters.hangupCause !== null)
        {
            conditions.push(`"hangupCause" = $${paramIndex++}`);
            values.push(filters.hangupCause);
        }

        if (filters.interest !== undefined && filters.interest !== null)
        {
            conditions.push(`"interest" = $${paramIndex++}`);
            values.push(filters.interest);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT "id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","transcript","cleanTranscript","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary","createdAt","updatedAt" FROM wira_call ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_call ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ fetchWiraCalls failed:", err.message);
        return null;
    }
}

async function searchWiraCalls(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.callId !== undefined && filters.callId !== null)
        {
            conditions.push(`"callId" ILIKE $${paramIndex++}`);
            values.push(`%${filters.callId}%`);
        }

        if (filters.fromPhone !== undefined && filters.fromPhone !== null)
        {
            conditions.push(`"fromPhone" ILIKE $${paramIndex++}`);
            values.push(`${filters.fromPhone}%`);
        }

        if (filters.bound !== undefined && filters.bound !== null)
        {
            conditions.push(`"bound" = $${paramIndex++}`);
            values.push(filters.bound);
        }

        if (filters.type !== undefined && filters.type !== null)
        {
            conditions.push(`"type" = $${paramIndex++}`);
            values.push(filters.type);
        }

        if (filters.status !== undefined && filters.status !== null)
        {
            conditions.push(`"status" = $${paramIndex++}`);
            values.push(filters.status);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.webName}%`);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            conditions.push(`"language" = $${paramIndex++}`);
            values.push(filters.language);
        }

        if (filters.hangupBy !== undefined && filters.hangupBy !== null)
        {
            conditions.push(`"hangupBy" = $${paramIndex++}`);
            values.push(filters.hangupBy);
        }

        if (filters.hangupCause !== undefined && filters.hangupCause !== null)
        {
            conditions.push(`"hangupCause" = $${paramIndex++}`);
            values.push(filters.hangupCause);
        }

        if (filters.interest !== undefined && filters.interest !== null)
        {
            conditions.push(`"interest" = $${paramIndex++}`);
            values.push(filters.interest);
        }

        if (filters.startedAtFrom !== undefined && filters.startedAtFrom !== null)
        {
            conditions.push(`"startedAt" >= $${paramIndex++}`);
            values.push(filters.startedAtFrom);
        }

        if (filters.startedAtTo !== undefined && filters.startedAtTo !== null)
        {
            conditions.push(`"startedAt" <= $${paramIndex++}`);
            values.push(filters.startedAtTo);
        }

        if (filters.endedAtFrom !== undefined && filters.endedAtFrom !== null)
        {
            conditions.push(`"endedAt" >= $${paramIndex++}`);
            values.push(filters.endedAtFrom);
        }

        if (filters.endedAtTo !== undefined && filters.endedAtTo !== null)
        {
            conditions.push(`"endedAt" <= $${paramIndex++}`);
            values.push(filters.endedAtTo);
        }

        if (filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if (filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        if (filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }

        if (filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT "id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","transcript","cleanTranscript","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary","createdAt","updatedAt" FROM wira_call ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_call ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ searchWiraCalls failed:", err.message);
        return null;
    }
}

async function semanticSearchWiraCalls(queryEmbedding, threshold = 30, page = 1, limit = 20, filters = {})
{
    const rawThreshold = inverseRemap(threshold / 100);
    const conditions = [];
    const params = [queryEmbedding, rawThreshold];
    let paramIndex = 3;

    if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
    {
        conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
        params.push(filters.wiraCandidateId);
    }

    if (filters.bound !== undefined && filters.bound !== null)
    {
        conditions.push(`"bound" = $${paramIndex++}`);
        params.push(filters.bound);
    }

    if (filters.type !== undefined && filters.type !== null)
    {
        conditions.push(`"type" = $${paramIndex++}`);
        params.push(filters.type);
    }

    if (filters.status !== undefined && filters.status !== null)
    {
        conditions.push(`"status" = $${paramIndex++}`);
        params.push(filters.status);
    }

    if (filters.webName !== undefined && filters.webName !== null)
    {
        conditions.push(`"webName" = $${paramIndex++}`);
        params.push(filters.webName);
    }

    if (filters.language !== undefined && filters.language !== null)
    {
        conditions.push(`"language" = $${paramIndex++}`);
        params.push(filters.language);
    }

    if (filters.interest !== undefined && filters.interest !== null)
    {
        conditions.push(`"interest" = $${paramIndex++}`);
        params.push(filters.interest);
    }

    if (filters.hangupCause !== undefined && filters.hangupCause !== null)
    {
        conditions.push(`"hangupCause" = $${paramIndex++}`);
        params.push(filters.hangupCause);
    }

    const extraWhere = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * limit;

    try
    {
        const dataQuery = `
            SELECT "id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","transcript","cleanTranscript","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary","createdAt","updatedAt",
                   1 - (embedding <=> $1::vector) AS "rawSimilarity"
            FROM wira_call
            WHERE 1 - (embedding <=> $1::vector) >= $2
            ${extraWhere}
            ORDER BY "rawSimilarity" DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const countQuery = `
            SELECT COUNT(*) AS total
            FROM wira_call
            WHERE 1 - (embedding <=> $1::vector) >= $2
            ${extraWhere}
        `;

        const [dataResult, countResult] = await Promise.all([
            pgDb.query(dataQuery, [...params, limit, offset]),
            pgDb.query(countQuery, params)
        ]);

        const rows = dataResult.rows.map(row =>
        {
            const rawSimilarity = row.rawSimilarity;
            const { rawSimilarity: _, ...rest } = row;
            return {
                ...rest,
                similarity: createLogicalSimilarity(rawSimilarity),
                rawSimilarity
            };
        });

        return {
            rows,
            total: parseInt(countResult.rows[0].total, 10),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ semanticSearchWiraCalls failed:", err.message);
        return null;
    }
}

async function insertWiraCall(data = {})
{
    try
    {
        const jsonbFields = ["transcript", "cleanTranscript"];
        const keys = Object.keys(data);
        const values = keys.map(k => jsonbFields.includes(k) ? JSON.stringify(data[k]) : data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) =>
        {
            if (keys[i] === "embedding") return `$${i + 1}::vector`;
            return `$${i + 1}`;
        }).join(", ");

        const result = await pgDb.query(
            `INSERT INTO wira_call (${columns}) VALUES (${placeholders}) RETURNING "id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","transcript","cleanTranscript","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary","createdAt","updatedAt"`,
            values
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraCall failed:", err.message);
        return null;
    }
}

async function updateWiraCalls(data = {}, filters = {})
{
    try
    {
        const jsonbFields = ["transcript", "cleanTranscript"];
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraCalls blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(jsonbFields.includes(key) ? JSON.stringify(data[key]) : data[key]);
            if (key === "embedding") return `"${key}" = $${paramIndex++}::vector`;
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.callId !== undefined && filters.callId !== null)
        {
            conditions.push(`"callId" = $${paramIndex++}`);
            values.push(filters.callId);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraCalls blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE wira_call SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING "id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","transcript","cleanTranscript","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary","createdAt","updatedAt"`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraCalls failed:", err.message);
        return null;
    }
}

async function deleteWiraCalls(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.callId !== undefined && filters.callId !== null)
        {
            conditions.push(`"callId" = $${paramIndex++}`);
            values.push(filters.callId);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM wira_call ${whereClause} RETURNING "id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","transcript","cleanTranscript","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary","createdAt","updatedAt"`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraCalls failed:", err.message);
        return null;
    }
}

async function checkWiraOutboundScreeningExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCallId !== undefined && filters.wiraCallId !== null)
        {
            conditions.push(`"wiraCallId" = $${paramIndex++}`);
            values.push(filters.wiraCallId);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_outbound_screening ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraOutboundScreeningExists failed:", err.message);
        return false;
    }
}

async function fetchWiraOutboundScreenings(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraCallId !== undefined && filters.wiraCallId !== null)
        {
            conditions.push(`"wiraCallId" = $${paramIndex++}`);
            values.push(filters.wiraCallId);
        }
 
        if(filters.jobId !== undefined && filters.jobId !== null)
        {
            conditions.push(`"jobId" = $${paramIndex++}`);
            values.push(filters.jobId);
        }
 
        if(filters.jobTitle !== undefined && filters.jobTitle !== null)
        {
            conditions.push(`"jobTitle" = $${paramIndex++}`);
            values.push(filters.jobTitle);
        }
 
        if(filters.companyName !== undefined && filters.companyName !== null)
        {
            conditions.push(`"companyName" = $${paramIndex++}`);
            values.push(filters.companyName);
        }
 
        if(filters.scoreMin !== undefined && filters.scoreMin !== null)
        {
            conditions.push(`"score" >= $${paramIndex++}`);
            values.push(filters.scoreMin);
        }
 
        if(filters.scoreMax !== undefined && filters.scoreMax !== null)
        {
            conditions.push(`"score" <= $${paramIndex++}`);
            values.push(filters.scoreMax);
        }
 
        if(filters.jobInterest !== undefined && filters.jobInterest !== null)
        {
            conditions.push(`"jobInterest" = $${paramIndex++}`);
            values.push(filters.jobInterest);
        }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];
 
        values.push(limit, offset);
 
        const result = await pgDb.query(`SELECT * FROM wira_outbound_screening ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_outbound_screening ${whereClause}`, filterValues);
 
        return {
            rows : result.rows,
            total : parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ fetchWiraOutboundScreenings failed:", err.message);
        return null;
    }
}

async function searchWiraOutboundScreenings(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraCallId !== undefined && filters.wiraCallId !== null)
        {
            conditions.push(`"wiraCallId" = $${paramIndex++}`);
            values.push(filters.wiraCallId);
        }
 
        if(filters.jobId !== undefined && filters.jobId !== null)
        {
            conditions.push(`"jobId" = $${paramIndex++}`);
            values.push(filters.jobId);
        }
 
        if(filters.jobTitle !== undefined && filters.jobTitle !== null)
        {
            conditions.push(`"jobTitle" ILIKE $${paramIndex++}`);
            values.push(`%${filters.jobTitle}%`);
        }
 
        if(filters.companyName !== undefined && filters.companyName !== null)
        {
            conditions.push(`"companyName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.companyName}%`);
        }
 
        if(filters.scoreMin !== undefined && filters.scoreMin !== null)
        {
            conditions.push(`"score" >= $${paramIndex++}`);
            values.push(filters.scoreMin);
        }
 
        if(filters.scoreMax !== undefined && filters.scoreMax !== null)
        {
            conditions.push(`"score" <= $${paramIndex++}`);
            values.push(filters.scoreMax);
        }
 
        if(filters.jobInterest !== undefined && filters.jobInterest !== null)
        {
            conditions.push(`"jobInterest" = $${paramIndex++}`);
            values.push(filters.jobInterest);
        }
 
        if(filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }
 
        if(filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }
 
        if(filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }
 
        if(filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];
 
        values.push(limit, offset);
 
        const result = await pgDb.query(`SELECT * FROM wira_outbound_screening ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_outbound_screening ${whereClause}`, filterValues);
 
        return {
            rows : result.rows,
            total : parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ searchWiraOutboundScreenings failed:", err.message);
        return null;
    }
}

async function insertWiraOutboundScreening(data = {})
{
    try
    {
        const jsonbFields = ["screeningQuestions", "screeningQA"];
        const keys = Object.keys(data);
        const values = keys.map(k => jsonbFields.includes(k) ? JSON.stringify(data[k]) : data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgDb.query(
            `INSERT INTO wira_outbound_screening (${columns}) VALUES (${placeholders}) RETURNING *`,
            values
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraOutboundScreening failed:", err.message);
        return null;
    }
}

async function updateWiraOutboundScreenings(data = {}, filters = {})
{
    try
    {
        const jsonbFields = ["screeningQuestions", "screeningQA"];
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraOutboundScreenings blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(jsonbFields.includes(key) ? JSON.stringify(data[key]) : data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCallId !== undefined && filters.wiraCallId !== null)
        {
            conditions.push(`"wiraCallId" = $${paramIndex++}`);
            values.push(filters.wiraCallId);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraOutboundScreenings blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE wira_outbound_screening SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraOutboundScreenings failed:", err.message);
        return null;
    }
}

async function deleteWiraOutboundScreenings(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCallId !== undefined && filters.wiraCallId !== null)
        {
            conditions.push(`"wiraCallId" = $${paramIndex++}`);
            values.push(filters.wiraCallId);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM wira_outbound_screening ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraOutboundScreenings failed:", err.message);
        return null;
    }
}

async function checkWiraCallCostExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraOutboundScreeningId !== undefined && filters.wiraOutboundScreeningId !== null)
        {
            conditions.push(`"wiraOutboundScreeningId" = $${paramIndex++}`);
            values.push(filters.wiraOutboundScreeningId);
        }

        if (filters.bucketIndex !== undefined && filters.bucketIndex !== null)
        {
            if (filters.wiraOutboundScreeningId === undefined || filters.wiraOutboundScreeningId === null)
            {
                console.error("❌ checkWiraCallCostExists: bucketIndex requires wiraOutboundScreeningId");
                return false;
            }

            conditions.push(`"bucketIndex" = $${paramIndex++}`);
            values.push(filters.bucketIndex);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_call_costs ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraCallCostExists failed:", err.message);
        return false;
    }
}

async function fetchWiraCallCosts(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraOutboundScreeningId !== undefined && filters.wiraOutboundScreeningId !== null)
        {
            conditions.push(`"wiraOutboundScreeningId" = $${paramIndex++}`);
            values.push(filters.wiraOutboundScreeningId);
        }

        if (filters.bucketIndex !== undefined && filters.bucketIndex !== null)
        {
            if (filters.wiraOutboundScreeningId === undefined || filters.wiraOutboundScreeningId === null)
            {
                console.error("❌ fetchWiraCallCosts: bucketIndex requires wiraOutboundScreeningId");
                return null;
            }

            conditions.push(`"bucketIndex" = $${paramIndex++}`);
            values.push(filters.bucketIndex);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_call_costs ${whereClause} ORDER BY "bucketIndex" ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_call_costs ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ fetchWiraCallCosts failed:", err.message);
        return null;
    }
}

async function searchWiraCallCosts(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraOutboundScreeningId !== undefined && filters.wiraOutboundScreeningId !== null)
        {
            conditions.push(`"wiraOutboundScreeningId" = $${paramIndex++}`);
            values.push(filters.wiraOutboundScreeningId);
        }

        if (filters.bucketIndex !== undefined && filters.bucketIndex !== null)
        {
            if (filters.wiraOutboundScreeningId === undefined || filters.wiraOutboundScreeningId === null)
            {
                console.error("❌ searchWiraCallCosts: bucketIndex requires wiraOutboundScreeningId");
                return null;
            }

            conditions.push(`"bucketIndex" = $${paramIndex++}`);
            values.push(filters.bucketIndex);
        }

        if (filters.startTimeFrom !== undefined && filters.startTimeFrom !== null)
        {
            conditions.push(`"startTime" >= $${paramIndex++}`);
            values.push(filters.startTimeFrom);
        }

        if (filters.startTimeTo !== undefined && filters.startTimeTo !== null)
        {
            conditions.push(`"startTime" <= $${paramIndex++}`);
            values.push(filters.startTimeTo);
        }

        if (filters.endTimeFrom !== undefined && filters.endTimeFrom !== null)
        {
            conditions.push(`"endTime" >= $${paramIndex++}`);
            values.push(filters.endTimeFrom);
        }

        if (filters.endTimeTo !== undefined && filters.endTimeTo !== null)
        {
            conditions.push(`"endTime" <= $${paramIndex++}`);
            values.push(filters.endTimeTo);
        }

        if (filters.bucketTotalMin !== undefined && filters.bucketTotalMin !== null)
        {
            conditions.push(`"bucketTotal" >= $${paramIndex++}`);
            values.push(filters.bucketTotalMin);
        }

        if (filters.bucketTotalMax !== undefined && filters.bucketTotalMax !== null)
        {
            conditions.push(`"bucketTotal" <= $${paramIndex++}`);
            values.push(filters.bucketTotalMax);
        }

        if (filters.geminiCostMin !== undefined && filters.geminiCostMin !== null)
        {
            conditions.push(`"geminiCost" >= $${paramIndex++}`);
            values.push(filters.geminiCostMin);
        }

        if (filters.geminiCostMax !== undefined && filters.geminiCostMax !== null)
        {
            conditions.push(`"geminiCost" <= $${paramIndex++}`);
            values.push(filters.geminiCostMax);
        }

        if (filters.plivoCostMin !== undefined && filters.plivoCostMin !== null)
        {
            conditions.push(`"plivoCost" >= $${paramIndex++}`);
            values.push(filters.plivoCostMin);
        }

        if (filters.plivoCostMax !== undefined && filters.plivoCostMax !== null)
        {
            conditions.push(`"plivoCost" <= $${paramIndex++}`);
            values.push(filters.plivoCostMax);
        }

        if (filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if (filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_call_costs ${whereClause} ORDER BY "bucketIndex" ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_call_costs ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ searchWiraCallCosts failed:", err.message);
        return null;
    }
}

async function insertWiraCallCost(data = {})
{
    try
    {
        const keys = Object.keys(data);
        const values = keys.map(k => data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const nonConflictKeys = keys.filter(k => k !== "wiraOutboundScreeningId" && k !== "bucketIndex");
        const updateSetClause = nonConflictKeys.map(k => `"${k}" = EXCLUDED."${k}"`).join(", ");

        const conflictClause = updateSetClause 
            ? `ON CONFLICT ("wiraOutboundScreeningId", "bucketIndex") DO UPDATE SET ${updateSetClause}`
            : `ON CONFLICT ("wiraOutboundScreeningId", "bucketIndex") DO NOTHING`;

        const result = await pgDb.query(
            `INSERT INTO wira_call_costs (${columns}) VALUES (${placeholders}) ${conflictClause} RETURNING *`,
            values
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraCallCost failed:", err.message);
        return null;
    }
}

async function updateWiraCallCosts(data = {}, filters = {})
{
    try
    {
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraCallCosts blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraOutboundScreeningId !== undefined && filters.wiraOutboundScreeningId !== null)
        {
            conditions.push(`"wiraOutboundScreeningId" = $${paramIndex++}`);
            values.push(filters.wiraOutboundScreeningId);
        }

        if (filters.bucketIndex !== undefined && filters.bucketIndex !== null)
        {
            if (filters.wiraOutboundScreeningId === undefined || filters.wiraOutboundScreeningId === null)
            {
                console.error("❌ updateWiraCallCosts: bucketIndex requires wiraOutboundScreeningId");
                return null;
            }

            conditions.push(`"bucketIndex" = $${paramIndex++}`);
            values.push(filters.bucketIndex);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraCallCosts blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE wira_call_costs SET ${setClause} ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraCallCosts failed:", err.message);
        return null;
    }
}

async function deleteWiraCallCosts(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraOutboundScreeningId !== undefined && filters.wiraOutboundScreeningId !== null)
        {
            conditions.push(`"wiraOutboundScreeningId" = $${paramIndex++}`);
            values.push(filters.wiraOutboundScreeningId);
        }

        if (filters.bucketIndex !== undefined && filters.bucketIndex !== null)
        {
            if (filters.wiraOutboundScreeningId === undefined || filters.wiraOutboundScreeningId === null)
            {
                console.error("❌ deleteWiraCallCosts: bucketIndex requires wiraOutboundScreeningId");
                return [];
            }

            conditions.push(`"bucketIndex" = $${paramIndex++}`);
            values.push(filters.bucketIndex);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM wira_call_costs ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraCallCosts failed:", err.message);
        return null;
    }
}

async function checkWiraAppExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_app ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraAppExists failed:", err.message);
        return false;
    }
}

async function fetchWiraApps(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (filters.geminiMinCost !== undefined && filters.geminiMinCost !== null)
        {
            conditions.push(`"overallGeminiCost" >= $${paramIndex++}`);
            values.push(filters.geminiMinCost);
        }

        if (filters.geminiMaxCost !== undefined && filters.geminiMaxCost !== null)
        {
            conditions.push(`"overallGeminiCost" <= $${paramIndex++}`);
            values.push(filters.geminiMaxCost);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_app ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_app ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ fetchWiraApps failed:", err.message);
        return null;
    }
}

async function searchWiraApps(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.webName}%`);
        }

        if (filters.geminiMinCost !== undefined && filters.geminiMinCost !== null)
        {
            conditions.push(`"overallGeminiCost" >= $${paramIndex++}`);
            values.push(filters.geminiMinCost);
        }

        if (filters.geminiMaxCost !== undefined && filters.geminiMaxCost !== null)
        {
            conditions.push(`"overallGeminiCost" <= $${paramIndex++}`);
            values.push(filters.geminiMaxCost);
        }

        if (filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if (filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        if (filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }

        if (filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_app ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_app ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ searchWiraApps failed:", err.message);
        return null;
    }
}

async function insertWiraApp(data = {})
{
    try
    {
        const keys = Object.keys(data);
        const values = keys.map(k => data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgDb.query(
            `INSERT INTO wira_app ("wiraCandidateId", "webName") 
            VALUES ($1, $2) 
            ON CONFLICT ("wiraCandidateId", "webName") DO UPDATE 
            SET "updatedAt" = NOW() 
            RETURNING *`,
            [data.wiraCandidateId, data.webName]
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraApp failed:", err.message);
        return null;
    }
}

async function updateWiraApps(data = {}, filters = {})
{
    try
    {
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraApps blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraApps blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE wira_app SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraApps failed:", err.message);
        return null;
    }
}

async function deleteWiraApps(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM wira_app ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraApps failed:", err.message);
        return null;
    }
}

async function checkWiraAppMessageExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraAppId !== undefined && filters.wiraAppId !== null)
        {
            conditions.push(`"wiraAppId" = $${paramIndex++}`);
            values.push(filters.wiraAppId);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_app_message ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraAppMessageExists failed:", err.message);
        return false;
    }
}

async function fetchWiraAppMessages(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraAppId !== undefined && filters.wiraAppId !== null)
        {
            conditions.push(`"wiraAppId" = $${paramIndex++}`);
            values.push(filters.wiraAppId);
        }
 
        if(filters.role !== undefined && filters.role !== null)
        {
            conditions.push(`"role" = $${paramIndex++}`);
            values.push(filters.role);
        }
 
        if(filters.platform !== undefined && filters.platform !== null)
        {
            conditions.push(`"platform" = $${paramIndex++}`);
            values.push(filters.platform);
        }
 
        if(filters.isServer !== undefined && filters.isServer !== null)
        {
            conditions.push(`"isServer" = $${paramIndex++}`);
            values.push(filters.isServer);
        }
 
        if(filters.cancelled !== undefined && filters.cancelled !== null)
        {
            conditions.push(`"cancelled" = $${paramIndex++}`);
            values.push(filters.cancelled);
        }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];
 
        values.push(limit, offset);
 
        const result = await pgDb.query(`SELECT "id","wiraAppId","role","content","urls","jobIds","queueIds","files","instructionData","platform","isServer","metadata","promptCosts","cancelled","cleanContent","createdAt" FROM wira_app_message ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_app_message ${whereClause}`, filterValues);
 
        return {
            rows : result.rows,
            total : parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ fetchWiraAppMessages failed:", err.message);
        return null;
    }
}

async function searchWiraAppMessages(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraAppId !== undefined && filters.wiraAppId !== null)
        {
            conditions.push(`"wiraAppId" = $${paramIndex++}`);
            values.push(filters.wiraAppId);
        }
 
        if(filters.role !== undefined && filters.role !== null)
        {
            conditions.push(`"role" = $${paramIndex++}`);
            values.push(filters.role);
        }
 
        if(filters.content !== undefined && filters.content !== null)
        {
            conditions.push(`("content" IS NOT NULL AND "content" ILIKE $${paramIndex++})`);
            values.push(`%${filters.content}%`);
        }
 
        if(filters.platform !== undefined && filters.platform !== null)
        {
            conditions.push(`"platform" = $${paramIndex++}`);
            values.push(filters.platform);
        }
 
        if(filters.isServer !== undefined && filters.isServer !== null)
        {
            conditions.push(`"isServer" = $${paramIndex++}`);
            values.push(filters.isServer);
        }
 
        if(filters.cancelled !== undefined && filters.cancelled !== null)
        {
            conditions.push(`"cancelled" = $${paramIndex++}`);
            values.push(filters.cancelled);
        }
 
        if(filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }
 
        if(filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];
 
        values.push(limit, offset);
 
        const result = await pgDb.query(`SELECT "id","wiraAppId","role","content","urls","jobIds","queueIds","files","instructionData","platform","isServer","metadata","promptCosts","cancelled","cleanContent","createdAt" FROM wira_app_message ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_app_message ${whereClause}`, filterValues);
 
        return {
            rows : result.rows,
            total : parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ searchWiraAppMessages failed:", err.message);
        return null;
    }
}

async function semanticSearchWiraAppMessages(queryEmbedding, threshold = 30, page = 1, limit = 20, filters = {})
{
    const rawThreshold = inverseRemap(threshold / 100);
    const conditions = [];
    const params = [queryEmbedding, rawThreshold];
    let paramIndex = 3;
 
    if(filters.wiraAppId !== undefined && filters.wiraAppId !== null)
    {
        conditions.push(`"wiraAppId" = $${paramIndex++}`);
        params.push(filters.wiraAppId);
    }
 
    if(filters.role !== undefined && filters.role !== null)
    {
        conditions.push(`"role" = $${paramIndex++}`);
        params.push(filters.role);
    }
 
    if(filters.platform !== undefined && filters.platform !== null)
    {
        conditions.push(`"platform" = $${paramIndex++}`);
        params.push(filters.platform);
    }
 
    if(filters.isServer !== undefined && filters.isServer !== null)
    {
        conditions.push(`"isServer" = $${paramIndex++}`);
        params.push(filters.isServer);
    }
 
    if(filters.cancelled !== undefined && filters.cancelled !== null)
    {
        conditions.push(`"cancelled" = $${paramIndex++}`);
        params.push(filters.cancelled);
    }

    if(filters.excludeIds && Array.isArray(filters.excludeIds) && filters.excludeIds.length > 0)
    {
        conditions.push(`"id" != ALL($${paramIndex++})`);
        params.push(filters.excludeIds);
    }
 
    const extraWhere = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * limit;
 
    try
    {
        const dataQuery = `SELECT "id","wiraAppId","role","content","urls","jobIds","queueIds","files","instructionData","platform","isServer","metadata","promptCosts","cancelled","cleanContent","createdAt",1 - (embedding <=> $1::vector) AS "rawSimilarity" FROM wira_app_message WHERE 1 - (embedding <=> $1::vector) >= $2 ${extraWhere} ORDER BY "rawSimilarity" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        const countQuery = `SELECT COUNT(*) AS total FROM wira_app_message WHERE 1 - (embedding <=> $1::vector) >= $2 ${extraWhere}`;
 
        const [dataResult, countResult] = await Promise.all([
            pgDb.query(dataQuery, [...params, limit, offset]),
            pgDb.query(countQuery, params)
        ]);
 
        const rows = dataResult.rows.map(row =>
        {
            const rawSimilarity = row.rawSimilarity;
            const { rawSimilarity: _, ...rest } = row;

            return {
                ...rest,
                similarity : createLogicalSimilarity(rawSimilarity),
                rawSimilarity
            };
        });
 
        return {
            rows: rows,
            total : parseInt(countResult.rows[0].total, 10),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ semanticSearchWiraAppMessages failed:", err.message);
        return null;
    }
}

async function insertWiraAppMessage(data = {})
{
    try
    {
        const jsonbFields = ["urls", "jobIds", "queueIds", "files", "instructionData", "metadata", "promptCosts"];
        const keys = Object.keys(data);
        const values = keys.map(k => jsonbFields.includes(k) ? JSON.stringify(data[k]) : data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => {

            if(keys[i] === "embedding")
            {
                return `$${i + 1}::vector`;
            }

            return `$${i + 1}`;
        }).join(", ");
 
        const result = await pgDb.query(`INSERT INTO wira_app_message (${columns}) VALUES (${placeholders}) RETURNING "id","wiraAppId","role","content","urls","jobIds","queueIds","files","instructionData","platform","isServer","metadata","promptCosts","cancelled","cleanContent","createdAt"`, values);
        return result.rows[0];
    }
    catch(err)
    {
        console.error("❌ insertWiraAppMessage failed:", err.message);
        return null;
    }
}

async function updateWiraAppMessages(data = {}, filters = {})
{
    try
    {
        const jsonbFields = ["urls", "jobIds", "queueIds", "files", "instructionData", "metadata", "promptCosts"];
        const dataKeys = Object.keys(data);
 
        if(dataKeys.length === 0)
        {
            console.error("❌ updateWiraAppMessages blocked: no data provided to update");
            return null;
        }
 
        const values = [];
        let paramIndex = 1;
 
        const setClause = dataKeys.map(key =>
        {
            values.push(jsonbFields.includes(key) ? JSON.stringify(data[key]) : data[key]);

            if(key === "embedding")
            {
                return `"${key}" = $${paramIndex++}::vector`;
            }

            return `"${key}" = $${paramIndex++}`;
        }).join(", ");
 
        const conditions = [];
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraAppId !== undefined && filters.wiraAppId !== null)
        {
            conditions.push(`"wiraAppId" = $${paramIndex++}`);
            values.push(filters.wiraAppId);
        }
 
        if(conditions.length === 0)
        {
            console.error("❌ updateWiraAppMessages blocked: no filters provided, refusing to update all rows");
            return null;
        }
 
        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`UPDATE wira_app_message SET ${setClause} ${whereClause} RETURNING "id","wiraAppId","role","content","urls","jobIds","queueIds","files","instructionData","platform","isServer","metadata","promptCosts","cancelled","cleanContent","createdAt"`, values);
 
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ updateWiraAppMessages failed:", err.message);
        return null;
    }
}

async function deleteWiraAppMessages(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraAppId !== undefined && filters.wiraAppId !== null)
        {
            conditions.push(`"wiraAppId" = $${paramIndex++}`);
            values.push(filters.wiraAppId);
        }
 
        if(conditions.length === 0)
        {
            return [];
        }
 
        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`DELETE FROM wira_app_message ${whereClause} RETURNING "id","wiraAppId","role","content","urls","jobIds","queueIds","files","instructionData","platform","isServer","metadata","promptCosts","cancelled","cleanContent","createdAt"`, values);
 
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ deleteWiraAppMessages failed:", err.message);
        return null;
    }
}

async function checkWiraWhatsappExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_whatsapp ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraWhatsappExists failed:", err.message);
        return false;
    }
}

async function fetchWiraWhatsapps(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (filters.geminiMinCost !== undefined && filters.geminiMinCost !== null)
        {
            conditions.push(`"overallGeminiCost" >= $${paramIndex++}`);
            values.push(filters.geminiMinCost);
        }

        if (filters.geminiMaxCost !== undefined && filters.geminiMaxCost !== null)
        {
            conditions.push(`"overallGeminiCost" <= $${paramIndex++}`);
            values.push(filters.geminiMaxCost);
        }

        if (filters.whatsappMinCost !== undefined && filters.whatsappMinCost !== null)
        {
            conditions.push(`"overallWhatsappCost" >= $${paramIndex++}`);
            values.push(filters.whatsappMinCost);
        }

        if (filters.whatsappMaxCost !== undefined && filters.whatsappMaxCost !== null)
        {
            conditions.push(`"overallWhatsappCost" <= $${paramIndex++}`);
            values.push(filters.whatsappMaxCost);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_whatsapp ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_whatsapp ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ fetchWiraWhatsapps failed:", err.message);
        return null;
    }
}

async function searchWiraWhatsapps(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.webName}%`);
        }

        if (filters.geminiMinCost !== undefined && filters.geminiMinCost !== null)
        {
            conditions.push(`"overallGeminiCost" >= $${paramIndex++}`);
            values.push(filters.geminiMinCost);
        }

        if (filters.geminiMaxCost !== undefined && filters.geminiMaxCost !== null)
        {
            conditions.push(`"overallGeminiCost" <= $${paramIndex++}`);
            values.push(filters.geminiMaxCost);
        }

        if (filters.whatsappMinCost !== undefined && filters.whatsappMinCost !== null)
        {
            conditions.push(`"overallWhatsappCost" >= $${paramIndex++}`);
            values.push(filters.whatsappMinCost);
        }

        if (filters.whatsappMaxCost !== undefined && filters.whatsappMaxCost !== null)
        {
            conditions.push(`"overallWhatsappCost" <= $${paramIndex++}`);
            values.push(filters.whatsappMaxCost);
        }

        if (filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if (filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        if (filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }

        if (filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_whatsapp ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_whatsapp ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ searchWiraWhatsapps failed:", err.message);
        return null;
    }
}

async function insertWiraWhatsapp(data = {})
{
    try
    {
        const keys = Object.keys(data);
        const values = keys.map(k => data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgDb.query(
            `INSERT INTO wira_whatsapp (${columns}) VALUES (${placeholders}) RETURNING *`,
            values
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraWhatsapp failed:", err.message);
        return null;
    }
}

async function updateWiraWhatsapps(data = {}, filters = {})
{
    try
    {
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraWhatsapps blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraWhatsapps blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE wira_whatsapp SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraWhatsapps failed:", err.message);
        return null;
    }
}

async function deleteWiraWhatsapps(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraCandidateId !== undefined && filters.wiraCandidateId !== null)
        {
            conditions.push(`"wiraCandidateId" = $${paramIndex++}`);
            values.push(filters.wiraCandidateId);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            conditions.push(`"webName" = $${paramIndex++}`);
            values.push(filters.webName);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM wira_whatsapp ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraWhatsapps failed:", err.message);
        return null;
    }
}

async function checkWiraWhatsappMessageExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.wiraWhatsappId !== undefined && filters.wiraWhatsappId !== null)
        {
            conditions.push(`"wiraWhatsappId" = $${paramIndex++}`);
            values.push(filters.wiraWhatsappId);
        }

        if (filters.whatsappMessageId !== undefined && filters.whatsappMessageId !== null)
        {
            conditions.push(`"whatsappMessageId" = $${paramIndex++}`);
            values.push(filters.whatsappMessageId);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_whatsapp_message ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraWhatsappMessageExists failed:", err.message);
        return false;
    }
}

async function fetchWiraWhatsappMessages(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraWhatsappId !== undefined && filters.wiraWhatsappId !== null)
        {
            conditions.push(`"wiraWhatsappId" = $${paramIndex++}`);
            values.push(filters.wiraWhatsappId);
        }
 
        if(filters.role !== undefined && filters.role !== null)
        {
            conditions.push(`"role" = $${paramIndex++}`);
            values.push(filters.role);
        }
 
        if(filters.isServer !== undefined && filters.isServer !== null)
        {
            conditions.push(`"isServer" = $${paramIndex++}`);
            values.push(filters.isServer);
        }
 
        if(filters.cancelled !== undefined && filters.cancelled !== null)
        {
            conditions.push(`"cancelled" = $${paramIndex++}`);
            values.push(filters.cancelled);
        }
 
        if(filters.whatsappMessageId !== undefined && filters.whatsappMessageId !== null)
        {
            conditions.push(`"whatsappMessageId" = $${paramIndex++}`);
            values.push(filters.whatsappMessageId);
        }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];
 
        values.push(limit, offset);
 
        const result = await pgDb.query(`SELECT "id","wiraWhatsappId","role","content","urls","jobIds","queueIds","files","instructionData","isServer","metadata","promptCosts","cancelled","whatsappMessageId","whatsappRawPayload","cleanContent","createdAt","updatedAt" FROM wira_whatsapp_message ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_whatsapp_message ${whereClause}`, filterValues);
 
        return {
            rows : result.rows,
            total : parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ fetchWiraWhatsappMessages failed:", err.message);
        return null;
    }
}

async function searchWiraWhatsappMessages(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraWhatsappId !== undefined && filters.wiraWhatsappId !== null)
        {
            conditions.push(`"wiraWhatsappId" = $${paramIndex++}`);
            values.push(filters.wiraWhatsappId);
        }
 
        if(filters.role !== undefined && filters.role !== null)
        {
            conditions.push(`"role" = $${paramIndex++}`);
            values.push(filters.role);
        }
 
        if(filters.content !== undefined && filters.content !== null)
        {
            conditions.push(`("content" IS NOT NULL AND "content" ILIKE $${paramIndex++})`);
            values.push(`%${filters.content}%`);
        }
 
        if(filters.isServer !== undefined && filters.isServer !== null)
        {
            conditions.push(`"isServer" = $${paramIndex++}`);
            values.push(filters.isServer);
        }
 
        if(filters.cancelled !== undefined && filters.cancelled !== null)
        {
            conditions.push(`"cancelled" = $${paramIndex++}`);
            values.push(filters.cancelled);
        }
 
        if(filters.whatsappMessageId !== undefined && filters.whatsappMessageId !== null)
        {
            conditions.push(`"whatsappMessageId" ILIKE $${paramIndex++}`);
            values.push(`%${filters.whatsappMessageId}%`);
        }
 
        if(filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }
 
        if(filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }
 
        if(filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }
 
        if(filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];
 
        values.push(limit, offset);
 
        const result = await pgDb.query(`SELECT "id","wiraWhatsappId","role","content","urls","jobIds","queueIds","files","instructionData","isServer","metadata","promptCosts","cancelled","whatsappMessageId","whatsappRawPayload","cleanContent","createdAt","updatedAt" FROM wira_whatsapp_message ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_whatsapp_message ${whereClause}`, filterValues);
 
        return {
            rows : result.rows,
            total : parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ searchWiraWhatsappMessages failed:", err.message);
        return null;
    }
}

async function semanticSearchWiraWhatsappMessages(queryEmbedding, threshold = 30, page = 1, limit = 20, filters = {})
{
    const rawThreshold = inverseRemap(threshold / 100);
    const conditions = [];
    const params = [queryEmbedding, rawThreshold];
    let paramIndex = 3;
 
    if(filters.wiraWhatsappId !== undefined && filters.wiraWhatsappId !== null)
    {
        conditions.push(`"wiraWhatsappId" = $${paramIndex++}`);
        params.push(filters.wiraWhatsappId);
    }
 
    if(filters.role !== undefined && filters.role !== null)
    {
        conditions.push(`"role" = $${paramIndex++}`);
        params.push(filters.role);
    }
 
    if(filters.isServer !== undefined && filters.isServer !== null)
    {
        conditions.push(`"isServer" = $${paramIndex++}`);
        params.push(filters.isServer);
    }
 
    if(filters.cancelled !== undefined && filters.cancelled !== null)
    {
        conditions.push(`"cancelled" = $${paramIndex++}`);
        params.push(filters.cancelled);
    }

    if(filters.excludeIds && Array.isArray(filters.excludeIds) && filters.excludeIds.length > 0)
    {
        conditions.push(`"id" != ALL($${paramIndex++})`);
        params.push(filters.excludeIds);
    }
 
    const extraWhere = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * limit;
 
    try
    {
        const dataQuery = `SELECT "id","wiraWhatsappId","role","content","urls","jobIds","queueIds","files","instructionData","isServer","metadata","promptCosts","cancelled","whatsappMessageId","whatsappRawPayload","cleanContent","createdAt","updatedAt",1 - (embedding <=> $1::vector) AS "rawSimilarity" FROM wira_whatsapp_message WHERE 1 - (embedding <=> $1::vector) >= $2 ${extraWhere} ORDER BY "rawSimilarity" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        const countQuery = `SELECT COUNT(*) AS total FROM wira_whatsapp_message WHERE 1 - (embedding <=> $1::vector) >= $2 ${extraWhere}`;
 
        const [dataResult, countResult] = await Promise.all([
            pgDb.query(dataQuery, [...params, limit, offset]),
            pgDb.query(countQuery, params)
        ]);
 
        const rows = dataResult.rows.map(row =>
        {
            const rawSimilarity = row.rawSimilarity;
            const { rawSimilarity: _, ...rest } = row;
            return {
                ...rest,
                similarity: createLogicalSimilarity(rawSimilarity),
                rawSimilarity
            };
        });
 
        return {
            rows: rows,
            total: parseInt(countResult.rows[0].total, 10),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ semanticSearchWiraWhatsappMessages failed:", err.message);
        return null;
    }
}

async function insertWiraWhatsappMessage(data = {})
{
    try
    {
        const jsonbFields = ["urls", "jobIds", "queueIds", "files", "instructionData", "metadata", "promptCosts", "whatsappRawPayload"];
        const keys = Object.keys(data);
        const values = keys.map(k => jsonbFields.includes(k) ? JSON.stringify(data[k]) : data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) =>
        {
            if(keys[i] === "embedding")
            {
                return `$${i + 1}::vector`;
            }

            return `$${i + 1}`;
        }).join(", ");
 
        const result = await pgDb.query(`INSERT INTO wira_whatsapp_message (${columns}) VALUES (${placeholders}) RETURNING "id","wiraWhatsappId","role","content","urls","jobIds","queueIds","files","instructionData","isServer","metadata","promptCosts","cancelled","whatsappMessageId","whatsappRawPayload","cleanContent","createdAt","updatedAt"`, values);
        return result.rows[0];
    }
    catch(err)
    {
        console.error("❌ insertWiraWhatsappMessage failed:", err.message);
        return null;
    }
}

async function updateWiraWhatsappMessages(data = {}, filters = {})
{
    try
    {
        const jsonbFields = ["urls", "jobIds", "queueIds", "files", "instructionData", "metadata", "promptCosts", "whatsappRawPayload"];
        const dataKeys = Object.keys(data);
 
        if(dataKeys.length === 0)
        {
            console.error("❌ updateWiraWhatsappMessages blocked: no data provided to update");
            return null;
        }
 
        const values = [];
        let paramIndex = 1;
 
        const setClause = dataKeys.map(key =>
        {
            values.push(jsonbFields.includes(key) ? JSON.stringify(data[key]) : data[key]);

            if(key === "embedding")
            {
                return `"${key}" = $${paramIndex++}::vector`;
            }

            return `"${key}" = $${paramIndex++}`;
        }).join(", ");
 
        const conditions = [];
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraWhatsappId !== undefined && filters.wiraWhatsappId !== null)
        {
            conditions.push(`"wiraWhatsappId" = $${paramIndex++}`);
            values.push(filters.wiraWhatsappId);
        }
 
        if(filters.whatsappMessageId !== undefined && filters.whatsappMessageId !== null)
        {
            conditions.push(`"whatsappMessageId" = $${paramIndex++}`);
            values.push(filters.whatsappMessageId);
        }
 
        if(conditions.length === 0)
        {
            console.error("❌ updateWiraWhatsappMessages blocked: no filters provided, refusing to update all rows");
            return null;
        }
 
        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`UPDATE wira_whatsapp_message SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING "id","wiraWhatsappId","role","content","urls","jobIds","queueIds","files","instructionData","isServer","metadata","promptCosts","cancelled","whatsappMessageId","whatsappRawPayload","cleanContent","createdAt","updatedAt"`, values);
 
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ updateWiraWhatsappMessages failed:", err.message);
        return null;
    }
}

async function deleteWiraWhatsappMessages(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;
 
        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }
 
        if(filters.wiraWhatsappId !== undefined && filters.wiraWhatsappId !== null)
        {
            conditions.push(`"wiraWhatsappId" = $${paramIndex++}`);
            values.push(filters.wiraWhatsappId);
        }
 
        if(filters.whatsappMessageId !== undefined && filters.whatsappMessageId !== null)
        {
            conditions.push(`"whatsappMessageId" = $${paramIndex++}`);
            values.push(filters.whatsappMessageId);
        }
 
        if(conditions.length === 0)
        {
            return [];
        }
 
        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`DELETE FROM wira_whatsapp_message ${whereClause} RETURNING "id","wiraWhatsappId","role","content","urls","jobIds","queueIds","files","instructionData","isServer","metadata","promptCosts","cancelled","whatsappMessageId","whatsappRawPayload","cleanContent","createdAt","updatedAt"`, values);
 
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ deleteWiraWhatsappMessages failed:", err.message);
        return null;
    }
}

async function checkWiraCacheCostExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.cacheId !== undefined && filters.cacheId !== null)
        {
            conditions.push(`"cacheId" = $${paramIndex++}`);
            values.push(filters.cacheId);
        }

        if (filters.promptName !== undefined && filters.promptName !== null)
        {
            conditions.push(`"promptName" = $${paramIndex++}`);
            values.push(filters.promptName);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_cache_costs ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraCacheCostExists failed:", err.message);
        return false;
    }
}

async function fetchWiraCacheCosts(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.cacheId !== undefined && filters.cacheId !== null)
        {
            conditions.push(`"cacheId" = $${paramIndex++}`);
            values.push(filters.cacheId);
        }

        if (filters.promptName !== undefined && filters.promptName !== null)
        {
            conditions.push(`"promptName" = $${paramIndex++}`);
            values.push(filters.promptName);
        }

        if (filters.modelName !== undefined && filters.modelName !== null)
        {
            conditions.push(`"modelName" = $${paramIndex++}`);
            values.push(filters.modelName);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_cache_costs ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_cache_costs ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ fetchWiraCacheCosts failed:", err.message);
        return null;
    }
}

async function searchWiraCacheCosts(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.cacheId !== undefined && filters.cacheId !== null)
        {
            conditions.push(`"cacheId" ILIKE $${paramIndex++}`);
            values.push(`%${filters.cacheId}%`);
        }

        if (filters.promptName !== undefined && filters.promptName !== null)
        {
            conditions.push(`"promptName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.promptName}%`);
        }

        if (filters.modelName !== undefined && filters.modelName !== null)
        {
            conditions.push(`"modelName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.modelName}%`);
        }

        if (filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if (filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        if (filters.deletedStart !== undefined && filters.deletedStart !== null)
        {
            conditions.push(`"deletedAt" >= $${paramIndex++}`);
            values.push(filters.deletedStart);
        }

        if (filters.deletedEnd !== undefined && filters.deletedEnd !== null)
        {
            conditions.push(`"deletedAt" <= $${paramIndex++}`);
            values.push(filters.deletedEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_cache_costs ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_cache_costs ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ searchWiraCacheCosts failed:", err.message);
        return null;
    }
}

async function insertWiraCacheCost(data = {})
{
    try
    {
        const keys = Object.keys(data);
        const values = keys.map(k => data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgDb.query(
            `INSERT INTO wira_cache_costs (${columns}) VALUES (${placeholders}) RETURNING *`,
            values
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraCacheCost failed:", err.message);
        return null;
    }
}

async function updateWiraCacheCosts(data = {}, filters = {})
{
    try
    {
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraCacheCosts blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.cacheId !== undefined && filters.cacheId !== null)
        {
            conditions.push(`"cacheId" = $${paramIndex++}`);
            values.push(filters.cacheId);
        }

        if (filters.promptName !== undefined && filters.promptName !== null)
        {
            conditions.push(`"promptName" = $${paramIndex++}`);
            values.push(filters.promptName);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraCacheCosts blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE wira_cache_costs SET ${setClause} ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraCacheCosts failed:", err.message);
        return null;
    }
}

async function deleteWiraCacheCosts(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.cacheId !== undefined && filters.cacheId !== null)
        {
            conditions.push(`"cacheId" = $${paramIndex++}`);
            values.push(filters.cacheId);
        }

        if (filters.promptName !== undefined && filters.promptName !== null)
        {
            conditions.push(`"promptName" = $${paramIndex++}`);
            values.push(filters.promptName);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM wira_cache_costs ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraCacheCosts failed:", err.message);
        return null;
    }
}

async function checkWiraQueueExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.queueName !== undefined && filters.queueName !== null)
        {
            conditions.push(`"queueName" = $${paramIndex++}`);
            values.push(filters.queueName);
        }

        if (filters.referenceTable !== undefined && filters.referenceTable !== null)
        {
            conditions.push(`"referenceTable" = $${paramIndex++}`);
            values.push(filters.referenceTable);
        }

        if (filters.referenceId !== undefined && filters.referenceId !== null)
        {
            conditions.push(`"referenceId" = $${paramIndex++}`);
            values.push(filters.referenceId);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM wira_queue ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraQueueExists failed:", err.message);
        return false;
    }
}

async function fetchWiraQueues(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.queueName !== undefined && filters.queueName !== null)
        {
            conditions.push(`"queueName" = $${paramIndex++}`);
            values.push(filters.queueName);
        }

        if (filters.promptName !== undefined && filters.promptName !== null)
        {
            conditions.push(`"promptName" = $${paramIndex++}`);
            values.push(filters.promptName);
        }

        if (filters.platform !== undefined && filters.platform !== null)
        {
            conditions.push(`"platform" = $${paramIndex++}`);
            values.push(filters.platform);
        }

        if (filters.setBy !== undefined && filters.setBy !== null)
        {
            conditions.push(`"setBy" = $${paramIndex++}`);
            values.push(filters.setBy);
        }

        if (filters.referenceTable !== undefined && filters.referenceTable !== null)
        {
            conditions.push(`"referenceTable" = $${paramIndex++}`);
            values.push(filters.referenceTable);
        }

        if (filters.referenceId !== undefined && filters.referenceId !== null)
        {
            conditions.push(`"referenceId" = $${paramIndex++}`);
            values.push(filters.referenceId);
        }

        if (filters.executed !== undefined && filters.executed !== null)
        {
            conditions.push(`"executed" = $${paramIndex++}`);
            values.push(filters.executed);
        }

        if (filters.status !== undefined && filters.status !== null)
        {
            conditions.push(`"status" = $${paramIndex++}`);
            values.push(filters.status);
        }

        const isPendingExecution = filters.executed === false && filters.status === "pending";
        const orderBy = isPendingExecution ? `"triggerAt" ASC` : `"createdAt" DESC`;

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_queue ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_queue ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ fetchWiraQueues failed:", err.message);
        return null;
    }
}

async function searchWiraQueues(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.queueName !== undefined && filters.queueName !== null)
        {
            conditions.push(`"queueName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.queueName}%`);
        }

        if (filters.promptName !== undefined && filters.promptName !== null)
        {
            conditions.push(`"promptName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.promptName}%`);
        }

        if (filters.platform !== undefined && filters.platform !== null)
        {
            conditions.push(`"platform" = $${paramIndex++}`);
            values.push(filters.platform);
        }

        if (filters.setBy !== undefined && filters.setBy !== null)
        {
            conditions.push(`"setBy" = $${paramIndex++}`);
            values.push(filters.setBy);
        }

        if (filters.referenceTable !== undefined && filters.referenceTable !== null)
        {
            conditions.push(`"referenceTable" = $${paramIndex++}`);
            values.push(filters.referenceTable);
        }

        if (filters.referenceId !== undefined && filters.referenceId !== null)
        {
            conditions.push(`"referenceId" = $${paramIndex++}`);
            values.push(filters.referenceId);
        }

        if (filters.executed !== undefined && filters.executed !== null)
        {
            conditions.push(`"executed" = $${paramIndex++}`);
            values.push(filters.executed);
        }

        if (filters.status !== undefined && filters.status !== null)
        {
            conditions.push(`"status" = $${paramIndex++}`);
            values.push(filters.status);
        }

        if (filters.triggerAtFrom !== undefined && filters.triggerAtFrom !== null)
        {
            conditions.push(`"triggerAt" >= $${paramIndex++}`);
            values.push(filters.triggerAtFrom);
        }

        if (filters.triggerAtTo !== undefined && filters.triggerAtTo !== null)
        {
            conditions.push(`"triggerAt" <= $${paramIndex++}`);
            values.push(filters.triggerAtTo);
        }

        if (filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if (filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        if (filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }

        if (filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }

        const isPendingExecution = filters.executed === false && filters.status === "pending";
        const orderBy = isPendingExecution ? `"triggerAt" ASC` : `"createdAt" DESC`;

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM wira_queue ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM wira_queue ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ searchWiraQueues failed:", err.message);
        return null;
    }
}

async function insertWiraQueue(data = {})
{
    try
    {
        const jsonbFields = ["data", "promptCosts"];
        const keys = Object.keys(data);
        const values = keys.map(k => jsonbFields.includes(k) ? JSON.stringify(data[k]) : data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgDb.query(
            `INSERT INTO wira_queue (${columns}) VALUES (${placeholders}) RETURNING *`,
            values
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraQueue failed:", err.message);
        return null;
    }
}

async function updateWiraQueues(data = {}, filters = {})
{
    try
    {
        const jsonbFields = ["data", "promptCosts"];
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraQueues blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(jsonbFields.includes(key) ? JSON.stringify(data[key]) : data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.queueName !== undefined && filters.queueName !== null)
        {
            conditions.push(`"queueName" = $${paramIndex++}`);
            values.push(filters.queueName);
        }

        if (filters.referenceTable !== undefined && filters.referenceTable !== null)
        {
            conditions.push(`"referenceTable" = $${paramIndex++}`);
            values.push(filters.referenceTable);
        }

        if (filters.referenceId !== undefined && filters.referenceId !== null)
        {
            conditions.push(`"referenceId" = $${paramIndex++}`);
            values.push(filters.referenceId);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraQueues blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE wira_queue SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraQueues failed:", err.message);
        return null;
    }
}

async function deleteWiraQueues(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.queueName !== undefined && filters.queueName !== null)
        {
            conditions.push(`"queueName" = $${paramIndex++}`);
            values.push(filters.queueName);
        }

        if (filters.referenceTable !== undefined && filters.referenceTable !== null)
        {
            conditions.push(`"referenceTable" = $${paramIndex++}`);
            values.push(filters.referenceTable);
        }

        if (filters.referenceId !== undefined && filters.referenceId !== null)
        {
            conditions.push(`"referenceId" = $${paramIndex++}`);
            values.push(filters.referenceId);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM wira_queue ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraQueues failed:", err.message);
        return null;
    }
}

async function checkWiraIntroAudioExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.text !== undefined && filters.text !== null)
        {
            conditions.push(`"text" = $${paramIndex++}`);
            values.push(filters.text);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            conditions.push(`"language" = $${paramIndex++}`);
            values.push(filters.language);
        }

        if (filters.speaker !== undefined && filters.speaker !== null)
        {
            conditions.push(`"speaker" = $${paramIndex++}`);
            values.push(filters.speaker);
        }

        if (conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `SELECT 1 FROM intro_audio_template ${whereClause} LIMIT 1`,
            values
        );

        return result.rows.length > 0;
    }
    catch (err)
    {
        console.error("❌ checkWiraIntroAudioExists failed:", err.message);
        return false;
    }
}

async function fetchWiraIntroAudios(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.text !== undefined && filters.text !== null)
        {
            conditions.push(`"text" = $${paramIndex++}`);
            values.push(filters.text);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            conditions.push(`"language" = $${paramIndex++}`);
            values.push(filters.language);
        }

        if (filters.speaker !== undefined && filters.speaker !== null)
        {
            conditions.push(`"speaker" = $${paramIndex++}`);
            values.push(filters.speaker);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM intro_audio_template ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM intro_audio_template ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ fetchWiraIntroAudios failed:", err.message);
        return null;
    }
}

async function insertWiraIntroAudio(data = {})
{
    try
    {
        const jsonbFields = ["segments"];
        const keys = Object.keys(data);
        const values = keys.map(k => jsonbFields.includes(k) ? JSON.stringify(data[k]) : data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgDb.query(
            `INSERT INTO intro_audio_template (${columns}) VALUES (${placeholders}) ON CONFLICT ("text", "language", "speaker") DO UPDATE SET "segments" = EXCLUDED."segments", "updatedAt" = NOW() RETURNING *`,
            values
        );

        return result.rows[0];
    }
    catch (err)
    {
        console.error("❌ insertWiraIntroAudio failed:", err.message);
        return null;
    }
}

async function updateWiraIntroAudios(data = {}, filters = {})
{
    try
    {
        const jsonbFields = ["segments"];
        const dataKeys = Object.keys(data);

        if (dataKeys.length === 0)
        {
            console.error("❌ updateWiraIntroAudios blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(jsonbFields.includes(key) ? JSON.stringify(data[key]) : data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.text !== undefined && filters.text !== null)
        {
            conditions.push(`"text" = $${paramIndex++}`);
            values.push(filters.text);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            conditions.push(`"language" = $${paramIndex++}`);
            values.push(filters.language);
        }

        if (filters.speaker !== undefined && filters.speaker !== null)
        {
            conditions.push(`"speaker" = $${paramIndex++}`);
            values.push(filters.speaker);
        }

        if (conditions.length === 0)
        {
            console.error("❌ updateWiraIntroAudios blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `UPDATE intro_audio_template SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ updateWiraIntroAudios failed:", err.message);
        return null;
    }
}

async function deleteWiraIntroAudios(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.text !== undefined && filters.text !== null)
        {
            conditions.push(`"text" = $${paramIndex++}`);
            values.push(filters.text);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            conditions.push(`"language" = $${paramIndex++}`);
            values.push(filters.language);
        }

        if (filters.speaker !== undefined && filters.speaker !== null)
        {
            conditions.push(`"speaker" = $${paramIndex++}`);
            values.push(filters.speaker);
        }

        if (conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const result = await pgDb.query(
            `DELETE FROM intro_audio_template ${whereClause} RETURNING *`,
            values
        );

        return result.rows;
    }
    catch (err)
    {
        console.error("❌ deleteWiraIntroAudios failed:", err.message);
        return null;
    }
}

async function searchWiraIntroAudios(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if (filters.text !== undefined && filters.text !== null)
        {
            conditions.push(`"text" ILIKE $${paramIndex++}`);
            values.push(`%${filters.text}%`);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            conditions.push(`"language" = $${paramIndex++}`);
            values.push(filters.language);
        }

        if (filters.speaker !== undefined && filters.speaker !== null)
        {
            conditions.push(`"speaker" = $${paramIndex++}`);
            values.push(filters.speaker);
        }

        if (filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if (filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        if (filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }

        if (filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(
            `SELECT * FROM intro_audio_template ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            values
        );

        const countResult = await pgDb.query(
            `SELECT COUNT(*) AS count FROM intro_audio_template ${whereClause}`,
            filterValues
        );

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page,
            limit
        };
    }
    catch (err)
    {
        console.error("❌ searchWiraIntroAudios failed:", err.message);
        return null;
    }
}

async function getWiraCandidateByPhone(phone)
{
    try
    {
        const result = await pgDb.query(`SELECT * FROM wira_candidate WHERE "phone" LIKE '%' || $1`, [normalizePhone(phone)]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ getWiraCandidateByPhone failed:", err.message);
        return null;
    }
}
 
async function getWiraCandidateById(id)
{
    try
    {
        const result = await pgDb.query(`SELECT * FROM wira_candidate WHERE "id" = $1 LIMIT 1`, [id]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ getWiraCandidateById failed:", err.message);
        return null;
    }
}
 
async function getWiraCallById(id)
{
    try
    {
        const result = await pgDb.query(`SELECT "id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","transcript","cleanTranscript","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary","createdAt","updatedAt" FROM wira_call WHERE "id" = $1 LIMIT 1`, [id]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ getWiraCallById failed:", err.message);
        return null;
    }
}
 
async function getWiraCallByCallId(callId)
{
    try
    {
        const result = await pgDb.query(`SELECT "id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","transcript","cleanTranscript","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary","createdAt","updatedAt" FROM wira_call WHERE "callId" = $1 LIMIT 1`, [callId]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ getWiraCallByCallId failed:", err.message);
        return null;
    }
}
 
async function getWiraAppByCandidate(wiraCandidateId, webName)
{
    try
    {
        const result = await pgDb.query(`SELECT * FROM wira_app WHERE "wiraCandidateId" = $1 AND "webName" = $2 LIMIT 1`, [wiraCandidateId, webName]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ getWiraAppByCandidate failed:", err.message);
        return null;
    }
}
 
async function getWiraWhatsappByCandidate(wiraCandidateId, webName)
{
    try
    {
        const result = await pgDb.query(`SELECT * FROM wira_whatsapp WHERE "wiraCandidateId" = $1 AND "webName" = $2 LIMIT 1`, [wiraCandidateId, webName]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ getWiraWhatsappByCandidate failed:", err.message);
        return null;
    }
}
 
async function getWiraScreeningByCallId(wiraCallId)
{
    try
    {
        const result = await pgDb.query(`SELECT * FROM wira_outbound_screening WHERE "wiraCallId" = $1 LIMIT 1`, [wiraCallId]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ getWiraScreeningByCallId failed:", err.message);
        return null;
    }
}
 
async function getWiraIntroAudio(text, language, speaker)
{
    try
    {
        const result = await pgDb.query(`SELECT * FROM intro_audio_template WHERE "text" = $1 AND "language" = $2 AND "speaker" = $3 LIMIT 1`, [text, language, speaker]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ getWiraIntroAudio failed:", err.message);
        return null;
    }
}
 
async function getPendingWiraQueues()
{
    try
    {
        const result = await pgDb.query(`SELECT * FROM wira_queue WHERE "executed" = FALSE AND "status" = 'pending' AND "triggerAt" <= NOW() ORDER BY "triggerAt" ASC`);
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ getPendingWiraQueues failed:", err.message);
        return null;
    }
}
 
async function markWiraQueueDone(id, status, message)
{
    try
    {
        const result = await pgDb.query(`UPDATE wira_queue SET "executed" = TRUE, "status" = $1, "message" = $2, "updatedAt" = NOW() WHERE "id" = $3 RETURNING *`, [status, message, id]);
        return result.rows[0] ?? null;
    }
    catch(err)
    {
        console.error("❌ markWiraQueueDone failed:", err.message);
        return null;
    }
}

async function fetchCandidateCallsWithScreening(wiraCandidateId, filters = {}, page = 1, limit = 50)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        conditions.push(`wc."wiraCandidateId" = $${paramIndex++}`);
        values.push(wiraCandidateId);

        if(filters.callId !== undefined && filters.callId !== null)
        {
            conditions.push(`wc."callId" = $${paramIndex++}`);
            values.push(filters.callId);
        }

        if(filters.bound !== undefined && filters.bound !== null)
        {
            conditions.push(`wc."bound" = $${paramIndex++}`);
            values.push(filters.bound);
        }

        if(filters.type !== undefined && filters.type !== null)
        {
            conditions.push(`wc."type" = $${paramIndex++}`);
            values.push(filters.type);
        }

        if(filters.status !== undefined && filters.status !== null)
        {
            conditions.push(`wc."status" = $${paramIndex++}`);
            values.push(filters.status);
        }

        if(filters.language !== undefined && filters.language !== null)
        {
            conditions.push(`wc."language" = $${paramIndex++}`);
            values.push(filters.language);
        }

        if(filters.jobTitle !== undefined && filters.jobTitle !== null)
        {
            conditions.push(`wos."jobTitle" ILIKE $${paramIndex++}`);
            values.push(`%${filters.jobTitle}%`);
        }

        if(filters.companyName !== undefined && filters.companyName !== null)
        {
            conditions.push(`wos."companyName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.companyName}%`);
        }

        if(filters.hangupBy !== undefined && filters.hangupBy !== null)
        {
            conditions.push(`wos."hangupBy" = $${paramIndex++}`);
            values.push(filters.hangupBy);
        }

        if(filters.hangupCause !== undefined && filters.hangupCause !== null)
        {
            conditions.push(`wos."hangupCause" = $${paramIndex++}`);
            values.push(filters.hangupCause);
        }

        if(filters.interest !== undefined && filters.interest !== null)
        {
            conditions.push(`wos."interest" = $${paramIndex++}`);
            values.push(filters.interest);
        }

        if(filters.jobInterest !== undefined && filters.jobInterest !== null)
        {
            conditions.push(`wos."jobInterest" = $${paramIndex++}`);
            values.push(filters.jobInterest);
        }

        if(filters.scoreMin !== undefined && filters.scoreMin !== null)
        {
            conditions.push(`wos."score" >= $${paramIndex++}`);
            values.push(filters.scoreMin);
        }

        if(filters.scoreMax !== undefined && filters.scoreMax !== null)
        {
            conditions.push(`wos."score" <= $${paramIndex++}`);
            values.push(filters.scoreMax);
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(`SELECT wc."id","wiraCandidateId","callId","fromPhone","bound","type","status","webName","intro","language","duration","recordingUrl","hangupBy","hangupReason","hangupCause","interest","startedAt","endedAt","preCost","sarvamTotalCost","plivoTotalCost","geminiTotalCost","geminiPostCost","totalCost","summary",wc."createdAt",wc."updatedAt",wos."id" AS "screeningId","jobId","jobTitle","companyName","score","scoreReason","jobInterest" FROM wira_call wc LEFT JOIN wira_outbound_screening wos ON wos."wiraCallId" = wc."id" ${whereClause} ORDER BY wc."createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_call wc LEFT JOIN wira_outbound_screening wos ON wos."wiraCallId" = wc."id" ${whereClause}`, filterValues);

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ fetchCandidateCallsWithScreening failed:", err.message);
        return null;
    }
}

async function checkWiraFileExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wireCandidateId !== undefined && filters.wireCandidateId !== null)
        {
            conditions.push(`"wireCandidateId" = $${paramIndex++}`);
            values.push(filters.wireCandidateId);
        }

        if(filters.fileName !== undefined && filters.fileName !== null)
        {
            conditions.push(`"fileName" = $${paramIndex++}`);
            values.push(filters.fileName);
        }

        if(filters.fileType !== undefined && filters.fileType !== null)
        {
            conditions.push(`"fileType" = $${paramIndex++}`);
            values.push(filters.fileType);
        }

        if(filters.extracted !== undefined && filters.extracted !== null)
        {
            conditions.push(`"extracted" = $${paramIndex++}`);
            values.push(filters.extracted);
        }

        if(conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`SELECT 1 FROM wira_files ${whereClause} LIMIT 1`, values);
        return result.rows.length > 0;
    }
    catch(err)
    {
        console.error("❌ checkWiraFileExists failed:", err.message);
        return false;
    }
}

async function fetchWiraFiles(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wireCandidateId !== undefined && filters.wireCandidateId !== null)
        {
            conditions.push(`"wireCandidateId" = $${paramIndex++}`);
            values.push(filters.wireCandidateId);
        }

        if(filters.fileName !== undefined && filters.fileName !== null)
        {
            conditions.push(`"fileName" = $${paramIndex++}`);
            values.push(filters.fileName);
        }

        if(filters.fileType !== undefined && filters.fileType !== null)
        {
            conditions.push(`"fileType" = $${paramIndex++}`);
            values.push(filters.fileType);
        }

        if(filters.mimeType !== undefined && filters.mimeType !== null)
        {
            conditions.push(`"mimeType" = $${paramIndex++}`);
            values.push(filters.mimeType);
        }

        if(filters.extracted !== undefined && filters.extracted !== null)
        {
            conditions.push(`"extracted" = $${paramIndex++}`);
            values.push(filters.extracted);
        }

        if(filters.excludeFileNames && Array.isArray(filters.excludeFileNames) && filters.excludeFileNames.length > 0)
        {
            conditions.push(`"fileName" != ALL($${paramIndex++})`);
            values.push(filters.excludeFileNames);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(`SELECT * FROM wira_files ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_files ${whereClause}`, filterValues);

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ fetchWiraFiles failed:", err.message);
        return null;
    }
}

async function searchWiraFiles(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wireCandidateId !== undefined && filters.wireCandidateId !== null)
        {
            conditions.push(`"wireCandidateId" = $${paramIndex++}`);
            values.push(filters.wireCandidateId);
        }

        if(filters.fileName !== undefined && filters.fileName !== null)
        {
            conditions.push(`"fileName" ILIKE $${paramIndex++}`);
            values.push(`%${filters.fileName}%`);
        }

        if(filters.fileType !== undefined && filters.fileType !== null)
        {
            conditions.push(`"fileType" = $${paramIndex++}`);
            values.push(filters.fileType);
        }

        if(filters.mimeType !== undefined && filters.mimeType !== null)
        {
            conditions.push(`"mimeType" ILIKE $${paramIndex++}`);
            values.push(`%${filters.mimeType}%`);
        }

        if(filters.extracted !== undefined && filters.extracted !== null)
        {
            conditions.push(`"extracted" = $${paramIndex++}`);
            values.push(filters.extracted);
        }

        if(filters.sizeKbMin !== undefined && filters.sizeKbMin !== null)
        {
            conditions.push(`"sizeKb" >= $${paramIndex++}`);
            values.push(filters.sizeKbMin);
        }

        if(filters.sizeKbMax !== undefined && filters.sizeKbMax !== null)
        {
            conditions.push(`"sizeKb" <= $${paramIndex++}`);
            values.push(filters.sizeKbMax);
        }

        if(filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if(filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        if(filters.updatedStart !== undefined && filters.updatedStart !== null)
        {
            conditions.push(`"updatedAt" >= $${paramIndex++}`);
            values.push(filters.updatedStart);
        }

        if(filters.updatedEnd !== undefined && filters.updatedEnd !== null)
        {
            conditions.push(`"updatedAt" <= $${paramIndex++}`);
            values.push(filters.updatedEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(`SELECT * FROM wira_files ${whereClause} ORDER BY "createdAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_files ${whereClause}`, filterValues);

        return {
            rows: result.rows,
            total: parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ searchWiraFiles failed:", err.message);
        return null;
    }
}

async function insertWiraFile(data = {})
{
    try
    {
        const keys = Object.keys(data);
        const values = keys.map(k => data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgDb.query(`INSERT INTO wira_files (${columns}) VALUES (${placeholders}) RETURNING *`, values);
        return result.rows[0];
    }
    catch(err)
    {
        console.error("❌ insertWiraFile failed:", err.message);
        return null;
    }
}

async function updateWiraFiles(data = {}, filters = {})
{
    try
    {
        const dataKeys = Object.keys(data);

        if(dataKeys.length === 0)
        {
            console.error("❌ updateWiraFiles blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(data[key]);
            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wireCandidateId !== undefined && filters.wireCandidateId !== null)
        {
            conditions.push(`"wireCandidateId" = $${paramIndex++}`);
            values.push(filters.wireCandidateId);
        }

        if(filters.fileName !== undefined && filters.fileName !== null)
        {
            conditions.push(`"fileName" = $${paramIndex++}`);
            values.push(filters.fileName);
        }

        if(conditions.length === 0)
        {
            console.error("❌ updateWiraFiles blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`UPDATE wira_files SET ${setClause}, "updatedAt" = NOW() ${whereClause} RETURNING *`, values);
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ updateWiraFiles failed:", err.message);
        return null;
    }
}

async function deleteWiraFiles(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wireCandidateId !== undefined && filters.wireCandidateId !== null)
        {
            conditions.push(`"wireCandidateId" = $${paramIndex++}`);
            values.push(filters.wireCandidateId);
        }

        if(filters.fileName !== undefined && filters.fileName !== null)
        {
            conditions.push(`"fileName" = $${paramIndex++}`);
            values.push(filters.fileName);
        }

        if(conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`DELETE FROM wira_files ${whereClause} RETURNING *`, values);
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ deleteWiraFiles failed:", err.message);
        return null;
    }
}

async function checkWiraFileChunkExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wiraFileId !== undefined && filters.wiraFileId !== null)
        {
            conditions.push(`"wiraFileId" = $${paramIndex++}`);
            values.push(filters.wiraFileId);
        }

        if(filters.chunkIndex !== undefined && filters.chunkIndex !== null)
        {
            if(filters.wiraFileId === undefined || filters.wiraFileId === null)
            {
                console.error("❌ checkWiraFileChunkExists: chunkIndex requires wiraFileId");
                return false;
            }

            conditions.push(`"chunkIndex" = $${paramIndex++}`);
            values.push(filters.chunkIndex);
        }

        if(conditions.length === 0)
        {
            return false;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`SELECT 1 FROM wira_file_chunks ${whereClause} LIMIT 1`, values);
        return result.rows.length > 0;
    }
    catch(err)
    {
        console.error("❌ checkWiraFileChunkExists failed:", err.message);
        return false;
    }
}

async function fetchWiraFileChunks(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wiraFileId !== undefined && filters.wiraFileId !== null)
        {
            conditions.push(`"wiraFileId" = $${paramIndex++}`);
            values.push(filters.wiraFileId);
        }

        if(filters.chunkIndex !== undefined && filters.chunkIndex !== null)
        {
            if(filters.wiraFileId === undefined || filters.wiraFileId === null)
            {
                console.error("❌ fetchWiraFileChunks: chunkIndex requires wiraFileId");
                return null;
            }

            conditions.push(`"chunkIndex" = $${paramIndex++}`);
            values.push(filters.chunkIndex);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(`SELECT "id","wiraFileId","chunkIndex","content","wordCount","createdAt" FROM wira_file_chunks ${whereClause} ORDER BY "wiraFileId" ASC, "chunkIndex" ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_file_chunks ${whereClause}`, filterValues);

        return {
            rows : result.rows,
            total : parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ fetchWiraFileChunks failed:", err.message);
        return null;
    }
}

async function searchWiraFileChunks(filters = {}, page = 1, limit = 20)
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wiraFileId !== undefined && filters.wiraFileId !== null)
        {
            conditions.push(`"wiraFileId" = $${paramIndex++}`);
            values.push(filters.wiraFileId);
        }

        if(filters.content !== undefined && filters.content !== null)
        {
            conditions.push(`"content" ILIKE $${paramIndex++}`);
            values.push(`%${filters.content}%`);
        }

        if(filters.wordCountMin !== undefined && filters.wordCountMin !== null)
        {
            conditions.push(`"wordCount" >= $${paramIndex++}`);
            values.push(filters.wordCountMin);
        }

        if(filters.wordCountMax !== undefined && filters.wordCountMax !== null)
        {
            conditions.push(`"wordCount" <= $${paramIndex++}`);
            values.push(filters.wordCountMax);
        }

        if(filters.createdStart !== undefined && filters.createdStart !== null)
        {
            conditions.push(`"createdAt" >= $${paramIndex++}`);
            values.push(filters.createdStart);
        }

        if(filters.createdEnd !== undefined && filters.createdEnd !== null)
        {
            conditions.push(`"createdAt" <= $${paramIndex++}`);
            values.push(filters.createdEnd);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const offset = (page - 1) * limit;
        const filterValues = [...values];

        values.push(limit, offset);

        const result = await pgDb.query(`SELECT "id","wiraFileId","chunkIndex","content","wordCount","createdAt" FROM wira_file_chunks ${whereClause} ORDER BY "wiraFileId" ASC, "chunkIndex" ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, values);
        const countResult = await pgDb.query(`SELECT COUNT(*) AS count FROM wira_file_chunks ${whereClause}`, filterValues);

        return {
            rows : result.rows,
            total : parseInt(countResult.rows[0].count),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ searchWiraFileChunks failed:", err.message);
        return null;
    }
}

async function semanticSearchWiraFileChunks(queryEmbedding, threshold = 30, page = 1, limit = 20, filters = {})
{
    const rawThreshold = inverseRemap(threshold / 100);
    const conditions = [];
    const params = [queryEmbedding, rawThreshold];
    let paramIndex = 3;

    if(filters.excludeFileNames !== undefined && filters.excludeFileNames !== null && filters.excludeFileNames.length > 0)
    {
        const placeholders = filters.excludeFileNames.map((_, i) => `$${paramIndex + i}`).join(", ");
        conditions.push(`"wiraFileId" NOT IN (SELECT id FROM wira_files WHERE "fileName" IN (${placeholders}))`);

        params.push(...filters.excludeFileNames);
        paramIndex += filters.excludeFileNames.length;
    }

    if(filters.includeFileNames !== undefined && filters.includeFileNames !== null && filters.includeFileNames.length > 0)
    {
        const placeholders = filters.includeFileNames.map((_, i) => `$${paramIndex + i}`).join(", ");
        conditions.push(`"wiraFileId" IN (SELECT id FROM wira_files WHERE "fileName" IN (${placeholders}))`);
        
        params.push(...filters.includeFileNames);
        paramIndex += filters.includeFileNames.length;
    }

    const extraWhere = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * limit;

    try
    {
        const dataQuery = `SELECT "id","wiraFileId","chunkIndex","content","wordCount","createdAt",1 - (embedding <=> $1::vector) AS "rawSimilarity" FROM wira_file_chunks WHERE "embedding" IS NOT NULL AND 1 - (embedding <=> $1::vector) >= $2 ${extraWhere} ORDER BY "rawSimilarity" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        const countQuery = `SELECT COUNT(*) AS total FROM wira_file_chunks WHERE "embedding" IS NOT NULL AND 1 - (embedding <=> $1::vector) >= $2 ${extraWhere}`;

        const [dataResult, countResult] = await Promise.all([
            pgDb.query(dataQuery, [...params, limit, offset]),
            pgDb.query(countQuery, params)
        ]);

        const rows = dataResult.rows.map(row =>
        {
            const rawSimilarity = row.rawSimilarity;
            const { rawSimilarity: _, ...rest } = row;

            return {
                ...rest,
                similarity: createLogicalSimilarity(rawSimilarity),
                rawSimilarity: rawSimilarity
            };
        });

        return {
            rows: rows,
            total: parseInt(countResult.rows[0].total, 10),
            page: page,
            limit: limit
        };
    }
    catch(err)
    {
        console.error("❌ semanticSearchWiraFileChunks failed:", err.message);
        return null;
    }
}

async function insertWiraFileChunk(data = {})
{
    try
    {
        const keys = Object.keys(data);
        const values = keys.map(k => data[k]);
        const columns = keys.map(k => `"${k}"`).join(", ");
        const placeholders = keys.map((_, i) =>
        {
            if(keys[i] === "embedding")
            {
                return `$${i + 1}::vector`;
            }

            return `$${i + 1}`;
        }).join(", ");

        const result = await pgDb.query(`INSERT INTO wira_file_chunks (${columns}) VALUES (${placeholders}) ON CONFLICT ("wiraFileId", "chunkIndex") DO UPDATE SET "content" = EXCLUDED."content", "wordCount" = EXCLUDED."wordCount", "embedding" = EXCLUDED."embedding" RETURNING "id","wiraFileId","chunkIndex","content","wordCount","createdAt"`, values);
        return result.rows[0];
    }
    catch(err)
    {
        console.error("❌ insertWiraFileChunk failed:", err.message);
        return null;
    }
}

async function updateWiraFileChunks(data = {}, filters = {})
{
    try
    {
        const dataKeys = Object.keys(data);

        if(dataKeys.length === 0)
        {
            console.error("❌ updateWiraFileChunks blocked: no data provided to update");
            return null;
        }

        const values = [];
        let paramIndex = 1;

        const setClause = dataKeys.map(key =>
        {
            values.push(data[key]);
            if(key === "embedding")
            {
                return `"${key}" = $${paramIndex++}::vector`;
            }

            return `"${key}" = $${paramIndex++}`;
        }).join(", ");

        const conditions = [];

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wiraFileId !== undefined && filters.wiraFileId !== null)
        {
            conditions.push(`"wiraFileId" = $${paramIndex++}`);
            values.push(filters.wiraFileId);
        }

        if(filters.chunkIndex !== undefined && filters.chunkIndex !== null)
        {
            if(filters.wiraFileId === undefined || filters.wiraFileId === null)
            {
                console.error("❌ updateWiraFileChunks: chunkIndex requires wiraFileId");
                return null;
            }

            conditions.push(`"chunkIndex" = $${paramIndex++}`);
            values.push(filters.chunkIndex);
        }

        if(conditions.length === 0)
        {
            console.error("❌ updateWiraFileChunks blocked: no filters provided, refusing to update all rows");
            return null;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`UPDATE wira_file_chunks SET ${setClause} ${whereClause} RETURNING "id","wiraFileId","chunkIndex","content","wordCount","createdAt"`, values);
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ updateWiraFileChunks failed:", err.message);
        return null;
    }
}

async function deleteWiraFileChunks(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if(filters.id !== undefined && filters.id !== null)
        {
            conditions.push(`"id" = $${paramIndex++}`);
            values.push(filters.id);
        }

        if(filters.wiraFileId !== undefined && filters.wiraFileId !== null)
        {
            conditions.push(`"wiraFileId" = $${paramIndex++}`);
            values.push(filters.wiraFileId);
        }

        if(filters.chunkIndex !== undefined && filters.chunkIndex !== null)
        {
            if(filters.wiraFileId === undefined || filters.wiraFileId === null)
            {
                console.error("❌ deleteWiraFileChunks: chunkIndex requires wiraFileId");
                return [];
            }

            conditions.push(`"chunkIndex" = $${paramIndex++}`);
            values.push(filters.chunkIndex);
        }

        if(conditions.length === 0)
        {
            return [];
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const result = await pgDb.query(`DELETE FROM wira_file_chunks ${whereClause} RETURNING "id","wiraFileId","chunkIndex","content","wordCount","createdAt"`, values);
        return result.rows;
    }
    catch(err)
    {
        console.error("❌ deleteWiraFileChunks failed:", err.message);
        return null;
    }
}

async function searchCandidatesWithCallsFull(filters = {}, page = 1, limit = 40)
{
    function parseDate(val)
    {
        if (val === undefined || val === null) return null;
        if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }

    function buildAnalysisBlock(ana)
    {
        const n = v => parseFloat(parseFloat(v ?? 0).toFixed(6));
        const i = v => parseInt(v ?? 0);

        return {
            counts:
            {
                totalCandidates: i(ana.totalCandidates),
                totalCalls: i(ana.totalCalls),
                outboundScreeningCalls: i(ana.outboundScreeningCalls),
                byStatus:
                {
                    completed:   i(ana.statusCompleted),
                    noAnswer:    i(ana.statusNoAnswer),
                    failed:      i(ana.statusFailed),
                    busy:        i(ana.statusBusy),
                    canceled:    i(ana.statusCanceled),
                    inProgress:  i(ana.statusInProgress),
                    initiated:   i(ana.statusInitiated),
                    finalizing:  i(ana.statusFinalizing)
                },
                byInterest:
                {
                    high:   i(ana.interestHigh),
                    medium: i(ana.interestMedium),
                    low:    i(ana.interestLow)
                },
                byHangupCause:
                {
                    completed:       i(ana.hangupCauseCompleted),
                    noAnswer:        i(ana.hangupCauseNoAnswer),
                    dropped:         i(ana.hangupCauseDropped),
                    notInterested:   i(ana.hangupCauseNotInterested),
                    candidateEnded:  i(ana.hangupCauseCandidateEnded),
                    busy:            i(ana.hangupCauseBusy),
                    callback:        i(ana.hangupCauseCallback),
                    languageBarrier: i(ana.hangupCauseLanguageBarrier),
                    alreadyPlaced:   i(ana.hangupCauseAlreadyPlaced),
                    system:          i(ana.hangupCauseSystem),
                    unknown:         i(ana.hangupCauseUnknown)
                },
                byJobInterest:
                {
                    high:   i(ana.jobInterestHigh),
                    medium: i(ana.jobInterestMedium),
                    low:    i(ana.jobInterestLow)
                }
            },
            costs:
            {
                totalCost:     n(ana.totalCost),
                totalPreCost:  n(ana.totalPreCost),
                totalPostCost: n(ana.totalPostCost),
                totalGeminiCost: n(ana.totalGeminiCost),
                totalSarvamCost: n(ana.totalSarvamCost),
                totalPlivoCost:  n(ana.totalPlivoCost)
            },
            duration:
            {
                totalDurationSeconds:       i(ana.totalDurationSeconds),
                avgCompletedDurationSeconds: n(ana.avgCompletedDurationSeconds)
            }
        };
    }

    try
    {
        const wcConditions  = [];
        const clConditions  = [];
        const scConditions  = [];
        const wcValues      = [];
        const clValues      = [];
        const scValues      = [];
        let   wcPi          = 1;
        let   clPi          = 1;
        let   scPi          = 1;

        if (filters.candidateId !== undefined && filters.candidateId !== null)
        {
            wcConditions.push(`wc."candidateId" = $${wcPi++}`);
            wcValues.push(filters.candidateId);
        }

        if (filters.phone !== undefined && filters.phone !== null)
        {
            wcConditions.push(`wc."phone" LIKE '%' || $${wcPi++}`);
            wcValues.push(normalizePhone(filters.phone));
        }

        if (filters.email !== undefined && filters.email !== null)
        {
            wcConditions.push(`wc."email" ILIKE $${wcPi++}`);
            wcValues.push(`%${filters.email}%`);
        }

        if (filters.name !== undefined && filters.name !== null)
        {
            wcConditions.push(`wc."name" ILIKE $${wcPi++}`);
            wcValues.push(`%${filters.name}%`);
        }

        if (filters.hasCall !== undefined && filters.hasCall !== null)
        {
            wcConditions.push(`wc."hasCall" = $${wcPi++}`);
            wcValues.push(filters.hasCall);
        }

        if (filters.hasWhatsapp !== undefined && filters.hasWhatsapp !== null)
        {
            wcConditions.push(`wc."hasWhatsapp" = $${wcPi++}`);
            wcValues.push(filters.hasWhatsapp);
        }

        if (filters.hasApp !== undefined && filters.hasApp !== null)
        {
            wcConditions.push(`wc."hasApp" = $${wcPi++}`);
            wcValues.push(filters.hasApp);
        }

        const candidateCreatedStart = parseDate(filters.candidateCreatedStart);
        if (candidateCreatedStart !== null)
        {
            wcConditions.push(`wc."createdAt" >= $${wcPi++}`);
            wcValues.push(candidateCreatedStart);
        }

        const candidateCreatedEnd = parseDate(filters.candidateCreatedEnd);
        if (candidateCreatedEnd !== null)
        {
            wcConditions.push(`wc."createdAt" <= $${wcPi++}`);
            wcValues.push(candidateCreatedEnd);
        }

        if (filters.callId !== undefined && filters.callId !== null)
        {
            clConditions.push(`cl."callId" ILIKE $${clPi++}`);
            clValues.push(`%${filters.callId}%`);
        }

        if (filters.fromPhone !== undefined && filters.fromPhone !== null)
        {
            clConditions.push(`cl."fromPhone" ILIKE $${clPi++}`);
            clValues.push(`${filters.fromPhone}%`);
        }

        if (filters.bound !== undefined && filters.bound !== null)
        {
            clConditions.push(`cl."bound" = $${clPi++}`);
            clValues.push(filters.bound);
        }

        if (filters.type !== undefined && filters.type !== null)
        {
            clConditions.push(`cl."type" = $${clPi++}`);
            clValues.push(filters.type);
        }

        if (filters.status !== undefined && filters.status !== null)
        {
            clConditions.push(`cl."status" = $${clPi++}`);
            clValues.push(filters.status);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            clConditions.push(`cl."webName" ILIKE $${clPi++}`);
            clValues.push(`%${filters.webName}%`);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            clConditions.push(`cl."language" = $${clPi++}`);
            clValues.push(filters.language);
        }

        if (filters.hangupBy !== undefined && filters.hangupBy !== null)
        {
            clConditions.push(`cl."hangupBy" = $${clPi++}`);
            clValues.push(filters.hangupBy);
        }

        if (filters.hangupCause !== undefined && filters.hangupCause !== null)
        {
            clConditions.push(`cl."hangupCause" = $${clPi++}`);
            clValues.push(filters.hangupCause);
        }

        if (filters.interest !== undefined && filters.interest !== null)
        {
            clConditions.push(`cl."interest" = $${clPi++}`);
            clValues.push(filters.interest);
        }

        const startedAtFrom = parseDate(filters.startedAtFrom);
        if (startedAtFrom !== null)
        {
            clConditions.push(`cl."startedAt" >= $${clPi++}`);
            clValues.push(startedAtFrom);
        }

        const startedAtTo = parseDate(filters.startedAtTo);
        if (startedAtTo !== null)
        {
            clConditions.push(`cl."startedAt" <= $${clPi++}`);
            clValues.push(startedAtTo);
        }

        const endedAtFrom = parseDate(filters.endedAtFrom);
        if (endedAtFrom !== null)
        {
            clConditions.push(`cl."endedAt" >= $${clPi++}`);
            clValues.push(endedAtFrom);
        }

        const endedAtTo = parseDate(filters.endedAtTo);
        if (endedAtTo !== null)
        {
            clConditions.push(`cl."endedAt" <= $${clPi++}`);
            clValues.push(endedAtTo);
        }

        const callCreatedStart = parseDate(filters.callCreatedStart);
        if (callCreatedStart !== null)
        {
            clConditions.push(`cl."createdAt" >= $${clPi++}`);
            clValues.push(callCreatedStart);
        }

        const callCreatedEnd = parseDate(filters.callCreatedEnd);
        if (callCreatedEnd !== null)
        {
            clConditions.push(`cl."createdAt" <= $${clPi++}`);
            clValues.push(callCreatedEnd);
        }

        if (filters.durationMin !== undefined && filters.durationMin !== null)
        {
            clConditions.push(`cl."duration" >= $${clPi++}`);
            clValues.push(filters.durationMin);
        }

        if (filters.durationMax !== undefined && filters.durationMax !== null)
        {
            clConditions.push(`cl."duration" <= $${clPi++}`);
            clValues.push(filters.durationMax);
        }

        if (filters.totalCostMin !== undefined && filters.totalCostMin !== null)
        {
            clConditions.push(`cl."totalCost" >= $${clPi++}`);
            clValues.push(filters.totalCostMin);
        }

        if (filters.totalCostMax !== undefined && filters.totalCostMax !== null)
        {
            clConditions.push(`cl."totalCost" <= $${clPi++}`);
            clValues.push(filters.totalCostMax);
        }

        if (filters.wiraCallIds !== undefined && filters.wiraCallIds !== null && filters.wiraCallIds.length > 0)
        {
            const ids = filters.wiraCallIds.map(() => `$${clPi++}`).join(", ");
            clConditions.push(`cl."id" IN (${ids})`);
            clValues.push(...filters.wiraCallIds);
        }

        if (filters.jobId !== undefined && filters.jobId !== null)
        {
            scConditions.push(`sc."jobId" = $${scPi++}`);
            scValues.push(filters.jobId);
        }

        if (filters.jobTitle !== undefined && filters.jobTitle !== null)
        {
            scConditions.push(`sc."jobTitle" ILIKE $${scPi++}`);
            scValues.push(`%${filters.jobTitle}%`);
        }

        if (filters.companyName !== undefined && filters.companyName !== null)
        {
            scConditions.push(`sc."companyName" ILIKE $${scPi++}`);
            scValues.push(`%${filters.companyName}%`);
        }

        if (filters.scoreMin !== undefined && filters.scoreMin !== null)
        {
            scConditions.push(`sc."score" >= $${scPi++}`);
            scValues.push(filters.scoreMin);
        }

        if (filters.scoreMax !== undefined && filters.scoreMax !== null)
        {
            scConditions.push(`sc."score" <= $${scPi++}`);
            scValues.push(filters.scoreMax);
        }

        if (filters.jobInterest !== undefined && filters.jobInterest !== null)
        {
            scConditions.push(`sc."jobInterest" = $${scPi++}`);
            scValues.push(filters.jobInterest);
        }

        const hasCallFilter      = clConditions.length > 0;
        const hasScreeningFilter = scConditions.length > 0;
        const hasJoinFilter      = hasCallFilter || hasScreeningFilter;

        const allValues = [...wcValues, ...clValues, ...scValues];

        const reindexed = (() =>
        {
            let idx = 1;
            const wc = wcConditions.map(c => c.replace(/\$\d+/g, () => `$${idx++}`));
            const cl = clConditions.map(c => c.replace(/\$\d+/g, () => `$${idx++}`));
            const sc = scConditions.map(c => c.replace(/\$\d+/g, () => `$${idx++}`));
            return { wc, cl, sc, nextIdx: idx };
        })();

        const wherePartsBase = [...reindexed.wc];
        if (hasJoinFilter) wherePartsBase.push(`cl."id" IS NOT NULL`);

        const whereClauseBase = wherePartsBase.length > 0
            ? `WHERE ${wherePartsBase.join(" AND ")}`
            : "";

        const clJoinOn = reindexed.cl.length > 0
            ? `AND ${reindexed.cl.join(" AND ")}`
            : "";

        const scJoinOn = reindexed.sc.length > 0
            ? `AND ${reindexed.sc.join(" AND ")}`
            : "";

        const offset = (page - 1) * limit;
        const limitIdx  = reindexed.nextIdx;
        const offsetIdx = reindexed.nextIdx + 1;

        const candidateIdSelect = `
            SELECT DISTINCT ON (wc."id") wc."id", wc."createdAt"
            FROM wira_candidate wc
            LEFT JOIN wira_call cl
                ON cl."wiraCandidateId" = wc."id"
                ${clJoinOn}
            LEFT JOIN wira_outbound_screening sc
                ON sc."wiraCallId" = cl."id"
                ${scJoinOn}
            ${whereClauseBase}
            ORDER BY wc."id", wc."createdAt" DESC
        `;

        const countQuery = `
            SELECT COUNT(*) AS total
            FROM (
                SELECT DISTINCT wc."id"
                FROM wira_candidate wc
                LEFT JOIN wira_call cl
                    ON cl."wiraCandidateId" = wc."id"
                    ${clJoinOn}
                LEFT JOIN wira_outbound_screening sc
                    ON sc."wiraCallId" = cl."id"
                    ${scJoinOn}
                ${whereClauseBase}
            ) AS sub
        `;

        const pagedIdsQuery = `
            SELECT "id"
            FROM (${candidateIdSelect}) AS sub
            ORDER BY "createdAt" DESC
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;

        const analysisQuery = `
            SELECT
                COUNT(DISTINCT wc."id")                                                         AS "totalCandidates",
                COUNT(cl."id")                                                                  AS "totalCalls",
                COUNT(cl."id") FILTER (WHERE cl."type" = 'outbound-screening')                 AS "outboundScreeningCalls",

                COUNT(cl."id") FILTER (WHERE cl."status" = 'completed')                        AS "statusCompleted",
                COUNT(cl."id") FILTER (WHERE cl."status" = 'no_answer')                        AS "statusNoAnswer",
                COUNT(cl."id") FILTER (WHERE cl."status" = 'failed')                           AS "statusFailed",
                COUNT(cl."id") FILTER (WHERE cl."status" = 'busy')                             AS "statusBusy",
                COUNT(cl."id") FILTER (WHERE cl."status" = 'canceled')                         AS "statusCanceled",
                COUNT(cl."id") FILTER (WHERE cl."status" = 'in_progress')                      AS "statusInProgress",
                COUNT(cl."id") FILTER (WHERE cl."status" = 'initiated')                        AS "statusInitiated",
                COUNT(cl."id") FILTER (WHERE cl."status" = 'finalizing')                       AS "statusFinalizing",

                COUNT(cl."id") FILTER (WHERE cl."interest" = 'HIGH')                           AS "interestHigh",
                COUNT(cl."id") FILTER (WHERE cl."interest" = 'MEDIUM')                         AS "interestMedium",
                COUNT(cl."id") FILTER (WHERE cl."interest" = 'LOW')                            AS "interestLow",

                COUNT(sc."id") FILTER (WHERE sc."jobInterest" = 'HIGH')                        AS "jobInterestHigh",
                COUNT(sc."id") FILTER (WHERE sc."jobInterest" = 'MEDIUM')                      AS "jobInterestMedium",
                COUNT(sc."id") FILTER (WHERE sc."jobInterest" = 'LOW')                         AS "jobInterestLow",

                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'conversation_completed')      AS "hangupCauseCompleted",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'no_answer'
                                           OR cl."hangupCause" = 'no_response')               AS "hangupCauseNoAnswer",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'call_dropped')                AS "hangupCauseDropped",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'candidate_not_interested')    AS "hangupCauseNotInterested",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'candidate_ended_call')        AS "hangupCauseCandidateEnded",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'candidate_busy')              AS "hangupCauseBusy",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'requested_callback')          AS "hangupCauseCallback",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'language_barrier')            AS "hangupCauseLanguageBarrier",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'candidate_already_placed')    AS "hangupCauseAlreadyPlaced",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'system_ended_call')           AS "hangupCauseSystem",
                COUNT(cl."id") FILTER (WHERE cl."hangupCause" = 'unknown'
                                           OR cl."hangupCause" = 'failed')                    AS "hangupCauseUnknown",

                COALESCE(SUM(cl."totalCost"),       0)                                          AS "totalCost",
                COALESCE(SUM(cl."preCost"),         0)                                          AS "totalPreCost",
                COALESCE(SUM(cl."geminiPostCost"),  0)                                          AS "totalPostCost",
                COALESCE(SUM(cl."geminiTotalCost"), 0)                                          AS "totalGeminiCost",
                COALESCE(SUM(cl."sarvamTotalCost"), 0)                                          AS "totalSarvamCost",
                COALESCE(SUM(cl."plivoTotalCost"),  0)                                          AS "totalPlivoCost",

                COALESCE(SUM(cl."duration"),        0)                                          AS "totalDurationSeconds",
                COALESCE(AVG(cl."duration") FILTER (WHERE cl."duration" IS NOT NULL
                    AND cl."status" = 'completed'), 0)                                          AS "avgCompletedDurationSeconds"

            FROM wira_candidate wc
            LEFT JOIN wira_call cl
                ON cl."wiraCandidateId" = wc."id"
                ${clJoinOn}
            LEFT JOIN wira_outbound_screening sc
                ON sc."wiraCallId" = cl."id"
                ${scJoinOn}
            ${whereClauseBase}
        `;

        const pagedValues = [...allValues, limit, offset];

        const [countResult, analysisResult, pagedIdsResult] = await Promise.all(
        [
            pgDb.query(countQuery,    allValues),
            pgDb.query(analysisQuery, allValues),
            pgDb.query(pagedIdsQuery, pagedValues)
        ]);

        const total              = parseInt(countResult.rows[0]?.total ?? 0);
        const analysis           = buildAnalysisBlock(analysisResult.rows[0] ?? {});
        const pagedCandidateIds  = pagedIdsResult.rows.map(r => r.id);

        if (pagedCandidateIds.length === 0)
        {
            return {
                candidates: [],
                total,
                analysis
            };
        }

        let dIdx = 2;
        const dataExtraConditions = [];
        const dataExtraValues     = [];

        if (hasJoinFilter) dataExtraConditions.push(`cl."id" IS NOT NULL`);

        const dataClJoinParts = [];
        const dataScJoinParts = [];

        if (filters.callId !== undefined && filters.callId !== null)
        {
            dataClJoinParts.push(`cl."callId" ILIKE $${dIdx++}`);
            dataExtraValues.push(`%${filters.callId}%`);
        }

        if (filters.fromPhone !== undefined && filters.fromPhone !== null)
        {
            dataClJoinParts.push(`cl."fromPhone" ILIKE $${dIdx++}`);
            dataExtraValues.push(`${filters.fromPhone}%`);
        }

        if (filters.bound !== undefined && filters.bound !== null)
        {
            dataClJoinParts.push(`cl."bound" = $${dIdx++}`);
            dataExtraValues.push(filters.bound);
        }

        if (filters.type !== undefined && filters.type !== null)
        {
            dataClJoinParts.push(`cl."type" = $${dIdx++}`);
            dataExtraValues.push(filters.type);
        }

        if (filters.status !== undefined && filters.status !== null)
        {
            dataClJoinParts.push(`cl."status" = $${dIdx++}`);
            dataExtraValues.push(filters.status);
        }

        if (filters.webName !== undefined && filters.webName !== null)
        {
            dataClJoinParts.push(`cl."webName" ILIKE $${dIdx++}`);
            dataExtraValues.push(`%${filters.webName}%`);
        }

        if (filters.language !== undefined && filters.language !== null)
        {
            dataClJoinParts.push(`cl."language" = $${dIdx++}`);
            dataExtraValues.push(filters.language);
        }

        if (filters.hangupBy !== undefined && filters.hangupBy !== null)
        {
            dataClJoinParts.push(`cl."hangupBy" = $${dIdx++}`);
            dataExtraValues.push(filters.hangupBy);
        }

        if (filters.hangupCause !== undefined && filters.hangupCause !== null)
        {
            dataClJoinParts.push(`cl."hangupCause" = $${dIdx++}`);
            dataExtraValues.push(filters.hangupCause);
        }

        if (filters.interest !== undefined && filters.interest !== null)
        {
            dataClJoinParts.push(`cl."interest" = $${dIdx++}`);
            dataExtraValues.push(filters.interest);
        }

        if (startedAtFrom !== null)
        {
            dataClJoinParts.push(`cl."startedAt" >= $${dIdx++}`);
            dataExtraValues.push(startedAtFrom);
        }

        if (startedAtTo !== null)
        {
            dataClJoinParts.push(`cl."startedAt" <= $${dIdx++}`);
            dataExtraValues.push(startedAtTo);
        }

        if (endedAtFrom !== null)
        {
            dataClJoinParts.push(`cl."endedAt" >= $${dIdx++}`);
            dataExtraValues.push(endedAtFrom);
        }

        if (endedAtTo !== null)
        {
            dataClJoinParts.push(`cl."endedAt" <= $${dIdx++}`);
            dataExtraValues.push(endedAtTo);
        }

        if (callCreatedStart !== null)
        {
            dataClJoinParts.push(`cl."createdAt" >= $${dIdx++}`);
            dataExtraValues.push(callCreatedStart);
        }

        if (callCreatedEnd !== null)
        {
            dataClJoinParts.push(`cl."createdAt" <= $${dIdx++}`);
            dataExtraValues.push(callCreatedEnd);
        }

        if (filters.durationMin !== undefined && filters.durationMin !== null)
        {
            dataClJoinParts.push(`cl."duration" >= $${dIdx++}`);
            dataExtraValues.push(filters.durationMin);
        }

        if (filters.durationMax !== undefined && filters.durationMax !== null)
        {
            dataClJoinParts.push(`cl."duration" <= $${dIdx++}`);
            dataExtraValues.push(filters.durationMax);
        }

        if (filters.totalCostMin !== undefined && filters.totalCostMin !== null)
        {
            dataClJoinParts.push(`cl."totalCost" >= $${dIdx++}`);
            dataExtraValues.push(filters.totalCostMin);
        }

        if (filters.totalCostMax !== undefined && filters.totalCostMax !== null)
        {
            dataClJoinParts.push(`cl."totalCost" <= $${dIdx++}`);
            dataExtraValues.push(filters.totalCostMax);
        }

        if (filters.jobId !== undefined && filters.jobId !== null)
        {
            dataScJoinParts.push(`sc."jobId" = $${dIdx++}`);
            dataExtraValues.push(filters.jobId);
        }

        if (filters.jobTitle !== undefined && filters.jobTitle !== null)
        {
            dataScJoinParts.push(`sc."jobTitle" ILIKE $${dIdx++}`);
            dataExtraValues.push(`%${filters.jobTitle}%`);
        }

        if (filters.companyName !== undefined && filters.companyName !== null)
        {
            dataScJoinParts.push(`sc."companyName" ILIKE $${dIdx++}`);
            dataExtraValues.push(`%${filters.companyName}%`);
        }

        if (filters.scoreMin !== undefined && filters.scoreMin !== null)
        {
            dataScJoinParts.push(`sc."score" >= $${dIdx++}`);
            dataExtraValues.push(filters.scoreMin);
        }

        if (filters.scoreMax !== undefined && filters.scoreMax !== null)
        {
            dataScJoinParts.push(`sc."score" <= $${dIdx++}`);
            dataExtraValues.push(filters.scoreMax);
        }

        if (filters.jobInterest !== undefined && filters.jobInterest !== null)
        {
            dataScJoinParts.push(`sc."jobInterest" = $${dIdx++}`);
            dataExtraValues.push(filters.jobInterest);
        }

        const dataClJoinOn = dataClJoinParts.length > 0 ? `AND ${dataClJoinParts.join(" AND ")}` : "";
        const dataScJoinOn = dataScJoinParts.length > 0 ? `AND ${dataScJoinParts.join(" AND ")}` : "";

        const dataWhereClause = dataExtraConditions.length > 0
            ? `AND ${dataExtraConditions.join(" AND ")}`
            : "";

        const dataQuery = `
            SELECT
                wc."id"                  AS "wc_id",
                wc."phone"               AS "wc_phone",
                wc."candidateId"         AS "wc_candidateId",
                wc."candidateData"       AS "wc_candidateData",
                wc."name"                AS "wc_name",
                wc."email"               AS "wc_email",
                wc."hasCall"             AS "wc_hasCall",
                wc."hasWhatsapp"         AS "wc_hasWhatsapp",
                wc."hasApp"              AS "wc_hasApp",
                wc."insights"            AS "wc_insights",
                wc."createdAt"           AS "wc_createdAt",
                wc."updatedAt"           AS "wc_updatedAt",

                cl."id"                  AS "callId_pk",
                cl."callId",
                cl."fromPhone",
                cl."bound",
                cl."type",
                cl."status",
                cl."webName"             AS "callWebName",
                cl."intro",
                cl."language",
                cl."transcript",
                cl."cleanTranscript",
                cl."duration",
                cl."recordingUrl",
                cl."hangupBy",
                cl."hangupReason",
                cl."hangupCause",
                cl."interest",
                cl."startedAt",
                cl."endedAt",
                cl."preCost",
                cl."sarvamTotalCost",
                cl."plivoTotalCost",
                cl."geminiTotalCost",
                cl."geminiPostCost",
                cl."totalCost",
                cl."summary",
                cl."createdAt"           AS "callCreatedAt",
                cl."updatedAt"           AS "callUpdatedAt",

                sc."id"                  AS "sc_id",
                sc."jobId"               AS "sc_jobId",
                sc."jobTitle"            AS "sc_jobTitle",
                sc."jobDescription"      AS "sc_jobDescription",
                sc."companyName"         AS "sc_companyName",
                sc."screeningQuestions"  AS "sc_screeningQuestions",
                sc."screeningQA"         AS "sc_screeningQA",
                sc."score"               AS "sc_score",
                sc."scoreReason"         AS "sc_scoreReason",
                sc."jobInterest"         AS "sc_jobInterest",
                sc."createdAt"           AS "sc_createdAt",
                sc."updatedAt"           AS "sc_updatedAt"

            FROM wira_candidate wc
            LEFT JOIN wira_call cl
                ON cl."wiraCandidateId" = wc."id"
                ${dataClJoinOn}
            LEFT JOIN wira_outbound_screening sc
                ON sc."wiraCallId" = cl."id"
                ${dataScJoinOn}
            WHERE wc."id" = ANY($1)
            ${dataWhereClause}
            ORDER BY wc."createdAt" DESC, cl."createdAt" DESC
        `;

        const fullDataResult = await pgDb.query(dataQuery, [pagedCandidateIds, ...dataExtraValues]);
        const candidateMap   = new Map();

        for (const row of fullDataResult.rows)
        {
            const cid = row.wc_id;

            if (!candidateMap.has(cid))
            {
                candidateMap.set(cid,
                {
                    id:            row.wc_id,
                    phone:         row.wc_phone,
                    candidateId:   row.wc_candidateId,
                    candidateData: row.wc_candidateData,
                    name:          row.wc_name,
                    email:         row.wc_email,
                    hasCall:       row.wc_hasCall,
                    hasWhatsapp:   row.wc_hasWhatsapp,
                    hasApp:        row.wc_hasApp,
                    insights:      row.wc_insights,
                    createdAt:     row.wc_createdAt,
                    updatedAt:     row.wc_updatedAt,
                    calls:         [],
                    _callIndex:    new Map()
                });
            }

            if (row.callId_pk !== null)
            {
                const candidate = candidateMap.get(cid);

                if (!candidate._callIndex.has(row.callId_pk))
                {
                    const callObject =
                    {
                        id:             row.callId_pk,
                        callId:         row.callId,
                        fromPhone:      row.fromPhone,
                        bound:          row.bound,
                        type:           row.type,
                        status:         row.status,
                        webName:        row.callWebName,
                        intro:          row.intro,
                        language:       row.language,
                        transcript:     row.transcript,
                        cleanTranscript: row.cleanTranscript,
                        duration:       row.duration,
                        recordingUrl:   row.recordingUrl,
                        hangupBy:       row.hangupBy,
                        hangupReason:   row.hangupReason,
                        hangupCause:    row.hangupCause,
                        interest:       row.interest,
                        startedAt:      row.startedAt,
                        endedAt:        row.endedAt,
                        preCost:        row.preCost,
                        sarvamTotalCost: row.sarvamTotalCost,
                        plivoTotalCost:  row.plivoTotalCost,
                        geminiTotalCost: row.geminiTotalCost,
                        geminiPostCost:  row.geminiPostCost,
                        totalCost:      row.totalCost,
                        summary:        row.summary,
                        createdAt:      row.callCreatedAt,
                        updatedAt:      row.callUpdatedAt,
                        childData:      null
                    };

                    candidate._callIndex.set(row.callId_pk, callObject);
                    candidate.calls.push(callObject);
                }

                if (row.sc_id !== null)
                {
                    const callObject     = candidate._callIndex.get(row.callId_pk);
                    callObject.childData =
                    {
                        id:                 row.sc_id,
                        jobId:              row.sc_jobId,
                        jobTitle:           row.sc_jobTitle,
                        jobDescription:     row.sc_jobDescription,
                        companyName:        row.sc_companyName,
                        screeningQuestions: row.sc_screeningQuestions,
                        screeningQA:        row.sc_screeningQA,
                        score:              row.sc_score,
                        scoreReason:        row.sc_scoreReason,
                        jobInterest:        row.sc_jobInterest,
                        createdAt:          row.sc_createdAt,
                        updatedAt:          row.sc_updatedAt
                    };
                }
            }
        }

        const orderedCandidates = pagedCandidateIds
            .map(id => candidateMap.get(id))
            .filter(Boolean)
            .map(c =>
            {
                const { _callIndex, ...candidate } = c;
                return candidate;
            });

        return {
            candidates: orderedCandidates,
            total,
            analysis
        };
    }
    catch(err)
    {
        console.error("searchCandidatesWithCallsFull failed:", err.message);
        throw err;
    }
}

module.exports = {
    checkWiraCandidateExists,
    fetchWiraCandidates,
    searchWiraCandidates,
    insertWiraCandidate,
    updateWiraCandidates,
    deleteWiraCandidates,
    checkWiraCallExists,
    fetchWiraCalls,
    searchWiraCalls,
    semanticSearchWiraCalls,
    insertWiraCall,
    updateWiraCalls,
    deleteWiraCalls,
    checkWiraOutboundScreeningExists,
    fetchWiraOutboundScreenings,
    searchWiraOutboundScreenings,
    insertWiraOutboundScreening,
    updateWiraOutboundScreenings,
    deleteWiraOutboundScreenings,
    checkWiraCallCostExists,
    fetchWiraCallCosts,
    searchWiraCallCosts,
    insertWiraCallCost,
    updateWiraCallCosts,
    deleteWiraCallCosts,
    checkWiraAppExists,
    fetchWiraApps,
    searchWiraApps,
    insertWiraApp,
    updateWiraApps,
    deleteWiraApps,
    checkWiraAppMessageExists,
    fetchWiraAppMessages,
    searchWiraAppMessages,
    semanticSearchWiraAppMessages,
    insertWiraAppMessage,
    updateWiraAppMessages,
    deleteWiraAppMessages,
    checkWiraWhatsappExists,
    fetchWiraWhatsapps,
    searchWiraWhatsapps,
    insertWiraWhatsapp,
    updateWiraWhatsapps,
    deleteWiraWhatsapps,
    checkWiraWhatsappMessageExists,
    fetchWiraWhatsappMessages,
    searchWiraWhatsappMessages,
    semanticSearchWiraWhatsappMessages,
    insertWiraWhatsappMessage,
    updateWiraWhatsappMessages,
    deleteWiraWhatsappMessages,
    checkWiraCacheCostExists,
    fetchWiraCacheCosts,
    searchWiraCacheCosts,
    insertWiraCacheCost,
    updateWiraCacheCosts,
    deleteWiraCacheCosts,
    checkWiraQueueExists,
    fetchWiraQueues,
    searchWiraQueues,
    insertWiraQueue,
    updateWiraQueues,
    deleteWiraQueues,
    checkWiraIntroAudioExists,
    fetchWiraIntroAudios,
    insertWiraIntroAudio,
    updateWiraIntroAudios,
    deleteWiraIntroAudios,
    searchWiraIntroAudios,
    getWiraCandidateByPhone,
    getWiraCandidateById,
    getWiraCallById,
    getWiraCallByCallId,
    getWiraAppByCandidate,
    getWiraWhatsappByCandidate,
    getWiraScreeningByCallId,
    getWiraIntroAudio,
    getPendingWiraQueues,
    markWiraQueueDone,
    fetchCandidateCallsWithScreening,
    checkWiraFileExists,
    fetchWiraFiles,
    searchWiraFiles,
    insertWiraFile,
    updateWiraFiles,
    deleteWiraFiles,
    checkWiraFileChunkExists,
    fetchWiraFileChunks,
    searchWiraFileChunks,
    semanticSearchWiraFileChunks,
    insertWiraFileChunk,
    updateWiraFileChunks,
    deleteWiraFileChunks,
    searchCandidatesWithCallsFull
};