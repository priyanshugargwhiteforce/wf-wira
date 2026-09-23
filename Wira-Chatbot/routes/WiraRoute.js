const express = require("express");
const router = express.Router();
const upload = require("../config/multerConfig");
const fs = require("fs");
const path = require("path");
const extractor = require("@wira/shared/Utility/extractText");
const DB = require("@wira/shared/database/WiraDB");
const AI = require("@wira/shared/AI/executeAI");
const socketIOHandler = require("../sockets/socket");

const REJECTED_EXTENSIONS = new Set([
    "mp4", 
    "mkv", 
    "avi", 
    "mov", 
    "wmv", 
    "flv", 
    "webm",
    "mpeg", 
    "3gp",
    "gif", 
    "gifv"
]);

const AUDIO_EXTENSIONS = new Set([
    "mp3", 
    "wav", 
    "ogg", 
    "flac", 
    "aac", 
    "m4a", 
    "wma", 
    "opus"
]);

const SUPPORTED_EXTENSIONS = new Set([
    "pdf", 
    "docx", 
    "pptx", 
    "ppt", 
    "odp", 
    "odt", 
    "ods", 
    "rtf", 
    "epub",
    "txt", 
    "csv", 
    "md", 
    "json", 
    "xml", 
    "html", 
    "htm", 
    "yaml", 
    "yml", 
    "log",
    "xlsx", 
    "xls", 
    "zip",
    "png", 
    "jpg", 
    "jpeg", 
    "webp", 
    "tiff", 
    "tif", 
    "bmp",
    "mp3", 
    "wav", 
    "ogg", 
    "flac",
    "aac", 
    "m4a", 
    "wma", 
    "opus"
]);

const routesToAuthenticate = [
    "/wira-file-save",
    "/whatsapp-to-wira",
    "/whatsapp-abort"
];

const EMBED_CONCURRENCY = 3;
let embeddingSlots = 0;
const embeddingQueue = [];

function acquireEmbedSlot()
{
    return new Promise((resolve) =>
    {
        if (embeddingSlots < EMBED_CONCURRENCY)
        {
            embeddingSlots++;
            resolve();
        }
        else
        {
            embeddingQueue.push(resolve);
        }
    });
}

function releaseEmbedSlot()
{
    if(embeddingQueue.length > 0)
    {
        const next = embeddingQueue.shift();
        next();
    }
    else
    {
        embeddingSlots--;
    }
}

function getFileExtension(filename)
{
    return path.extname(filename).replace(".", "").toLowerCase();
}

function chunkText(text, maxWords = 250)
{
    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];

    for(let i = 0; i < words.length; i += maxWords)
    {
        chunks.push(words.slice(i, i + maxWords).join(" "));
    }

    return chunks;
}

function cleanText(text, ext)
{
    if(["json"].includes(ext))
    {
        return text;
    }

    if(["txt", "md", "csv", "log", "yaml", "yml"].includes(ext))
    {
        return text
            .replace(/<head[\s\S]*?<\/head>/gi, "")
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
            .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
            .replace(/\r\n|\r/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^[ \t]+|[ \t]+$/gm, "")
            .trim();
    }

    if(["html", "htm", "xml"].includes(ext))
    {
        return text
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<(h[1-6])[^>]{0,500}>([\s\S]*?)<\/\1>/gi, (_, tag, content) => `\n\n${content.trim()}\n`)
            .replace(/<(p|div|section|article|li|td|th|dt|dd|blockquote)[^>]{0,500}>([\s\S]*?)<\/\1>/gi, (_, __, content) => `${content.trim()}\n`)
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]{0,2000}>/g, "")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&[a-z]{2,8};/gi, " ")
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
            .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
            .replace(/\r\n|\r/g, "\n")
            .replace(/[^\S\n]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^[ \t]+|[ \t]+$/gm, "")
            .trim();
    }

    return text
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
        .replace(/\r\n|\r/g, "\n")
        .replace(/[^\S\n]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/^[ \t]+|[ \t]+$/gm, "")
        .replace(/\bPage\s+\d+\s+(of\s+\d+)?\b/gi, "")
        .trim();
}

async function embedWithConcurrencyControl(chunks)
{
    await acquireEmbedSlot();

    try
    {
        return await AI.runWiraEmbedChunks({ chunks });
    }
    finally
    {
        releaseEmbedSlot();
    }
}

async function processFileInBackground(fileRecord, filePath, transcript)
{
    const wiraFileId = fileRecord.id;
    const ext = fileRecord.fileType;

    try
    {
        const rawText = transcript ? transcript : await extractor.extractText(filePath);

        if(!rawText || rawText.trim().length === 0)
        {
            await DB.updateWiraFiles(
                { 
                    extracted: false 
                },
                { 
                    id: wiraFileId 
                }
            );
            return;
        }

        const chunks = chunkText(cleanText(rawText, ext), 250);
        console.log(`[wiraFile:${wiraFileId}] extracted ${chunks.length} chunks from ${transcript ? 'transcript' : 'file'}`);

        if(chunks.length === 0)
        {
            await DB.updateWiraFiles(
                { 
                    extracted: false 
                },
                { 
                    id: wiraFileId 
                }
            );
            return;
        }

        const { vectors, costInr } = await embedWithConcurrencyControl(chunks);
        console.log(`[wiraFile:${wiraFileId}] embedded ${vectors.length} vectors | cost ₹${costInr}`);

        const insertPromises = chunks.map((content, i) =>
        {
            const wordCount = content.split(/\s+/).filter(Boolean).length;

            return DB.insertWiraFileChunk({
                wiraFileId : wiraFileId,
                chunkIndex : i,
                content : content,
                wordCount : wordCount,
                embedding : JSON.stringify(vectors[i])
            });
        });

        await Promise.all(insertPromises);

        await DB.updateWiraFiles(
            {
                extracted : true,
                extractedAt : new Date(),
                chunkCount : chunks.length,
                embeddingCostInr : costInr
            },
            { 
                id: wiraFileId 
            }
        );
    }
    catch(err)
    {
        console.error(`❌ processFileInBackground failed for wiraFileId ${wiraFileId}:`, err.message);

        await DB.updateWiraFiles(
            { 
                extracted: false 
            },
            { 
                id: wiraFileId 
            }
        ).catch(() => {});
    }
}

router.use(routesToAuthenticate, (request, response, next) =>
{
    const apiKey = request.headers["x-api-key"];

    if(!apiKey || apiKey !== process.env.WIRA_API_KEY)
    {
        return response.status(401).json({
            statusCode: 401,
            success: false,
            message: "Unauthorized.",
            data: null
        });
    }

    next();
});

router.post("/whatsapp-to-wira", async (request, response) =>
{
    function callback(result)
    {
        return response.status(result.statusCode).json(result);
    }

    try
    {
        const body = request.body;
        const Wira = socketIOHandler.getWira();

        const authResult = await Wira.authenticate(
            body.role,
            null,
            {
                ...body,
                webName: body.webName ?? "White Force"
            }
        );

        if(!authResult.success)
        {
            return response.status(authResult.statusCode).json(authResult);
        }

        return await Wira.message(null, body, body, callback);
    }
    catch(error)
    {
        console.error("❌ Whatsapp message route failed:", error.message);

        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Internal server error.",
            data: null
        });
    }
});

router.post("/whatsapp-abort", async (request, response) =>
{
    try
    {
        const body = request.body;
        const phone = body?.phone;

        if(!phone)
        {
            return response.status(400).json({
                statusCode: 400,
                success: false,
                message: "Missing phone.",
                data: null
            });
        }

        const Wira = socketIOHandler.getWira();
        const result = await Wira.abort(null, { phone }, body, null);

        return response.status(result?.statusCode ?? 200).json(result);
    }
    catch(error)
    {
        console.error("❌ Whatsapp abort route failed:", error.message);

        return response.status(500).json({
            statusCode: 500,
            success: false,
            message: "Internal server error.",
            data: null
        });
    }
});

router.post("/wira-file-save", upload.array("files", 20), async (request, response) =>
{
    try
    {
        const MAX_FILE_SIZE = 5 * 1024 * 1024;

        if(!request.files || request.files.length === 0)
        {
            return response.status(400).json({
                statusCode : 400,
                success : false,
                message : "No files uploaded.",
                data : null
            });
        }

        const phone = request.body.phone?.trim();

        if(!phone)
        {
            for(const file of request.files)
            {
                try
                {
                    fs.unlinkSync(file.path); 
                } 
                catch(_) 
                {

                }
            }

            return response.status(400).json({
                statusCode : 400,
                success : false,
                message : "phone is required.",
                data : null
            });
        }

        const candidate = await DB.getWiraCandidateByPhone(phone);

        if(!candidate)
        {
            for(const file of request.files)
            {
                try 
                { 
                    fs.unlinkSync(file.path); 
                } 
                catch(_) 
                {

                }
            }

            return response.status(404).json({
                statusCode : 404,
                success : false,
                message : "Candidate not found.",
                data : null
            });
        }

        let transcriptMap = {};

        if(request.body.transcripts)
        {
            try
            {
                transcriptMap = JSON.parse(request.body.transcripts);
            }
            catch(_)
            {
                transcriptMap = {};
            }
        }

        const fileData = [];
        const backgroundTasks = [];

        for(const file of request.files)
        {
            const ext = getFileExtension(file.originalname);
            const transcript = transcriptMap[file.originalname] ?? null;

            if(file.size > MAX_FILE_SIZE)
            {
                try 
                { 
                    fs.unlinkSync(file.path); 
                } 
                catch(_) 
                {

                }

                fileData.push({
                    fileName : file.originalname,
                    fileType : file.mimetype,
                    fileSize : file.size,
                    filePath : null,
                    saved : false,
                    message : "File exceeds 1MB limit and was not saved."
                });

                continue;
            }

            if(REJECTED_EXTENSIONS.has(ext))
            {
                try 
                { 
                    fs.unlinkSync(file.path); 
                } 
                catch(_) 
                {

                }

                fileData.push({
                    fileName : file.originalname,
                    fileType : file.mimetype,
                    fileSize : file.size,
                    filePath : null,
                    saved : false,
                    message : "File type not supported."
                });

                continue;
            }

            if(AUDIO_EXTENSIONS.has(ext) && !transcript)
            {
                try 
                { 
                    fs.unlinkSync(file.path); 
                } 
                catch(_) 
                {

                }

                fileData.push({
                    fileName : file.originalname,
                    fileType : file.mimetype,
                    fileSize : file.size,
                    filePath : null,
                    saved : false,
                    message : "Audio files require a transcript."
                });

                continue;
            }

            if(!SUPPORTED_EXTENSIONS.has(ext))
            {
                try 
                { 
                    fs.unlinkSync(file.path); 
                } 
                catch(_) 
                {

                }

                fileData.push({
                    fileName : file.originalname,
                    fileType : file.mimetype,
                    fileSize : file.size,
                    filePath : null,
                    saved : false,
                    message : "File type not supported."
                });

                continue;
            }

            const publicUrl = `https://wira-ai.com/chat/assets/${encodeURIComponent(file.filename)}`;
            const sizeKb = parseFloat((file.size / 1024).toFixed(2));

            const fileRecord = await DB.insertWiraFile({
                wireCandidateId : candidate.id,
                fileName : file.originalname,
                fileType : ext,
                sizeKb : sizeKb,
                mimeType : file.mimetype,
                extracted : false,
                storagePath : file.path
            });

            fileData.push({
                fileName : file.filename,
                fileType : file.mimetype,
                fileSize : file.size,
                filePath : publicUrl,
                saved : true,
                message : "File saved successfully.",
                transcript : transcript ?? null
            });

            if(fileRecord)
            {
                backgroundTasks.push(processFileInBackground(fileRecord, file.path, transcript));
            }
        }

        Promise.all(backgroundTasks).catch((err) =>
        {
            console.error("❌ Background file processing error:", err.message);
        });

        const allFailed = fileData.every((f) => !f.saved);
        const partialFailure = fileData.some((f) => !f.saved);

        if(allFailed)
        {
            return response.status(500).json({
                statusCode : 500,
                success : false,
                message : "All files failed to save.",
                data : fileData
            });
        }

        return response.status(partialFailure ? 207 : 200).json({
            statusCode : partialFailure ? 207 : 200,
            success : !partialFailure,
            message : partialFailure ? "Some files failed to save." : "All files saved successfully.",
            data : fileData
        });
    }
    catch (err)
    {
        return response.status(500).json({
            statusCode : 500,
            success : false,
            message : err.message || "Internal server error.",
            data : null
        });
    }
});

module.exports = router;