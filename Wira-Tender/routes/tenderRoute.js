const express = require('express');
const path = require("path");
const fs = require("fs");
const router = express.Router();
const upload = require("../multerSetup");
const tenderAI = require("../AI/tenderAI");
const embedder = require("../utility/embedding");
const tenderDB = require("../database/tenderDBFunctions");
const extractor = require("../utility/extractText");
const archiver = require('archiver');
const builder = require("../pdfBuilder/builder");
const tenderScraper = require("../utility/tenderScraper");
const tenderExtractor = require("../utility/extractTender");
const { v4: uuidv4 } = require('uuid');

const VALID_INDEXES = [1, 2, 3];

const TENDER_CHUNK_SIZE = 1500;
const TENDER_CHUNK_OVERLAP = 200;
 
let tenderSessions = [];

const COMPANY_FILES = {
    1: "../tenderFiles/happySquare.json",
    2: "../tenderFiles/whiteForce.json",
    3: "../tenderFiles/rajpalOPC.json",
};

const COMPANY_NAMES = {
    1: "Happy Square",
    2: "White Force",
    3: "Rajpal OPC",
};

const COMPANY_TXT_FILES = {
    1: "../tenderFiles/happySquare.txt",
    2: "../tenderFiles/whiteForce.txt",
    3: "../tenderFiles/rajpalOPC.txt",
};

const DOCUMENT_COMPANY_FILES = {
    1: "../tenderFiles/happySquareDocuments.json",
    2: "../tenderFiles/whiteForceDocuments.json",
    3: "../tenderFiles/rajpalOPCDocuments.json",
};

const DOCUMENT_COMPANY_TXT_FILES = {
    1: "../tenderFiles/happySquareDocuments.txt",
    2: "../tenderFiles/whiteForceDocuments.txt",
    3: "../tenderFiles/rajpalOPCDocuments.txt",
};

function loadAllowedRules()
{
    try
    {
        const filePath = path.resolve(__dirname, "../tenderFiles/rules.json");
        const rulesJson = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const allowedSet = new Set(rulesJson.allowedRules);
        const matched = [];

        for (const category of rulesJson.categories)
        {
            for (const rule of category.rules)
            {
                if (allowedSet.has(rule.id))
                {
                    matched.push({
                        id:          rule.id,
                        title:       rule.title,
                        prompt:      rule.prompt,
                        description: rule.description,
                        severity:    rule.severity,
                        category:    category.label
                    });
                }
            }
        }
        return matched;
    }
    catch (err)
    {
        console.error("❌ Error loading rules:", err.message);
        return [];
    }
}

function loadCompanyProfilePath(index = 1) 
{
    return path.resolve(__dirname, COMPANY_FILES[index] || COMPANY_FILES[1]);
}

function readCompany(index) 
{
    const filePath = path.resolve(__dirname, COMPANY_FILES[index]);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeCompany(index, data) 
{
    const filePath = path.resolve(__dirname, COMPANY_FILES[index]);
    data.generatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function validateIndex(request, response) 
{
    const index = parseInt(request.params.index);

    if(!VALID_INDEXES.includes(index)) 
    {
        response.status(400).json({ error: 'Invalid company index. Must be 1, 2, or 3.' });
        return null;
    }

    return index;
}

function rebuildLicenseStats(data) 
{
    const licenses = data.licenses || [];
    
    data.licenseStats = {
        total: licenses.length,
        valid: licenses.filter(l => l.status?.toLowerCase() === 'valid').length,
        expired: licenses.filter(l => l.status?.toLowerCase() === 'expired').length,
    };
}

function rebuildProjectStats(data) 
{
    const all = data.projects?.all || [];
    const completed = all.filter(p => p.status === 'completed');
    const ongoing = all.filter(p => p.status === 'ongoing');
    
    data.projects.stats = {
        totalProjects: all.length,
        completedCount: completed.length,
        ongoingCount: ongoing.length,
        completedContractValueINR: completed.reduce((sum, p) => sum + (p.contractValueINR || 0), 0),
        ongoingContractValueINR: ongoing.reduce((sum, p) => sum + (p.contractValueINR || 0), 0),
        completedTotalManpower: completed.reduce((sum, p) => sum + (p.manpower || 0), 0),
        ongoingTotalManpower: ongoing.reduce((sum, p) => sum + (p.manpower || 0), 0),
    };
}

function chunkTenderText(text)
{
    const chunks = [];
    let start = 0;
 
    while (start < text.length)
    {
        const end   = Math.min(start + TENDER_CHUNK_SIZE, text.length);
        const chunk = text.slice(start, end).trim();
 
        if (chunk.length > 50)
        {
            chunks.push(chunk);
        }
 
        start += TENDER_CHUNK_SIZE - TENDER_CHUNK_OVERLAP;
    }
 
    return chunks;
}
 
async function embedTenderChunksInBackground(session, rawChunks)
{
    for (let i = 0; i < rawChunks.length; i++)
    {
        const embedding = await embedder.getEmbedding(rawChunks[i]);
 
        if (embedding)
        {
            session.tenderChunks.push({
                index:     i,
                content:   rawChunks[i],
                embedding: embedding,
            });
        }
    }
 
    session.scope.chunksReady = true;
    console.log(`✅ Background embedding complete for session ${session.id} | Chunks: ${session.tenderChunks.length}/${rawChunks.length}`);
}

router.post('/analyze-tender', upload.array("files", 10), async (request, response) => {

    if(!request.files || request.files.length === 0)
    {
        return response.status(400).json({ error: 'No tender PDFs uploaded', statusCode: 400 });
    }

    const index = request.body.index;
    const tenderRules = loadAllowedRules();
    const profilePath = loadCompanyProfilePath(index);

    if(!profilePath || !tenderRules)
    {
        request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
        return response.status(500).json({ error: 'Failed to load profile or rules', statusCode: 500 });
    }

    const filePaths = [...request.files.map(f => path.join(__dirname, "../assets", f.filename)), profilePath];

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const onChunk = (text) =>
    {
        response.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
        response.flush();
    };

    try
    {
        const result = await tenderAI.analyzeTenderPDF(filePaths, tenderRules, 3, onChunk);

        if(result.status !== "success" || !result.data)
        {
            response.write(`data: ${JSON.stringify({ type: "error", error: "Analysis returned no data" })}\n\n`);
            response.flush();
            return response.end();
        }

        response.write(`data: ${JSON.stringify({ type: "done", data: result.data })}\n\n`);
        response.flush();
        response.end();
    }
    catch (err)
    {
        console.error("❌ Tender analysis error:", err.message);
        response.write(`data: ${JSON.stringify({ type: "error", error: "Failed to analyze tender" })}\n\n`);
        response.flush();
        response.end();
    }
    finally
    {
        request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
    }
});

/*
router.post('/analyze-tender2', upload.array("files", 10), async (request, response) =>
{
    if (!request.files || request.files.length === 0)
    {
        return response.status(400).json({ error: 'No tender PDFs uploaded', statusCode: 400 });
    }

    const index = request.body.index;
    const language = request.body.language || "English";
    const profilePath = loadCompanyProfilePath(index);

    if(!profilePath)
    {
        request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
        return response.status(500).json({ error: 'Failed to load profile', statusCode: 500 });
    }

    const tenderFilePaths = [...request.files.map(f => path.join(__dirname, "../assets", f.filename)), profilePath];

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const onChunk = (text) =>
    {
        response.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
        response.flush();
    };

    try
    {
        const result = await tenderAI.analyzeTenderPDF2(tenderFilePaths, 3, onChunk, language, index, profilePath);

        if(result.status !== "success" || !result.data)
        {
            response.write(`data: ${JSON.stringify({ type: "error", error: "Analysis returned no data" })}\n\n`);
            response.flush();
            return response.end();
        }

        const sessionId   = uuidv4();
        const companyName = COMPANY_NAMES[index] || "Unknown";
        const tenderText  = result.tenderText || "";
        const rawChunks   = chunkTenderText(tenderText);

        const session =
        {
            id: sessionId,
            scope:
            {
                companyName:   companyName,
                companyIndex:  index,
                language:      language,
                lastMessageId: 0,
                terminated:    false,
                chunksReady:   false,
            },
            tenderChunks: [],
            messages:     [],
        };

        const d = result.data.tender;

        const structuredChunkText = [
            d.tender_id          ? `Tender ID: ${d.tender_id}`                             : null,
            d.bid_value          ? `Bid Value / Estimated Contract Value: ${d.bid_value}`  : null,
            d.emd_amount         ? `EMD Amount (Earnest Money Deposit): ${d.emd_amount}`   : null,
            d.emd_exemption      ? `EMD Exemption: ${d.emd_exemption}`                     : null,
            d.contract_period    ? `Contract Duration: ${d.contract_period}`               : null,
            d.department_details ? `Department: ${d.department_details}`                   : null,
            d.business_category  ? `Category: ${d.business_category}`                      : null,
            d.bid_opening_date   ? `Bid Opening Date: ${d.bid_opening_date}`               : null,
            d.msme               ? `MSE Exemption: ${d.msme}`                              : null,
            d.startup            ? `Startup Exemption: ${d.startup}`                       : null,
            d.epbg_percent       ? `ePBG Percent: ${d.epbg_percent}`                       : null,
            d.epbg_amount        ? `ePBG Amount: ${d.epbg_amount}`                         : null,
            d.tender_type        ? `Tender Type: ${d.tender_type}`                         : null,
            d.no_of_manpower     ? `Manpower Required: ${d.no_of_manpower}`                : null,
            d.customBid          ? `Custom Bid: ${d.customBid}`                            : null,
        ].filter(Boolean).join("\n");

        if(structuredChunkText.length > 0)
        {
            const structuredEmbedding = await embedder.getEmbedding(structuredChunkText);

            if(structuredEmbedding)
            {
                session.tenderChunks.push({
                    index:     -1,
                    content:   `=== STRUCTURED TENDER SUMMARY ===\n${structuredChunkText}`,
                    embedding: structuredEmbedding,
                    pinned:    true,
                });
            }
        }

        tenderSessions.push(session);

        embedTenderChunksInBackground(session, rawChunks).catch(err =>
        {
            console.error(`❌ Background embedding failed for session ${sessionId}:`, err.message);
        });

        console.log(`🚀 Tender session created: ${sessionId} | Company: ${companyName} | Chunks queued: ${rawChunks.length}`);

        response.write(`data: ${JSON.stringify({ type: "done", data: result.data, sessionId: sessionId })}\n\n`);
        response.flush();
        response.end();
    }
    catch(err)
    {
        console.error("❌ Tender analysis error:", err.message);
        response.write(`data: ${JSON.stringify({ type: "error", error: "Failed to analyze tender" })}\n\n`);
        response.flush();
        response.end();
    }
    finally
    {
        request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
    }
});
*/

router.post('/analyze-tender2', upload.array("files", 10), async (request, response) =>
{
    if (!request.files || request.files.length === 0)
    {
        return response.status(400).json({ error: 'No tender PDFs uploaded', statusCode: 400 });
    }

    const index = request.body.index;
    const language = request.body.language || "English";
    const profilePath = loadCompanyProfilePath(index);

    if(!profilePath)
    {
        request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
        return response.status(500).json({ error: 'Failed to load profile', statusCode: 500 });
    }

    const tenderFilePaths = [...request.files.map(f => path.join(__dirname, "../assets", f.filename)), profilePath];

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const onChunk = (text) =>
    {
        response.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
        response.flush();
    };

    try
    {
        const result = await tenderAI.analyzeTenderPDF2(tenderFilePaths, 3, onChunk, language, index, profilePath);

        if(result.status !== "success" || !result.data)
        {
            response.write(`data: ${JSON.stringify({ type: "error", error: "Analysis returned no data" })}\n\n`);
            response.flush();
            return response.end();
        }

        const sessionId = uuidv4();

        response.write(`data: ${JSON.stringify({ type: "done", data: result.data, sessionId: sessionId })}\n\n`);
        response.flush();
        response.end();
    }
    catch(err)
    {
        console.error("❌ Tender analysis error:", err.message);
        response.write(`data: ${JSON.stringify({ type: "error", error: "Failed to analyze tender" })}\n\n`);
        response.flush();
        response.end();
    }
    finally
    {
        request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
    }
});

router.post('/analyze-annexures', upload.array("files", 10), async (request, response) =>
{
    if(!request.files || request.files.length === 0)
    {
        return response.status(400).json({ error: 'No tender PDFs uploaded', statusCode: 400 });
    }
    
    const index = request.body.index;
    const language = request.body.language || "English";
    const profilePath = loadCompanyProfilePath(index);
    
    if(!profilePath)
    {
        request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
        return response.status(500).json({ error: 'Failed to load profile', statusCode: 500 });
    }
    
    const tenderFilePaths = request.files.map(f => path.join(__dirname, "../assets", f.filename));
    
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    
    const onChunk = (text) =>
    {
        response.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
        response.flush();
    };
    
    try
    {
        const result = await tenderAI.analyzeAnnexures(tenderFilePaths, [profilePath], 3, onChunk, language);
    
        if(result.status !== "success" || !result.data)
        {
            response.write(`data: ${JSON.stringify({ type: "error", error: "Annexure analysis returned no data" })}\n\n`);
            response.flush();
            return response.end();
        }
    
        response.write(`data: ${JSON.stringify({ type: "done", data: result.data })}\n\n`);
        response.flush();
        response.end();
    }
    catch (err)
    {
        console.error("❌ Annexure analysis error:", err.message);
        response.write(`data: ${JSON.stringify({ type: "error", error: "Failed to analyze annexures" })}\n\n`);
        response.flush();
        response.end();
    }
    finally
    {
        request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
    }
});

router.post('/analyze-deep-dive', upload.array("files", 10), async (request, response) => {
    try 
    {
        if(!request.files?.length) 
        {
            return response.status(400).json({ error: 'No tender PDFs uploaded', statusCode: 400 });
        }
  
        const index = request.body.index;
        const language = request.body.language || "English";
        const hasAnnexures = request.body.hasAnnexures === "true" || request.body.hasAnnexures === true;
  
        const existingRequirements = (() => {
            try 
            { 
                return JSON.parse(request.body.existingRequirements || "[]"); 
            }
            catch 
            { 
                return []; 
            }
        })();
  
        const profilePath = loadCompanyProfilePath(index);
  
        if(!profilePath) 
        {
            request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
            return response.status(500).json({ error: 'Failed to load profile', statusCode: 500 });
        }
  
        //const tenderFilePaths = request.files.map(f => path.join(__dirname, "../assets", f.filename));
        const tenderFilePaths = [...request.files.map(f => path.join(__dirname, "../assets", f.filename)), profilePath];
  
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();
  
        const onChunk = (text) =>
        {
            response.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
            response.flush();
        };
  
        const result = await tenderAI.analyzeTenderDeepDive(
            tenderFilePaths,
            [profilePath],
            existingRequirements,
            hasAnnexures,
            3,
            onChunk,
            language,
            index,
            profilePath
        );
  
        if(result.status !== "success" || !result.data) 
        {
            response.write(`data: ${JSON.stringify({ type: "error", error: "Deep dive analysis returned no data" })}\n\n`);
            response.flush();
            return response.end();
        }

        const rawProfile = readCompany(index);
        const allProjects = rawProfile.projects?.all || rawProfile.experienceTracker?.allProjects || rawProfile.experienceTracker?.topProjects || [];
  
        const normalize = (str) => String(str || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  
        const getNumeric = (val) => {
            if(val == null)
            {
                return null;
            }
                 
            const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
        };
  
        const findProjectByNameLocation = (clientName, location) => {
            const targetName = normalize(clientName);
            const targetLoc = normalize(location);
  
            return allProjects.findIndex(p => {
                const pName = normalize(p.clientName || '');
                const pLoc = normalize(p.location || '');
                return (pName.includes(targetName) || targetName.includes(pName)) && (pLoc.includes(targetLoc) || targetLoc.includes(pLoc));
            });
        };
  
        const findProjectByNameValue = (clientName, contractValue) => {
            const targetName = normalize(clientName);
            const targetVal = getNumeric(contractValue);
  
            if(targetVal === null)
            {
                return -1;
            }
  
            return allProjects.findIndex(p => {
                const pName = normalize(p.clientName || '');
                const pVal = getNumeric(p.contractValueINR || p.contractValue);
          
                if(pVal === null)
                {
                    return false;
                } 
          
                const nameMatch = pName.includes(targetName) || targetName.includes(pName);
                const ratio = pVal / targetVal;
                const valueMatch = (ratio > 0.9 && ratio < 1.1) || (ratio > 95000 && ratio < 105000) || (ratio > 0.000009 && ratio < 0.000011);
          
                return nameMatch && valueMatch;
            });
        };
  
        const resolveProjectIndex = (match) => {
            if(match.projectIndex != null && typeof match.projectIndex === 'number' && match.projectIndex >= 0) 
            {
                if(allProjects[match.projectIndex]) 
                {
                    return match.projectIndex;
                }
            }
  
            let idx = findProjectByNameLocation(match.clientName, match.location);
            if(idx >= 0) 
            {
                console.log(`✅ Resolved by name+location: "${match.clientName}" @ "${match.location}" → index ${idx}`);
                return idx;
            }
  
            idx = findProjectByNameValue(match.clientName, match.contractValue);
            if(idx >= 0) 
            {
                console.log(`✅ Resolved by name+value: "${match.clientName}" (₹${match.contractValue}) → index ${idx}`);
                return idx;
            }

            const targetName = normalize(match.clientName);
                idx = allProjects.findIndex(p => {
                    const pName = normalize(p.clientName || '');
                    return pName.includes(targetName) || targetName.includes(pName);
                });
  
                if(idx >= 0) 
                {
                    console.warn(`⚠️ Resolved by name-only (loose): "${match.clientName}" → index ${idx}`);
                    return idx;
                }
  
                console.warn(`❌ Could not resolve: "${match.clientName}" | "${match.location}" | ₹${match.contractValue}`);
                return -1;
            };
  
            const resolvedMatches = (result.data.workOrderMatches || []).map(requirement => {
            const resolvedMatchList = (requirement.matches || []).map(match => {
                const projectIndex = resolveProjectIndex(match);
                const project = projectIndex >= 0 ? allProjects[projectIndex] : null;
  
                return {
                    ...match,
                    projectIndex: projectIndex >= 0 ? projectIndex : null,
                    resolved: !!project,
                    project: project
                };
            });
  
            return {
                ...requirement,
                matches: resolvedMatchList
            };
        });
  
        const enrichedData = {
            ...result.data,
            workOrderMatches: resolvedMatches
        };
  
        response.write(`data: ${JSON.stringify({ type: "done", data: enrichedData })}\n\n`);
        response.flush();
        response.end();
    } 
    catch(err) 
    {
        console.error("❌ Deep dive analysis error:", err.message);
        response.write(`data: ${JSON.stringify({ type: "error", error: "Failed to run deep dive analysis" })}\n\n`);
        response.flush();
        response.end();
    } 
    finally 
    {
        if(request.files?.length) 
        {
            request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
        }
    }
}); 

router.post("/analyze-enhance", upload.array("files", 10), async (request, response) =>
{
    const tenderFilePaths = [];
    
    try
    {
        if(!request.files?.length)
        {
            return response.status(400).json({
                statusCode: 400,
                success:    false,
                message:    "No tender PDFs uploaded",
                data:       null
            });
        }
    
        const index    = request.body.index;
        const language = request.body.language || "English";
    
        const profilePath = loadCompanyProfilePath(index);
    
        if(!profilePath)
        {
            request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
            return response.status(500).json({
                statusCode: 500,
                success:    false,
                message:    "Failed to load profile",
                data:       null
            });
        }
    
        const documentsPath = path.resolve(__dirname, DOCUMENT_COMPANY_TXT_FILES[index]);
    
        if(!documentsPath || !fs.existsSync(documentsPath))
        {
            request.files.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
            return response.status(500).json({
                statusCode: 500,
                success:    false,
                message:    "Failed to load documents inventory",
                data:       null
            });
        }
    
        const timestamp = Date.now();
        
        for(const f of request.files)
        {
            const oldPath = path.join(__dirname, "../assets", f.filename);
            const safeOriginalName = f.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
            const newFilename = timestamp + "-" + safeOriginalName;
            const newPath = path.join(__dirname, "../assets", newFilename);
            
            if(fs.existsSync(oldPath))
            {
                fs.renameSync(oldPath, newPath);
            }
            
            tenderFilePaths.push(newPath);
        }
    
        response.setHeader("Content-Type",  "text/event-stream");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection",    "keep-alive");
        response.flushHeaders();
    
        const onChunk = (text) =>
        {
            response.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
            response.flush();
        };
    
        const result = await tenderAI.analyzeTenderEnhance(
            tenderFilePaths,
            [profilePath],
            [documentsPath],
            3,
            onChunk,
            language
        );
    
        if(result.status !== "success" || !result.data)
        {
            response.write(`data: ${JSON.stringify({ type: "error", error: "Enhance analysis returned no data" })}\n\n`);
            response.flush();
            return response.end();
        }
    
        const enrichedDocuments = await Promise.all(
            (result.data.documents || []).map(async (doc) =>
            {
                if(!doc.documentId)
                {
                    return { ...doc, data: null };
                }
    
                const fetched = await tenderDB.getTenderDocumentById(doc.documentId);
                return { ...doc, data: fetched.success ? {...fetched.data, generated: false} : null };
            })
        );
    
        const composedResults = await builder.createComposedDocuments(result.data.composedDocuments || [], index);
        console.log(composedResults);
        
        const composedAsDocuments = composedResults.map((r) => ({
            documentTitle: r.title,
            description:   r.description,
            stage:         r.stage || "bid",
            mandatory:     true,
            inInventory:   true,
            data: r.success
                ? {
                    id:          null,
                    companyName:  null,
                    documentName: r.title,
                    purpose:      r.description,
                    fileType:     "pdf",
                    path:         r.serverPath,
                    isActive:     true,
                    uploadedAt:   new Date().toISOString(),
                    generated:    true
                }
                : null,
            error: r.success ? undefined : r.error
        }));
    
        const enrichedData =
        {
            ...result.data,
            documents: [...enrichedDocuments, ...composedAsDocuments]
        };
    
        response.write(`data: ${JSON.stringify({ type: "done", data: enrichedData })}\n\n`);
        response.flush();
        response.end();
    }
    catch(err)
    {
        console.error("❌ Enhance analysis error:", err.message);
        response.write(`data: ${JSON.stringify({ type: "error", error: "Failed to run enhance analysis" })}\n\n`);
        response.flush();
        response.end();
    }
    finally
    {
        if(tenderFilePaths.length)
        {
            tenderFilePaths.forEach(p => 
            {
                if(fs.existsSync(p))
                {
                    fs.unlink(p, () => {});
                }
            });
        }
    }
});

router.post('/search-work-experiences', async (request, response) => {
    try
    {
        const { experienceSearchQuery, page = 1 } = request.body;

        if(!experienceSearchQuery)
        {
            return response.status(400).json({ error: 'experienceSearchQuery is required', statusCode: 400 });
        }

        const limit  = 10;
        const offset = (page - 1) * limit;

        const embedding = await embedder.getEmbedding(experienceSearchQuery);

        if(!embedding)
        {
            return response.status(500).json({ error: 'Failed to generate embedding', statusCode: 500 });
        }

        const results = await tenderDB.searchWorkExperiences(embedding, limit, offset);

        return response.status(200).json({ ...results, statusCode: 200 });
    }
    catch(err)
    {
        console.error("❌ Search work experiences error:", err.message);
        return response.status(500).json({ error: 'Failed to search work experiences', statusCode: 500 });
    }
});

router.get('/fetch-tender-rules', async (request, response) => {
    try
    {
        const data = fs.readFileSync(path.resolve(__dirname, "../tenderFiles/rules.json"), "utf-8");
        return response.status(200).json({ statusCode: 200, rules: JSON.parse(data) });
    }
    catch (err)
    {
        return response.status(500).json({ error: "Failed to fetch tender rules", statusCode: 500 });
    }
});

router.put('/update-tender-rules', async (request, response) => {
    const allowedRules = request.body.allowedRules;

    if(!allowedRules || !Array.isArray(allowedRules))
    {
        return response.status(400).json({ error: "allowedRules must be an array", statusCode: 400 });
    }

    try
    {
        const filePath = path.resolve(__dirname, "../tenderFiles/rules.json");
        const rules = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        rules.allowedRules = allowedRules;

        fs.writeFileSync(filePath, JSON.stringify(rules, null, 2), "utf-8");
        return response.status(200).json({ statusCode: 200, message: "Tender rules updated successfully", allowedRules: rules.allowedRules });
    }
    catch(err)
    {
        return response.status(500).json({ error: "Failed to update tender rules", statusCode: 500 });
    }
});

router.get("/companies", (request, response) =>
{
    const companies = VALID_INDEXES.map(index =>
    {
        try
        {
            const data = readCompany(index);
            const allProjects = data.projects?.all || [];
    
            return {
                index,
                companyName: data.company?.name                         || "—",
                tenderReadiness: data.company?.tenderReadiness              || "—",
                isMSME: data.company?.isMSME                       ?? false,
                totalLicenses: data.licenseStats?.total                   ?? 0,
                validLicenses: data.licenseStats?.valid                   ?? 0,
                annualTurnover: data.financials?.annualTurnover?.fy2024_25 ?? null,
                completedProjects: allProjects.filter(p => p.status === "completed").length,
                ongoingProjects: allProjects.filter(p => p.status === "ongoing").length,
                totalProjects: allProjects.length,
            };
        }
        catch(error)
        {
            return { 
                index, 
                error: error.message 
            };
        }
    });
    
    response.json({ companies });
});
    
router.get("/companies/:index", (request, response) =>
{
    const index = validateIndex(request, response);
    if(!index)
    {
        return;
    }
    
    try
    {
        response.json(readCompany(index));
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/company", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        response.json(readCompany(index).company || {});
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.put("/companies/:index/company", (request, response) =>
{
    const index = validateIndex(request, response);

    if (!index)
    {
        return;
    }
    
    try
    {
        const data   = readCompany(index);
        data.company = { ...data.company, ...request.body };
        writeCompany(index, data);
        response.json(data.company);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/financials", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        response.json(readCompany(index).financials || {});
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.put("/companies/:index/financials", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
        const companyName = COMPANY_NAMES[index];
        data.financials = { 
            ...data.financials, 
            ...request.body 
        };
    
        const dbPayload = {
            companyName,
            turnoverFy2024_25: data.financials.annualTurnover?.fy2024_25           ?? null,
            turnoverFy2023_24: data.financials.annualTurnover?.fy2023_24           ?? null,
            turnoverFy2022_23: data.financials.annualTurnover?.fy2022_23           ?? null,
            avgTurnover3yr: data.financials.averageTurnover3Yr?.value           ?? null,
            netWorthFy2024_25: data.financials.netWorth?.fy2024_25                 ?? null,
            netWorthFy2023_24: data.financials.netWorth?.fy2023_24                 ?? null,
            netWorthFy2022_23: data.financials.netWorth?.fy2022_23                 ?? null,
            bankSolvencyValueLakhs: data.financials.bankSolvency?.valueLakhs            ?? null,
            bankSolvencyIssuingBank: data.financials.bankSolvency?.issuingBank           ?? null,
            workingCapital: data.financials.workingCapital                      ?? null,
            maxManpowerDeployed: data.financials.maxManpowerDeployed                 ?? null,
            largestSingleWorkOrderValue: data.financials.largestSingleWorkOrderValue         ?? null,
            ongoingCommitmentsLakhs: data.financials.ongoingCommitmentsLakhs             ?? null,
        };
    
        const existingDbId = data.financials.db_id ?? null;
    
        if(existingDbId)
        {
            await tenderDB.updateFinancials(existingDbId, dbPayload);
        }
        else
        {
            const dbResult = await tenderDB.insertFinancials(dbPayload);
    
            if(dbResult.success)
            {
                data.financials.db_id = dbResult.data.id;
            }
        }
    
        writeCompany(index, data);
        response.json(data.financials);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/licenses", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
    
        response.json({
            licenses: data.licenses || [],
            licenseStats: data.licenseStats || {},
        });
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.post("/companies/:index/licenses", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    if(!request.body?.licenseType)
    {
        return response.status(400).json({ error: "licenseType is required." });
    }
    
    try
    {
        const data = readCompany(index);
        const companyName = COMPANY_NAMES[index];
        data.licenses = data.licenses || [];
    
        const newLicense = {
            sno: data.licenses.length + 1,
            licenseType: request.body.licenseType,
            licenseNo: request.body.licenseNo || null,
            issuingAuthority: request.body.issuingAuthority || null,
            validFrom: request.body.validFrom || null,
            validTill: request.body.validTill || null,
            applicableFor: request.body.applicableFor || null,
            geographicScope: request.body.geographicScope || "Valid for all over India",
            status: request.body.status || "valid",
        };
    
        const dbResult = await tenderDB.insertLicense({ ...newLicense, companyName });
    
        if(dbResult.success)
        {
            newLicense.db_id = dbResult.data.id;
        }
    
        data.licenses.push(newLicense);
        rebuildLicenseStats(data);
        writeCompany(index, data);
        response.status(201).json(newLicense);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.put("/companies/:index/licenses/:dbId", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    const dbId = parseInt(request.params.dbId);
    
    try
    {
        const data = readCompany(index);
        const companyName = COMPANY_NAMES[index];
        const licenseIndex = (data.licenses || []).findIndex(l => l.db_id === dbId);
    
        if(licenseIndex === -1)
        {
            return response.status(404).json({ error: "License not found." });
        }
    
        data.licenses[licenseIndex] = { ...data.licenses[licenseIndex], ...request.body };
    
        await tenderDB.updateLicense(dbId, {
            companyName,
            licenseType: data.licenses[licenseIndex].licenseType,
            licenseNo: data.licenses[licenseIndex].licenseNo,
            issuingAuthority: data.licenses[licenseIndex].issuingAuthority,
            validFrom: data.licenses[licenseIndex].validFrom,
            validTill: data.licenses[licenseIndex].validTill,
            applicableFor: data.licenses[licenseIndex].applicableFor,
            geographicScope: data.licenses[licenseIndex].geographicScope,
            status: data.licenses[licenseIndex].status,
        });
    
        rebuildLicenseStats(data);
        writeCompany(index, data);
        response.json(data.licenses[licenseIndex]);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.delete("/companies/:index/licenses/:dbId", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    const dbId = parseInt(request.params.dbId);
    
    try
    {
        const data = readCompany(index);
        const licenseIndex = (data.licenses || []).findIndex(l => l.db_id === dbId);
    
        if(licenseIndex === -1)
        {
            return response.status(404).json({ error: "License not found." });
        }
    
        const removed = data.licenses.splice(licenseIndex, 1)[0];
    
        await tenderDB.deleteLicense(dbId);
    
        rebuildLicenseStats(data);
        writeCompany(index, data);
        response.json({ removed });
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/projects", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
        const allProjects = data.projects?.all || [];
        const { status } = request.query;
        const filtered = status ? allProjects.filter(p => p.status === status) : allProjects;
    
        response.json({
            projects: filtered,
            stats: data.projects?.stats || {},
        });
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.post("/companies/:index/projects", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    if(!request.body?.clientName)
    {
        return response.status(400).json({ error: "clientName is required." });
    }
    
    try
    {
        const data = readCompany(index);
        const companyName = COMPANY_NAMES[index];
        data.projects = data.projects || { all: [], stats: {} };
        data.projects.all = data.projects.all || [];
    
        const newProject = {
            clientName: request.body.clientName,
            clientType: request.body.clientType || "Government",
            workDescription: request.body.workDescription || "",
            location: request.body.location || "",
            orderNo: request.body.orderNo || null,
            contractValueINR: request.body.contractValueINR ?? null,
            manpower: request.body.manpower ?? null,
            workStart: request.body.workStart || null,
            workEnd: request.body.workEnd || null,
            status: request.body.status || "completed",
            hasCompletionCertificate: request.body.hasCompletionCertificate ?? null,
            hasExperienceCertificate: request.body.hasExperienceCertificate ?? null,
        };
    
        const textToEmbed = [
            newProject.clientName,
            newProject.clientType,
            newProject.workDescription,
            newProject.location,
            newProject.orderNo,
            newProject.contractValueINR != null ? `Contract Value: ${newProject.contractValueINR}` : null,
            newProject.manpower != null ? `Manpower: ${newProject.manpower}` : null,
            newProject.workStart ? `Start: ${newProject.workStart}` : null,
            newProject.workEnd ? `End: ${newProject.workEnd}` : null,
            newProject.status,
            newProject.hasCompletionCertificate != null ? `Completion Certificate: ${newProject.hasCompletionCertificate}` : null,
            newProject.hasExperienceCertificate != null ? `Experience Certificate: ${newProject.hasExperienceCertificate}` : null,
        ].filter(Boolean).join(" | ");
    
        const embedding = await embedder.getEmbedding(textToEmbed);
        const dbResult = await tenderDB.insertWorkExperience({ ...newProject, companyName }, embedding);
    
        if(dbResult.success)
        {
            newProject.id = dbResult.data.id;
        }
    
        data.projects.all.push(newProject);
        rebuildProjectStats(data);
    
        const jsonStr = JSON.stringify(data, null, 2);
        const jsonPath = path.resolve(__dirname, COMPANY_FILES[index]);
        const txtPath = path.resolve(__dirname, COMPANY_TXT_FILES[index]);
        fs.writeFileSync(jsonPath, jsonStr, "utf-8");
        fs.writeFileSync(txtPath,  jsonStr, "utf-8");
    
        response.status(201).json(newProject);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.put("/companies/:index/projects/:projectId", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    const projectId = parseInt(request.params.projectId);
    
    try
    {
        const data = readCompany(index);
        const companyName = COMPANY_NAMES[index];
        const projectIndex = (data.projects?.all || []).findIndex(p => p.id === projectId);
        console.log(`🔍 Updating project ID ${projectId} for company index ${index} (found at projectIndex ${projectIndex})`);
    
        if(projectIndex === -1)
        {
            console.warn(`❌ Project with ID ${projectId} not found for company index ${index}`);
            return response.status(404).json({ error: "Project not found." });
        }
    
        const existing = data.projects.all[projectIndex];
        const updated = { ...existing, ...request.body };
    
        const textToEmbed = [
            updated.clientName,
            updated.clientType,
            updated.workDescription,
            updated.location,
            updated.orderNo,
            updated.contractValueINR != null ? `Contract Value: ${updated.contractValueINR}` : null,
            updated.manpower != null ? `Manpower: ${updated.manpower}` : null,
            updated.workStart ? `Start: ${updated.workStart}` : null,
            updated.workEnd ? `End: ${updated.workEnd}` : null,
            updated.status,
            updated.hasCompletionCertificate != null ? `Completion Certificate: ${updated.hasCompletionCertificate}` : null,
            updated.hasExperienceCertificate != null ? `Experience Certificate: ${updated.hasExperienceCertificate}` : null,
        ].filter(Boolean).join(" | ");
    
        const embedding = await embedder.getEmbedding(textToEmbed);
    
        await tenderDB.updateWorkExperience(projectId, {
            companyName,
            clientName: updated.clientName,
            clientType: updated.clientType,
            workDescription: updated.workDescription,
            location: updated.location,
            orderNo: updated.orderNo,
            contractValueINR: updated.contractValueINR,
            manpower: updated.manpower,
            workStart: updated.workStart,
            workEnd: updated.workEnd,
            status: updated.status,
            hasCompletionCertificate: updated.hasCompletionCertificate,
            hasExperienceCertificate: updated.hasExperienceCertificate,
        }, embedding);
    
        data.projects.all[projectIndex] = updated;
        rebuildProjectStats(data);
    
        const jsonStr  = JSON.stringify(data, null, 2);
        const jsonPath = path.resolve(__dirname, COMPANY_FILES[index]);
        const txtPath  = path.resolve(__dirname, COMPANY_TXT_FILES[index]);
        fs.writeFileSync(jsonPath, jsonStr, "utf-8");
        fs.writeFileSync(txtPath,  jsonStr, "utf-8");
    
        response.json(updated);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.delete("/companies/:index/projects/:projectId", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    const projectId = parseInt(request.params.projectId);
    
    try
    {
        const data = readCompany(index);
        const projectIndex = (data.projects?.all || []).findIndex(p => p.id === projectId);
    
        if(projectIndex === -1)
        {
            return response.status(404).json({ error: "Project not found." });
        }
    
        const removed = data.projects.all.splice(projectIndex, 1)[0];
    
        await tenderDB.deleteWorkExperience(projectId);
    
        rebuildProjectStats(data);
    
        const jsonStr  = JSON.stringify(data, null, 2);
        const jsonPath = path.resolve(__dirname, COMPANY_FILES[index]);
        const txtPath  = path.resolve(__dirname, COMPANY_TXT_FILES[index]);
        fs.writeFileSync(jsonPath, jsonStr, "utf-8");
        fs.writeFileSync(txtPath,  jsonStr, "utf-8");
    
        response.json({ removed });
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/certifications", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        response.json(readCompany(index).certifications || {});
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.put("/companies/:index/certifications", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
        const companyName = COMPANY_NAMES[index];
        data.certifications = { ...data.certifications, ...request.body };
    
        const incomingIso = data.certifications.iso   || [];
        const incomingPsara = data.certifications.psara || [];
        const fssai = data.certifications.fssai || null;
        const electrical = data.certifications.electricalContractor || null;
    
        for(let i = 0; i < incomingIso.length; i++)
        {
            const iso = incomingIso[i];
            const dbPayload = {
                companyName,
                standard: iso.standard || null,
                scope: iso.scope || null,
                certNo: iso.certNo || null,
                validTill: iso.validTill || null,
            };
    
            if(iso.db_id)
            {
                await tenderDB.updateIsoCert(iso.db_id, dbPayload);
            }
            else
            {
                const dbResult = await tenderDB.insertIsoCert(dbPayload);
    
                if(dbResult.success)
                {
                    incomingIso[i].db_id = dbResult.data.id;
                }
            }
        }
    
        for(let i = 0; i < incomingPsara.length; i++)
        {
            const psara = incomingPsara[i];
            const dbPayload = {
                companyName,
                state: psara.state || null,
                licenseNo: psara.licenseNo || null,
                validTill: psara.validTill || null,
            };
    
            if(psara.db_id)
            {
                await tenderDB.updatePsaraCert(psara.db_id, dbPayload);
            }
            else
            {
                const dbResult = await tenderDB.insertPsaraCert(dbPayload);
    
                if(dbResult.success)
                {
                    incomingPsara[i].db_id = dbResult.data.id;
                }
            }
        }
    
        if(fssai)
        {
            const fssaiPayload = {
                companyName,
                certType: "fssai",
                licenseNo: fssai.licenseNo || null,
                grade: null,
                issuingAuthority: null,
                validTill: fssai.validTill || null,
                scope: fssai.scope || null,
                geographicScope: fssai.geographicScope || null,
            };
    
            if(fssai.db_id)
            {
                await tenderDB.updateSpecialCert(fssai.db_id, fssaiPayload);
            }
            else
            {
                const dbResult = await tenderDB.insertSpecialCert(fssaiPayload);
    
                if(dbResult.success)
                {
                    data.certifications.fssai.db_id = dbResult.data.id;
                }
            }
        }
    
        if(electrical)
        {
            const electricalPayload = {
                companyName,
                certType: "electrical_contractor",
                licenseNo: electrical.licenseNo || null,
                grade: electrical.grade || null,
                issuingAuthority: electrical.issuingAuthority || null,
                validTill: electrical.validTill || null,
                scope: null,
                geographicScope: electrical.geographicScope || null,
            };
    
            if(electrical.db_id)
            {
                await tenderDB.updateSpecialCert(electrical.db_id, electricalPayload);
            }
            else
            {
                const dbResult = await tenderDB.insertSpecialCert(electricalPayload);
    
                if(dbResult.success)
                {
                    data.certifications.electricalContractor.db_id = dbResult.data.id;
                }
            }
        }
    
        data.certifications.iso = incomingIso;
        data.certifications.psara = incomingPsara;
    
        writeCompany(index, data);
        response.json(data.certifications);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/msme", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        response.json(readCompany(index).msmeAdvantages || {});
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.put("/companies/:index/msme", async (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
        const companyName = COMPANY_NAMES[index];
        data.msmeAdvantages = { ...data.msmeAdvantages, ...request.body };
    
        const dbPayload = {
            companyName,
            udyamNo: data.msmeAdvantages.udyamNo || null,
            nsicRegNo: data.msmeAdvantages.nsicRegNo || null,
            exemptions: data.msmeAdvantages.exemptions || [],
        };
    
        const existingDbId = data.msmeAdvantages.db_id ?? null;
    
        if(existingDbId)
        {
            await tenderDB.updateMsme(existingDbId, dbPayload);
        }
        else
        {
            const dbResult = await tenderDB.insertMsme(dbPayload);
    
            if(dbResult.success)
            {
                data.msmeAdvantages.db_id = dbResult.data.id;
            }
        }
    
        writeCompany(index, data);
        response.json(data.msmeAdvantages);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/escalation", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        response.json(readCompany(index).escalationMatrix || {});
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.put("/companies/:index/escalation", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
        data.escalationMatrix = { ...data.escalationMatrix, ...request.body };
        writeCompany(index, data);
        response.json(data.escalationMatrix);
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/tender-info", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
    
        response.json({
            tenderConditions: data.tenderConditions || [],
            recommendedTenderTypes: data.recommendedTenderTypes || [],
        });
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.put("/companies/:index/tender-info", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
    
        if(request.body.tenderConditions)
        {
            data.tenderConditions = request.body.tenderConditions;
        }
    
        if(request.body.recommendedTenderTypes)
        {
            data.recommendedTenderTypes = request.body.recommendedTenderTypes;
        }
    
        writeCompany(index, data);
    
        response.json({
            tenderConditions: data.tenderConditions,
            recommendedTenderTypes: data.recommendedTenderTypes,
        });
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});
    
router.get("/companies/:index/notifications", (request, response) =>
{
    const index = validateIndex(request, response);

    if(!index)
    {
        return;
    }
    
    try
    {
        const data = readCompany(index);
        const notifications = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
    
        const licenses = data.licenses || [];
    
        licenses.forEach((license, idx) =>
        {
            if(!license.validTill || license.validTill === "lifetime")
            {
                return;
            }
    
            const expiryDate = new Date(license.validTill);
            expiryDate.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
    
            if(daysUntilExpiry < 0)
            {
                notifications.push({
                    type: "license_expired",
                    severity: "critical",
                    title: `License Expired: ${license.licenseType}`,
                    message: `${license.licenseType} expired ${Math.abs(daysUntilExpiry)} days ago (${license.validTill})`,
                    reference: { resource: "license", index: idx, name: license.licenseType },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
            else if(daysUntilExpiry === 0)
            {
                notifications.push({
                    type: "license_expires_today",
                    severity: "critical",
                    title: `License Expires Today: ${license.licenseType}`,
                    message: `${license.licenseType} expires today (${license.validTill})`,
                    reference: { resource: "license", index: idx, name: license.licenseType },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
            else if(daysUntilExpiry <= 7)
            {
                notifications.push({
                    type: "license_expiring_soon",
                    severity: "high",
                    title: `License Expiring Soon: ${license.licenseType}`,
                    message: `${license.licenseType} will expire in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? "s" : ""} (${license.validTill})`,
                    reference: { resource: "license", index: idx, name: license.licenseType },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
            else if(daysUntilExpiry <= 30)
            {
                notifications.push({
                    type: "license_expiring_soon",
                    severity: "medium",
                    title: `License Expiration Notice: ${license.licenseType}`,
                    message: `${license.licenseType} will expire in ${daysUntilExpiry} days (${license.validTill})`,
                    reference: { resource: "license", index: idx, name: license.licenseType },
                    timestamp: new Date().toISOString(),
                    actionRequired: false,
                });
            }
        });
    
        const allProjects = data.projects?.all || [];
    
        allProjects.forEach((project, idx) =>
        {
            if(project.status === "ongoing" && project.workEnd)
            {
                const endDate = new Date(project.workEnd);
                endDate.setHours(0, 0, 0, 0);
                const daysUntilEnd = Math.floor((endDate - today) / (1000 * 60 * 60 * 24));
    
                if(daysUntilEnd < 0)
                {
                    notifications.push({
                        type: "project_overdue",
                        severity: "high",
                        title: `Ongoing Project Overdue: ${project.clientName}`,
                        message: `Project for ${project.clientName} was due to complete ${Math.abs(daysUntilEnd)} days ago (${project.workEnd})`,
                        reference: { resource: "project", index: idx, name: project.clientName },
                        timestamp: new Date().toISOString(),
                        actionRequired: true,
                    });
                }
                else if(daysUntilEnd === 0)
                {
                    notifications.push({
                        type: "project_ending_today",
                        severity: "high",
                        title: `Project Completion Due: ${project.clientName}`,
                        message: `Project for ${project.clientName} is due to complete today (${project.workEnd})`,
                        reference: { resource: "project", index: idx, name: project.clientName },
                        timestamp: new Date().toISOString(),
                        actionRequired: true,
                    });
                }
                else if(daysUntilEnd <= 7)
                {
                    notifications.push({
                        type: "project_ending_soon",
                        severity: "medium",
                        title: `Project Completion Approaching: ${project.clientName}`,
                        message: `Project for ${project.clientName} is due in ${daysUntilEnd} day${daysUntilEnd > 1 ? "s" : ""} (${project.workEnd})`,
                        reference: { resource: "project", index: idx, name: project.clientName },
                        timestamp: new Date().toISOString(),
                        actionRequired: false,
                    });
                }
            }
    
            if(project.status === "completed" && project.hasCompletionCertificate !== true)
            {
                notifications.push({
                    type: "project_missing_certificate",
                    severity: "medium",
                    title: `Missing Completion Certificate: ${project.clientName}`,
                    message: `Project for ${project.clientName} is marked complete but lacks a completion certificate`,
                    reference: { resource: "project", index: idx, name: project.clientName },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
        });
    
        const certs = data.certifications || {};
    
        (certs.iso || []).forEach((iso, idx) =>
        {
            if(!iso.validTill)
            {
                return;
            }
    
            const expiryDate = new Date(iso.validTill);
            expiryDate.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
    
            if(daysUntilExpiry < 0)
            {
                notifications.push({
                    type: "iso_expired",
                    severity: "high",
                    title: `ISO Certification Expired: ${iso.standard}`,
                    message: `${iso.standard} certification expired ${Math.abs(daysUntilExpiry)} days ago (${iso.validTill})`,
                    reference: { resource: "iso_certification", index: idx, name: iso.standard },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
            else if(daysUntilExpiry <= 90)
            {
                notifications.push({
                    type: "iso_expiring_soon",
                    severity: daysUntilExpiry <= 30 ? "high" : "medium",
                    title: `ISO Certification Renewal Due: ${iso.standard}`,
                    message: `${iso.standard} certification will expire in ${daysUntilExpiry} days (${iso.validTill})`,
                    reference: { resource: "iso_certification", index: idx, name: iso.standard },
                    timestamp: new Date().toISOString(),
                    actionRequired: daysUntilExpiry <= 30,
                });
            }
        });
    
        (certs.psara || []).forEach((psara, idx) =>
        {
            if(!psara.validTill)
            {
                return;
            }
    
            const expiryDate = new Date(psara.validTill);
            expiryDate.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
    
            if(daysUntilExpiry < 0)
            {
                notifications.push({
                    type: "psara_expired",
                    severity: "critical",
                    title: `PSARA License Expired: ${psara.state}`,
                    message: `PSARA license for ${psara.state} expired ${Math.abs(daysUntilExpiry)} days ago (${psara.validTill})`,
                    reference: { resource: "psara_license", index: idx, name: psara.state },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
            else if(daysUntilExpiry <= 60)
            {
                notifications.push({
                    type: "psara_expiring_soon",
                    severity: daysUntilExpiry <= 30 ? "critical" : "high",
                    title: `PSARA License Renewal Required: ${psara.state}`,
                    message: `PSARA license for ${psara.state} will expire in ${daysUntilExpiry} days (${psara.validTill})`,
                    reference: { resource: "psara_license", index: idx, name: psara.state },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
        });
    
        if(certs.fssai?.validTill)
        {
            const expiryDate = new Date(certs.fssai.validTill);
            expiryDate.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
    
            if(daysUntilExpiry < 0)
            {
                notifications.push({
                    type: "fssai_expired",
                    severity: "high",
                    title: "FSSAI License Expired",
                    message: `FSSAI license expired ${Math.abs(daysUntilExpiry)} days ago (${certs.fssai.validTill})`,
                    reference: { resource: "fssai_license", name: "FSSAI" },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
            else if(daysUntilExpiry <= 60)
            {
                notifications.push({
                    type: "fssai_expiring_soon",
                    severity: daysUntilExpiry <= 30 ? "high" : "medium",
                    title: "FSSAI License Renewal Required",
                    message: `FSSAI license will expire in ${daysUntilExpiry} days (${certs.fssai.validTill})`,
                    reference: { resource: "fssai_license", name: "FSSAI" },
                    timestamp: new Date().toISOString(),
                    actionRequired: daysUntilExpiry <= 30,
                });
            }
        }
    
        if(certs.electricalContractor?.validTill)
        {
            const expiryDate = new Date(certs.electricalContractor.validTill);
            expiryDate.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
    
            if(daysUntilExpiry < 0)
            {
                notifications.push({
                    type: "electrical_license_expired",
                    severity: "high",
                    title: `Electrical Contractor License Expired (Grade ${certs.electricalContractor.grade})`,
                    message: `Electrical contractor license expired ${Math.abs(daysUntilExpiry)} days ago (${certs.electricalContractor.validTill})`,
                    reference: { resource: "electrical_license", name: `Grade ${certs.electricalContractor.grade}` },
                    timestamp: new Date().toISOString(),
                    actionRequired: true,
                });
            }
            else if(daysUntilExpiry <= 90)
            {
                notifications.push({
                    type: "electrical_license_expiring_soon",
                    severity: daysUntilExpiry <= 30 ? "high" : "medium",
                    title: "Electrical Contractor License Renewal Required",
                    message: `Electrical contractor license will expire in ${daysUntilExpiry} days (${certs.electricalContractor.validTill})`,
                    reference: { resource: "electrical_license", name: `Grade ${certs.electricalContractor.grade}` },
                    timestamp: new Date().toISOString(),
                    actionRequired: daysUntilExpiry <= 30,
                });
            }
        }
    
        const company = data.company || {};
        const missingFields = [];
        const requiredFields = ["name", "CIN", "PAN", "GSTIN", "director", "headquarter"];
    
        requiredFields.forEach(field =>
        {
            if(!company[field])
            {
                missingFields.push(field);
            }      
        });
    
        if(missingFields.length > 0)
        {
            notifications.push({
                type: "profile_incomplete",
                severity: "low",
                title: "Company Profile Incomplete",
                message: `Missing ${missingFields.length} required field${missingFields.length > 1 ? "s" : ""}: ${missingFields.join(", ")}`,
                reference: { resource: "company_profile", fields: missingFields },
                timestamp: new Date().toISOString(),
                actionRequired: false,
            });
        }
    
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    
        notifications.sort((a, b) =>
        {
            const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];

            if(severityDiff !== 0)
            {
                return severityDiff;
            } 

            return new Date(b.timestamp) - new Date(a.timestamp);
        });
    
        response.json({
            total: notifications.length,
            critical: notifications.filter(n => n.severity === "critical").length,
            high: notifications.filter(n => n.severity === "high").length,
            medium: notifications.filter(n => n.severity === "medium").length,
            low: notifications.filter(n => n.severity === "low").length,
            notifications,
        });
    }
    catch(error)
    {
        response.status(500).json({ error: error.message });
    }
});

router.get("/common-requirements", (request, response) =>
{
    try
    {
        const filePath = path.resolve(__dirname, "../tenderFiles/commonRequirements.json");
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

        response.json({ 
            statusCode: 200, 
            message: "Common requirements fetched", 
            data 
        });
    }
    catch(error)
    {
        response.status(500).json({ 
            statusCode: 500, 
            message: error.message 
        });
    }
});
    
router.post("/common-requirements", (request, response) =>
{
    if(!request.body?.requirement)
    {
        return response.status(400).json({ 
            statusCode: 400, 
            message: "requirement field is required" 
        });
    }
    
    try
    {
        const filePath = path.resolve(__dirname, "../tenderFiles/commonRequirements.json");
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    
        const newEntry = {
            requirement: request.body.requirement,
            canBeProvided: request.body.canBeProvided ?? false
        };
    
        data.push(newEntry);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    
        response.status(201).json({ 
            statusCode: 201, 
            message: "Requirement added", 
            data: newEntry 
        });
    }
    catch(error)
    {
        response.status(500).json({ 
            statusCode: 500, 
            message: error.message 
        });
    }
});
    
router.put("/common-requirements/:index", (request, response) =>
{
    const idx = parseInt(request.params.index);
    
    try
    {
        const filePath = path.resolve(__dirname, "../tenderFiles/commonRequirements.json");
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    
        if(isNaN(idx) || idx < 0 || idx >= data.length)
        {
            return response.status(404).json({ statusCode: 404, message: "Requirement not found" });
        }
    
        if(request.body.requirement !== undefined)
        {
            data[idx].requirement = request.body.requirement;
        }
    
        if(request.body.canBeProvided !== undefined)
        {
            data[idx].canBeProvided = request.body.canBeProvided;
        }
    
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    
        response.json({ 
            statusCode: 200, 
            message: "Requirement updated", 
            data: data[idx] 
        });
    }
    catch(error)
    {
        response.status(500).json({ 
            statusCode: 500, 
            message: error.message 
        });
    }
});
    
router.delete("/common-requirements/:index", (request, response) =>
{
    const idx = parseInt(request.params.index);
    
    try
    {
        const filePath = path.resolve(__dirname, "../tenderFiles/commonRequirements.json");
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    
        if(isNaN(idx) || idx < 0 || idx >= data.length)
        {
            return response.status(404).json({ statusCode: 404, message: "Requirement not found" });
        }
    
        const removed = data.splice(idx, 1)[0];
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    
        response.json({ 
            statusCode: 200, 
            message: "Requirement deleted", 
            data: removed 
        });
    }
    catch(error)
    {
        response.status(500).json({ 
            statusCode: 500, 
            message: error.message 
        });
    }
});

router.post("/companies/:index/documents", upload.single("file"), async (request, response) =>
{
    const index = parseInt(request.params.index);
    
    if(![1, 2, 3].includes(index))
    {
        return response.status(400).json({ 
            statusCode: 400, 
            error: "Invalid company index. Must be 1, 2, or 3." 
        });
    }
    
    if(!request.file)
    {
        return response.status(400).json({ 
            statusCode: 400, 
            error: "No file uploaded." 
        });
    }
    
    if(!request.body?.documentName)
    {
        fs.unlink(path.join(__dirname, "../assets", request.file.filename), () => {});
        return response.status(400).json({ 
            statusCode: 400, 
            error: "documentName is required." 
        });
    }
    
    try
    {
        const companyName = COMPANY_NAMES[index];
        const originalExt = path.extname(request.file.originalname).toLowerCase();
        const savedFileName = request.file.filename;
        const finalFileName = savedFileName + originalExt;
        const sourcePath = path.join(__dirname, "../assets", savedFileName);
        const destPath = path.join(__dirname, "../assets/tenderDocuments", finalFileName);
    
        fs.renameSync(sourcePath, destPath);
    
        const serverPath = `/assets/tenderDocuments/${finalFileName}`;
        const extractedText = await extractor.extractText(destPath) || "";
    
        const textToEmbed = [request.body.documentName, request.body.purpose || "", extractedText.slice(0, 1000),].filter(Boolean).join(" | ");
        const embedding = await embedder.getEmbedding(textToEmbed);
    
        const dbResult = await tenderDB.insertTenderDocument(
            {
                companyName,
                documentName: request.body.documentName,
                purpose: request.body.purpose || null,
                fileType: originalExt.replace(".", ""),
                path: serverPath,
                text: extractedText || null,
            },
            embedding
        );
    
        if(!dbResult.success)
        {
            return response.status(500).json({ 
                statusCode: 500, 
                error: "Failed to save document to database."
            });
        }
    
        const newDoc = {
            id: dbResult.data.id,
            companyName,
            documentName: request.body.documentName,
            purpose: request.body.purpose || null,
            fileType: originalExt.replace(".", ""),
            path: serverPath,
            isActive: true,
            uploadedAt: dbResult.data.uploadedAt,
        };
    
        const jsonFilePath = path.resolve(__dirname, DOCUMENT_COMPANY_FILES[index]);
        const txtFilePath = path.resolve(__dirname, DOCUMENT_COMPANY_TXT_FILES[index]);
    
        let existing = [];
    
        try
        {
            existing = JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));
        }
        catch
        {
            existing = [];
        }
    
        existing.push(newDoc);
    
        const jsonStr = JSON.stringify(existing, null, 2);
        fs.writeFileSync(jsonFilePath, jsonStr, "utf-8");
        fs.writeFileSync(txtFilePath,  jsonStr, "utf-8");
    
        return response.status(201).json({ 
            statusCode: 201, 
            message: "Document uploaded successfully.", 
            data: newDoc 
        });
    }
    catch(error)
    {
        console.error("❌ Error uploading tender document:", error.message);
        return response.status(500).json({ 
            statusCode: 500, 
            error: "Failed to upload document." 
        });
    }
});
    
router.get("/companies/:index/documents", async (request, response) =>
{
    const index = parseInt(request.params.index);
    
    if(![1, 2, 3].includes(index))
    {
        return response.status(400).json({ 
            statusCode: 400, 
            error: "Invalid company index. Must be 1, 2, or 3." 
        });
    }
    
    try
    {
        const companyName = COMPANY_NAMES[index];
        const limit = parseInt(request.query.limit)  || 50;
        const offset = parseInt(request.query.offset) || 0;
    
        const result = await tenderDB.getAllTenderDocuments(companyName, limit, offset);
    
        return response.status(200).json({ 
            statusCode: 200, 
            ...result
        });
    }
    catch(error)
    {
        console.error("❌ Error fetching tender documents:", error.message);
        return response.status(500).json({ 
            statusCode: 500, 
            error: "Failed to fetch documents." 
        });
    }
});
    
router.get("/companies/:index/documents/:docId", async (request, response) =>
{
    const index = parseInt(request.params.index);
    
    if(![1, 2, 3].includes(index))
    {
        return response.status(400).json({ 
            statusCode: 400, 
            error: "Invalid company index. Must be 1, 2, or 3." 
        });
    }
    
    const docId = parseInt(request.params.docId);
    
    try
    {
        const result = await tenderDB.getTenderDocumentById(docId);
    
        if(!result.success)
        {
            return response.status(404).json({ 
                statusCode: 404, 
                error: "Document not found." 
            });
        }
    
        return response.status(200).json({ 
            statusCode: 200, 
            data: result.data 
        });
    }
    catch(error)
    {
        console.error("❌ Error fetching tender document:", error.message);
        return response.status(500).json({ 
            statusCode: 500, 
            error: "Failed to fetch document." 
        });
    }
});
    
router.put("/companies/:index/documents/:docId", async (request, response) =>
{
    const index = parseInt(request.params.index);
    
    if(![1, 2, 3].includes(index))
    {
        return response.status(400).json({
            statusCode: 400, 
            error: "Invalid company index. Must be 1, 2, or 3." 
        });
    }
    
    const docId = parseInt(request.params.docId);
     
    try
    {
        const existing = await tenderDB.getTenderDocumentById(docId);
    
        if(!existing.success)
        {
            return response.status(404).json({ 
                statusCode: 404, 
                error: "Document not found." 
            });
        }
    
        const companyName = COMPANY_NAMES[index];
        const documentName = request.body.documentName !== undefined ? request.body.documentName : existing.data.documentName;
        const purpose = request.body.purpose !== undefined ? request.body.purpose : existing.data.purpose;
        const textToEmbed = [documentName, purpose || "", (existing.data.text || "").slice(0, 1000),].filter(Boolean).join(" | ");
        const embedding = await embedder.getEmbedding(textToEmbed);
    
        const dbResult = await tenderDB.updateTenderDocument(
            docId,
            {
                companyName,
                documentName,
                purpose,
                fileType: existing.data.fileType,
                path: existing.data.path,
                text: existing.data.text,
            },
            embedding
        );
    
        if(!dbResult.success)
        {
            return response.status(500).json({ 
                statusCode: 500, 
                error: "Failed to update document." 
            });
        }
    
        const jsonFilePath = path.resolve(__dirname, DOCUMENT_COMPANY_FILES[index]);
        const txtFilePath = path.resolve(__dirname, DOCUMENT_COMPANY_TXT_FILES[index]);
    
        let docs = [];
    
        try
        {
            docs = JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));
        }
        catch
        {
            docs = [];
        }
    
        const docIndex = docs.findIndex(d => d.id === docId);
    
        if(docIndex !== -1)
        {
            docs[docIndex] = { 
                ...docs[docIndex], 
                documentName, 
                purpose 
            };
        }
    
        const jsonStr = JSON.stringify(docs, null, 2);
        fs.writeFileSync(jsonFilePath, jsonStr, "utf-8");
        fs.writeFileSync(txtFilePath,  jsonStr, "utf-8");
    
        return response.status(200).json({ 
            statusCode: 200, 
            message: "Document updated successfully.", 
            data: dbResult.data 
        });
    }
    catch(error)
    {
        console.error("❌ Error updating tender document:", err.message);
        return response.status(500).json({ 
            statusCode: 500, 
            error: "Failed to update document." 
        });
    }
});
    
router.delete("/companies/:index/documents/:docId", async (request, response) =>
{
    const index = parseInt(request.params.index);
    
    if(![1, 2, 3].includes(index))
    {
        return response.status(400).json({ 
            statusCode: 400, 
            error: "Invalid company index. Must be 1, 2, or 3." 
        });
    }
    
    const docId = parseInt(request.params.docId);
    
    try
    {
        const existing = await tenderDB.getTenderDocumentById(docId);
    
        if(!existing.success)
        {
            return response.status(404).json({ statusCode: 404, error: "Document not found." });
        }
    
        const filePath = path.join(__dirname, "..", existing.data.path);
    
        fs.unlink(filePath, (unlinkErr) =>
        {
            if(unlinkErr)
            {
                console.warn(`⚠️ Could not delete file: ${filePath}`);
            }
        });
    
        const dbResult = await tenderDB.deleteTenderDocument(docId);
    
        if(!dbResult.success)
        {
            return response.status(500).json({ statusCode: 500, error: "Failed to delete document from database." });
        }
    
        const jsonFilePath = path.resolve(__dirname, DOCUMENT_COMPANY_FILES[index]);
        const txtFilePath = path.resolve(__dirname, DOCUMENT_COMPANY_TXT_FILES[index]);
    
        let docs = [];
    
        try
        {
            docs = JSON.parse(fs.readFileSync(jsonFilePath, "utf-8"));
        }
        catch
        {
            docs = [];
        }
    
        docs = docs.filter(d => d.id !== docId);
    
        const jsonStr = JSON.stringify(docs, null, 2);
        fs.writeFileSync(jsonFilePath, jsonStr, "utf-8");
        fs.writeFileSync(txtFilePath,  jsonStr, "utf-8");
    
        return response.status(200).json({ 
            statusCode: 200, 
            message: "Document deleted successfully." 
        });
    }
    catch(error)
    {
        console.error("❌ Error deleting tender document:", error.message);
        return response.status(500).json({ 
            statusCode: 500, 
            error: "Failed to delete document." 
        });
    }
});
    
router.post("/companies/:index/documents/search", async (request, response) =>
{
    const index = parseInt(request.params.index);
    
    if(![1, 2, 3].includes(index))
    {
        return response.status(400).json({ 
            statusCode: 400, 
            error: "Invalid company index. Must be 1, 2, or 3." 
        });
    }
    
    if(!request.body?.query)
    {
        return response.status(400).json({ 
            statusCode: 400, 
            error: "query is required." 
        });
    }
    
    try
    {
        const companyName = COMPANY_NAMES[index];
        const limit = parseInt(request.body.limit)  || 10;
        const offset = parseInt(request.body.offset) || 0;
    
        const embedding = await embedder.getEmbedding(request.body.query);
    
        if(!embedding)
        {
            return response.status(500).json({ 
                statusCode: 500, 
                error: "Failed to generate embedding." 
            });
        }
    
        const result = await tenderDB.searchTenderDocuments(embedding, companyName, limit, offset);
        return response.status(200).json({ 
            statusCode: 200, 
            ...result 
        });
    }
    catch(error)
    {
        console.error("❌ Error searching tender documents:", error.message);
        return response.status(500).json({ 
            statusCode: 500, 
            error: "Failed to search documents." 
        });
    }
});

router.post("/download-zip", async (request, response) =>
{
    const name = request.body.name;
    const paths = request.body.paths;
    
    if(!name || typeof name !== "string" || name.trim() === "")
    {
        return response.status(400).json({
            statusCode: 400,
            error: "`name` is required and must be a non-empty string."
        });
    }
    
    if(!paths || !Array.isArray(paths) || paths.length === 0)
    {
        return response.status(400).json({
            statusCode: 400,
            error: "`paths` is required and must be a non-empty array."
        });
    }
    
    try
    {
        const validPaths = [];
        const missingPaths = [];
        const usedNames = new Set();
    
        for(const entry of paths)
        {
            const filePath = typeof entry === "object" ? entry.path : entry;
            const customName = typeof entry === "object" ? entry.name : null;
            const absolutePath = path.join(process.cwd(), filePath);
    
            console.log("📂 Resolved path:", absolutePath);
            console.log("📂 Exists:", fs.existsSync(absolutePath));
    
            if(fs.existsSync(absolutePath))
            {
                const rawBasename = path.basename(absolutePath);
                const fileExt = path.extname(rawBasename);
                const cleanedBase = rawBasename.replace(/^\d{13}-/, "");
    
                let finalName;
    
                if(customName && customName.trim())
                {
                    let targetName = customName.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-_.\u0900-\u097F]/g, "");
                    
                    if(!targetName.toLowerCase().endsWith(fileExt.toLowerCase()))
                    {
                        targetName += fileExt;
                    }
                    
                    finalName = targetName;
                }
                else
                {
                    finalName = cleanedBase.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-_.\u0900-\u097F]/g, "");
                    
                    if(!finalName.toLowerCase().endsWith(fileExt.toLowerCase()))
                    {
                        finalName += fileExt;
                    }
                }
    
                const nameWithoutExt = path.basename(finalName, fileExt);
                let counter = 1;
                
                while(usedNames.has(finalName))
                {
                    finalName = nameWithoutExt + "_" + counter + fileExt;
                    counter++;
                }
    
                usedNames.add(finalName);
                validPaths.push({ absolute: absolutePath, name: finalName });
            }
            else
            {
                missingPaths.push(filePath);
            }
        }
    
        if(validPaths.length === 0)
        {
            return response.status(404).json({
                statusCode: 404,
                error: "None of the provided paths exist on the server.",
                missing: missingPaths
            });
        }
    
        const safeFileName = name.trim().replace(/[^a-zA-Z0-9_\-. ]/g, "_");
    
        response.setHeader("Content-Type", "application/zip");
        response.setHeader("Content-Disposition", `attachment; filename="${safeFileName}.zip"`);
    
        if(missingPaths.length > 0)
        {
            response.setHeader("X-Skipped-Files", JSON.stringify(missingPaths));
        }
    
        const archive = archiver("zip", { store: true });
    
        archive.on("error", (err) =>
        {
            console.error("❌ Error creating zip archive:", err.message);
            response.destroy();
        });
    
        archive.on("finish", () =>
        {
            console.log(`✅ "${safeFileName}.zip" sent — ${archive.pointer()} bytes, ${validPaths.length} file(s)`);
        });

        response.setHeader("Content-Type", "application/zip");
        response.setHeader("Content-Disposition", `attachment; filename="${safeFileName}.zip"`);
        response.setHeader("Transfer-Encoding", "chunked");
        response.setHeader("X-Accel-Buffering", "no");
    
        archive.pipe(response);
    
        for(const file of validPaths)
        {
            archive.file(file.absolute, { name: file.name });
        }
    
        archive.finalize();
    }
    catch(error)
    {
        console.error("❌ Error processing download-zip request:", error.message);
        return response.status(500).json({
            statusCode: 500,
            error: "Failed to generate zip."
        });
    }
});

router.get("/tender-details", async (request, response) =>
{
    try
    {
        const { url } = request.query;

        if (!url || !url.includes("tenderdetail.com/Indian-Tenders/TenderNotice/"))
        {
            return response.status(400).json({
                statusCode: 400,
                success : false,
                message : "A valid tenderdetail.com TenderNotice URL is required.",
                data : null
            });
        }

        const details = await tenderScraper.extractTenderDetails(url);

        if (!details.success)
        {
            return response.status(422).json({
                statusCode: 422,
                success : false,
                message : `Failed to extract tender details: ${details.error}`,
                data : null
            });
        }

        return response.status(200).json({
            statusCode: 200,
            success : true,
            message : "Tender details extracted successfully.",
            data : details
        });
    }
    catch (error)
    {
        console.error("❌ Error in Tender Details: ", error);

        return response.status(500).json({
            statusCode: 500,
            success : false,
            message : "Internal Server Error.",
            data : null
        });
    }
});

router.get("/tender-sync-save", async (request, response) =>
{
    try
    {
        let days = parseInt(request.query.days) || 1;
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);
        fromDate.setHours(0, 0, 0, 0);
 
        const emails = await tenderExtractor.extractTenderEmails(fromDate);
 
        if (!emails || emails.length === 0)
        {
            return response.status(404).json({
                statusCode: 404,
                success: false,
                message: "No tender emails found for yesterday.",
                data: null,
            });
        }
 
        const flat = [];
 
        for(const group of emails)
        {
            for(const tender of (group.tenders || []))
            {
                flat.push({ ...tender, category: group.category });
            }
        }
 
        const results = await tenderDB.insertTenders(flat);
 
        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: `Sync complete. ${results.saved} saved, ${results.failed} failed out of ${flat.length} fetched.`,
            data: { total: flat.length, ...results },
        });
    }
    catch (error)
    {
        console.error("❌ Error in tender sync save:", error);
 
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Internal Server Error.",
            data: null,
        });
    }
});

/*
router.post("/tenders/fetch", async (request, response) =>
{
    try
    {
        const filters = request.body.filters || {};
        const pageNo = request.body.pageNo || null;
        const limit = request.body.limit || null;

        const result = await tenderDB.fetchTenders(filters, pageNo, limit);

        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: "Tenders fetched successfully.",
            data: result.data,
            pagination: result.pagination || null,
            totalCount: result.totalCount,
        });
    }
    catch (error)
    {
        console.error("❌ Error fetching tenders:", error.message);
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to fetch tenders.",
            data: null,
        });
    }
});
 
router.post("/tenders", async (request, response) =>
{
    if (!request.body || !Array.isArray(request.body))
    {
        return response.status(400).json({
            statusCode: 400,
            success: false,
            message: "Request body must be an array of tender objects.",
            data: null,
        });
    }
 
    try
    {
        const results = await tenderDB.insertTenders(request.body);
 
        return response.status(201).json({
            statusCode: 201,
            success: true,
            message: `Insert complete. ${results.saved} saved, ${results.failed} failed.`,
            data: results,
        });
    }
    catch (error)
    {
        console.error("❌ Error inserting tenders:", error.message);
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to insert tenders.",
            data: null,
        });
    }
});
 
router.put("/tenders", async (request, response) =>
{
    if (!request.body || typeof request.body !== "object")
    {
        return response.status(400).json({
            statusCode: 400,
            success: false,
            message: "Request body must contain 'filters' and 'data' objects.",
            data: null,
        });
    }
 
    try
    {
        const filters = request.body.filters || {};
        const data = request.body.data || {};
 
        if (Object.keys(data).length === 0)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: "No fields to update provided.",
                data: null,
            });
        }
 
        const result = await tenderDB.updateTenders(filters, data);
 
        if (!result.success)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: result.error || "Update failed.",
                data: null,
            });
        }
 
        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: `${result.updated} tender(s) updated successfully.`,
            data: {
                updated: result.updated,
                tenders: result.data,
            },
        });
    }
    catch (error)
    {
        console.error("❌ Error updating tenders:", error.message);
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to update tenders.",
            data: null,
        });
    }
});
 
router.post("/tenders/remove", async (request, response) =>
{
    if (!request.body || typeof request.body !== "object" || Object.keys(request.body).length === 0)
    {
        return response.status(400).json({
            statusCode: 400,
            success: false,
            message: "Request body must contain at least one filter.",
            data: null,
        });
    }
 
    try
    {
        const filters = request.body;
        const result = await tenderDB.deleteTenders(filters);
 
        if (!result.success)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: result.error || "Delete failed.",
                data: null,
            });
        }
 
        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: `${result.deleted} tender(s) deleted successfully.`,
            data: {
                deleted: result.deleted,
            },
        });
    }
    catch (error)
    {
        console.error("❌ Error deleting tenders:", error.message);
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to delete tenders.",
            data: null,
        });
    }
});

router.post("/tenders/metadata", async (request, response) =>
{
    try
    {
        const filters = request.body.filters || {};

        const result = await tenderDB.fetchTenderMetadata(filters);

        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: "Tender metadata fetched successfully.",
            data: result
        });
    }
    catch (error)
    {
        console.error("❌ Error fetching metadata:", error.message);

        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to fetch metadata.",
            data: null
        });
    }
});
*/

router.post("/tenders/fetch", async (request, response) =>
{
    try
    {
        const filters = request.body.filters || {};
        const pageNo = request.body.pageNo || 1;
        const limit = request.body.limit || 20;

        const metadataFilters = { ...filters };
        delete metadataFilters.category;

        const [result, metadata] = await Promise.all([
            tenderDB.fetchTendersLoose(filters, pageNo, limit),
            tenderDB.fetchTenderPool2Metadata(metadataFilters),
        ]);

        if (!result.success)
        {
            return response.status(500).json({
                statusCode: 500,
                success: false,
                message: "Failed to fetch tenders.",
                data: null,
            });
        }

        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: "Tenders fetched successfully.",
            data: result.data,
            pagination: result.pagination,
            metadata,
        });
    }
    catch (error)
    {
        console.error("❌ Error fetching tenders:", error.message);
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to fetch tenders.",
            data: null,
        });
    }
});

router.post("/tenders", async (request, response) =>
{
    if (!request.body || typeof request.body !== "object")
    {
        return response.status(400).json({
            statusCode: 400,
            success: false,
            message: "Request body must be a tender object.",
            data: null,
        });
    }

    try
    {
        const result = await tenderDB.insertTenderPool2(request.body);

        if (!result.success)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: result.error || "Insert failed.",
                data: null,
            });
        }

        return response.status(201).json({
            statusCode: 201,
            success: true,
            message: "Tender inserted successfully.",
            data: result.data,
        });
    }
    catch (error)
    {
        console.error("❌ Error inserting tender:", error.message);
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to insert tender.",
            data: null,
        });
    }
});

router.put("/tenders", async (request, response) =>
{
    if (!request.body || typeof request.body !== "object")
    {
        return response.status(400).json({
            statusCode: 400,
            success: false,
            message: "Request body must contain 'filters' and 'data' objects.",
            data: null,
        });
    }

    try
    {
        const filters = request.body.filters || {};
        const data = request.body.data || {};

        if (Object.keys(data).length === 0)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: "No fields to update provided.",
                data: null,
            });
        }

        const result = await tenderDB.updateTendersPool2(filters, data);

        if (!result.success)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: result.error || "Update failed.",
                data: null,
            });
        }

        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: `${result.updated} tender(s) updated successfully.`,
            data: {
                updated: result.updated,
                tenders: result.data,
            },
        });
    }
    catch (error)
    {
        console.error("❌ Error updating tenders:", error.message);
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to update tenders.",
            data: null,
        });
    }
});

router.post("/tenders/remove", async (request, response) =>
{
    if (!request.body || typeof request.body !== "object" || Object.keys(request.body).length === 0)
    {
        return response.status(400).json({
            statusCode: 400,
            success: false,
            message: "Request body must contain at least one filter.",
            data: null,
        });
    }

    try
    {
        const filters = request.body;
        const result = await tenderDB.deleteTendersPool2(filters);

        if (!result.success)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: result.error || "Delete failed.",
                data: null,
            });
        }

        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: `${result.deleted} tender(s) deleted successfully.`,
            data: {
                deleted: result.deleted,
            },
        });
    }
    catch (error)
    {
        console.error("❌ Error deleting tenders:", error.message);
        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Failed to delete tenders.",
            data: null,
        });
    }
});

router.get("/tender-files-by-id", async (request, response) =>
{
    try
    {
        const id = request.query.id ? parseInt(request.query.id, 10) : null;

        if(!id)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: "Tender ID (tdr) is required.",
                data: null
            });
        }

        const tenderResult = await tenderDB.fetchTendersStrict({ tdr: id }, 1, 1);

        if(!tenderResult.success || !tenderResult.data || tenderResult.data.length === 0)
        {
            return response.status(404).json({
                statusCode: 404,
                success: false,
                message: `No tender found with ID: ${id}`,
                data: null
            });
        }

        const tender = tenderResult.data[0];
        const docs = tender.docs || [];

        const fileUrls = docs.map(doc => ({
            fileName: doc.name,
            fileUrl: doc.url,
            description: doc.description
        }));

        return response.status(200).json({
            statusCode: 200,
            success: true,
            message: "Tender documents fetched successfully.",
            data: fileUrls
        });
    }
    catch (error)
    {
        console.error("❌ Error fetching tender details by ID:", error);

        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Internal Server Error.",
            data: null
        });
    }
});

router.get("/proxy-tender-file", async (request, response) =>
{
    const fileUrl = request.query.url;
    const fileName = request.query.name || "tender_document.pdf";

    if (!fileUrl) {
        return response.status(400).json({ success: false, message: "Missing url parameter" });
    }

    try {
        const fileResponse = await fetch(fileUrl);

        if (!fileResponse.ok) throw new Error(`Failed to fetch file: ${fileResponse.status}`);

        const contentType = fileResponse.headers.get("content-type") || "application/octet-stream";
        const buffer = await fileResponse.arrayBuffer();

        response.setHeader("Content-Type", contentType);
        response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.send(Buffer.from(buffer));
    }
    catch (error) {
        console.error("❌ Proxy file error:", error);
        response.status(500).json({ success: false, message: "Failed to proxy file" });
    }
});

router.post('/start-tender-chatbot', upload.array("files", 10), async (request, response) =>
{
    let urlsFromBody  = request.body.urls ? (Array.isArray(request.body.urls) ? request.body.urls : [request.body.urls]) : [];
    const uploadedFiles = request.files || [];

    if(uploadedFiles.length === 0 && urlsFromBody.length === 0)
    {
        const id = request.body.id ? parseInt(request.body.id, 10) : null;

        if(id)
        {
            try
            {
                const tenderResult = await tenderDB.fetchTenders({ tdr: id });
                if(tenderResult.data && tenderResult.data.length > 0)
                {
                    const tender = tenderResult.data[0];
                    const tenderUrl = tender.url;

                    if(tenderUrl && tenderUrl.includes("tenderdetail.com/Indian-Tenders/TenderNotice/"))
                    {
                        const details = await tenderScraper.extractTenderDetails(tenderUrl);
                        if(details.success && details.documents)
                        {
                            urlsFromBody = details.documents.map(doc => doc.fileUrl);
                        }
                    }
                }
            }
            catch(err)
            {
                console.warn(`⚠️ Failed to fetch tender by ID ${id}: ${err.message}`);
            }
        }

        if(uploadedFiles.length === 0 && urlsFromBody.length === 0)
        {
            return response.status(400).json({ 
                error: 'No files uploaded, URLs provided, or valid tender ID', 
                statusCode: 400 
            });
        }
    }

    const index = request.body.index;
    const language = request.body.language || "English";
    const profilePath = loadCompanyProfilePath(index);
    const companyName = COMPANY_NAMES[index] || "Unknown";
    const filePaths = uploadedFiles.map(f => path.join(__dirname, "../assets", f.filename));
    const allSources = [...filePaths, ...urlsFromBody];

    try
    {
        const seenHashes = new Set();
        const extractedParts = [];
        let totalChars = 0;

        for(const source of allSources)
        {
            if(!source.startsWith('http://') && !source.startsWith('https://'))
            {
                if(path.extname(source).toLowerCase() !== ".pdf")
                {
                    continue;
                }
            }

            try
            {
                const result = await extractText(source);

                if(result)
                {
                    const hash = crypto.createHash("sha256").update(result).digest("hex");

                    if(seenHashes.has(hash))
                    {
                        console.log(`⚠️ Duplicate content skipped: ${source}`);
                        continue;
                    }

                    seenHashes.add(hash);
                    const displayName = source.startsWith('http') ? new URL(source).pathname.split('/').pop() || source : path.basename(source);
                    extractedParts.push(`=== TENDER DOCUMENT: ${displayName} ===\n\n${result}\n\n=== END ===`);
                    totalChars += result.length;
                    console.log(`✅ Extracted ${result.length.toLocaleString()} chars from ${displayName}`);
                }
                else
                {
                    console.warn(`⚠️ No text extracted from ${source}`);
                }
            }
            catch(err)
            {
                console.warn(`⚠️ Extraction failed for ${source}: ${err.message}`);
            }
        }

        if(extractedParts.length === 0)
        {
            return response.status(422).json({ 
                error: 'No text could be extracted from uploaded files or provided URLs', 
                statusCode: 422 
            });
        }

        const tenderText = extractedParts.join("\n\n");
        const rawChunks = chunkTenderText(tenderText);
        const sessionId = uuidv4();

        const session =
        {
            id: sessionId,
            scope:
            {
                companyName: companyName,
                companyIndex: index,
                language: language,
                lastMessageId: 0,
                terminated: false,
                chunksReady: false,
            },
            tenderChunks: [],
            messages: [],
        };

        tenderSessions.push(session);

        embedTenderChunksInBackground(session, rawChunks).catch(err =>
        {
            console.error(`❌ Background embedding failed for session ${sessionId}:`, err.message);
        });

        console.log(`🚀 Tender session created: ${sessionId} | Company: ${companyName} | Chunks queued: ${rawChunks.length}`);

        return response.status(200).json({
            success: true,
            sessionId: sessionId,
            chunksReady: false,
            totalChars,
            chunkCount: rawChunks.length,
        });
    }
    catch(err)
    {
        console.error("❌ Create tender session error:", err.message);
        return response.status(500).json({ error: 'Failed to create session', statusCode: 500 });
    }
    finally
    {
        uploadedFiles.forEach(f => fs.unlink(path.join(__dirname, "../assets", f.filename), () => {}));
    }
});

router.post("/reply-tender-chatbot", async (request, response) =>
{
    const sessionId = request.body.sessionId;
    const content   = request.body.content;

    if(!sessionId)
    {
        return response.json({
            statusCode: 402,
            success:    false,
            message:    "No Session ID provided.",
            id:         null,
            data:       null,
        });
    }

    if(!content)
    {
        return response.json({
            statusCode: 402,
            success:    false,
            message:    "No content provided.",
            id:         null,
            data:       null,
        });
    }

    if(content.length > 500)
    {
        return response.json({
            statusCode: 402,
            success:    false,
            message:    "Content exceeds maximum length.",
            id:         null,
            data:       null,
        });
    }

    const session = tenderSessions.find((s) => s.id === sessionId);

    if(!session)
    {
        return response.json({
            statusCode: 400,
            success:    false,
            message:    "Tender session not found.",
            id:         null,
            data:       null,
        });
    }

    if(session.scope.terminated)
    {
        return response.json({
            statusCode: 403,
            success:    false,
            message:    "Session has been terminated.",
            id:         sessionId,
            data:       null,
        });
    }

    try
    {
        const userMessageId = ++session.scope.lastMessageId;

        session.messages.push({
            id:      userMessageId,
            role:    "user",
            content: content,
        });

        const conversationHistory = session.messages.map((m) => ({
            role:    m.role,
            content: m.content,
        }));

        const interpreted = await tenderAI.interpretTenderQuery(content, conversationHistory.slice(0, -1));

        const { statement, embeddingQuery, needsCompanyData, needsTenderData } = interpreted;

        let companyChunks = [];
        let tenderChunks  = [];

        if(needsCompanyData)
        {
            let embedding = null;

            while(!embedding)
            {
                embedding = await embedder.getEmbedding(embeddingQuery);
            }

            const dbResult = await tenderDB.searchCompanyChunks(embedding, 6, session.scope.companyName);
            companyChunks  = dbResult.data || [];
        }

        if(needsTenderData && session.tenderChunks.length > 0)
        {
            let embedding = null;

            while(!embedding)
            {
                embedding = await embedder.getEmbedding(embeddingQuery);
            }

            const embeddingArr = JSON.parse(embedding);

            const scored = session.tenderChunks.map((chunk) =>
            {
                const chunkArr   = JSON.parse(chunk.embedding);
                let   dotProduct = 0;

                for(let i = 0; i < embeddingArr.length; i++)
                {
                    dotProduct += embeddingArr[i] * chunkArr[i];
                }

                return { ...chunk, similarity: dotProduct };
            });

            const pinnedChunks  = scored.filter((c) => c.pinned);
            const regularChunks = scored
                .filter((c) => !c.pinned && c.similarity >= 0.45)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, 6);

            tenderChunks = [...pinnedChunks, ...regularChunks];
        }

        const aiResult = await tenderAI.getTenderChatResponse(
            content,
            statement,
            companyChunks,
            tenderChunks,
            conversationHistory,
            session.scope.language
        );

        const assistantMessageId = ++session.scope.lastMessageId;

        session.messages.push({
            id:      assistantMessageId,
            role:    "assistant",
            content: aiResult.content,
        });

        return response.status(200).json({
            statusCode: 200,
            success:    true,
            message:    "Reply generated successfully.",
            id:         sessionId,
            data:
            {
                role:        "assistant",
                content:     aiResult.content,
                suggestions: aiResult.suggestions || [],
                allowInput:  true,
                chunksReady: session.scope.chunksReady,
            },
            scope: session.scope,
        });
    }
    catch(err)
    {
        console.error("❌ Error in reply-tender-chatbot:", err.message);

        return response.json({
            statusCode: 500,
            success:    false,
            message:    "Internal Server Error.",
            id:         null,
            data:       null,
        });
    }
});

router.post("/tender-analyses/fetch", async (request, response) =>
{
    try
    {
        const body    = request.body || {};
        const filters = body.filters || {};
        const pageNo  = body.pageNo  || null;
        const limit   = body.limit   || null;

        const result = await tenderDB.fetchTenderAnalyses(filters, pageNo, limit);

        return response.status(200).json({
            statusCode:  200,
            success:     true,
            message:     "Tender analyses fetched successfully.",
            data:        result.data,
            pagination:  result.pagination || null,
            totalCount:  result.totalCount,
        });
    }
    catch (error)
    {
        console.error("❌ Error fetching tender analyses:", error.message);

        return response.status(500).json({
            statusCode: 500,
            success:    false,
            message:    "Failed to fetch tender analyses.",
            data:       null,
        });
    }
});

module.exports = router;