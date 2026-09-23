const path = require("path");
const embedder = require("@wira/shared/Utility/embedding");
const db = require("../database/tenderDBFunctions");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const FILES = [
    { 
        name: "Happy Square",  
        path: path.resolve(__dirname, "../tenderFiles/happySquare.json")  
    },
    { 
        name: "White Force",   
        path: path.resolve(__dirname, "../tenderFiles/whiteForce.json")   
    },
    { 
        name: "Rajpal OPC",    
        path: path.resolve(__dirname, "../tenderFiles/rajpalOPC.json")    
    },
];

const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildChunks(company, data)
{
    const chunks = [];

    const c = data.company;
    chunks.push(
        {
            title: "Company Overview",
            content: `${c.name} is a company headquartered in ${c.headquarter}, registered under CIN ${c.CIN}. ` + `Director: ${c.director}. ` + `PAN: ${c.PAN}. GSTIN: ${c.GSTIN}. TAN: ${c.TAN}. ` + `EPFO: ${c.EPFO}. ESIC: ${c.ESIC}. ` + `MSME Udyam No: ${c.MSME_UdyamNo || "N/A"}. ` + `NSIC Reg No: ${c.NSIC_RegNo || "N/A"}. ` + `Registered Address: ${c.registeredAddress}. ` + `Tender Readiness: ${c.tenderReadiness}.`,
        }
    );

    chunks.push(
        {
            title: "Services and Geographic Reach",
            content: `${c.name} provides the following primary services: ${c.primaryServices.join(", ")}. ` + `The company operates across the following states: ${c.operatingStates.join(", ")}. ` + `MSME registered: ${c.isMSME ? "Yes" : "No"}. ` + `Labour License (State): ${c.labourLicenseState || "N/A"}. ` + `Labour License (Central): ${c.labourLicenseCentral || "N/A"}.`,
        }
    );

    const iso = data.certifications?.iso || [];
    const psara = data.certifications?.psara || [];
    const fssai = data.certifications?.fssai;
    const electrical = data.certifications?.electricalContractor;

    const isoParts = iso.length > 0 ? iso.map(i => `${i.standard} (Cert No: ${i.certNo}, valid till ${i.validTill}, scope: ${i.scope})`).join("; ") : "None";
    const psaraParts = psara.filter(p => p.licenseNo).length > 0 ? psara.filter(p => p.licenseNo).map(p => `${p.state} - License No: ${p.licenseNo}, valid till ${p.validTill}`).join("; ") : "Not documented";
    const fssaiPart = fssai ? `FSSAI License No: ${fssai.licenseNo}, valid till ${fssai.validTill}, scope: ${fssai.scope}, geographic scope: ${fssai.geographicScope}.` : "No FSSAI license.";
    const electricalPart = electrical ? `Electrical Contractor License: Grade ${electrical.grade}, License No: ${electrical.licenseNo}, issued by ${electrical.issuingAuthority}, valid till ${electrical.validTill}, scope: ${electrical.geographicScope}.` : "No electrical contractor license.";

    chunks.push(
        {
            title: "Certifications",
            content: `${c.name} holds the following certifications. ISO Certifications: ${isoParts}. PSARA Licenses: ${psaraParts}. ${fssaiPart} ${electricalPart}`,
        }
    );

    const licenses = data.licenses || [];
    const BATCH = 6;
    for(let i = 0; i < licenses.length; i += BATCH)
    {
        const slice = licenses.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const lines = slice.map(l => `${l.licenseType}: No. ${l.licenseNo || "N/A"}, issued by ${l.issuingAuthority || "N/A"}, valid from ${l.validFrom || "N/A"} to ${l.validTill || "N/A"}, status: ${l.status}, applicable for: ${l.applicableFor || "N/A"}, geographic scope: ${l.geographicScope || "N/A"}.`).join(" ");

        chunks.push(
            {
                title: `Licenses (Part ${batchNum})`,
                content: `${c.name} licenses (batch ${batchNum}): ${lines}`,
            }
        );
    }

    const stats = data.licenseStats;
    chunks.push(
        {
            title: "License Summary",
            content: `${c.name} has a total of ${stats.total} licenses on record. Valid: ${stats.valid}. Expired: ${stats.expired}.`,
        }
    );

    const fin = data.financials;
    chunks.push(
        {
            title: "Financials",
            content: `${c.name} financial data. Annual Turnover — FY2024-25: ${fin.annualTurnover.fy2024_25 ?? "Not provided"}, FY2023-24: ${fin.annualTurnover.fy2023_24 ?? "Not provided"}, FY2022-23: ${fin.annualTurnover.fy2022_23 ?? "Not provided"} (unit: ${fin.annualTurnover.unit}). Average Turnover (3 years, ${fin.averageTurnover3Yr.period}): ${fin.averageTurnover3Yr.value ?? "Not provided"}. Net Worth — FY2024-25: ${fin.netWorth.fy2024_25 ?? "Not provided"}, ` + `FY2023-24: ${fin.netWorth.fy2023_24 ?? "Not provided"}, ` + `FY2022-23: ${fin.netWorth.fy2022_23 ?? "Not provided"}. ` + `Bank Solvency: ${fin.bankSolvency.valueLakhs ?? "Not provided"} Lakhs, Bank: ${fin.bankSolvency.issuingBank ?? "N/A"}. ` + `Working Capital: ${fin.workingCapital ?? "Not provided"}. ` + `Max Manpower Deployed: ${fin.maxManpowerDeployed ?? "Not provided"}. ` + `Largest Single Work Order Value: ${fin.largestSingleWorkOrderValue ?? "Not provided"}. ` + `Ongoing Commitments: ${fin.ongoingCommitmentsLakhs ?? "Not provided"} Lakhs.`,
        }
    );

    const projects = data.projects?.all || [];
    const pStats = data.projects?.stats;

    chunks.push(
        {
            title: "Project Statistics",
            content: `${c.name} project summary. ` + `Total projects: ${pStats.totalProjects}. ` + `Completed: ${pStats.completedCount} (total contract value: INR ${pStats.completedContractValueINR}, total manpower: ${pStats.completedTotalManpower}). ` + `Ongoing: ${pStats.ongoingCount} (total contract value: INR ${pStats.ongoingContractValueINR}, total manpower: ${pStats.ongoingTotalManpower}).`,
        }
    );

    const completed = projects.filter(p => p.status === "completed");
    const ongoing = projects.filter(p => p.status === "ongoing");

    const PROJECT_BATCH = 10;
    for(let i = 0; i < completed.length; i += PROJECT_BATCH)
    {
        const slice = completed.slice(i, i + PROJECT_BATCH);
        const batchNum = Math.floor(i / PROJECT_BATCH) + 1;
        const lines = slice.map(p => `Client: ${p.clientName} (${p.clientType || "N/A"}), Work: ${p.workDescription}, ` + `Location: ${p.location}, Order No: ${p.orderNo}, ` + `Contract Value: INR ${p.contractValueINR}, Manpower: ${p.manpower}, ` + `Period: ${p.workStart} to ${p.workEnd}.`).join(" | ");

        chunks.push(
            {
                title: `Completed Projects (Part ${batchNum})`,
                content: `${c.name} completed work experience (batch ${batchNum}): ${lines}`,
            }
        );
    }

    for(let i = 0; i < ongoing.length; i += PROJECT_BATCH)
    {
        const slice = ongoing.slice(i, i + PROJECT_BATCH);
        const batchNum = Math.floor(i / PROJECT_BATCH) + 1;
        const lines = slice.map(p => `Client: ${p.clientName} (${p.clientType || "N/A"}), Work: ${p.workDescription}, ` + `Location: ${p.location}, Order No: ${p.orderNo}, ` + `Contract Value: INR ${p.contractValueINR}, Manpower: ${p.manpower}, ` + `Period: ${p.workStart} to ${p.workEnd}.`).join(" | ");

        chunks.push(
            {
                title: `Ongoing Projects (Part ${batchNum})`,
                content: `${c.name} ongoing active contracts (batch ${batchNum}): ${lines}`,
            }
        );
    }

    const msme = data.msmeAdvantages;
    chunks.push(
        {
            title: "MSME Advantages",
            content: `${c.name} MSME details. ` + `Udyam No: ${msme.udyamNo || "N/A"}. ` + `NSIC Reg No: ${msme.nsicRegNo || "N/A"}. ` + `Exemptions and advantages: ${(msme.exemptions || []).join(", ")}.`,
        }
    );

    const rec = data.recommendedTenderTypes || [];
    const cond = data.tenderConditions || [];
    chunks.push(
        {
            title: "Tender Eligibility and Conditions",
            content: `${c.name} is recommended for the following tender types: ${rec.join(", ")}. ` + (cond.length > 0 ? `Tender conditions to note: ${cond.join("; ")}.` : "No special tender conditions noted."),
        }
    );

    const esc = data.escalationMatrix;
    chunks.push(
        {
            title: "Contact and Escalation",
            content: `${c.name} contact details. ` + `Contact Person: ${esc.contactPerson || "N/A"}. ` + `Email: ${esc.email || "N/A"}. ` + `Support No: ${esc.dedicatedSupportNo || "N/A"}. ` + `Registered Office: ${esc.registeredOfficeAddress || "N/A"}. ` + (esc.levels && esc.levels.length > 0 ? `Escalation levels: ${esc.levels.map(l => `Level ${l.level}: ${l.name || ""} ${l.contact}`).join(", ")}.` : "No escalation levels defined."),
        }
    );

    return chunks;
}

async function embedAndSave(companyName, chunkTitle, content)
{
    let embedding = null;

    for(let attempt = 1; attempt <= MAX_RETRIES; attempt++)
    {
        embedding = await embedder.getEmbedding(content);
        if(embedding)
        {
            break;
        }

        await sleep(RETRY_DELAY_MS * attempt);
    }

    if(!embedding)
    {
        return false;
    }

    const result = await db.insertCompanyChunk(companyName, chunkTitle, content, embedding);
    if(!result.success)
    {
        return false;
    }

    return true;
}

async function processCompany(entry)
{
    const data = require(entry.path);
    const chunks = buildChunks(entry.name, data);
    const cleared = await db.deleteAllCompanyChunks(entry.name);

    let saved = 0;
    let failed = 0;

    for(const chunk of chunks)
    {
        const ok = await embedAndSave(entry.name, chunk.title, chunk.content);
        if(ok)
        {
            saved++;
        }
        else
        {
            failed++;
        }
    }
}

async function main()
{
    console.log("🚀 Starting company chunk seeder...\n");

    for(const entry of FILES)
    {
        await processCompany(entry);
    }
    
    process.exit(0);
}

main().catch(err =>
{
    console.error("❌ Fatal error:", err);
    process.exit(1);
});