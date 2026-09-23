//const db = require("@wira/shared/database/pgDb");
const db = require("../../shared/database/pgDb");

function normalizeSimScore(rawSimilarity, minSim = 0.45, maxSim = 0.77) 
{
    if(rawSimilarity <= minSim)
    {
        return 0;
    }

    if(rawSimilarity >= maxSim)
    {
        return 100;
    }

    return Math.round(((rawSimilarity - minSim) / (maxSim - minSim)) * 100);
}

function mapRow(row)
{
    return {
        id: row.id,
        companyName: row.company_name,
        clientName: row.client_name,
        clientType: row.client_type,
        workDescription: row.work_description,
        location: row.location,
        orderNo: row.order_no,
        contractValueINR: row.contract_value_inr,
        manpower: row.manpower,
        workStart: row.work_start,
        workEnd: row.work_end,
        status: row.status,
        hasCompletionCertificate: row.has_completion_certificate,
        hasExperienceCertificate: row.has_experience_certificate,
    };
}

function mapLicense(row)
{
    return {
        id: row.id,
        companyName: row.company_name,
        licenseType: row.license_type,
        licenseNo: row.license_no,
        issuingAuthority: row.issuing_authority,
        validFrom: row.valid_from,
        validTill: row.valid_till,
        applicableFor: row.applicable_for,
        geographicScope: row.geographic_scope,
        status: row.status,
    };
}

function mapIso(row)
{
    return {
        id: row.id,
        companyName: row.company_name,
        standard: row.standard,
        scope: row.scope,
        certNo: row.cert_no,
        validTill: row.valid_till,
    };
}

function mapPsara(row)
{
    return {
        id: row.id,
        companyName: row.company_name,
        state: row.state,
        licenseNo: row.license_no,
        validTill: row.valid_till,
    };
}

function mapSpecial(row)
{
    return {
        id: row.id,
        companyName: row.company_name,
        certType: row.cert_type,
        licenseNo: row.license_no,
        grade: row.grade,
        issuingAuthority: row.issuing_authority,
        validTill: row.valid_till,
        scope: row.scope,
        geographicScope: row.geographic_scope,
    };
}

function mapFinancials(row)
{
    return {
        id: row.id,
        companyName: row.company_name,
        turnoverFy2024_25: row.turnover_fy2024_25,
        turnoverFy2023_24: row.turnover_fy2023_24,
        turnoverFy2022_23: row.turnover_fy2022_23,
        avgTurnover3yr: row.avg_turnover_3yr,
        netWorthFy2024_25: row.net_worth_fy2024_25,
        netWorthFy2023_24: row.net_worth_fy2023_24,
        netWorthFy2022_23: row.net_worth_fy2022_23,
        bankSolvencyValueLakhs: row.bank_solvency_value_lakhs,
        bankSolvencyIssuingBank: row.bank_solvency_issuing_bank,
        workingCapital: row.working_capital,
        maxManpowerDeployed: row.max_manpower_deployed,
        largestSingleWorkOrderValue: row.largest_single_work_order_value,
        ongoingCommitmentsLakhs: row.ongoing_commitments_lakhs,
    };
}

function mapMsme(row)
{
    return {
        id: row.id,
        companyName: row.company_name,
        udyamNo: row.udyam_no,
        nsicRegNo: row.nsic_reg_no,
        exemptions: row.exemptions,
    };
}

function mapTenderDocument(row)
{
    return {
        id: row.id,
        companyName: row.company_name,
        documentName: row.document_name,
        purpose: row.purpose,
        fileType: row.file_type,
        path: row.path,
        text: row.text,
        isActive: row.is_active,
        uploadedAt: row.uploaded_at,
    };
}

function buildStrictConditions(filters, values, startIndex)
{
    const conditions = [];
    let i = startIndex;

    if(filters.id != null)
    {
        conditions.push(`id = $${i++}`);
        values.push(filters.id);
    }

    if(filters.tdr != null)
    {
        conditions.push(`tdr = $${i++}`);
        values.push(filters.tdr);
    }

    if(filters.tenderNo != null)
    {
        conditions.push(`tender_no = $${i++}`);
        values.push(filters.tenderNo);
    }

    if(filters.tenderId != null)
    {
        conditions.push(`tender_id = $${i++}`);
        values.push(filters.tenderId);
    }

    if(filters.authority != null)
    {
        conditions.push(`authority = $${i++}`);
        values.push(filters.authority);
    }

    if(filters.city != null)
    {
        conditions.push(`city = $${i++}`);
        values.push(filters.city);
    }

    if(filters.state != null)
    {
        conditions.push(`state = $${i++}`);
        values.push(filters.state);
    }

    if(filters.category != null)
    {
        conditions.push(`category = $${i++}`);
        values.push(filters.category);
    }

    if(filters.type != null)
    {
        conditions.push(`type = $${i++}`);
        values.push(filters.type);
    }

    if(filters.tenderCategory != null)
    {
        conditions.push(`tender_category = $${i++}`);
        values.push(filters.tenderCategory);
    }

    if(filters.biddingType != null)
    {
        conditions.push(`bidding_type = $${i++}`);
        values.push(filters.biddingType);
    }

    if(filters.competitionType != null)
    {
        conditions.push(`competition_type = $${i++}`);
        values.push(filters.competitionType);
    }

    if(filters.exemption != null)
    {
        conditions.push(`exemption = $${i++}`);
        values.push(filters.exemption);
    }

    if(filters.gem != null)
    {
        conditions.push(`gem = $${i++}`);
        values.push(filters.gem);
    }

    if(filters.corrigendum != null)
    {
        conditions.push(`corrigendum = $${i++}`);
        values.push(filters.corrigendum);
    }

    if(filters.workingOn != null)
    {
        conditions.push(`working_on = $${i++}`);
        values.push(filters.workingOn);
    }

    if(filters.company != null)
    {
        conditions.push(`company = $${i++}`);
        values.push(filters.company);
    }

    if(filters.person != null)
    {
        conditions.push(`person = $${i++}`);
        values.push(filters.person);
    }

    if(filters.pincode != null)
    {
        conditions.push(`pincode = $${i++}`);
        values.push(filters.pincode);
    }

    if(filters.minValue != null)
    {
        conditions.push(`value >= $${i++}`);
        values.push(filters.minValue);
    }

    if(filters.maxValue != null)
    {
        conditions.push(`value <= $${i++}`);
        values.push(filters.maxValue);
    }

    if(filters.minEmd != null)
    {
        conditions.push(`emd >= $${i++}`);
        values.push(filters.minEmd);
    }

    if(filters.maxEmd != null)
    {
        conditions.push(`emd <= $${i++}`);
        values.push(filters.maxEmd);
    }

    if(filters.publishDateFrom != null)
    {
        conditions.push(`publish_date >= $${i++}`);
        values.push(filters.publishDateFrom);
    }

    if(filters.publishDateTo != null)
    {
        conditions.push(`publish_date <= $${i++}`);
        values.push(filters.publishDateTo);
    }

    if(filters.deadlineFrom != null)
    {
        conditions.push(`deadline >= $${i++}`);
        values.push(filters.deadlineFrom);
    }

    if(filters.deadlineTo != null)
    {
        conditions.push(`deadline <= $${i++}`);
        values.push(filters.deadlineTo);
    }

    if(filters.openingDateFrom != null)
    {
        conditions.push(`opening_date >= $${i++}`);
        values.push(filters.openingDateFrom);
    }

    if(filters.openingDateTo != null)
    {
        conditions.push(`opening_date <= $${i++}`);
        values.push(filters.openingDateTo);
    }

    if(filters.insertedFrom != null)
    {
        conditions.push(`inserted_at >= $${i++}`);
        values.push(filters.insertedFrom);
    }

    if(filters.insertedTo != null)
    {
        conditions.push(`inserted_at <= $${i++}`);
        values.push(filters.insertedTo);
    }

    if(filters.lastSeenFrom != null)
    {
        conditions.push(`last_seen_at >= $${i++}`);
        values.push(filters.lastSeenFrom);
    }

    if(filters.lastSeenTo != null)
    {
        conditions.push(`last_seen_at <= $${i++}`);
        values.push(filters.lastSeenTo);
    }

    return { 
        conditions: conditions, 
        nextIndex: i 
    };
}

function buildLooseConditions(filters, values, startIndex)
{
    const conditions = [];
    let i = startIndex;

    if(filters.id != null)
    {
        conditions.push(`CAST(id AS TEXT) ILIKE $${i++}`);
        values.push(`%${filters.id}%`);
    }

    if(filters.tdr != null)
    {
        conditions.push(`CAST(tdr AS TEXT) ILIKE $${i++}`);
        values.push(`${filters.tdr}%`);
    }

    if(filters.tenderNo != null)
    {
        conditions.push(`tender_no ILIKE $${i++}`);
        values.push(`${filters.tenderNo}%`);
    }

    if(filters.tenderId != null)
    {
        conditions.push(`tender_id ILIKE $${i++}`);
        values.push(`${filters.tenderId}%`);
    }

    if(filters.authority != null)
    {
        conditions.push(`authority ILIKE $${i++}`);
        values.push(`%${filters.authority}%`);
    }

    if(filters.city != null)
    {
        conditions.push(`city ILIKE $${i++}`);
        values.push(`%${filters.city}%`);
    }

    if(filters.state != null)
    {
        conditions.push(`state ILIKE $${i++}`);
        values.push(`%${filters.state}%`);
    }

    if(filters.category != null)
    {
        conditions.push(`category ILIKE $${i++}`);
        values.push(`%${filters.category}%`);
    }

    if(filters.type != null)
    {
        conditions.push(`type ILIKE $${i++}`);
        values.push(`%${filters.type}%`);
    }

    if(filters.tenderCategory != null)
    {
        conditions.push(`tender_category ILIKE $${i++}`);
        values.push(`%${filters.tenderCategory}%`);
    }

    if(filters.biddingType != null)
    {
        conditions.push(`bidding_type ILIKE $${i++}`);
        values.push(`%${filters.biddingType}%`);
    }

    if(filters.competitionType != null)
    {
        conditions.push(`competition_type ILIKE $${i++}`);
        values.push(`%${filters.competitionType}%`);
    }

    if(filters.exemption != null)
    {
        conditions.push(`exemption = $${i++}`);
        values.push(filters.exemption);
    }

    if(filters.gem != null)
    {
        conditions.push(`gem = $${i++}`);
        values.push(filters.gem);
    }

    if(filters.corrigendum != null)
    {
        conditions.push(`corrigendum = $${i++}`);
        values.push(filters.corrigendum);
    }

    if(filters.workingOn != null)
    {
        conditions.push(`working_on = $${i++}`);
        values.push(filters.workingOn);
    }

    if(filters.company != null)
    {
        conditions.push(`company ILIKE $${i++}`);
        values.push(`%${filters.company}%`);
    }

    if(filters.person != null)
    {
        conditions.push(`person ILIKE $${i++}`);
        values.push(`%${filters.person}%`);
    }

    if(filters.pincode != null)
    {
        conditions.push(`pincode ILIKE $${i++}`);
        values.push(`%${filters.pincode}%`);
    }

    if(filters.brief != null)
    {
        conditions.push(`brief ILIKE $${i++}`);
        values.push(`%${filters.brief}%`);
    }

    if(filters.description != null)
    {
        conditions.push(`description ILIKE $${i++}`);
        values.push(`%${filters.description}%`);
    }

    if(filters.minValue != null)
    {
        conditions.push(`value >= $${i++}`);
        values.push(filters.minValue);
    }

    if(filters.maxValue != null)
    {
        conditions.push(`value <= $${i++}`);
        values.push(filters.maxValue);
    }

    if(filters.minEmd != null)
    {
        conditions.push(`emd >= $${i++}`);
        values.push(filters.minEmd);
    }

    if(filters.maxEmd != null)
    {
        conditions.push(`emd <= $${i++}`);
        values.push(filters.maxEmd);
    }

    if(filters.publishDateFrom != null)
    {
        conditions.push(`publish_date >= $${i++}`);
        values.push(filters.publishDateFrom);
    }

    if(filters.publishDateTo != null)
    {
        conditions.push(`publish_date <= $${i++}`);
        values.push(filters.publishDateTo);
    }

    if(filters.deadlineFrom != null)
    {
        conditions.push(`deadline >= $${i++}`);
        values.push(filters.deadlineFrom);
    }

    if(filters.deadlineTo != null)
    {
        conditions.push(`deadline <= $${i++}`);
        values.push(filters.deadlineTo);
    }

    if(filters.openingDateFrom != null)
    {
        conditions.push(`opening_date >= $${i++}`);
        values.push(filters.openingDateFrom);
    }

    if(filters.openingDateTo != null)
    {
        conditions.push(`opening_date <= $${i++}`);
        values.push(filters.openingDateTo);
    }

    if(filters.insertedFrom != null)
    {
        conditions.push(`inserted_at >= $${i++}`);
        values.push(filters.insertedFrom);
    }

    if(filters.insertedTo != null)
    {
        conditions.push(`inserted_at <= $${i++}`);
        values.push(filters.insertedTo);
    }

    if(filters.lastSeenFrom != null)
    {
        conditions.push(`last_seen_at >= $${i++}`);
        values.push(filters.lastSeenFrom);
    }

    if(filters.lastSeenTo != null)
    {
        conditions.push(`last_seen_at <= $${i++}`);
        values.push(filters.lastSeenTo);
    }

    return { 
        conditions: conditions, 
        nextIndex: i 
    };
}

function mapRow2(row)
{
    return {
        id: row.id,
        tdr: row.tdr,
        tenderNo: row.tender_no,
        tenderId: row.tender_id,
        url: row.url,
        category: row.category,
        authority: row.authority,
        city: row.city,
        state: row.state,
        brief: row.brief,
        description: row.description,
        value: row.value,
        valueRaw: row.value_raw,
        emd: row.emd,
        emdRaw: row.emd_raw,
        docFees: row.doc_fees,
        docFeesRaw: row.doc_fees_raw,
        type: row.type,
        tenderCategory: row.tender_category,
        biddingType: row.bidding_type,
        competitionType: row.competition_type,
        exemption: row.exemption,
        gem: row.gem,
        corrigendum: row.corrigendum,
        publishDate: row.publish_date,
        deadline: row.deadline,
        openingDate: row.opening_date,
        company: row.company,
        person: row.person,
        address: row.address,
        pincode: row.pincode,
        source: row.source,
        corrigendums: row.corrigendums,
        docs: row.docs,
        workingOn: row.working_on,
        insertedAt: row.inserted_at,
        lastSeenAt: row.last_seen_at
    };
}

async function searchWorkExperiences(queryEmbedding, limit = 10, offset = 0, threshold = 0.5)
{
    try 
    {
        const query = `
            SELECT 
                id,
                company_name,
                client_name,
                client_type,
                work_description,
                location,
                order_no,
                contract_value_inr,
                manpower,
                work_start,
                work_end,
                status,
                has_completion_certificate,
                has_experience_certificate,
                1 - (embedding <=> $1) AS similarity,
                COUNT(*) OVER() AS total_count
            FROM work_experiences
            WHERE 1 - (embedding <=> $1) >= $2
            ORDER BY similarity DESC
            LIMIT $3
            OFFSET $4
        `;

        const result = await db.query(query, [queryEmbedding, threshold, limit, offset]);

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(row => ({
                id: row.id,
                companyName: row.company_name,
                clientName: row.client_name,
                clientType: row.client_type,
                workDescription: row.work_description,
                location: row.location,
                orderNo: row.order_no,
                contractValueINR: row.contract_value_inr,
                manpower: row.manpower,
                workStart: row.work_start,
                workEnd: row.work_end,
                status: row.status,
                hasCompletionCertificate: row.has_completion_certificate,
                hasExperienceCertificate: row.has_experience_certificate,
                similarity: normalizeSimScore(row.similarity),
            })),

            pagination: {
                totalCount: totalCount,
                totalPages: totalPages,
                currentPage: currentPage,
                limit: limit,
                offset: offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    } 
    catch(err) 
    {
        console.error("❌ Error searching work experiences:", err);

        return { 
            data: [], 
            pagination: {} 
        };
    }
}

async function insertWorkExperience(data, embedding)
{
    try
    {
        const query = `INSERT INTO work_experiences (company_name, client_name, client_type, work_description, location, order_no, contract_value_inr, manpower, work_start, work_end, status, has_completion_certificate, has_experience_certificate, embedding) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`;

        const values = [
            data.companyName,
            data.clientName,
            data.clientType,
            data.workDescription,
            data.location,
            data.orderNo,
            data.contractValueINR,
            data.manpower,
            data.workStart,
            data.workEnd,
            data.status,
            data.hasCompletionCertificate,
            data.hasExperienceCertificate,
            embedding,
        ];

        const result = await db.query(query, values);

        return { 
            success: true, 
            data: mapRow(result.rows[0]) 
        };
    }
    catch(err)
    {
        console.error("❌ Error inserting work experience:", err);

        return { 
            success: false, 
            data: null 
        };
    }
}

async function updateWorkExperience(id, data, embedding = null)
{
    try
    {
        const fields = ["company_name = $1", "client_name = $2", "client_type = $3", "work_description = $4", "location = $5", "order_no = $6", "contract_value_inr = $7", "manpower = $8", "work_start = $9", "work_end = $10", "status = $11", "has_completion_certificate = $12", "has_experience_certificate = $13"];
        const values = [data.companyName, data.clientName, data.clientType, data.workDescription, data.location, data.orderNo, data.contractValueINR, data.manpower, data.workStart, data.workEnd, data.status, data.hasCompletionCertificate, data.hasExperienceCertificate];

        if(embedding)
        {
            fields.push(`embedding = $${values.length + 1}`);
            values.push(embedding);
        }

        values.push(id);
        const idParam = `$${values.length}`;
        const query = `UPDATE work_experiences SET ${fields.join(", ")} WHERE id = ${idParam} RETURNING *`;

        const result = await db.query(query, values);

        if(result.rows.length === 0)
        {
            return { 
                success: false, 
                data: null 
            };
        }

        return { 
            success: true, 
            data: mapRow(result.rows[0]) 
        };
    }
    catch(err)
    {
        console.error("❌ Error updating work experience:", err);

        return { 
            success: false, 
            data: null 
        };
    }
}

async function deleteWorkExperience(id)
{
    try
    {
        const result = await db.query("DELETE FROM work_experiences WHERE id = $1 RETURNING id", [id]);
        if (result.rows.length === 0)
        {
            return { 
                success: false 
            };
        }
             
        return { 
            success: true 
        };
    }
    catch(err)
    {
        console.error("❌ Error deleting work experience:", err);

        return { 
            success: false 
        };
    }
}

async function getWorkExperienceById(id)
{
    try
    {
        const result = await db.query(`SELECT id, company_name, client_name, client_type, work_description, location, order_no, contract_value_inr, manpower, work_start, work_end, status, has_completion_certificate FROM work_experiences WHERE id = $1`, [id]);

        if(result.rows.length === 0)
        {
            return { 
                success: false, 
                data: null 
            };
        } 
            
        return { 
            success: true, 
            data: mapRow(result.rows[0]) 
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching work experience by id:", err);

        return { 
            success: false, 
            data: null 
        };
    }
}

async function getAllWorkExperiences(limit = 20, offset = 0)
{
    try
    {
        const result = await db.query(`SELECT id, company_name, client_name, client_type, work_description, location, order_no, contract_value_inr, manpower, work_start, work_end, status, has_completion_certificate, COUNT(*) OVER() AS total_count FROM work_experiences ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(mapRow),
            pagination: {
                totalCount: totalCount,
                totalPages: totalPages,
                currentPage: currentPage,
                limit: limit,
                offset: offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching all work experiences:", err);

        return { 
            data: [], 
            pagination: {} 
        };
    }
}

async function getAllLicenses(companyName = null, limit = 50, offset = 0)
{
    try
    {
        const hasFilter = Boolean(companyName);

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM licenses
             ${hasFilter ? "WHERE company_name = $3" : ""}
             ORDER BY id ASC
             LIMIT $1 OFFSET $2`,
            hasFilter ? [limit, offset, companyName] : [limit, offset]
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(mapLicense),
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                limit,
                offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching all licenses:", err);

        return {
            data: [],
            pagination: {}
        };
    }
}

async function getLicenseById(id)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM licenses WHERE id = $1`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapLicense(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching license by id:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function insertLicense(data)
{
    try
    {
        const result = await db.query(
            `INSERT INTO licenses
               (company_name, license_type, license_no, issuing_authority,
                valid_from, valid_till, applicable_for, geographic_scope, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [
                data.companyName,
                data.licenseType ?? null,
                data.licenseNo ?? null,
                data.issuingAuthority ?? null,
                data.validFrom ?? null,
                data.validTill ?? null,
                data.applicableFor ?? null,
                data.geographicScope ?? null,
                data.status ?? null,
            ]
        );

        return {
            success: true,
            data: mapLicense(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error inserting license:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function updateLicense(id, data)
{
    try
    {
        const result = await db.query(
            `UPDATE licenses SET
               company_name = $1,
               license_type = $2,
               license_no = $3,
               issuing_authority = $4,
               valid_from = $5,
               valid_till = $6,
               applicable_for = $7,
               geographic_scope = $8,
               status = $9
             WHERE id = $10
             RETURNING *`,
            [
                data.companyName,
                data.licenseType ?? null,
                data.licenseNo ?? null,
                data.issuingAuthority ?? null,
                data.validFrom ?? null,
                data.validTill ?? null,
                data.applicableFor ?? null,
                data.geographicScope ?? null,
                data.status ?? null,
                id,
            ]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapLicense(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error updating license:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function deleteLicense(id)
{
    try
    {
        const result = await db.query(
            `DELETE FROM licenses WHERE id = $1 RETURNING id`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false
            };
        }

        return {
            success: true
        };
    }
    catch(err)
    {
        console.error("❌ Error deleting license:", err);

        return {
            success: false
        };
    }
}

async function getAllIsoCerts(companyName = null, limit = 50, offset = 0)
{
    try
    {
        const hasFilter = Boolean(companyName);

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM certifications_iso
             ${hasFilter ? "WHERE company_name = $3" : ""}
             ORDER BY id ASC
             LIMIT $1 OFFSET $2`,
            hasFilter ? [limit, offset, companyName] : [limit, offset]
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(mapIso),
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                limit,
                offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching ISO certs:", err);

        return {
            data: [],
            pagination: {}
        };
    }
}

async function getIsoCertById(id)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM certifications_iso WHERE id = $1`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapIso(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching ISO cert by id:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function insertIsoCert(data)
{
    try
    {
        const result = await db.query(
            `INSERT INTO certifications_iso (company_name, standard, scope, cert_no, valid_till)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING *`,
            [
                data.companyName,
                data.standard  ?? null,
                data.scope     ?? null,
                data.certNo    ?? null,
                data.validTill ?? null,
            ]
        );

        return {
            success: true,
            data: mapIso(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error inserting ISO cert:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function updateIsoCert(id, data)
{
    try
    {
        const result = await db.query(
            `UPDATE certifications_iso SET
               company_name = $1,
               standard     = $2,
               scope        = $3,
               cert_no      = $4,
               valid_till   = $5
             WHERE id = $6
             RETURNING *`,
            [
                data.companyName,
                data.standard  ?? null,
                data.scope     ?? null,
                data.certNo    ?? null,
                data.validTill ?? null,
                id,
            ]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapIso(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error updating ISO cert:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function deleteIsoCert(id)
{
    try
    {
        const result = await db.query(
            `DELETE FROM certifications_iso WHERE id = $1 RETURNING id`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false
            };
        }

        return {
            success: true
        };
    }
    catch(err)
    {
        console.error("❌ Error deleting ISO cert:", err);

        return {
            success: false
        };
    }
}

async function getAllPsaraCerts(companyName = null, limit = 50, offset = 0)
{
    try
    {
        const hasFilter = Boolean(companyName);

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM certifications_psara
             ${hasFilter ? "WHERE company_name = $3" : ""}
             ORDER BY id ASC
             LIMIT $1 OFFSET $2`,
            hasFilter ? [limit, offset, companyName] : [limit, offset]
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(mapPsara),
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                limit,
                offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching PSARA certs:", err);

        return {
            data: [],
            pagination: {}
        };
    }
}

async function getPsaraCertById(id)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM certifications_psara WHERE id = $1`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapPsara(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching PSARA cert by id:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function insertPsaraCert(data)
{
    try
    {
        const result = await db.query(
            `INSERT INTO certifications_psara (company_name, state, license_no, valid_till)
             VALUES ($1,$2,$3,$4)
             RETURNING *`,
            [
                data.companyName,
                data.state     ?? null,
                data.licenseNo ?? null,
                data.validTill ?? null,
            ]
        );

        return {
            success: true,
            data: mapPsara(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error inserting PSARA cert:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function updatePsaraCert(id, data)
{
    try
    {
        const result = await db.query(
            `UPDATE certifications_psara SET
               company_name = $1,
               state        = $2,
               license_no   = $3,
               valid_till   = $4
             WHERE id = $5
             RETURNING *`,
            [
                data.companyName,
                data.state     ?? null,
                data.licenseNo ?? null,
                data.validTill ?? null,
                id,
            ]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapPsara(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error updating PSARA cert:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function deletePsaraCert(id)
{
    try
    {
        const result = await db.query(
            `DELETE FROM certifications_psara WHERE id = $1 RETURNING id`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false
            };
        }

        return {
            success: true
        };
    }
    catch(err)
    {
        console.error("❌ Error deleting PSARA cert:", err);

        return {
            success: false
        };
    }
}

async function getAllSpecialCerts(companyName = null, limit = 50, offset = 0)
{
    try
    {
        const hasFilter = Boolean(companyName);

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM certifications_special
             ${hasFilter ? "WHERE company_name = $3" : ""}
             ORDER BY id ASC
             LIMIT $1 OFFSET $2`,
            hasFilter ? [limit, offset, companyName] : [limit, offset]
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(mapSpecial),
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                limit,
                offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching special certs:", err);

        return {
            data: [],
            pagination: {}
        };
    }
}

async function getSpecialCertById(id)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM certifications_special WHERE id = $1`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapSpecial(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching special cert by id:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function insertSpecialCert(data)
{
    try
    {
        const result = await db.query(
            `INSERT INTO certifications_special
               (company_name, cert_type, license_no, grade, issuing_authority,
                valid_till, scope, geographic_scope)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
                data.companyName,
                data.certType         ?? null,
                data.licenseNo        ?? null,
                data.grade            ?? null,
                data.issuingAuthority ?? null,
                data.validTill        ?? null,
                data.scope            ?? null,
                data.geographicScope  ?? null,
            ]
        );

        return {
            success: true,
            data: mapSpecial(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error inserting special cert:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function updateSpecialCert(id, data)
{
    try
    {
        const result = await db.query(
            `UPDATE certifications_special SET
               company_name      = $1,
               cert_type         = $2,
               license_no        = $3,
               grade             = $4,
               issuing_authority = $5,
               valid_till        = $6,
               scope             = $7,
               geographic_scope  = $8
             WHERE id = $9
             RETURNING *`,
            [
                data.companyName,
                data.certType         ?? null,
                data.licenseNo        ?? null,
                data.grade            ?? null,
                data.issuingAuthority ?? null,
                data.validTill        ?? null,
                data.scope            ?? null,
                data.geographicScope  ?? null,
                id,
            ]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapSpecial(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error updating special cert:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function deleteSpecialCert(id)
{
    try
    {
        const result = await db.query(
            `DELETE FROM certifications_special WHERE id = $1 RETURNING id`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false
            };
        }

        return {
            success: true
        };
    }
    catch(err)
    {
        console.error("❌ Error deleting special cert:", err);

        return {
            success: false
        };
    }
}

async function getAllFinancials(companyName = null, limit = 20, offset = 0)
{
    try
    {
        const hasFilter = Boolean(companyName);

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM financials
             ${hasFilter ? "WHERE company_name = $3" : ""}
             ORDER BY id ASC
             LIMIT $1 OFFSET $2`,
            hasFilter ? [limit, offset, companyName] : [limit, offset]
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(mapFinancials),
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                limit,
                offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching financials:", err);

        return {
            data: [],
            pagination: {}
        };
    }
}

async function getFinancialsById(id)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM financials WHERE id = $1`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapFinancials(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching financials by id:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function getFinancialsByCompany(companyName)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM financials WHERE company_name = $1 LIMIT 1`,
            [companyName]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapFinancials(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching financials by company:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function insertFinancials(data)
{
    try
    {
        const result = await db.query(
            `INSERT INTO financials
               (company_name,
                turnover_fy2024_25, turnover_fy2023_24, turnover_fy2022_23, avg_turnover_3yr,
                net_worth_fy2024_25, net_worth_fy2023_24, net_worth_fy2022_23,
                bank_solvency_value_lakhs, bank_solvency_issuing_bank,
                working_capital, max_manpower_deployed,
                largest_single_work_order_value, ongoing_commitments_lakhs)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING *`,
            [
                data.companyName,
                data.turnoverFy2024_25           ?? null,
                data.turnoverFy2023_24           ?? null,
                data.turnoverFy2022_23           ?? null,
                data.avgTurnover3yr              ?? null,
                data.netWorthFy2024_25           ?? null,
                data.netWorthFy2023_24           ?? null,
                data.netWorthFy2022_23           ?? null,
                data.bankSolvencyValueLakhs      ?? null,
                data.bankSolvencyIssuingBank     ?? null,
                data.workingCapital              ?? null,
                data.maxManpowerDeployed         ?? null,
                data.largestSingleWorkOrderValue ?? null,
                data.ongoingCommitmentsLakhs     ?? null,
            ]
        );

        return {
            success: true,
            data: mapFinancials(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error inserting financials:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function updateFinancials(id, data)
{
    try
    {
        const result = await db.query(
            `UPDATE financials SET
               company_name                    = $1,
               turnover_fy2024_25              = $2,
               turnover_fy2023_24              = $3,
               turnover_fy2022_23              = $4,
               avg_turnover_3yr                = $5,
               net_worth_fy2024_25             = $6,
               net_worth_fy2023_24             = $7,
               net_worth_fy2022_23             = $8,
               bank_solvency_value_lakhs       = $9,
               bank_solvency_issuing_bank      = $10,
               working_capital                 = $11,
               max_manpower_deployed           = $12,
               largest_single_work_order_value = $13,
               ongoing_commitments_lakhs       = $14
             WHERE id = $15
             RETURNING *`,
            [
                data.companyName,
                data.turnoverFy2024_25           ?? null,
                data.turnoverFy2023_24           ?? null,
                data.turnoverFy2022_23           ?? null,
                data.avgTurnover3yr              ?? null,
                data.netWorthFy2024_25           ?? null,
                data.netWorthFy2023_24           ?? null,
                data.netWorthFy2022_23           ?? null,
                data.bankSolvencyValueLakhs      ?? null,
                data.bankSolvencyIssuingBank     ?? null,
                data.workingCapital              ?? null,
                data.maxManpowerDeployed         ?? null,
                data.largestSingleWorkOrderValue ?? null,
                data.ongoingCommitmentsLakhs     ?? null,
                id,
            ]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapFinancials(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error updating financials:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function deleteFinancials(id)
{
    try
    {
        const result = await db.query(
            `DELETE FROM financials WHERE id = $1 RETURNING id`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false
            };
        }

        return {
            success: true
        };
    }
    catch(err)
    {
        console.error("❌ Error deleting financials:", err);

        return {
            success: false
        };
    }
}

async function getAllMsme(companyName = null, limit = 20, offset = 0)
{
    try
    {
        const hasFilter = Boolean(companyName);

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM msme_advantages
             ${hasFilter ? "WHERE company_name = $3" : ""}
             ORDER BY id ASC
             LIMIT $1 OFFSET $2`,
            hasFilter ? [limit, offset, companyName] : [limit, offset]
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(mapMsme),
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                limit,
                offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching MSME records:", err);

        return {
            data: [],
            pagination: {}
        };
    }
}

async function getMsmeById(id)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM msme_advantages WHERE id = $1`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapMsme(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching MSME by id:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function getMsmeByCompany(companyName)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM msme_advantages WHERE company_name = $1 LIMIT 1`,
            [companyName]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapMsme(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching MSME by company:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function insertMsme(data)
{
    try
    {
        const result = await db.query(
            `INSERT INTO msme_advantages (company_name, udyam_no, nsic_reg_no, exemptions)
             VALUES ($1,$2,$3,$4)
             RETURNING *`,
            [
                data.companyName,
                data.udyamNo    ?? null,
                data.nsicRegNo  ?? null,
                data.exemptions ?? [],
            ]
        );

        return {
            success: true,
            data: mapMsme(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error inserting MSME record:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function updateMsme(id, data)
{
    try
    {
        const result = await db.query(
            `UPDATE msme_advantages SET
               company_name = $1,
               udyam_no     = $2,
               nsic_reg_no  = $3,
               exemptions   = $4
             WHERE id = $5
             RETURNING *`,
            [
                data.companyName,
                data.udyamNo    ?? null,
                data.nsicRegNo  ?? null,
                data.exemptions ?? [],
                id,
            ]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapMsme(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error updating MSME record:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function deleteMsme(id)
{
    try
    {
        const result = await db.query(
            `DELETE FROM msme_advantages WHERE id = $1 RETURNING id`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false
            };
        }

        return {
            success: true
        };
    }
    catch(err)
    {
        console.error("❌ Error deleting MSME record:", err);

        return {
            success: false
        };
    }
}

async function insertTenderDocument(data, embedding)
{
    try
    {
        const result = await db.query(
            `INSERT INTO tender_documents
               (company_name, document_name, purpose, file_type, path, text, embedding)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
                data.companyName,
                data.documentName ?? null,
                data.purpose      ?? null,
                data.fileType     ?? null,
                data.path         ?? null,
                data.text         ?? null,
                embedding,
            ]
        );

        return {
            success: true,
            data: mapTenderDocument(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error inserting tender document:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function getTenderDocumentById(id)
{
    try
    {
        const result = await db.query(
            `SELECT * FROM tender_documents WHERE id = $1`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapTenderDocument(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching tender document by id:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function updateTenderDocument(id, data, embedding = null)
{
    try
    {
        const fields = [
            "company_name  = $1",
            "document_name = $2",
            "purpose       = $3",
            "file_type     = $4",
            "path          = $5",
            "text          = $6",
        ];

        const values = [
            data.companyName,
            data.documentName ?? null,
            data.purpose      ?? null,
            data.fileType     ?? null,
            data.path         ?? null,
            data.text         ?? null,
        ];

        if(embedding)
        {
            fields.push(`embedding = $${values.length + 1}`);
            values.push(embedding);
        }

        values.push(id);
        const idParam = `$${values.length}`;
        const query   = `UPDATE tender_documents SET ${fields.join(", ")} WHERE id = ${idParam} RETURNING *`;

        const result = await db.query(query, values);

        if(result.rows.length === 0)
        {
            return {
                success: false,
                data: null
            };
        }

        return {
            success: true,
            data: mapTenderDocument(result.rows[0])
        };
    }
    catch(err)
    {
        console.error("❌ Error updating tender document:", err);

        return {
            success: false,
            data: null
        };
    }
}

async function deleteTenderDocument(id)
{
    try
    {
        const result = await db.query(
            `DELETE FROM tender_documents WHERE id = $1 RETURNING id`,
            [id]
        );

        if(result.rows.length === 0)
        {
            return {
                success: false
            };
        }

        return {
            success: true
        };
    }
    catch(err)
    {
        console.error("❌ Error deleting tender document:", err);

        return {
            success: false
        };
    }
}

async function getAllTenderDocuments(companyName = null, limit = 50, offset = 0)
{
    try
    {
        const hasFilter = Boolean(companyName);

        const result = await db.query(
            `SELECT id, company_name, document_name, purpose, file_type, path, is_active, uploaded_at,
                    COUNT(*) OVER() AS total_count
             FROM tender_documents
             ${hasFilter ? "WHERE company_name = $3" : ""}
             ORDER BY id DESC
             LIMIT $1 OFFSET $2`,
            hasFilter ? [limit, offset, companyName] : [limit, offset]
        );

        const totalCount  = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages  = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(mapTenderDocument),
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                limit,
                offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error fetching all tender documents:", err);

        return {
            data: [],
            pagination: {}
        };
    }
}

async function searchTenderDocuments(queryEmbedding, companyName = null, limit = 10, offset = 0, threshold = 0.5)
{
    try
    {
        const hasFilter = Boolean(companyName);

        const query = `
            SELECT
                id,
                company_name,
                document_name,
                purpose,
                file_type,
                path,
                is_active,
                uploaded_at,
                1 - (embedding <=> $1) AS similarity,
                COUNT(*) OVER() AS total_count
            FROM tender_documents
            WHERE 1 - (embedding <=> $1) >= $2
            ${hasFilter ? "AND company_name = $5" : ""}
            ORDER BY similarity DESC
            LIMIT $3 OFFSET $4
        `;

        const values = hasFilter
            ? [queryEmbedding, threshold, limit, offset, companyName]
            : [queryEmbedding, threshold, limit, offset];

        const result      = await db.query(query, values);
        const totalCount  = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages  = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        return {
            data: result.rows.map(row => ({
                ...mapTenderDocument(row),
                similarity: normalizeSimScore(row.similarity),
            })),
            pagination: {
                totalCount,
                totalPages,
                currentPage,
                limit,
                offset,
                hasNext: currentPage < totalPages,
                hasPrev: currentPage > 1,
            }
        };
    }
    catch(err)
    {
        console.error("❌ Error searching tender documents:", err);

        return {
            data: [],
            pagination: {}
        };
    }
}
 
async function insertTenders(tenders)
{
    const results = { saved: 0, failed: 0 };
 
    for (const data of tenders)
    {
        try
        {
            let tenderValueFormatted = null;
            if (data.tenderValue != null)
            {
                tenderValueFormatted = Math.round(data.tenderValue);
            }

            let dueDateFormatted = null;
            if (data.dueDate)
            {
                const p = data.dueDate.split("-");
                if (p.length === 3)
                {
                    dueDateFormatted = `${p[2]}-${p[1]}-${p[0]}`;
                }
            }
 
            await db.query(
                `INSERT INTO tender_pool (
                    tdr, category, authority, city, state, brief,
                    is_corrigendum, document_type,
                    tender_value, tender_value_raw, due_date, url
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                ON CONFLICT (tdr) DO UPDATE SET
                    category         = EXCLUDED.category,
                    authority        = EXCLUDED.authority,
                    city             = EXCLUDED.city,
                    state            = EXCLUDED.state,
                    brief            = EXCLUDED.brief,
                    is_corrigendum   = EXCLUDED.is_corrigendum,
                    document_type    = EXCLUDED.document_type,
                    tender_value     = EXCLUDED.tender_value,
                    tender_value_raw = EXCLUDED.tender_value_raw,
                    due_date         = EXCLUDED.due_date,
                    url              = EXCLUDED.url,
                    last_seen_at     = NOW()`,
                [
                    data.tdr,
                    data.category,
                    data.authority      ?? null,
                    data.city           ?? null,
                    data.state          ?? null,
                    data.brief          ?? null,
                    data.isCorrigendum  ?? false,
                    data.documentType   ?? null,
                    tenderValueFormatted,
                    data.tenderValueRaw ?? null,
                    dueDateFormatted,
                    data.url            ?? null,
                ]
            );
            results.saved++;
        }
        catch (err)
        {
            console.error(`❌ Failed to insert tdr ${data.tdr}:`, err.message);
            results.failed++;
        }
    }
 
    console.log(`✅ insertTenders: ${results.saved} saved, ${results.failed} failed`);
    return results;
}
 
async function updateTenders(filters = {}, data = {})
{
    try
    {
        const setFields = [];
        const setValues = [];
        let i = 1;
 
        const allowed = [
            ["category",       "category"],
            ["authority",      "authority"],
            ["city",           "city"],
            ["state",          "state"],
            ["brief",          "brief"],
            ["isCorrigendum",  "is_corrigendum"],
            ["documentType",   "document_type"],
            ["tenderValue",    "tender_value"],
            ["tenderValueRaw", "tender_value_raw"],
            ["url",            "url"],
            ["workingOn",      "working_on"],
        ];
 
        for(const [jsKey, colName] of allowed)
        {
            if(jsKey in data)
            {
                setFields.push(`${colName} = $${i++}`);
                setValues.push(data[jsKey]);
            }
        }
 
        if ("dueDate" in data)
        {
            let dueDateFormatted = null;
            if (data.dueDate)
            {
                const p = data.dueDate.split("-");
                if (p.length === 3)
                {
                    dueDateFormatted = `${p[2]}-${p[1]}-${p[0]}`;
                }
            }
            setFields.push(`due_date = $${i++}`);
            setValues.push(dueDateFormatted);
        }
 
        if (setFields.length === 0) return { success: false, error: "No fields to update" };
 
        // Build WHERE clause inline
        const conditions = [];
        const whereValues = [];
        let whereIndex = i;

        if (filters.id            != null) { conditions.push(`id = $${whereIndex++}`);                     whereValues.push(filters.id); }
        if (filters.tdr           != null) { conditions.push(`tdr = $${whereIndex++}`);                    whereValues.push(filters.tdr); }
        if (filters.isCorrigendum != null) { conditions.push(`is_corrigendum = $${whereIndex++}`);         whereValues.push(filters.isCorrigendum); }
        if (filters.workingOn     != null) { conditions.push(`working_on = $${whereIndex++}`);             whereValues.push(filters.workingOn); }
        if (filters.minValue      != null) { conditions.push(`tender_value >= $${whereIndex++}`);          whereValues.push(filters.minValue); }
        if (filters.maxValue      != null) { conditions.push(`tender_value <= $${whereIndex++}`);          whereValues.push(filters.maxValue); }
        if (filters.dueDateFrom   != null) { conditions.push(`due_date >= $${whereIndex++}`);              whereValues.push(filters.dueDateFrom); }
        if (filters.dueDateTo     != null) { conditions.push(`due_date <= $${whereIndex++}`);              whereValues.push(filters.dueDateTo); }
        if (filters.insertedFrom  != null) { conditions.push(`inserted_at >= $${whereIndex++}`);           whereValues.push(filters.insertedFrom); }
        if (filters.insertedTo    != null) { conditions.push(`inserted_at <= $${whereIndex++}`);           whereValues.push(filters.insertedTo); }
 
        if (filters.category  != null) { conditions.push(`LOWER(category) = LOWER($${whereIndex++})`);    whereValues.push(filters.category); }
 
        if (filters.state     != null) { conditions.push(`state ~* $${whereIndex++}`);                     whereValues.push(`\\m${filters.state}\\M`); }
        if (filters.city      != null) { conditions.push(`city ~* $${whereIndex++}`);                      whereValues.push(`\\m${filters.city}\\M`); }
 
        if (filters.authority != null) { conditions.push(`authority ILIKE $${whereIndex++}`);              whereValues.push(`%${filters.authority}%`); }
        if (filters.brief     != null) { conditions.push(`brief ILIKE $${whereIndex++}`);                  whereValues.push(`%${filters.brief}%`); }

        const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
        const result = await db.query(
            `UPDATE tender_pool SET ${setFields.join(", ")} ${clause} RETURNING *`,
            [...setValues, ...whereValues]
        );
 
        const mappedData = result.rows.map(row => ({
            id:             row.id,
            tdr:            row.tdr,
            category:       row.category,
            authority:      row.authority,
            city:           row.city,
            state:          row.state,
            brief:          row.brief,
            isCorrigendum:  row.is_corrigendum,
            documentType:   row.document_type,
            tenderValue:    row.tender_value,
            tenderValueRaw: row.tender_value_raw,
            dueDate:        row.due_date,
            url:            row.url,
            insertedAt:     row.inserted_at,
            lastSeenAt:     row.last_seen_at,
            workingOn:      row.working_on,
        }));

        return { success: true, updated: result.rowCount, data: mappedData };
    }
    catch (err)
    {
        console.error("❌ Error updating tenders:", err);
        return { success: false, updated: 0 };
    }
}
 
async function deleteTenders(filters = {})
{
    try
    {
        if (Object.keys(filters).length === 0)
        {
            return { success: false, error: "Refusing to delete without filters" };
        }
 
        const conditions = [];
        const values = [];
        let i = 1;

        if (filters.id            != null) { conditions.push(`id = $${i++}`);                     values.push(filters.id); }
        if (filters.tdr           != null) { conditions.push(`tdr = $${i++}`);                    values.push(filters.tdr); }
        if (filters.isCorrigendum != null) { conditions.push(`is_corrigendum = $${i++}`);         values.push(filters.isCorrigendum); }
        if (filters.workingOn     != null) { conditions.push(`working_on = $${i++}`);             values.push(filters.workingOn); }
        if (filters.minValue      != null) { conditions.push(`tender_value >= $${i++}`);          values.push(filters.minValue); }
        if (filters.maxValue      != null) { conditions.push(`tender_value <= $${i++}`);          values.push(filters.maxValue); }
        if (filters.dueDateFrom   != null) { conditions.push(`due_date >= $${i++}`);              values.push(filters.dueDateFrom); }
        if (filters.dueDateTo     != null) { conditions.push(`due_date <= $${i++}`);              values.push(filters.dueDateTo); }
        if (filters.insertedFrom  != null) { conditions.push(`inserted_at >= $${i++}`);           values.push(filters.insertedFrom); }
        if (filters.insertedTo    != null) { conditions.push(`inserted_at <= $${i++}`);           values.push(filters.insertedTo); }
 
        if (filters.category  != null) { conditions.push(`LOWER(category) = LOWER($${i++})`);    values.push(filters.category); }
 
        if (filters.state     != null) { conditions.push(`state ~* $${i++}`);                     values.push(`\\m${filters.state}\\M`); }
        if (filters.city      != null) { conditions.push(`city ~* $${i++}`);                      values.push(`\\m${filters.city}\\M`); }
 
        if (filters.authority != null) { conditions.push(`authority ILIKE $${i++}`);              values.push(`%${filters.authority}%`); }
        if (filters.brief     != null) { conditions.push(`brief ILIKE $${i++}`);                  values.push(`%${filters.brief}%`); }

        const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
        const result = await db.query(
            `DELETE FROM tender_pool ${clause} RETURNING tdr`,
            values
        );
 
        return { success: true, deleted: result.rowCount };
    }
    catch (err)
    {
        console.error("❌ Error deleting tenders:", err);
        return { success: false, deleted: 0 };
    }
}

async function fetchTenders(filters = {}, pageNo = null, limit = null)
{
    try
    {
        const conditions = [];
        const values = [];
        let i = 1;

        if (filters.id            != null) { conditions.push(`CAST(id AS TEXT) ILIKE $${i++}`);            values.push(`%${filters.id}%`); }
        if (filters.tdr           != null) { conditions.push(`CAST(tdr AS TEXT) ILIKE $${i++}`);           values.push(`%${filters.tdr}%`); }
        if (filters.isCorrigendum != null) { conditions.push(`is_corrigendum = $${i++}`);                  values.push(filters.isCorrigendum); }
        if (filters.workingOn     != null) { conditions.push(`working_on = $${i++}`);                      values.push(filters.workingOn); }
        if (filters.minValue      != null) { conditions.push(`tender_value >= $${i++}`);                   values.push(filters.minValue); }
        if (filters.maxValue      != null) { conditions.push(`tender_value <= $${i++}`);                   values.push(filters.maxValue); }
        if (filters.dueDateFrom   != null) { conditions.push(`due_date >= $${i++}`);                       values.push(filters.dueDateFrom); }
        if (filters.dueDateTo     != null) { conditions.push(`due_date <= $${i++}`);                       values.push(filters.dueDateTo); }
        if (filters.insertedFrom  != null) { conditions.push(`inserted_at >= $${i++}`);                    values.push(filters.insertedFrom); }
        if (filters.insertedTo    != null) { conditions.push(`inserted_at <= $${i++}`);                    values.push(filters.insertedTo); }
        if (filters.documentType  != null) { conditions.push(`LOWER(document_type) LIKE $${i++}`);         values.push(`%${filters.documentType.toLowerCase()}%`); }
        if (filters.category      != null) { conditions.push(`category ILIKE $${i++}`);                    values.push(`%${filters.category}%`); }
        if (filters.state         != null) { conditions.push(`state ILIKE $${i++}`);                       values.push(`%${filters.state}%`); }
        if (filters.city          != null) { conditions.push(`city ILIKE $${i++}`);                        values.push(`%${filters.city}%`); }
        if (filters.authority     != null) { conditions.push(`authority ILIKE $${i++}`);                   values.push(`%${filters.authority}%`); }
        if (filters.brief         != null) { conditions.push(`brief ILIKE $${i++}`);                       values.push(`%${filters.brief}%`); }

        const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const hasPage = pageNo != null && limit != null;
        const offset  = hasPage ? (pageNo - 1) * limit : null;

        let paginationClause = "";

        if (hasPage)
        {
            paginationClause = `LIMIT $${i++} OFFSET $${i++}`;
            values.push(limit, offset);
        }

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM tender_pool
             ${clause}
             ORDER BY inserted_at DESC
             ${paginationClause}`,
            values
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;

        const mappedData = result.rows.map(row => ({
            id:             row.id,
            tdr:            row.tdr,
            category:       row.category,
            authority:      row.authority,
            city:           row.city,
            state:          row.state,
            brief:          row.brief,
            isCorrigendum:  row.is_corrigendum,
            documentType:   row.document_type,
            tenderValue:    row.tender_value,
            tenderValueRaw: row.tender_value_raw,
            dueDate:        row.due_date,
            url:            row.url,
            insertedAt:     row.inserted_at,
            lastSeenAt:     row.last_seen_at,
            workingOn:      row.working_on,
        }));

        if (!hasPage)
        {
            return { data: mappedData, totalCount };
        }

        const totalPages = Math.ceil(totalCount / limit);

        return {
            data: mappedData,
            pagination: {
                totalCount,
                totalPages,
                currentPage: pageNo,
                limit,
                hasNext: pageNo < totalPages,
                hasPrev: pageNo > 1,
            }
        };
    }
    catch (err)
    {
        console.error("❌ Error fetching tenders:", err);
        return { data: [], totalCount: 0 };
    }
}

async function fetchTenderMetadata(filters = {})
{
    try
    {
        const conditions = [];
        const values     = [];
        let   i          = 1;

        if (filters.id            != null) { conditions.push(`CAST(id AS TEXT) ILIKE $${i++}`);    values.push(`%${filters.id}%`); }
        if (filters.tdr           != null) { conditions.push(`CAST(tdr AS TEXT) ILIKE $${i++}`);   values.push(`%${filters.tdr}%`); }
        if (filters.isCorrigendum != null) { conditions.push(`is_corrigendum = $${i++}`);          values.push(filters.isCorrigendum); }
        if (filters.workingOn     != null) { conditions.push(`working_on = $${i++}`);              values.push(filters.workingOn); }
        if (filters.minValue      != null) { conditions.push(`tender_value >= $${i++}`);           values.push(filters.minValue); }
        if (filters.maxValue      != null) { conditions.push(`tender_value <= $${i++}`);           values.push(filters.maxValue); }
        if (filters.dueDateFrom   != null) { conditions.push(`due_date >= $${i++}`);               values.push(filters.dueDateFrom); }
        if (filters.dueDateTo     != null) { conditions.push(`due_date <= $${i++}`);               values.push(filters.dueDateTo); }
        if (filters.insertedFrom  != null) { conditions.push(`inserted_at >= $${i++}`);            values.push(filters.insertedFrom); }
        if (filters.insertedTo    != null) { conditions.push(`inserted_at <= $${i++}`);            values.push(filters.insertedTo); }
        if (filters.documentType  != null) { conditions.push(`LOWER(document_type) LIKE $${i++}`); values.push(`%${filters.documentType.toLowerCase()}%`); }
        if (filters.category      != null) { conditions.push(`category ILIKE $${i++}`);            values.push(`%${filters.category}%`); }
        if (filters.state         != null) { conditions.push(`state ILIKE $${i++}`);               values.push(`%${filters.state}%`); }
        if (filters.city          != null) { conditions.push(`city ILIKE $${i++}`);                values.push(`%${filters.city}%`); }
        if (filters.authority     != null) { conditions.push(`authority ILIKE $${i++}`);           values.push(`%${filters.authority}%`); }
        if (filters.brief         != null) { conditions.push(`brief ILIKE $${i++}`);               values.push(`%${filters.brief}%`); }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const nullClause = conditions.length > 0
            ? `AND state IS NOT NULL AND city IS NOT NULL`
            : `WHERE state IS NOT NULL AND city IS NOT NULL`;

        const overviewQuery = `
            SELECT
                COUNT(*) AS total,

                COUNT(*) FILTER (
                    WHERE due_date <= CURRENT_DATE + INTERVAL '7 days'
                    AND due_date >= CURRENT_DATE
                ) AS due_soon,

                COUNT(*) FILTER (
                    WHERE is_corrigendum = true
                ) AS corrigendum,

                COUNT(*) FILTER (
                    WHERE LOWER(document_type) LIKE '%gem%'
                ) AS gem

            FROM tender_pool
            ${whereClause}
        `;

        const categoryQuery = `
            SELECT
                category,
                COUNT(*) AS count
            FROM tender_pool
            ${whereClause}
            GROUP BY category
            ORDER BY count DESC
        `;

        const stateCityQuery = `
            SELECT
                state,
                city
            FROM tender_pool
            ${whereClause}
            ${nullClause}
        `;

        const [
            overviewResult,
            categoryResult,
            stateCityResult
        ] = await Promise.all([
            db.query(overviewQuery,  values),
            db.query(categoryQuery,  values),
            db.query(stateCityQuery, values)
        ]);

        const statesMap = {};

        for (const row of stateCityResult.rows)
        {
            const state = row.state?.trim();
            const city  = row.city?.trim();

            if (!state || !city) continue;

            if (!statesMap[state])
            {
                statesMap[state] = new Set();
            }

            statesMap[state].add(city);
        }

        const states = Object.entries(statesMap).map(([state, citiesSet]) => ({
            state,
            cities: Array.from(citiesSet).sort()
        }));

        return {
            overview: {
                total:       parseInt(overviewResult.rows[0].total       || 0),
                dueSoon:     parseInt(overviewResult.rows[0].due_soon    || 0),
                corrigendum: parseInt(overviewResult.rows[0].corrigendum || 0),
                gem:         parseInt(overviewResult.rows[0].gem         || 0),
            },

            categories: categoryResult.rows.map(row => ({
                name:  row.category || "Others",
                count: parseInt(row.count)
            })),

            states
        };
    }
    catch (err)
    {
        console.error("❌ Error fetching metadata:", err);

        return {
            overview: {
                total:       0,
                dueSoon:     0,
                corrigendum: 0,
                gem:         0
            },

            categories: [],
            states:     []
        };
    }
}

async function insertCompanyChunk(companyName, chunkTitle, content, embedding)
{
    try
    {
        const query = `INSERT INTO company_profile_chunks (company_name, chunk_title, content, embedding) VALUES ($1, $2, $3, $4) RETURNING id`;
        const values = [companyName, chunkTitle, content, embedding];
        const result = await db.query(query, values);

        return { success: true, id: result.rows[0].id };
    }
    catch(err)
    {
        console.error("❌ Error inserting company chunk:", err);
        return { success: false, id: null };
    }
}

async function searchCompanyChunks(queryEmbedding, limit = 5, companyName = null, threshold = 0.45)
{
    try
    {
        let query;
        let values;

        if(companyName)
        {
            query = `
                SELECT id, company_name, chunk_title, content, 1 - (embedding <=> $1) AS similarity
                FROM company_profile_chunks
                WHERE company_name = $2 AND 1 - (embedding <=> $1) >= $3
                ORDER BY similarity DESC
                LIMIT $4
            `;
            values = [queryEmbedding, companyName, threshold, limit];
        }
        else
        {
            query = `
                SELECT id, company_name, chunk_title, content, 1 - (embedding <=> $1) AS similarity
                FROM company_profile_chunks
                WHERE 1 - (embedding <=> $1) >= $2
                ORDER BY similarity DESC
                LIMIT $3
            `;
            values = [queryEmbedding, threshold, limit];
        }

        const result = await db.query(query, values);

        return {
            success: true,
            data: result.rows.map(row => ({
                id:          row.id,
                companyName: row.company_name,
                chunkTitle:  row.chunk_title,
                content:     row.content,
                similarity:  row.similarity,
            })),
        };
    }
    catch(err)
    {
        console.error("❌ Error searching company chunks:", err);
        return { success: false, data: [] };
    }
}

async function deleteCompanyChunk(id)
{
    try
    {
        const result = await db.query(`DELETE FROM company_profile_chunks WHERE id = $1 RETURNING id`, [id]);

        if(result.rows.length === 0)
        {
            return { success: false };
        }

        return { success: true };
    }
    catch(err)
    {
        console.error("❌ Error deleting company chunk:", err);
        return { success: false };
    }
}

async function deleteAllCompanyChunks(companyName)
{
    try
    {
        const result = await db.query(`DELETE FROM company_profile_chunks WHERE company_name = $1 RETURNING id`, [companyName]);

        return { success: true, deleted: result.rows.length };
    }
    catch(err)
    {
        console.error("❌ Error deleting company chunks:", err);
        return { success: false, deleted: 0 };
    }
}

async function insertTenderAnalysis(data)
{
    try
    {
        const result = await db.query(
            `INSERT INTO tender_analyses (
                tdr, company_name,
                tender_type, business_category, tendering_org, location,
                tender_publish_date, tender_id, department_details, no_of_manpower,
                contract_period, bid_value, epbg_percent, epbg_amount, epbg_duration,
                emd_amount, emd_exemption, msme, startup, consumable_amount,
                submission_date, bid_opening_date, tender_description, website_link,
                custom_bid, has_annexure, summary,
                pass1_confidence, deep_dive_confidence, pass1_done, deep_dive_done, checked
            )
            VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
            )
            ON CONFLICT (tdr, company_name) DO UPDATE SET
                tender_type          = EXCLUDED.tender_type,
                business_category    = EXCLUDED.business_category,
                tendering_org        = EXCLUDED.tendering_org,
                location             = EXCLUDED.location,
                tender_publish_date  = EXCLUDED.tender_publish_date,
                tender_id            = EXCLUDED.tender_id,
                department_details   = EXCLUDED.department_details,
                no_of_manpower       = EXCLUDED.no_of_manpower,
                contract_period      = EXCLUDED.contract_period,
                bid_value            = EXCLUDED.bid_value,
                epbg_percent         = EXCLUDED.epbg_percent,
                epbg_amount          = EXCLUDED.epbg_amount,
                epbg_duration        = EXCLUDED.epbg_duration,
                emd_amount           = EXCLUDED.emd_amount,
                emd_exemption        = EXCLUDED.emd_exemption,
                msme                 = EXCLUDED.msme,
                startup              = EXCLUDED.startup,
                consumable_amount    = EXCLUDED.consumable_amount,
                submission_date      = EXCLUDED.submission_date,
                bid_opening_date     = EXCLUDED.bid_opening_date,
                tender_description   = EXCLUDED.tender_description,
                website_link         = EXCLUDED.website_link,
                custom_bid           = EXCLUDED.custom_bid,
                has_annexure         = EXCLUDED.has_annexure,
                summary              = EXCLUDED.summary,
                pass1_confidence     = EXCLUDED.pass1_confidence,
                deep_dive_confidence = EXCLUDED.deep_dive_confidence,
                pass1_done           = EXCLUDED.pass1_done,
                deep_dive_done       = EXCLUDED.deep_dive_done,
                checked              = EXCLUDED.checked,
                updated_at           = NOW()
            RETURNING *`,
            [
                data.tdr,
                data.companyName,
                data.tenderType          ?? null,
                data.businessCategory    ?? null,
                data.tenderingOrg        ?? null,
                data.location            ?? null,
                data.tenderPublishDate   ?? null,
                data.tenderId            ?? null,
                data.departmentDetails   ?? null,
                data.noOfManpower        ?? null,
                data.contractPeriod      ?? null,
                data.bidValue            ?? null,
                data.epbgPercent         ?? null,
                data.epbgAmount          ?? null,
                data.epbgDuration        ?? null,
                data.emdAmount           ?? null,
                data.emdExemption        ?? null,
                data.msme                ?? null,
                data.startup             ?? null,
                data.consumableAmount    ?? null,
                data.submissionDate      ?? null,
                data.bidOpeningDate      ?? null,
                data.tenderDescription   ?? null,
                data.websiteLink         ?? null,
                data.customBid           ?? false,
                data.hasAnnexure         ?? false,
                data.summary             ?? null,
                data.pass1Confidence     ?? null,
                data.deepDiveConfidence  ?? null,
                data.pass1Done           ?? false,
                data.deepDiveDone        ?? false,
                data.checked             ?? false,
            ]
        );

        const analysis = result.rows[0];

        if (data.requirements?.length)
        {
            await db.query(`DELETE FROM analysis_requirements WHERE analysis_id = $1`, [analysis.id]);

            for (const req of data.requirements)
            {
                await db.query(
                    `INSERT INTO analysis_requirements (analysis_id, requirement, source, answer, status, stage, importance)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [analysis.id, req.requirement ?? null, req.source ?? null, req.answer ?? null, req.status ?? null, req.stage ?? null, req.importance ?? null]
                );
            }
        }

        if (data.missedRequirements?.length)
        {
            await db.query(`DELETE FROM analysis_missed_requirements WHERE analysis_id = $1`, [analysis.id]);

            for (const req of data.missedRequirements)
            {
                await db.query(
                    `INSERT INTO analysis_missed_requirements (analysis_id, requirement, source, answer, status, stage, importance)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [analysis.id, req.requirement ?? null, req.source ?? null, req.answer ?? null, req.status ?? null, req.stage ?? null, req.importance ?? null]
                );
            }
        }

        await db.query(`DELETE FROM analysis_work_order_matches WHERE analysis_id = $1`, [analysis.id]);

        if (data.workOrderMatches?.length)
        {
            const block = data.workOrderMatches[0];

            for (const match of block.matches ?? [])
            {
                await db.query(
                    `INSERT INTO analysis_work_order_matches (analysis_id, requirement_summary, experience_search_query, rank, client_name, location, contract_value, match_strength, similarity_basis, caveats)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                    [
                        analysis.id,
                        match.rank === 1 ? (block.requirementSummary  ?? null) : null,
                        match.rank === 1 ? (block.experienceSearchQuery ?? null) : null,
                        match.rank            ?? null,
                        match.clientName      ?? null,
                        match.location        ?? null,
                        match.contractValue   ?? null,
                        match.matchStrength   ?? null,
                        match.similarityBasis ?? null,
                        match.caveats         ?? null,
                    ]
                );
            }
        }

        await db.query(`DELETE FROM analysis_forms WHERE analysis_id = $1`, [analysis.id]);

        if (data.forms?.length)
        {
            for (const form of data.forms)
            {
                await db.query(
                    `INSERT INTO analysis_forms (analysis_id, form_id, title, start_page, fields)
                     VALUES ($1,$2,$3,$4,$5)`,
                    [analysis.id, form.form_id ?? null, form.title ?? null, form.startPage ?? null, JSON.stringify(form.fields ?? [])]
                );
            }
        }

        return { success: true, id: analysis.id };
    }
    catch (err)
    {
        console.error("❌ Error inserting tender analysis:", err);
        return { success: false, id: null };
    }
}
 
async function fetchTenderAnalyses(filters = {}, pageNo = null, limit = null)
{
    try
    {
        const conditions = [];
        const values     = [];
        let   i          = 1;
 
        if (filters.id          != null) { conditions.push(`ta.id = $${i++}`);                        values.push(filters.id); }
        if (filters.tdr         != null) { conditions.push(`ta.tdr ILIKE $${i++}`);                   values.push(`%${filters.tdr}%`); }
        if (filters.companyName != null) { conditions.push(`ta.company_name ILIKE $${i++}`);          values.push(`%${filters.companyName}%`); }
        if (filters.checked     != null) { conditions.push(`ta.checked = $${i++}`);                   values.push(filters.checked); }
        if (filters.pass1Done   != null) { conditions.push(`ta.pass1_done = $${i++}`);                values.push(filters.pass1Done); }
        if (filters.deepDiveDone != null) { conditions.push(`ta.deep_dive_done = $${i++}`);           values.push(filters.deepDiveDone); }
        if (filters.hasAnnexure != null) { conditions.push(`ta.has_annexure = $${i++}`);              values.push(filters.hasAnnexure); }
        if (filters.location    != null) { conditions.push(`ta.location ILIKE $${i++}`);              values.push(`%${filters.location}%`); }
        if (filters.tenderingOrg != null) { conditions.push(`ta.tendering_org ILIKE $${i++}`);        values.push(`%${filters.tenderingOrg}%`); }
        if (filters.submissionFrom != null) { conditions.push(`ta.submission_date >= $${i++}`);       values.push(filters.submissionFrom); }
        if (filters.submissionTo   != null) { conditions.push(`ta.submission_date <= $${i++}`);       values.push(filters.submissionTo); }
        if (filters.minBidValue    != null) { conditions.push(`ta.bid_value >= $${i++}`);             values.push(filters.minBidValue); }
        if (filters.maxBidValue    != null) { conditions.push(`ta.bid_value <= $${i++}`);             values.push(filters.maxBidValue); }
        if (filters.createdFrom    != null) { conditions.push(`ta.created_at >= $${i++}`);            values.push(filters.createdFrom); }
        if (filters.createdTo      != null) { conditions.push(`ta.created_at <= $${i++}`);            values.push(filters.createdTo); }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
        const hasPage      = pageNo != null && limit != null;
        const offset       = hasPage ? (pageNo - 1) * limit : null;
        const paginationClause = hasPage ? `LIMIT $${i++} OFFSET $${i++}` : "";
 
        if (hasPage)
        {
            values.push(limit, offset);
        }
 
        const result = await db.query(
            `SELECT ta.*, COUNT(*) OVER() AS total_count
             FROM tender_analyses ta
             ${whereClause}
             ORDER BY ta.created_at DESC
             ${paginationClause}`,
            values
        );
 
        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
 
        const analyses = await Promise.all(result.rows.map(async (row) =>
{
    try
    {
        const [reqs, missed, wom, forms] = await Promise.all([
            db.query(`SELECT * FROM analysis_requirements        WHERE analysis_id = $1 ORDER BY id ASC`,   [row.id]),
            db.query(`SELECT * FROM analysis_missed_requirements WHERE analysis_id = $1 ORDER BY id ASC`,   [row.id]),
            db.query(`SELECT * FROM analysis_work_order_matches  WHERE analysis_id = $1 ORDER BY rank ASC`, [row.id]),
            db.query(`SELECT * FROM analysis_forms               WHERE analysis_id = $1 ORDER BY id ASC`,   [row.id]),
        ]);

        return {
            id:                  row.id,
            tdr:                 row.tdr,
            companyName:         row.company_name,
            tenderType:          row.tender_type,
            businessCategory:    row.business_category,
            tenderingOrg:        row.tendering_org,
            location:            row.location,
            tenderPublishDate:   row.tender_publish_date,
            tenderId:            row.tender_id,
            departmentDetails:   row.department_details,
            noOfManpower:        row.no_of_manpower,
            contractPeriod:      row.contract_period,
            bidValue:            row.bid_value,
            epbgPercent:         row.epbg_percent,
            epbgAmount:          row.epbg_amount,
            epbgDuration:        row.epbg_duration,
            emdAmount:           row.emd_amount,
            emdExemption:        row.emd_exemption,
            msme:                row.msme,
            startup:             row.startup,
            consumableAmount:    row.consumable_amount,
            submissionDate:      row.submission_date,
            bidOpeningDate:      row.bid_opening_date,
            tenderDescription:   row.tender_description,
            websiteLink:         row.website_link,
            customBid:           row.custom_bid,
            hasAnnexure:         row.has_annexure,
            summary:             row.summary,
            pass1Confidence:     row.pass1_confidence,
            deepDiveConfidence:  row.deep_dive_confidence,
            pass1Done:           row.pass1_done,
            deepDiveDone:        row.deep_dive_done,
            checked:             row.checked,
            createdAt:           row.created_at,
            updatedAt:           row.updated_at,
            requirements:        reqs.rows,
            missedRequirements:  missed.rows,
            workOrderMatches:    wom.rows,
            forms:               forms.rows.map(f => ({ ...f, fields: typeof f.fields === "string" ? JSON.parse(f.fields) : (f.fields ?? []) })),
        };
    }
    catch (rowErr)
    {
        console.error(`❌ Error mapping row id ${row.id}:`, rowErr.message);
        return null;
    }
}));
 
        if (!hasPage)
        {
            return { data: analyses, totalCount };
        }
 
        const totalPages = Math.ceil(totalCount / limit);
 
        return {
            data: analyses,
            pagination: {
                totalCount,
                totalPages,
                currentPage: pageNo,
                limit,
                hasNext: pageNo < totalPages,
                hasPrev:  pageNo > 1,
            }
        };
    }
    catch (err)
    {
        console.error("❌ Error fetching tender analyses:", err);
        return { data: [], totalCount: 0 };
    }
}
 
async function updateTenderAnalysis(filters = {}, data = {})
{
    try
    {
        if (Object.keys(filters).length === 0)
        {
            return { success: false, error: "Refusing to update without filters" };
        }
 
        const setFields = [];
        const setValues = [];
        let   i         = 1;
 
        const allowed = [
            ["tenderType",         "tender_type"],
            ["businessCategory",   "business_category"],
            ["tenderingOrg",       "tendering_org"],
            ["location",           "location"],
            ["tenderPublishDate",  "tender_publish_date"],
            ["tenderId",           "tender_id"],
            ["departmentDetails",  "department_details"],
            ["noOfManpower",       "no_of_manpower"],
            ["contractPeriod",     "contract_period"],
            ["bidValue",           "bid_value"],
            ["epbgPercent",        "epbg_percent"],
            ["epbgAmount",         "epbg_amount"],
            ["epbgDuration",       "epbg_duration"],
            ["emdAmount",          "emd_amount"],
            ["emdExemption",       "emd_exemption"],
            ["msme",               "msme"],
            ["startup",            "startup"],
            ["consumableAmount",   "consumable_amount"],
            ["submissionDate",     "submission_date"],
            ["bidOpeningDate",     "bid_opening_date"],
            ["tenderDescription",  "tender_description"],
            ["websiteLink",        "website_link"],
            ["customBid",          "custom_bid"],
            ["hasAnnexure",        "has_annexure"],
            ["summary",            "summary"],
            ["pass1Confidence",    "pass1_confidence"],
            ["deepDiveConfidence", "deep_dive_confidence"],
            ["pass1Done",          "pass1_done"],
            ["deepDiveDone",       "deep_dive_done"],
            ["checked",            "checked"],
        ];
 
        for (const [jsKey, colName] of allowed)
        {
            if (jsKey in data)
            {
                setFields.push(`${colName} = $${i++}`);
                setValues.push(data[jsKey]);
            }
        }
 
        if (setFields.length === 0)
        {
            return { success: false, error: "No valid fields to update" };
        }
 
        setFields.push(`updated_at = NOW()`);
 
        const conditions  = [];
        const whereValues = [];
        let   wi          = i;
 
        if (filters.id          != null) { conditions.push(`id = $${wi++}`);                 whereValues.push(filters.id); }
        if (filters.tdr         != null) { conditions.push(`tdr = $${wi++}`);                whereValues.push(filters.tdr); }
        if (filters.companyName != null) { conditions.push(`company_name = $${wi++}`);       whereValues.push(filters.companyName); }
        if (filters.checked     != null) { conditions.push(`checked = $${wi++}`);            whereValues.push(filters.checked); }
        if (filters.pass1Done   != null) { conditions.push(`pass1_done = $${wi++}`);         whereValues.push(filters.pass1Done); }
        if (filters.deepDiveDone != null) { conditions.push(`deep_dive_done = $${wi++}`);   whereValues.push(filters.deepDiveDone); }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
        const result = await db.query(
            `UPDATE tender_analyses SET ${setFields.join(", ")} ${whereClause} RETURNING id`,
            [...setValues, ...whereValues]
        );
 
        return { success: true, updated: result.rowCount };
    }
    catch (err)
    {
        console.error("❌ Error updating tender analysis:", err);
        return { success: false, updated: 0 };
    }
}
 
async function deleteTenderAnalysis(filters = {})
{
    try
    {
        if (Object.keys(filters).length === 0)
        {
            return { success: false, error: "Refusing to delete without filters" };
        }
 
        const conditions = [];
        const values     = [];
        let   i          = 1;
 
        if (filters.id          != null) { conditions.push(`id = $${i++}`);                 values.push(filters.id); }
        if (filters.tdr         != null) { conditions.push(`tdr = $${i++}`);                values.push(filters.tdr); }
        if (filters.companyName != null) { conditions.push(`company_name = $${i++}`);       values.push(filters.companyName); }
        if (filters.checked     != null) { conditions.push(`checked = $${i++}`);            values.push(filters.checked); }
        if (filters.pass1Done   != null) { conditions.push(`pass1_done = $${i++}`);         values.push(filters.pass1Done); }
        if (filters.deepDiveDone != null) { conditions.push(`deep_dive_done = $${i++}`);   values.push(filters.deepDiveDone); }
        if (filters.createdFrom != null) { conditions.push(`created_at >= $${i++}`);        values.push(filters.createdFrom); }
        if (filters.createdTo   != null) { conditions.push(`created_at <= $${i++}`);        values.push(filters.createdTo); }
 
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
 
        const result = await db.query(
            `DELETE FROM tender_analyses ${whereClause} RETURNING id`,
            values
        );
 
        return { success: true, deleted: result.rowCount };
    }
    catch (err)
    {
        console.error("❌ Error deleting tender analysis:", err);
        return { success: false, deleted: 0 };
    }
}

async function tenderExists(filters = {})
{
    try
    {
        const conditions = [];
        const values = [];
        let i = 1;

        if (filters.tdr != null)
        {
            conditions.push(`tdr = $${i++}`);
            values.push(filters.tdr);
        }

        if (filters.tenderNo != null)
        {
            conditions.push(`tender_no = $${i++}`);
            values.push(filters.tenderNo);
        }

        if (filters.tenderId != null)
        {
            conditions.push(`tender_id = $${i++}`);
            values.push(filters.tenderId);
        }

        if (conditions.length === 0)
        {
            return { success: false, exists: false, error: "No identifying field provided" };
        }

        const clause = conditions.join(" OR ");

        const result = await db.query(
            `SELECT id, tdr, tender_no, tender_id
             FROM tender_pool2
             WHERE ${clause}
             LIMIT 1`,
            values
        );

        if (result.rows.length === 0)
        {
            return { success: true, exists: false };
        }

        return {
            success: true,
            exists: true,
            id: result.rows[0].id,
            tdr: result.rows[0].tdr,
            tenderNo: result.rows[0].tender_no,
            tenderId: result.rows[0].tender_id
        };
    }
    catch (err)
    {
        console.error("❌ Error checking tender existence:", err);
        return { success: false, exists: false, error: err.message };
    }
}

async function insertTenderPool2(data)
{
    try
    {
        const result = await db.query(
            `INSERT INTO tender_pool2 (
                tdr, tender_no, tender_id, url, category, authority, city, state,
                brief, description, value, value_raw, emd, emd_raw, doc_fees, doc_fees_raw,
                type, tender_category, bidding_type, competition_type, exemption, gem, corrigendum,
                publish_date, deadline, opening_date, company, person, address, pincode,
                source, corrigendums, docs
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
            ON CONFLICT (url) DO UPDATE SET
                last_seen_at = NOW()
            RETURNING *`,
            [
                data.tdr ?? null,
                data.tenderNo ?? null,
                data.tenderId ?? null,
                data.url,
                data.category ?? null,
                data.authority ?? null,
                data.city ?? null,
                data.state ?? null,
                data.brief ?? null,
                data.description ?? null,
                data.value ?? null,
                data.valueRaw ?? null,
                data.emd ?? null,
                data.emdRaw ?? null,
                data.docFees ?? null,
                data.docFeesRaw ?? null,
                data.type ?? null,
                data.tenderCategory ?? null,
                data.biddingType ?? null,
                data.competitionType ?? null,
                data.exemption ?? null,
                data.gem ?? false,
                data.corrigendum ?? false,
                data.publishDate ?? null,
                data.deadline ?? null,
                data.openingDate ?? null,
                data.company ?? null,
                data.person ?? null,
                data.address ?? null,
                data.pincode ?? null,
                data.source ?? null,
                data.corrigendums ? JSON.stringify(data.corrigendums) : null,
                data.docs ? JSON.stringify(data.docs) : null
            ]
        );

        return { success: true, data: mapRow2(result.rows[0]) };
    }
    catch (err)
    {
        console.error("❌ Error inserting into tender_pool2:", err);
        return { success: false, error: err.message };
    }
}

async function fetchTendersStrict(filters = {}, pageNo = 1, perPage = 20)
{
    try
    {
        const values = [];
        const { conditions, nextIndex } = buildStrictConditions(filters, values, 1);

        const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const offset = (pageNo - 1) * perPage;

        let i = nextIndex;
        const limitPlaceholder = `$${i++}`;
        const offsetPlaceholder = `$${i++}`;
        values.push(perPage, offset);

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM tender_pool2
             ${clause}
             ORDER BY inserted_at DESC
             LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
            values
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / perPage);

        return {
            success: true,
            data: result.rows.map(mapRow2),
            pagination: {
                totalCount,
                totalPages,
                currentPage: pageNo,
                perPage,
                hasNext: pageNo < totalPages,
                hasPrev: pageNo > 1
            }
        };
    }
    catch (err)
    {
        console.error("❌ Error fetching tenders (strict):", err);
        return { success: false, data: [], pagination: null };
    }
}

async function fetchTendersLoose(filters = {}, pageNo = 1, perPage = 20)
{
    try
    {
        const values = [];
        const { conditions, nextIndex } = buildLooseConditions(filters, values, 1);

        const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const offset = (pageNo - 1) * perPage;

        let i = nextIndex;
        const limitPlaceholder = `$${i++}`;
        const offsetPlaceholder = `$${i++}`;
        values.push(perPage, offset);

        const result = await db.query(
            `SELECT *, COUNT(*) OVER() AS total_count
             FROM tender_pool2
             ${clause}
             ORDER BY inserted_at DESC
             LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
            values
        );

        const totalCount = result.rows[0] ? parseInt(result.rows[0].total_count) : 0;
        const totalPages = Math.ceil(totalCount / perPage);

        return {
            success: true,
            data: result.rows.map(mapRow2),
            pagination: {
                totalCount,
                totalPages,
                currentPage: pageNo,
                perPage,
                hasNext: pageNo < totalPages,
                hasPrev: pageNo > 1
            }
        };
    }
    catch (err)
    {
        console.error("❌ Error fetching tenders (loose):", err);
        return { success: false, data: [], pagination: null };
    }
}

async function updateTendersPool2(filters = {}, data = {})
{
    try
    {
        const setFields = [];
        const setValues = [];
        let i = 1;

        const allowed = [
            ["tenderNo", "tender_no"],
            ["tenderId", "tender_id"],
            ["url", "url"],
            ["category", "category"],
            ["authority", "authority"],
            ["city", "city"],
            ["state", "state"],
            ["brief", "brief"],
            ["description", "description"],
            ["value", "value"],
            ["valueRaw", "value_raw"],
            ["emd", "emd"],
            ["emdRaw", "emd_raw"],
            ["docFees", "doc_fees"],
            ["docFeesRaw", "doc_fees_raw"],
            ["type", "type"],
            ["tenderCategory", "tender_category"],
            ["biddingType", "bidding_type"],
            ["competitionType", "competition_type"],
            ["exemption", "exemption"],
            ["gem", "gem"],
            ["corrigendum", "corrigendum"],
            ["publishDate", "publish_date"],
            ["deadline", "deadline"],
            ["openingDate", "opening_date"],
            ["company", "company"],
            ["person", "person"],
            ["address", "address"],
            ["pincode", "pincode"],
            ["source", "source"],
            ["corrigendums", "corrigendums"],
            ["docs", "docs"],
            ["workingOn", "working_on"]
        ];

        for (const [jsKey, colName] of allowed)
        {
            if (jsKey in data)
            {
                setFields.push(`${colName} = $${i++}`);
                setValues.push(data[jsKey]);
            }
        }

        if (setFields.length === 0)
        {
            return { success: false, error: "No fields to update" };
        }

        setFields.push(`last_seen_at = NOW()`);

        const { conditions, nextIndex } = buildStrictConditions(filters, setValues, i);

        if (conditions.length === 0)
        {
            return { success: false, error: "Refusing to update without filters" };
        }

        const clause = `WHERE ${conditions.join(" AND ")}`;

        const result = await db.query(
            `UPDATE tender_pool2 SET ${setFields.join(", ")} ${clause} RETURNING *`,
            setValues
        );

        return { success: true, updated: result.rowCount, data: result.rows.map(mapRow2) };
    }
    catch (err)
    {
        console.error("❌ Error updating tender_pool2:", err);
        return { success: false, updated: 0 };
    }
}

async function deleteTendersPool2(filters = {})
{
    try
    {
        const values = [];
        const { conditions } = buildStrictConditions(filters, values, 1);

        if (conditions.length === 0)
        {
            return { success: false, error: "Refusing to delete without filters" };
        }

        const clause = `WHERE ${conditions.join(" AND ")}`;

        const result = await db.query(
            `DELETE FROM tender_pool2 ${clause} RETURNING tdr`,
            values
        );

        return { success: true, deleted: result.rowCount };
    }
    catch (err)
    {
        console.error("❌ Error deleting from tender_pool2:", err);
        return { success: false, deleted: 0 };
    }
}

async function fetchTenderPool2Metadata(filters = {})
{
    try
    {
        const values = [];
        const { conditions } = buildLooseConditions(filters, values, 1);

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const nullClause = conditions.length > 0
            ? `AND state IS NOT NULL AND city IS NOT NULL`
            : `WHERE state IS NOT NULL AND city IS NOT NULL`;

        const overviewQuery = `
            SELECT
                COUNT(*) AS total,

                COUNT(*) FILTER (
                    WHERE deadline <= NOW() + INTERVAL '7 days'
                    AND deadline >= NOW()
                ) AS due_soon,

                COUNT(*) FILTER (
                    WHERE corrigendum = true
                ) AS corrigendum,

                COUNT(*) FILTER (
                    WHERE gem = true
                ) AS gem

            FROM tender_pool2
            ${whereClause}
        `;

        const categoryQuery = `
            SELECT
                category,
                COUNT(*) AS count
            FROM tender_pool2
            ${whereClause}
            GROUP BY category
            ORDER BY count DESC
        `;

        const stateCityQuery = `
            SELECT
                state,
                city
            FROM tender_pool2
            ${whereClause}
            ${nullClause}
        `;

        const [
            overviewResult,
            categoryResult,
            stateCityResult
        ] = await Promise.all([
            db.query(overviewQuery, values),
            db.query(categoryQuery, values),
            db.query(stateCityQuery, values)
        ]);

        const statesMap = {};

        for (const row of stateCityResult.rows)
        {
            const state = row.state?.trim();
            const city = row.city?.trim();

            if (!state || !city)
            {
                continue;
            }

            if (!statesMap[state])
            {
                statesMap[state] = new Set();
            }

            statesMap[state].add(city);
        }

        const states = Object.entries(statesMap).map(([state, citiesSet]) => ({
            state,
            cities: Array.from(citiesSet).sort()
        }));

        return {
            overview: {
                total: parseInt(overviewResult.rows[0].total || 0),
                dueSoon: parseInt(overviewResult.rows[0].due_soon || 0),
                corrigendum: parseInt(overviewResult.rows[0].corrigendum || 0),
                gem: parseInt(overviewResult.rows[0].gem || 0)
            },

            categories: categoryResult.rows.map(row => ({
                name: row.category || "Others",
                count: parseInt(row.count)
            })),

            states
        };
    }
    catch (err)
    {
        console.error("❌ Error fetching tender_pool2 metadata:", err);

        return {
            overview: {
                total: 0,
                dueSoon: 0,
                corrigendum: 0,
                gem: 0
            },

            categories: [],
            states: []
        };
    }
}

module.exports = {
    getAllLicenses,
    getLicenseById,
    insertLicense,
    updateLicense,
    deleteLicense,
    getAllIsoCerts,
    getIsoCertById,
    insertIsoCert,
    updateIsoCert,
    deleteIsoCert,
    getAllPsaraCerts,
    getPsaraCertById,
    insertPsaraCert,
    updatePsaraCert,
    deletePsaraCert,
    getAllSpecialCerts,
    getSpecialCertById,
    insertSpecialCert,
    updateSpecialCert,
    deleteSpecialCert,
    getAllFinancials,
    getFinancialsById,
    getFinancialsByCompany,
    insertFinancials,
    updateFinancials,
    deleteFinancials,
    getAllMsme,
    getMsmeById,
    getMsmeByCompany,
    insertMsme,
    updateMsme,
    deleteMsme,
    searchWorkExperiences,
    getWorkExperienceById,
    getAllWorkExperiences,
    updateWorkExperience,
    deleteWorkExperience,
    insertWorkExperience,
    insertTenderDocument,
    getTenderDocumentById,
    updateTenderDocument,
    deleteTenderDocument,
    getAllTenderDocuments,
    searchTenderDocuments,
    insertTenders,
    updateTenders,
    deleteTenders,
    fetchTenders,
    fetchTenderMetadata,
    insertCompanyChunk,
    searchCompanyChunks,
    deleteCompanyChunk,
    deleteAllCompanyChunks,
    insertTenderAnalysis,
    fetchTenderAnalyses,
    updateTenderAnalysis,
    deleteTenderAnalysis,
    tenderExists,
    insertTenderPool2,
    fetchTendersStrict,
    fetchTendersLoose,
    updateTendersPool2,
    deleteTendersPool2,
    fetchTenderPool2Metadata
};