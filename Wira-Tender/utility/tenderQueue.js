const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { Queue, Worker, QueueEvents } = require("bullmq");
const tenderExtractor = require("./extractTender");
const tenderScraper = require("./tenderScraper");
const tenderAI = require("../AI/tenderAI");

const VALID_CATEGORIES = new Set([
    "Man Power",
    "HouseKeeping",
    "Security Guard",
    "Security Services",
    "Training Services",
    "Computer Tenders",
    "Electrical Works"
]);

const ONE_CRORE = 10000000;

const KEYWORDS = [
    "facility management service",
    "fms",
    "manpower",
    "outsourcing",
    "security"
];

const SEARCHABLE_FIELDS = [
    "authority",
    "city",
    "state",
    "brief",
    "category",
    "documentType"
];

const TENDERS_PER_USER = 5;
const HAPPY_SQUARE_INDEX = 1;
const HAPPY_SQUARE_PROFILE = path.resolve(__dirname, "../tenderFiles/happySquare.json");

const IMPORTANCE_SCORES = { 
    critical: 6, 
    high: 4, 
    medium: 2, 
    low: 1 
};

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined
};

const QUEUE_NAME = "tender-nightly-queue";
const LOG_DIR = path.resolve(__dirname, "../logs");

function authorityMatchesCompany(authority, companyName)
{
    function normalize(str)
    {
        return str.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    }

    function tokenize(str)
    {
        return str.split(" ").filter(w => w.length > 2 && !stopWords.has(w));
    }

    if(!authority || !companyName)
    {
        return false;
    }

    const normAuthority = normalize(authority);
    const normCompany = normalize(companyName);
    const acronymMatch = companyName.match(/\(([A-Z]{2,})\)/g);
    if(acronymMatch)
    {
        for(const acronym of acronymMatch)
        {
            const letters = acronym.replace(/[()]/g, "").toLowerCase();
            if(normAuthority.includes(letters))
            {
                return true;
            }
        }
    }

    if(normAuthority.includes(normCompany) || normCompany.includes(normAuthority))
    {
        return true;
    }

    const stopWords = new Set([
        "the", 
        "and", 
        "for", 
        "ltd", 
        "pvt", 
        "limited", 
        "services", 
        "private", 
        "india", 
        "of", 
        "in", 
        "at"
    ]);

    const authorityTokens = new Set(tokenize(normAuthority));
    const companyTokens = tokenize(normCompany);

    if(companyTokens.length === 0)
    {
        return false;
    }

    const matched = companyTokens.filter(w => authorityTokens.has(w));
    return matched.length >= 1 && (matched.length / companyTokens.length) >= 0.4;
}

function getTenderValue(tender)
{
    if(tender.tenderValue != null)
    {
        return tender.tenderValue;
    }

    if(tender.value != null)
    {
        return tender.value;
    }

    return 0;
}

function isTenderGem(tender)
{
    if(typeof tender.gem === "boolean")
    {
        return tender.gem;
    }

    if(tender.tenderNo && /^gem\//i.test(tender.tenderNo))
    {
        return true;
    }

    if(tender.source && /gem\.gov\.in/i.test(tender.source))
    {
        return true;
    }

    return false;
}

function tenderHasSecurityFee(tender)
{
    if(typeof tender.security_fee_required === "boolean")
    {
        return tender.security_fee_required;
    }

    const emd = tender.emd ?? 0;
    const docFees = tender.docFees ?? 0;
    return emd > 0 || docFees > 0;
}

function userMatchesHardPreferences(user, tender)
{
    const val = getTenderValue(tender);
    const gem = isTenderGem(tender);

    if(user.tender_type === "GEM" && !gem)
    {
        return false;
    }

    if(user.tender_type === "NON_GEM" && gem)
    {
        return false;
    }

    if(user.bid_value_limit === "Above 1 Crore" && val < ONE_CRORE)
    {
        return false;
    }

    if(user.bid_value_limit === "Below 1 Crore" && val >= ONE_CRORE)
    {
        return false;
    }

    return true;
}

function userMatchesSecurityFee(user, tender)
{
    if(user.security_fee_required === true)
    {
        return tenderHasSecurityFee(tender);
    }

    return true;
}

function userMatchesCompany(user, tender)
{
    if(!user.assigned_companies || user.assigned_companies.length === 0)
    {
        return false;
    }

    return user.assigned_companies.some(company => authorityMatchesCompany(tender.authority, company));
}

function assignTenders(tenders, users)
{
    const perUserLimit = TENDERS_PER_USER;
    const assignments = new Map();
    const assigned = new Set();

    for(const user of users)
    {
        assignments.set(user.id, []);
    }

    for(const user of users)
    {
        if(!user.assigned_companies || user.assigned_companies.length === 0)
        {
            continue;
        }

        for(const tender of tenders)
        {
            if(assigned.has(tender.tdr))
            {
                continue;
            }

            if(assignments.get(user.id).length >= perUserLimit)
            {
                break;
            }

            if(userMatchesHardPreferences(user, tender) && userMatchesSecurityFee(user, tender) && userMatchesCompany(user, tender))
            {
                assignments.get(user.id).push(tender);
                assigned.add(tender.tdr);
            }
        }
    }

    for(const user of users)
    {
        if(!user.assigned_companies || user.assigned_companies.length === 0)
        {
            continue;
        }

        for(const tender of tenders)
        {
            if(assigned.has(tender.tdr))
            {
                continue;
            }

            if(assignments.get(user.id).length >= perUserLimit)
            {
                break;
            }

            if(userMatchesHardPreferences(user, tender) && userMatchesCompany(user, tender))
            {
                assignments.get(user.id).push(tender);
                assigned.add(tender.tdr);
            }
        }
    }

    for(const user of users)
    {
        for(const tender of tenders)
        {
            if(assigned.has(tender.tdr))
            {
                continue;
            }

            if(assignments.get(user.id).length >= perUserLimit)
            {
                break;
            }

            if(userMatchesHardPreferences(user, tender) && userMatchesSecurityFee(user, tender))
            {
                assignments.get(user.id).push(tender);
                assigned.add(tender.tdr);
            }
        }
    }

    for(const user of users)
    {
        for(const tender of tenders)
        {
            if(assigned.has(tender.tdr))
            {
                continue;
            }

            if(assignments.get(user.id).length >= perUserLimit)
            {
                break;
            }

            if(userMatchesHardPreferences(user, tender))
            {
                assignments.get(user.id).push(tender);
                assigned.add(tender.tdr);
            }
        }
    }

    for(const user of users)
    {
        for(const tender of tenders)
        {
            if(assigned.has(tender.tdr))
            {
                continue;
            }

            if(assignments.get(user.id).length >= perUserLimit)
            {
                break;
            }

            const gem = isTenderGem(tender);
            if((user.tender_type === "GEM" && gem) || (user.tender_type === "NON_GEM" && !gem))
            {
                assignments.get(user.id).push(tender);
                assigned.add(tender.tdr);
            }
        }
    }

    const remainingTenders = tenders.filter(t => !assigned.has(t.tdr));
    let roundRobinIndex = 0;

    for(const tender of remainingTenders)
    {
        let placed = false;
        let attempts = 0;

        while(!placed && attempts < users.length)
        {
            const user = users[roundRobinIndex % users.length];
            roundRobinIndex++;
            attempts++;

            if(assignments.get(user.id).length < perUserLimit)
            {
                assignments.get(user.id).push(tender);
                assigned.add(tender.tdr);
                placed = true;
            }
        }
    }

    return assignments;
}

function getTodayDateString()
{
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function getTimestamp()
{
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `[${dd}-${mm}-${yyyy} ${hh}:${min}:${ss}]`;
}

function getLogFilePath()
{
    if(!fs.existsSync(LOG_DIR))
    {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    return path.join(LOG_DIR, `tender-queue-log-${getTodayDateString()}.txt`);
}

function writeLog(logFilePath, lines)
{
    const ts = getTimestamp();
    const content = Array.isArray(lines) ? lines : [lines];
    const stamped = content.map(line => `${ts}  ${line}`).join("\n");
    fs.appendFileSync(logFilePath, stamped + "\n", "utf8");
}

function writeSectionDivider(logFilePath)
{
    writeLog(logFilePath, "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function writeSectionHeader(logFilePath, title)
{
    writeSectionDivider(logFilePath);
    writeLog(logFilePath, `  ${title}`);
    writeSectionDivider(logFilePath);
}

function matchesKeyword(tender)
{
    const haystack = SEARCHABLE_FIELDS.map(f => tender[f] ?? "").join(" ").toLowerCase();
    return KEYWORDS.some(kw => haystack.includes(kw.toLowerCase()));
}

function filterTenders(tenders)
{
    return tenders.filter(tender =>
    {
        if(!VALID_CATEGORIES.has(tender.category))
        {
            return false;
        }

        const state = tender.state?.toLowerCase().trim();
        const val = getTenderValue(tender);

        if(state !== "madhya pradesh")
        {
            if(val == null || val === 0)
            {
                return false;
            }

            if(val < ONE_CRORE)
            {
                return false;
            }
        }

        return matchesKeyword(tender);
    });
}

function computeScore(requirements)
{
    const totalPoints = requirements.reduce((sum, r) => sum + (IMPORTANCE_SCORES[r.importance] || 1), 0);
    if(!totalPoints)
    {
        return 0;
    }

    const earned = requirements.filter(r => String(r.status || "").toLowerCase().trim() === "yes").reduce((sum, r) => sum + (IMPORTANCE_SCORES[r.importance] || 1), 0);
    return parseFloat(((earned / totalPoints) * 100).toFixed(1));
}

async function fetchActiveUsers()
{
    try
    {
        const response = await fetch("https://white-force.com/tender/api/get-active-users",
        {
            method: "GET",
            headers: { 
                "Content-Type": "application/json" 
            }
        });

        const users = await response.json();
        console.log(`👥 Active users fetched: ${users.length}`);
        return users;
    }
    catch(err)
    {
        console.warn(`⚠️  Failed to fetch active users: ${err.message}`);
        return [];
    }
}

function getPdfUrls(tender)
{
    return (tender.documents || []).filter(doc => doc.fileUrl && doc.fileName?.toLowerCase().endsWith(".pdf")).map(doc => doc.fileUrl);
}

async function saveAnalysisData(tenderId, tdr, analyzeData, deepDiveData, allRequirements, score, userId)
{
    try
    {
        const saveResponse = await fetch("https://white-force.com/tender/api/save-analysis-data",
        {
            method: "POST",
            headers: { 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify(
                {
                    tender_id: tenderId,
                    tdr: tdr,
                    analysis_data: analyzeData,
                    deep_dive_data: deepDiveData,
                    user_requirements: allRequirements,
                    user_score: score,
                    user_id: userId
                }
            )
        });

        const saveResponseData = await saveResponse.json();
        if(!saveResponse.ok || saveResponseData?.success !== true)
        {
            console.warn(`⚠️  [tdr ${tdr}] Save to API returned failure:`, saveResponseData);

            return { 
                saved: false, 
                analysisId: null 
            };
        }

        console.log(`✅ [tdr ${tdr}] Saved — analysis_id: ${saveResponseData.analysis_id}`);

        return { 
            saved: true, 
            analysisId: saveResponseData.analysis_id 
        };
    }
    catch(err)
    {
        console.warn(`⚠️  [tdr ${tdr}] Save to API failed: ${err.message}`);

        return { 
            saved: false, 
            analysisId: null 
        };
    }
}

async function runAnalysis(tender, userId, logFilePath)
{
    const pdfUrls = getPdfUrls(tender);

    writeLog(logFilePath, `\n  TDR ${tender.tdr} — ${tender.authority}`);
    writeLog(logFilePath, `  Category : ${tender.category}`);
    writeLog(logFilePath, `  Value    : ${tender.tenderValue != null ? "₹" + tender.tenderValue.toLocaleString("en-IN") : "Not specified"}`);
    writeLog(logFilePath, `  State    : ${tender.state}`);

    if(pdfUrls.length === 0)
    {
        writeLog(logFilePath, `  ❌ No PDF documents found — skipped`);

        return {
            tdr: tender.tdr,
            authority: tender.authority,
            error: "No PDF documents found for analysis",
            statusCode: 404,
            data: { 
                analyze: null, 
                deepDive: null, 
                score: 0 
            }
        };
    }

    const fileInputs = [...pdfUrls, HAPPY_SQUARE_PROFILE];
    let pass1Result;

    try
    {
        pass1Result = await tenderAI.analyzeTenderPDF2(
            fileInputs,
            3,
            (chunk) => process.stdout.write(chunk),
            "English",
            HAPPY_SQUARE_INDEX,
            HAPPY_SQUARE_PROFILE
        );

        writeLog(logFilePath, `  ✅ Pass 1 — Analysis complete`);
    }
    catch(err)
    {
        writeLog(logFilePath, `  ❌ Pass 1 — Failed: ${err.message}`);

        return {
            tdr: tender.tdr,
            authority: tender.authority,
            error: "Pass 1 analysis failed: " + err.message,
            statusCode: 500,
            data: { 
                analyze: null, 
                deepDive: null, 
                score: 0 
            }
        };
    }

    if(pass1Result?.status !== "success" || !pass1Result.data)
    {
        writeLog(logFilePath, `  ❌ Pass 1 — Returned no data`);

        return {
            tdr: tender.tdr,
            authority: tender.authority,
            error: "Pass 1 analysis returned no data",
            statusCode: 500,
            data: { 
                analyze: null, 
                deepDive: null, 
                score: 0 
            }
        };
    }

    const existingRequirements = pass1Result.data.requirements || [];
    const hasAnnexures = pass1Result.data.tender?.hasAnnexure ?? false;
    let pass2Result;

    try
    {
        pass2Result = await tenderAI.analyzeTenderDeepDive(
            fileInputs,
            [HAPPY_SQUARE_PROFILE],
            existingRequirements,
            hasAnnexures,
            3,
            (chunk) => process.stdout.write(chunk),
            "English",
            HAPPY_SQUARE_INDEX,
            HAPPY_SQUARE_PROFILE
        );

        writeLog(logFilePath, `  ✅ Pass 2 — Deep dive complete`);
    }
    catch(err)
    {
        const score = computeScore(existingRequirements);
        writeLog(logFilePath, `  ❌ Pass 2 — Failed: ${err.message}`);

        return {
            tdr: tender.tdr,
            authority: tender.authority,
            error: "Pass 2 analysis failed: " + err.message,
            statusCode: 500,
            data: { 
                analyze: pass1Result.data, 
                deepDive: null, 
                score: score 
            }
        };
    }

    if(pass2Result?.status !== "success" || !pass2Result.data)
    {
        const score = computeScore(existingRequirements);
        writeLog(logFilePath, `  ❌ Pass 2 — Returned no data`);

        return {
            tdr: tender.tdr,
            authority: tender.authority,
            error: "Pass 2 analysis returned no data",
            statusCode: 500,
            data: { 
                analyze: pass1Result.data, 
                deepDive: null, 
                score: score 
            }
        };
    }

    const splitAt = pass1Result.data.requirements?.length || 0;
    const allRequirements = [...existingRequirements, ...(pass2Result.data.missedRequirements || [])];
    let corrected;

    try
    {
        corrected = await tenderAI.crossCheckRequirements(allRequirements);
        const flippedCount = corrected.filter((r, i) => r.status === "Yes" && allRequirements[i].status === "No").length;
        writeLog(logFilePath, `  ✅ Pass 3 — Requirements cross-check complete (${flippedCount} flipped to Yes)`);
    }
    catch(err)
    {
        corrected = allRequirements;
        writeLog(logFilePath, `  ⚠️  Pass 3 — Cross-check failed, using raw requirements: ${err.message}`);
    }

    const score = computeScore(corrected);

    const analyzeOut = { 
        ...pass1Result.data, 
        requirements: corrected.slice(0, splitAt) 
    };

    const deepDiveOut = { 
        ...pass2Result.data, 
        missedRequirements: corrected.slice(splitAt) 
    };

    const saveResult = await saveAnalysisData(pass1Result.data.tender.tender_id, tender.tdr, analyzeOut, deepDiveOut, corrected, score, userId);
    writeLog(logFilePath, `  📊 Score    : ${score}%`);

    if(saveResult.saved)
    {
        writeLog(logFilePath, `  ✅ Saved to API — analysis_id: ${saveResult.analysisId} — allocated to user ${userId}`);
    }
    else
    {
        writeLog(logFilePath, `  ❌ Save to API failed — user ${userId} allocation not confirmed`);
    }

    return {
        tdr: tender.tdr,
        authority: tender.authority,
        error: saveResult.saved ? null : "Save to API failed",
        statusCode: saveResult.saved ? 200 : 500,
        data: { 
            analyze: analyzeOut, 
            deepDive: deepDiveOut, 
            score: score 
        }
    };
}

async function processTenderNightlyJob(job)
{
    const logFilePath = getLogFilePath();
    const startedAt = new Date();

    writeLog(logFilePath, `\n\n${"═".repeat(70)}`);
    writeLog(logFilePath, `  TENDER NIGHTLY QUEUE — ${startedAt.toISOString()}`);
    writeLog(logFilePath, `${"═".repeat(70)}\n`);

    writeSectionHeader(logFilePath, "STEP 1 — FETCH & FILTER TENDERS");

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 1);
    fromDate.setHours(0, 0, 0, 0);

    writeLog(logFilePath, `  Fetching tender emails since: ${fromDate.toISOString()}\n`);

    const emails = await tenderExtractor.extractTenderEmails(fromDate);
    if(!emails || emails.length === 0)
    {
        writeLog(logFilePath, `  ⚠️  No tender emails found. Pipeline stopped.`);
        console.warn("⚠️ No tender emails found.");
        return;
    }

    const flat = [];
    const categoryTotals = {};

    for(const group of emails)
    {
        for(const tender of (group.tenders || []))
        {
            flat.push({ ...tender, category: group.category });
            categoryTotals[group.category] = (categoryTotals[group.category] || 0) + 1;
        }
    }

    writeLog(logFilePath, `  Total fetched : ${flat.length}`);
    writeLog(logFilePath, `\n  Breakdown by category:`);

    for(const [cat, count] of Object.entries(categoryTotals))
    {
        writeLog(logFilePath, `    • ${cat.padEnd(25)} ${count}`);
    }

    writeLog(logFilePath, `\n  Scraping & saving to tender_pool2...\n`);

    let scrapeSaved = 0;
    let scrapeFailed = 0;
    for(let i = 0; i < flat.length; i++)
    {
        const tender = flat[i];

        try
        {
            const details = await tenderScraper.extractTenderDetails(tender.url, tender.category);

            if(details.success)
            {
                tender.documents = (details.docs || []).map(doc => ({
                    fileUrl: doc.url.startsWith("http") ? doc.url : `https://www.tenderdetail.com${doc.url}`,
                    fileName: doc.name
                }));

                tender.tenderValue = details.value ?? tender.tenderValue;
                tender.value = details.value ?? tender.value;
                tender.emd = details.emd;
                tender.docFees = details.docFees;
                tender.gem = details.gem;
                tender.authority = details.authority || tender.authority;
                tender.state = details.state || tender.state;
                tender.city = details.city || tender.city;
                tender.tdr = details.tdr || tender.tdr;
                tender.brief = details.brief || tender.brief;

                if(details.inserted)
                {
                    scrapeSaved++;
                }

                writeLog(logFilePath, `  [${i + 1}/${flat.length}] tdr ${tender.tdr} — ✅ ${tender.documents.length} doc(s)${details.inserted ? " — saved to tender_pool2" : " — already exists"}`);
            }
            else
            {
                tender.documents = [];
                scrapeFailed++;
                writeLog(logFilePath, `  [${i + 1}/${flat.length}] tdr ${tender.tdr} — ⚠️  scrape failed: ${details.error}`);
            }
        }
        catch(err)
        {
            tender.documents = [];
            scrapeFailed++;
            writeLog(logFilePath, `  [${i + 1}/${flat.length}] tdr ${tender.tdr} — ❌ error: ${err.message}`);
        }

        job.updateProgress(Math.floor((i + 1) / flat.length * 30));
    }

    writeLog(logFilePath, `\n  tender_pool2 save — new: ${scrapeSaved}, failed: ${scrapeFailed}`);

    const filtered = filterTenders(flat);
    const filteredByCategory = {};
    for(const tender of filtered)
    {
        filteredByCategory[tender.category] = (filteredByCategory[tender.category] || 0) + 1;
    }

    writeLog(logFilePath, `\n  After keyword + category + value filter : ${filtered.length}`);
    writeLog(logFilePath, `\n  Filtered breakdown by category:`);

    for(const [cat, count] of Object.entries(filteredByCategory))
    {
        writeLog(logFilePath, `    • ${cat.padEnd(25)} ${count}`);
    }

    writeSectionHeader(logFilePath, "STEP 2 — FETCH ACTIVE USERS & ALLOCATE");

    const users = await fetchActiveUsers();
    if(users.length === 0)
    {
        writeLog(logFilePath, `  ⚠️  No active users found. Analysis skipped.`);
        console.warn("⚠️ No active users found. Skipping analysis.");
        return;
    }

    writeLog(logFilePath, `  Active users (${users.length}):`);
    for(const user of users)
    {
        writeLog(logFilePath, `    • ${user.name} (id: ${user.id}) — ${user.tender_type} — ${user.bid_value_limit}${user.assigned_companies.length > 0 ? ` — ${user.assigned_companies.length} preferred companies` : ""}`);
    }

    const allAssignments = assignTenders(filtered, users);
    const flatAssigned = [];
    for(const user of users)
    {
        const userTenders = allAssignments.get(user.id) || [];

        for(const tender of userTenders)
        {
            flatAssigned.push({ tender, user });
        }
    }

    writeSectionHeader(logFilePath, `STEP 3 — AI ANALYSIS (${flatAssigned.length} tenders)`);

    const results = [];
    for(let i = 0; i < flatAssigned.length; i++)
    {
        const { tender, user: assignedUser } = flatAssigned[i];

        writeLog(logFilePath, `\n  ── [${i + 1}/${flatAssigned.length}] ──────────────────────────────────────────────`);

        const result = await runAnalysis(tender, assignedUser.id, logFilePath);

        writeLog(logFilePath, `  👤 Allocated to : ${assignedUser.name} (id: ${assignedUser.id})`);

        if(result)
        {
            results.push({ 
                ...result, 
                assignedUserId: assignedUser.id 
            });
        }

        job.updateProgress(30 + Math.floor((i + 1) / flatAssigned.length * 70));
    }

    writeSectionHeader(logFilePath, "SUMMARY");

    const succeeded = results.filter(r => r.statusCode === 200).length;
    const failed = results.filter(r => r.statusCode !== 200).length;

    writeLog(logFilePath, `  Total analysed : ${results.length}`);
    writeLog(logFilePath, `  ✅ Succeeded   : ${succeeded}`);
    writeLog(logFilePath, `  ❌ Failed      : ${failed}`);
    writeLog(logFilePath, `\n  Results:`);

    for(const result of results)
    {
        const icon = result.statusCode === 200 ? "✅" : "❌";
        writeLog(logFilePath, `    ${icon} tdr ${result.tdr} — ${result.authority} — score: ${result.data?.score ?? "N/A"}%`);
    }

    const finishedAt = new Date();
    const durationMs = finishedAt - startedAt;
    const durationMin = Math.floor(durationMs / 60000);
    const durationSec = Math.floor((durationMs % 60000) / 1000);

    writeLog(logFilePath, `\n  Started  : ${startedAt.toISOString()}`);
    writeLog(logFilePath, `  Finished : ${finishedAt.toISOString()}`);
    writeLog(logFilePath, `  Duration : ${durationMin}m ${durationSec}s`);
    writeLog(logFilePath, `\n${"═".repeat(70)}\n`);

    console.log(JSON.stringify(results, null, 2));
}

async function startWorker()
{
    const worker = new Worker(QUEUE_NAME, processTenderNightlyJob,
    {
        connection: REDIS_CONNECTION,
        concurrency: 1
    });

    worker.on("completed", (job) =>
    {
        console.log(`✅ [BullMQ] Job ${job.id} completed`);
    });

    worker.on("failed", (job, err) =>
    {
        console.error(`❌ [BullMQ] Job ${job?.id} failed: ${err.message}`);
    });

    worker.on("progress", (job, progress) =>
    {
        console.log(`📊 [BullMQ] Job ${job.id} progress: ${progress}%`);
    });

    console.log("🔧 [BullMQ] Tender worker started");
    return worker;
}

async function execute()
{
    const queue = new Queue(QUEUE_NAME, { connection: REDIS_CONNECTION });
    const existingJobs = await queue.getJobs(["active", "waiting", "delayed"]);

    if(existingJobs.length > 0)
    {
        console.log(`⏭️  [BullMQ] ${existingJobs.length} job(s) already in queue — skipping new enqueue`);
        await queue.close();
        return;
    }

    await queue.add("nightly-tender-run", {},
    {
        attempts: 3,
        backoff: { 
            type: "exponential", 
            delay: 60000 
        },
        removeOnComplete: { 
            count: 7 
        },
        removeOnFail: { 
            count: 7 
        }
    });

    console.log("📥 [BullMQ] Nightly tender job enqueued");
    await queue.close();
}

module.exports = {
    execute,
    startWorker
};