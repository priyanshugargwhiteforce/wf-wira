const db = require("./pgDb");

const inMin = 0.50;
const inMax = 0.70;
const outMin = 0;
const outMax = 1;

function remapSimilarity(x)
{
  x = Math.max(inMin, Math.min(inMax, x));
  const remapped = ((x - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
  return parseFloat(remapped.toFixed(4));
}

function createLogicalSimilarity(rawSimilarity)
{
  const remapped = remapSimilarity(rawSimilarity);
  let score = remapped * 100;

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

function inverseRemap(y)
{
  const x = ((y - outMin) / (outMax - outMin)) * (inMax - inMin) + inMin;
  return parseFloat(x.toFixed(4));
}

function normalizeGender(gender, addedFrom)
{
  if(!gender)
  {
    return "unknown";
  }

  const g = String(gender).trim().toLowerCase();

  if(addedFrom === null || addedFrom === undefined)
  {
    if(g === "male")
    {
      return "male";
    }

    if(g === "female")
    {
      return "female";
    }

    return "unknown";
  }

  const maleTokens = ["male", "man", "men", "boy", "masculine", "gents", "mr", "m"];
  const femaleTokens = ["female", "woman", "women", "girl", "feminine", "ladies", "ms", "mrs", "miss", "f"];

  for(const token of maleTokens)
  {
    if(g === token || g.startsWith(token))
    {
      return "male";
    }
  }

  for(const token of femaleTokens)
  {
    if(g === token || g.startsWith(token))
    {
      return "female";
    }
  }

  return "unknown";
}

function normalizeSalary(salary, addedFrom)
{
  if(salary === null || salary === undefined || salary === "")
  {
    return null;
  }

  if(addedFrom === null || addedFrom === undefined)
  {
    const n = parseFloat(String(salary).replace(/,/g, ""));
    return isNaN(n) ? null : Math.round(n);
  }

  const raw = String(salary).trim().toLowerCase();
  const stripped = raw.replace(/[₹$£€,\s\/\-]+/g, "");

  const croreMatch = stripped.match(/^([\d.]+)(cr|crore)$/);
  if(croreMatch)
  {
    return Math.round(parseFloat(croreMatch[1]) * 10000000);
  }

  const lakhMatch = stripped.match(/^([\d.]+)(l|lac|lakh|lpa)$/);
  if(lakhMatch)
  {
    return Math.round(parseFloat(lakhMatch[1]) * 100000);
  }

  const kMatch = stripped.match(/^([\d.]+)k$/);
  if(kMatch) 
  {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }

  const plain = stripped.replace(/[^\d.]/g, "");
  const n = parseFloat(plain);
  return isNaN(n) ? null : Math.round(n);
}

async function insertCandidateEmbedding(id, embedding, data = {})
{
  const client = await db.connect();

  try
  {
    const {
      experience = null,
      title = null,
      location = null,
      country = null,
      state = null,
      city = null,
      address = null,
      qualification = null,
      industry = null,
      gender = null,
      currentSalary = null,
      expectedSalary = null
    } = data;

    await client.query("BEGIN");

    const query = `INSERT INTO candidates (id, embedding, experience, title, location, country, state, city, address, qualification, industry, gender, current_salary, expected_salary) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)  ON CONFLICT (id) DO UPDATE SET embedding = COALESCE(EXCLUDED.embedding, candidates.embedding),  experience = COALESCE(EXCLUDED.experience, candidates.experience),  title = COALESCE(EXCLUDED.title, candidates.title),  location = COALESCE(EXCLUDED.location, candidates.location),  country = COALESCE(EXCLUDED.country, candidates.country),  state = COALESCE(EXCLUDED.state, candidates.state),  city = COALESCE(EXCLUDED.city, candidates.city),  address = COALESCE(EXCLUDED.address, candidates.address),  qualification = COALESCE(EXCLUDED.qualification, candidates.qualification),  industry = COALESCE(EXCLUDED.industry, candidates.industry),  gender = COALESCE(EXCLUDED.gender, candidates.gender),  current_salary = COALESCE(EXCLUDED.current_salary, candidates.current_salary),  expected_salary = COALESCE(EXCLUDED.expected_salary, candidates.expected_salary)`;
    await client.query(query, [id, embedding, experience, title, location, country, state, city, address, qualification, industry, gender, currentSalary, expectedSalary]);

    await client.query("COMMIT");
    return true;
  }
  catch (err)
  {
    await client.query("ROLLBACK");
    console.error("❌ Candidate insert failed:", err.message);
    return false;
  }
  finally
  {
    client.release();
  }
}

async function insertJobEmbedding(id, embedding, data = {})
{
  const client = await db.connect();

  try
  {
    const {
      country = null,
      state = null,
      city = null,
      location = null,
      minSalary = null,
      maxSalary = null,
      minExperience = null,
      maxExperience = null,
      industry = null,
      status = null
    } = data;

    await client.query("BEGIN");

    const query = `INSERT INTO jobs (id, embedding, country, state, city, location, min_salary, max_salary, min_year_exp, max_year_exp, industry, status)  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)  ON CONFLICT (id) DO UPDATE SET embedding = COALESCE(EXCLUDED.embedding, candidates.embedding),  country = COALESCE(EXCLUDED.country, jobs.country),  state = COALESCE(EXCLUDED.state, jobs.state),  city = COALESCE(EXCLUDED.city, jobs.city),  location = COALESCE(EXCLUDED.location, jobs.location),  min_salary = COALESCE(EXCLUDED.min_salary, jobs.min_salary),  max_salary = COALESCE(EXCLUDED.max_salary, jobs.max_salary),  min_year_exp = COALESCE(EXCLUDED.min_year_exp, jobs.min_year_exp),  max_year_exp = COALESCE(EXCLUDED.max_year_exp, jobs.max_year_exp),  industry = COALESCE(EXCLUDED.industry, jobs.industry),  status = COALESCE(EXCLUDED.status, jobs.status)`;
    await client.query(query, [id, embedding, country, state, city, location, minSalary, maxSalary, minExperience, maxExperience, industry, status]);

    await client.query("COMMIT");
    return true;
  }
  catch (err)
  {
    await client.query("ROLLBACK");
    console.error("❌ Job insert failed:", err.message);
    return false;
  }
  finally
  {
    client.release();
  }
}

async function getCandidateCount()
{
  const client = await db.connect();

  try
  {
    const { rows } = await client.query("SELECT COUNT(*) AS count FROM candidates");
    return parseInt(rows[0].count);
  }
  catch(err)
  {
    console.error("❌ Candidate count failed:", err.message);
    return null;
  }
  finally
  {
    client.release();
  }
}

async function getJobCount()
{
  const client = await db.connect();

  try
  {
    const { rows } = await client.query("SELECT COUNT(*) AS count FROM jobs");
    return parseInt(rows[0].count);
  }
  catch (err)
  {
    console.error("❌ Job count failed:", err.message);
    return null;
  }
  finally
  {
    client.release();
  }
}

async function searchCandidates(queryEmbedding, limit = 10, offset = 0, threshold = 30, filters = {})
{
  const rawThreshold = inverseRemap(threshold / 100);

  const {
    country,
    state,
    city,
    location,
    experience,
    qualification,
    industry,
    gender,
    minCurrentSalary,
    maxCurrentSalary,
    minExpectedSalary,
    maxExpectedSalary
  } = filters;

  const conditions = [];
  const params = [queryEmbedding, rawThreshold];
  let paramIndex = 3;

  if(country)       
  {
    conditions.push(`country ILIKE $${paramIndex++}`); 
    params.push(`%${country}%`); 
  }

  if(state) 
  {
    conditions.push(`state ILIKE $${paramIndex++}`);
    params.push(`%${state}%`);
  }

  if(city) 
  {
    conditions.push(`city ILIKE $${paramIndex++}`);
    params.push(`%${city}%`);
  }

  if(location) 
  {
    conditions.push(`location ILIKE $${paramIndex++}`);
    params.push(`%${location}%`);
  }

  if(experience) 
  {
    conditions.push(`experience ILIKE $${paramIndex++}`);
    params.push(`%${experience}%`);
  }

  if(qualification) 
  {
    conditions.push(`qualification ILIKE $${paramIndex++}`);
    params.push(`%${qualification}%`);
  }

  if(industry) 
  {
    conditions.push(`industry ILIKE $${paramIndex++}`);
    params.push(`%${industry}%`);
  }

  if(gender) 
  {
    conditions.push(`gender = $${paramIndex++}`);
    params.push(gender);
  }

  if(minCurrentSalary) 
  {
    conditions.push(`current_salary >= $${paramIndex++}`);
    params.push(minCurrentSalary);
  }

  if(maxCurrentSalary) 
  {
    conditions.push(`current_salary <= $${paramIndex++}`);
    params.push(maxCurrentSalary);
  }

  if(minExpectedSalary) 
  {
    conditions.push(`expected_salary >= $${paramIndex++}`);
    params.push(minExpectedSalary);
  }

  if(maxExpectedSalary) 
  {
    conditions.push(`expected_salary <= $${paramIndex++}`);
    params.push(maxExpectedSalary);
  }

  const extraWhere = conditions.length ? `AND ${conditions.join(" AND ")}` : "";

  try
  {
    const dataQuery = `SELECT id, created_at, updated_at, 1 - (embedding <=> $1) AS similarity  FROM candidates  WHERE 1 - (embedding <=> $1) >= $2  ${extraWhere}  ORDER BY similarity DESC  LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const countQuery = `SELECT COUNT(*) AS total  FROM candidates  WHERE 1 - (embedding <=> $1) >= $2  ${extraWhere} `;

    const [dataResult, countResult] = await Promise.all([
      db.query(dataQuery, [...params, limit, offset]),
      db.query(countQuery, params)
    ]);

    const rows = dataResult.rows.map((row) => {
      return {
        id: row.id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        similarity: createLogicalSimilarity(row.similarity),
        rawSimilarity: row.similarity
      }
    });

    return {
      rows: rows,
      total: parseInt(countResult.rows[0].total, 10)
    };
  }
  catch(err)
  {
    console.error("❌ Candidate search failed:", err.message);

    return { 
      rows: [], 
      total: 0 
    };
  }
}

async function searchJobs(queryEmbedding, limit = 10, offset = 0, threshold = 30, filters = {}, jobIds = [])
{
  const rawThreshold = inverseRemap(threshold / 100);

  const {
    country,
    state,
    city,
    location,
    minSalary,
    maxSalary,
    minExperience,
    maxExperience,
    industry,
    status
  } = filters;

  const conditions = [];
  const params = [queryEmbedding, rawThreshold];
  let paramIndex = 3;

  if(country)
  { 
    conditions.push(`country ILIKE $${paramIndex++}`);       
    params.push(`%${country}%`); 
  }

  if(state)         
  { 
    conditions.push(`state ILIKE $${paramIndex++}`);          
    params.push(`%${state}%`); 
  }

  if(city)          
  { 
    conditions.push(`city ILIKE $${paramIndex++}`);           
    params.push(`%${city}%`); 
  }

  if(location)      
  { 
    conditions.push(`location ILIKE $${paramIndex++}`);       
    params.push(`%${location}%`); 
  }

  if(industry)      
  { 
    conditions.push(`industry ILIKE $${paramIndex++}`);       
    params.push(`%${industry}%`); 
  }

  if(status)        
  { 
    conditions.push(`status = $${paramIndex++}`);             
    params.push(status); 
  }

  if(minSalary)     
  { 
    conditions.push(`min_salary >= $${paramIndex++}`);        
    params.push(minSalary); 
  }

  if(maxSalary)     
  { 
    conditions.push(`max_salary <= $${paramIndex++}`);        
    params.push(maxSalary); 
  }

  if(minExperience) 
  { 
    conditions.push(`min_year_exp >= $${paramIndex++}`);      
    params.push(minExperience); 
  }

  if(maxExperience) 
  { 
    conditions.push(`max_year_exp <= $${paramIndex++}`);      
    params.push(maxExperience); 
  }

  if(jobIds && jobIds.length > 0)
  {
    conditions.push(`id = ANY($${paramIndex++})`);
    params.push(jobIds);
  }

  const extraWhere = conditions.length ? `AND ${conditions.join(" AND ")}` : "";

  try
  {
    const dataQuery = `SELECT id, created_at, updated_at, 1 - (embedding <=> $1) AS similarity  FROM jobs  WHERE 1 - (embedding <=> $1) >= $2  ${extraWhere}  ORDER BY similarity DESC  LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const countQuery = `SELECT COUNT(*) AS total  FROM jobs  WHERE 1 - (embedding <=> $1) >= $2 ${extraWhere}`;

    const [dataResult, countResult] = await Promise.all([
      db.query(dataQuery, [...params, limit, offset]),
      db.query(countQuery, params)
    ]);

    const rows = dataResult.rows.map((row) => {
      return {
        id: row.id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        similarity: createLogicalSimilarity(row.similarity),
        rawSimilarity: row.similarity
      }
    });

    return {
      rows,
      total: parseInt(countResult.rows[0].total, 10)
    };
  }
  catch(err)
  {
    console.error("❌ Job search failed:", err.message);

    return { 
      rows: [], 
      total: 0 
    };
  }
}

async function getCandidateEmbedding(id)
{
  const client = await db.connect();

  try
  {
    const { rows } = await client.query("SELECT embedding, created_at, updated_at FROM candidates WHERE id = $1", [id]);
    return rows.length ? rows[0] : null;
  }
  catch(err)
  {
    console.error("❌ Get candidate embedding failed:", err.message);
    return null;
  }
  finally
  {
    client.release();
  }
}

async function getJobEmbedding(id)
{
  const client = await db.connect();

  try
  {
    const { rows } = await client.query("SELECT embedding, created_at, updated_at FROM jobs WHERE id = $1", [id]);
    return rows.length ? rows[0] : null;
  }
  catch(err)
  {
    console.error("❌ Get job embedding failed:", err.message);
    return null;
  }
  finally
  {
    client.release();
  }
}

async function getCandidateJobSimilarity(candidateId, jobId)
{
  try
  {
    const { rows } = await db.query(`SELECT 1 - (c.embedding <=> j.embedding) AS similarity, c.created_at, c.updated_at, j.created_at AS job_created_at, j.updated_at AS job_updated_at FROM candidates c, jobs j WHERE c.id = $1 AND j.id = $2`, [candidateId, jobId]);

    if(!rows.length)
    {
      return null;
    }

    return {
      similarity: createLogicalSimilarity(rows[0].similarity),
      created_at: rows[0].created_at,
      updated_at: rows[0].updated_at,
      job_created_at: rows[0].job_created_at,
      job_updated_at: rows[0].job_updated_at
    };
  }
  catch(err)
  {
    console.error("❌ Similarity computation failed:", err.message);
    return null;
  }
}

async function getLastMigratedJobId()
{
  const client = await db.connect();

  try
  {
    const { rows } = await client.query("SELECT id FROM jobs ORDER BY id DESC LIMIT 1");
    return rows.length ? rows[0].id : null;
  }
  catch(err)
  {
    console.error("❌ Get last migrated job id failed:", err.message);
    return null;
  }
  finally
  {
    client.release();
  }
}

async function candidateExists(id)
{
  const client = await db.connect();

  try
  {
    const { rows } = await client.query("SELECT 1 FROM candidates WHERE id = $1 LIMIT 1", [id]);
    return rows.length > 0;
  }
  catch (err)
  {
    console.error("❌ Candidate exists check failed:", err.message);
    return false;
  }
  finally
  {
    client.release();
  }
}

async function jobExists(id)
{
  const client = await db.connect();

  try
  {
    const { rows } = await client.query("SELECT 1 FROM jobs WHERE id = $1 LIMIT 1", [id]);
    return rows.length > 0;
  }
  catch (err)
  {
    console.error("❌ Job exists check failed:", err.message);
    return false;
  }
  finally
  {
    client.release();
  }
}

module.exports = {
  insertCandidateEmbedding,
  insertJobEmbedding,
  searchCandidates,
  searchJobs,
  getCandidateCount,
  getJobCount,
  getCandidateEmbedding,
  getJobEmbedding,
  getCandidateJobSimilarity,
  getLastMigratedJobId,
  normalizeGender,
  normalizeSalary,
  candidateExists,
  jobExists
};