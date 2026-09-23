const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const mammoth = require("mammoth");
const textract = require("textract");
const Tesseract = require("tesseract.js");
const { execSync } = require("child_process");
const AdmZip = require("adm-zip");
const XLSX = require("xlsx");
const officeParser = require("officeparser");
const epub2 = require("epub2");
const qpdf = require("node-qpdf2");
const poppler = process.platform === "win32" ? require("pdf-poppler") : null;

const CALIBRI_WIDTHS = {
    ' ': 0.376, 'a': 0.508, 'b': 0.518, 'c': 0.461, 'd': 0.518, 'e': 0.506,
    'f': 0.299, 'g': 0.518, 'h': 0.518, 'i': 0.216, 'j': 0.216, 'k': 0.480,
    'l': 0.216, 'm': 0.794, 'n': 0.518, 'o': 0.518, 'p': 0.518, 'q': 0.518,
    'r': 0.328, 's': 0.432, 't': 0.353, 'u': 0.518, 'v': 0.461, 'w': 0.667,
    'x': 0.461, 'y': 0.461, 'z': 0.432, 'A': 0.579, 'B': 0.565, 'C': 0.555,
    'D': 0.623, 'E': 0.510, 'F': 0.473, 'G': 0.592, 'H': 0.627, 'I': 0.229,
    'J': 0.353, 'K': 0.565, 'L': 0.482, 'M': 0.714, 'N': 0.627, 'O': 0.650,
    'P': 0.530, 'Q': 0.650, 'R': 0.571, 'S': 0.498, 'T': 0.512, 'U': 0.620,
    'V': 0.561, 'W': 0.792, 'X': 0.535, 'Y': 0.529, 'Z': 0.527, '0': 0.518,
    '1': 0.518, '2': 0.518, '3': 0.518, '4': 0.518, '5': 0.518, '6': 0.518,
    '7': 0.518, '8': 0.518, '9': 0.518, '.': 0.259, ',': 0.259, ':': 0.259,
    ';': 0.259, '(': 0.318, ')': 0.318, '/': 0.353, '\\': 0.353, '-': 0.337,
    '_': 0.518, '?': 0.435, '!': 0.259,
};

const ARIAL_WIDTHS = {
    ' ': 0.278, 'a': 0.556, 'b': 0.556, 'c': 0.500, 'd': 0.556, 'e': 0.556,
    'f': 0.278, 'g': 0.556, 'h': 0.556, 'i': 0.222, 'j': 0.222, 'k': 0.500,
    'l': 0.222, 'm': 0.833, 'n': 0.556, 'o': 0.556, 'p': 0.556, 'q': 0.556,
    'r': 0.333, 's': 0.500, 't': 0.278, 'u': 0.556, 'v': 0.500, 'w': 0.722,
    'x': 0.500, 'y': 0.500, 'z': 0.500, 'A': 0.667, 'B': 0.667, 'C': 0.722,
    'D': 0.722, 'E': 0.667, 'F': 0.611, 'G': 0.778, 'H': 0.722, 'I': 0.278,
    'J': 0.500, 'K': 0.667, 'L': 0.556, 'M': 0.833, 'N': 0.722, 'O': 0.778,
    'P': 0.667, 'Q': 0.778, 'R': 0.722, 'S': 0.667, 'T': 0.611, 'U': 0.722,
    'V': 0.667, 'W': 0.944, 'X': 0.667, 'Y': 0.667, 'Z': 0.611, '0': 0.556,
    '1': 0.556, '2': 0.556, '3': 0.556, '4': 0.556, '5': 0.556, '6': 0.556,
    '7': 0.556, '8': 0.556, '9': 0.556, '.': 0.278, ',': 0.278, ':': 0.278,
    ';': 0.278, '(': 0.333, ')': 0.333, '/': 0.278, '\\': 0.278, '-': 0.333,
    '_': 0.556, '?': 0.556, '!': 0.278,
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "tiff", "tif", "bmp", "gif"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"];
const VIDEO_EXTENSIONS = ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "mpeg", "3gp"];
const PLAIN_TEXT_EXTENSIONS = ["csv", "md", "json", "xml", "html", "htm", "yaml", "yml", "log"];
const MIN_PDF_TEXT_LENGTH = 100;
const WORKER_POOL_SIZE = 4;
const FORM_BLANK_RE = /[_\.]{4,}|…{2,}/;
const PAGE_RE_XML = /<page number="(\d+)"[^>]*height="(\d+)"[^>]*width="(\d+)"/g;
const XML_TAG_RE = /<[^>]+>/g;
const PPM_MIN_RUN = 60;
const PPM_DARK_LUMA = 80;
const PPM_MAX_GAP = 4;
const PDF_PT_W = 595.28;
const PDF_PT_H = 841.89;
const TABLE_LABEL_RE = /^(Bank\s*Name|Branch\s*Name|Branch\s*Place|Branch\s*City|Pin\s*Code|Branch\s*Code|MICR\s*No\.?|Account\s*Type|Account\s*Number|RTGS\s*[/\/]?\s*IFSC\s*Code|Savings|Current|Cash\s*Credit|Date\s+from|Place|Date)$/i;
const SKIP_LINE_RE = /^\s*$|^\(|^N\.B\.|^Certified|^Bank'?s\s*Stamp|^Signature|^I hereby|^also undertake|^credit of|^9 digits|^a cheque|^effected|^To be submitted|^To,|^Hindustan|^Dear Sir|^Sub:|^Please fill|^Tender Enquiry|^ANNEXURE|^Page \d+/i;

let workerPool = [];
let workerPoolReady = false;
let workerIndex = 0;

const TEMP_DIR = (() =>
{
    const dir = path.join(process.cwd(), "assets", "temp");

    if(!fs.existsSync(dir))
    {
        fs.mkdirSync(dir, { recursive: true });
    }

    return dir;
})();

async function downloadToTemp(url)
{
    const parsedUrl = new URL(url);
    const fileName = new URL(url).searchParams.get("FileName") || path.basename(parsedUrl.pathname) || `download-${Date.now()}.pdf`;
    const ext = path.extname(fileName) || ".pdf";
    const baseName = path.basename(fileName, ext);
    const destPath = path.join(TEMP_DIR, `url-dl-${Date.now()}-${baseName}${ext}`);
    const protocol = url.startsWith("https") ? https : http;

    await new Promise((resolve, reject) =>
    {
        const file = fs.createWriteStream(destPath);
        const request = protocol.get(url, (response) =>
        {
            if(response.statusCode >= 300 && response.statusCode < 400 && response.headers.location)
            {
                file.close();

                fs.rmSync(destPath, { 
                    force: true 
                });

                return downloadToTemp(response.headers.location).then(redirectPath =>
                {
                    resolve(redirectPath);
                })
                .catch(reject);
            }

            if(response.statusCode !== 200)
            {
                file.close();
                return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
            }

            response.pipe(file);
            file.on("finish", () => file.close(resolve));
            file.on("error", reject);
        });

        request.on("error", err =>
        {
            file.close();
            try 
            { 
                fs.rmSync(destPath, { 
                    force: true 
                }); 
            } 
            catch(_) 
            {

            }

            reject(err);
        });

        request.setTimeout(30_000, () =>
        {
            request.destroy();
            reject(new Error(`Download timed out: ${url}`));
        });
    });

    return destPath;
}

async function getWorkerPool()
{
    if(workerPoolReady)
    {
        return workerPool;
    }

    workerPool = await Promise.all(Array.from({ length: WORKER_POOL_SIZE }, () => Tesseract.createWorker("eng", 1, { logger: () => {} })));
    workerPoolReady = true;
    return workerPool;
}

async function terminateWorkerPool()
{
    if(!workerPoolReady)
    {
        return;
    }

    await Promise.all(workerPool.map(w => w.terminate()));

    workerPool = [];
    workerPoolReady = false;
}

async function ocrImage(filePath)
{
    try
    {
        const pool = await getWorkerPool();
        const worker = pool[workerIndex % pool.length];
        workerIndex++;

        const data = await worker.recognize(filePath);
        return data.data.text || "";
    }
    catch(error)
    {
        console.warn(`⚠️  OCR failed for "${path.basename(filePath)}": ${error.message}`);
        return "";
    }
}

function cleanText(rawText)
{
    if(!rawText)
    {
        return "";
    }

    return rawText.replace(/\r\n|\r/g, "\n").replace(/\n{2,}/g, "\n").replace(/[ \t]{2,}/g, " ").split("\n").map(l => l.trim()).join("\n").replace(/Page \d+ of \d+/gi, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

function renderPdfPages(filePath, tempDir, pageRange = null, resolution = 150)
{
    const prefix = path.join(tempDir, "page");
    const isWindows = process.platform === "win32";
    const rangeFlag = pageRange ? `-f ${pageRange[0]} -l ${pageRange[1]}` : "";

    if(isWindows)
    {
        return poppler.convert(filePath, {
            format: "jpeg",
            out_dir: tempDir,
            out_prefix: "page",
            page: null,
            resolution: resolution
        });
    }

    execSync(`pdftoppm -jpeg -r ${resolution} -q ${rangeFlag} "${filePath}" "${prefix}"`, { timeout: 120000 });
    return Promise.resolve();
}

function getSortedPageFiles(tempDir, limit = Infinity)
{
    return fs.readdirSync(tempDir).filter(f => /\.(jpg|jpeg|ppm)$/.test(f)).sort((a, b) => {
        const toNum = f => parseInt(f.match(/(\d+)\./)?.[1] || "0");
        return toNum(a) - toNum(b);
    }).slice(0, limit);
}

async function ocrPages(tempDir, files)
{
    const texts = await Promise.all(files.map((f) => ocrImage(path.join(tempDir, f)).then(t => t ? `\f${t}` : null)));
    return texts.filter(Boolean).join("\n\n");
}

async function extractPdfViaOCR(filePath)
{
    const tempDir = fs.mkdtempSync(path.join(TEMP_DIR, "wf-pdf-"));

    try
    {
        await renderPdfPages(filePath, tempDir, null, 150);

        const files = getSortedPageFiles(tempDir);
        if(files.length === 0)
        {
            return null;
        }

        return await ocrPages(tempDir, files) || null;
    }
    catch(error)
    {
        console.error("❌ Full PDF OCR failed:", error);
        return null;
    }
    finally
    {
        try 
        { 
            fs.rmSync(tempDir, { 
                recursive: true, 
                force: true 
            }); 
        } 
        catch(_) 
        {

        }
    }
}

async function ocrFirstPages(filePath, pageCount = 2)
{
    const tempDir = fs.mkdtempSync(path.join(TEMP_DIR, "wf-ocr-"));

    try
    {
        await renderPdfPages(filePath, tempDir, [1, pageCount], 200);

        const files = getSortedPageFiles(tempDir, pageCount);
        if(files.length === 0)
        {
            return null;
        }

        const text = await ocrPages(tempDir, files);
        return text ? text.replace(/\f/g, " ") : null;
    }
    catch(error)   
    {
        console.warn(`⚠️  ocrFirstPages failed for "${path.basename(filePath)}": ${error.message}`);
        return null;
    }
    finally
    {
        try 
        { 
            fs.rmSync(tempDir, { 
                recursive: true, 
                force: true 
            }); 
        } 
        catch(_) 
        {

        }
    }
}

function likelyMissingNITTable(text)
{
    const lower = text.toLowerCase();
    const keywords = ["emd", "tender fee", "bid opening", "last date", "nit no"];
    const foundCount = keywords.filter(k => lower.includes(k)).length;
    return foundCount < 2;
}

function addPageMarkersToText(rawText)
{
    let pages = rawText.split("\f");
    let method = "form-feed";

    if(pages.length <= 1)
    {
        pages = rawText.split(/(?=Page \d+ of \d+)/i);
        method = "page-footer";
    }

    if(pages.length <= 1)
    {
        pages = [rawText];
        method = "none (single block)";
    }

    //console.log(`📄 addPageMarkersToText → split method: "${method}" → ${pages.length} page(s)`);

    const result = pages.map((pageText, i) => {
        const cleaned = cleanText(pageText);

        if(!cleaned)
        {
            return null;
        }

        return "[Page " + (i + 1) + "]\n" + cleaned;
    }).filter(Boolean).join("\n\n");

    //const injected = (result.match(/\[Page \d+\]/g) || []);
    //console.log(`📌 Page markers injected: ${injected.length} → ${injected.join(", ")}`);

    return result;
}

async function extractOffice(filePath)
{
    try
    {
        const text = await officeParser.parseOfficeAsync(filePath);
        return text || null;
    }
    catch(error)
    {
        console.error(`❌ officeParser failed for "${path.basename(filePath)}":`, error);
        return null;
    }
}

async function extractEpub(filePath)
{
    try
    {
        const book = await epub2.EPub.createAsync(filePath);
        const chapters = await Promise.all(book.flow.map((chapter) =>
                new Promise((resolve) =>
                {
                    book.getChapter(chapter.id, (err, text) =>
                    {
                        if(err || !text)
                        {
                            resolve("");
                        }
                        else
                        {
                            resolve(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
                        }
                    });
                })
            )
        );

        return chapters.filter(Boolean).join("\n\n") || null;
    }
    catch(error)
    {
        console.error(`❌ epub extraction failed for "${path.basename(filePath)}":`, error);
        return null;
    }
}

async function tryDecryptPdf(filePath)
{
    const decryptedPath = path.join(TEMP_DIR, `decrypted-${Date.now()}.pdf`);
    try
    {
        await qpdf.decrypt({
            input: filePath,
            output: decryptedPath,
            password: ""
        });

        if(!fs.existsSync(decryptedPath))
        {
            return null;
        }

        return decryptedPath;
    }
    catch(error)
    {
        try 
        { 
            fs.rmSync(decryptedPath, { 
                force: true 
            }); 
        } 
        catch(_) 
        {

        }

        return null;
    }
}

async function extractText(filePathOrUrl, addPageNumber = false)
{
    const isUrl = /^https?:\/\//i.test(filePathOrUrl);
    let filePath = filePathOrUrl;
    let tempDownloaded = null;

    if(isUrl)
    {
        try
        {
            tempDownloaded = await downloadToTemp(filePathOrUrl);
            filePath = tempDownloaded;
        }
        catch(error)
        {
            console.error(`❌ extractText download failed for "${filePathOrUrl}":`, error);
            return null;
        }
    }

    const ext = path.extname(filePath).replace(".", "").toLowerCase();
    let rawText = "";

    try
    {
        if(ext === "pdf")
        {
            const dataBuffer = fs.readFileSync(filePath);
            const header = dataBuffer.slice(0, 5).toString("ascii");

            if(header !== "%PDF-")
            {
                rawText = dataBuffer.toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            }
            else
            {
                const pdf = require("pdf-parse");
                let data;

                try
                {
                    data = await pdf(dataBuffer);
                    rawText = data.text || "";
                }
                catch(pdfError)
                {
                    const isEncrypted = pdfError.message?.toLowerCase().includes("encrypt") || pdfError.message?.toLowerCase().includes("password");

                    if(isEncrypted)
                    {
                        //console.warn(`🔒 Encrypted PDF detected, attempting blank-password decrypt: "${path.basename(filePath)}"`);
                        const decryptedPath = await tryDecryptPdf(filePath);

                        if(decryptedPath)
                        {
                            try
                            {
                                const decryptedBuffer = fs.readFileSync(decryptedPath);
                                data = await pdf(decryptedBuffer);
                                rawText = data.text || "";
                            }
                            catch(_) 
                            {

                            }
                            finally
                            {
                                try 
                                { 
                                    fs.rmSync(decryptedPath, { 
                                        force: true 
                                    }); 
                                } 
                                catch(_) 
                                {

                                }
                            }
                        }

                        if(!rawText)
                        {
                            console.warn(`⚠️ Could not extract encrypted PDF: "${path.basename(filePath)}"`);
                            return null;
                        }
                    }
                    else
                    {
                        const ocrText = await extractPdfViaOCR(filePath);
                        if(ocrText) rawText = ocrText;
                    }
                }

                if(rawText.trim().length < MIN_PDF_TEXT_LENGTH)
                {
                    const ocrText = await extractPdfViaOCR(filePath);

                    if(ocrText)
                    {
                        rawText = ocrText;
                    }
                }
                else if(likelyMissingNITTable(rawText))
                {
                    const firstPageOcr = await ocrFirstPages(filePath, 2);

                    if(firstPageOcr)
                    {
                        const pages = rawText.split("\f");
                        const ocrParts = firstPageOcr.split(/\s{3,}/);

                        if(pages.length >= 1 && ocrParts[0])
                        {
                            pages[0] = ocrParts[0];
                        }

                        if(pages.length >= 2 && ocrParts[1])
                        {
                            pages[1] = ocrParts[1];
                        }

                        rawText = pages.join("\f");
                    }
                }

                if(addPageNumber)
                {
                    return addPageMarkersToText(rawText);
                }
            }
        }

        else if(ext === "docx")
        {
            const result = await mammoth.extractRawText({ path: filePath });
            rawText = result.value;
        }

        else if(["pptx", "ppt", "odp", "odt", "ods", "rtf"].includes(ext))
        {
            rawText = await extractOffice(filePath) || "";
        }

        else if(ext === "epub")
        {
            rawText = await extractEpub(filePath) || "";
        }

        else if(ext === "txt")
        {
            rawText = fs.readFileSync(filePath, "utf8");
        }

        else if(IMAGE_EXTENSIONS.includes(ext))
        {
            rawText = await ocrImage(filePath);
        }

        else if(ext === "zip")
        {
            const tempDir = fs.mkdtempSync(path.join(TEMP_DIR, "wf-zip-"));

            try
            {
                const zip = new AdmZip(filePath);
                zip.extractAllTo(tempDir, true);

                const results = await Promise.all(zip.getEntries().filter(e => !e.isDirectory).map(async (entry) => {
                    const entryPath = path.join(tempDir, entry.entryName);

                    if(!fs.existsSync(entryPath))
                    {
                        return null;
                    }

                    const result = await extractText(entryPath, addPageNumber);
                    return result ? "[" + entry.entryName + "]\n" + result : null;
                }));

                rawText = results.filter(Boolean).join("\n\n");
            }
            finally
            {
                try
                {
                    fs.rmSync(tempDir, {
                        recursive: true,
                        force: true
                    });
                }
                catch(_) 
                {

                }
            }
        }

        else if(ext === "xlsx" || ext === "xls")
        {
            const workbook = XLSX.readFile(filePath);
            const result = {};

            for(const sheetName of workbook.SheetNames)
            {
                result[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
            }

            rawText = JSON.stringify(result);
        }

        else if(PLAIN_TEXT_EXTENSIONS.includes(ext))
        {
            rawText = fs.readFileSync(filePath, "utf8");
        }

        else if(AUDIO_EXTENSIONS.includes(ext) || VIDEO_EXTENSIONS.includes(ext))
        {
            console.warn(`⚠️  extractText: unsupported media type "${ext}" — audio/video files cannot be extracted`);
            return null;
        }

        else
        {
            rawText = await new Promise((resolve, reject) =>
            {
                textract.fromFileWithPath(filePath, {
                    preserveLineBreaks: true
                }, (err, text) =>
                    err ? reject(err) : resolve(text)
                );
            });
        }
    }
    catch(error)
    {
        console.error(`❌ extractText failed for "${path.basename(filePath)}":`, error);
        return null;
    }
    finally
    {
        if(tempDownloaded)
        {
            try
            {
                fs.rmSync(tempDownloaded, {
                    force: true
                });
            }
            catch(_) 
            {
                
            }
        }
    }

    return cleanText(rawText);
}

function parsePPM(buf)
{
    let pos = 0;

    function readLine()
    {
        let line = "";

        while(pos < buf.length && buf[pos] !== 10) 
        {
            line += String.fromCharCode(buf[pos++]); 
        }

        pos++;
        return line.trim();
    };

    readLine();
    let dims = readLine();

    while(dims.startsWith("#"))
    {
        dims = readLine();
    }

    const [width, height] = dims.split(" ").map(Number);
    readLine();
    const pixels = buf.slice(pos);

    return { 
        width: width, 
        height: height, 
        pixels: pixels 
    };
}

function detectLinesInPPM(buf)
{
    const { width, height, pixels } = parsePPM(buf);
    const raw = [];

    for(let y = 0; y < height; y++)
    {
        let runStart = -1;
        let runLen = 0;

        for(let x = 0; x < width; x++)
        {
            const idx = (y * width + x) * 3;
            const lum = (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) / 1000;

            if(lum < PPM_DARK_LUMA)
            {
                if(runStart === -1)
                {
                    runStart = x;
                }

                runLen++;
            }
            else
            {
                if(runLen >= PPM_MIN_RUN)
                {
                    raw.push({ 
                        x: runStart, 
                        y: y, 
                        w: runLen 
                    });
                }

                runStart = -1;
                runLen = 0;
            }
        }

        if(runLen >= PPM_MIN_RUN)
        {
            raw.push({ 
                x: runStart, 
                y: y, 
                w: runLen 
            });
        }
    }

    const sorted = raw.sort((a, b) => a.y - b.y || a.x - b.x);
    const merged = [];
    const used = new Set();

    for(let i = 0; i < sorted.length; i++)
    {
        if(used.has(i))
        {
            continue;
        }
        
        let { x, y, w } = sorted[i];
        used.add(i);

        for(let j = i + 1; j < sorted.length; j++)
        {
            if(used.has(j))
            {
                continue;
            }

            const n = sorted[j];

            if(n.y - y > PPM_MAX_GAP)
            {
                break;
            }

            if(Math.abs(n.x - x) < 20 && Math.abs(n.w - w) < 30)
            {
                used.add(j);
                w = Math.max(w, n.w);
            }
        }

        merged.push({ 
            x: x, 
            y: y, 
            w: w, 
            imgW: width, 
            imgH: height 
        });
    }

    return merged;
}

function lineToPdfPts(line)
{
    return {
        x: Math.round(line.x * PDF_PT_W / line.imgW),
        y: Math.round((line.imgH - line.y) * PDF_PT_H / line.imgH),
        width: Math.round(line.w * PDF_PT_W / line.imgW),
        height: 12
    };
}

function findLabelForLine(lineX, lineY, lineW, words, rowTol = 35)
{
    let candidates = words.filter(w => Math.abs(w.y1 - lineY) < rowTol && w.x2 <= lineX + 20);

    if(!candidates.length)
    {
        candidates = words.filter(w => lineY - 50 < w.y1 && w.y1 < lineY + rowTol && w.x1 < lineX + lineW);
    }

    if(!candidates.length)
    {
        return "field";
    }

    candidates.sort((a, b) => Math.abs(a.y1 - lineY) * 10 + Math.abs(a.x2 - lineX) - (Math.abs(b.y1 - lineY) * 10 + Math.abs(b.x2 - lineX)));

    const anchorY = candidates[0].y1;
    const rowWords = candidates.filter(w => Math.abs(w.y1 - anchorY) < 12).sort((a, b) => a.x1 - b.x1);
    return rowWords.map(w => w.text).join(" ").replace(/:$/, "").trim();
}

async function extractFieldsFromImagePages(pdfPath, pageCount, onlyPages = null)
{
    const tempDir = fs.mkdtempSync(path.join(TEMP_DIR, "wf-form-"));

    try
    {
        const isWindows = process.platform === "win32";
        if(isWindows)
        {
            await poppler.convert(pdfPath, {
                format: "ppm",
                out_dir: tempDir,
                out_prefix: "page",
                resolution: 150
            });
        }
        else
        {
            execSync(`pdftoppm -r 150 -q "${pdfPath}" "${path.join(tempDir, "page")}"`, { timeout: 120000 });
        }

        const allFiles = getSortedPageFiles(tempDir).filter(f => f.endsWith(".ppm"));
        const files = onlyPages ? allFiles.filter((_, i) => onlyPages.includes(i + 1)) : allFiles;

        const pool = await getWorkerPool();
        const fields = [];

        for(let idx = 0; idx < files.length; idx++)
        {
            const fileIndex = onlyPages ? onlyPages[idx] - 1 : idx;
            const pageNum = fileIndex + 1;
            const ppmPath = path.join(tempDir, files[idx]);
            const ppmBuf = fs.readFileSync(ppmPath);
            const lines = detectLinesInPPM(ppmBuf);

            if(!lines.length)
            {
                continue;
            }

            const worker = pool[workerIndex % pool.length];
            workerIndex++;

            const data = await worker.recognize(ppmPath);
            const words = (data.data.words || []).map((w) => {
                return {
                    text: w.text.trim(),
                    x1: w.bbox.x0,
                    y1: w.bbox.y0,
                    x2: w.bbox.x1,
                    y2: w.bbox.y1
                }
            }).filter(w => w.text.length > 0);

            for(const line of lines)
            {
                const label = findLabelForLine(line.x, line.y, line.w, words);
                const pts = lineToPdfPts(line);

                fields.push({ 
                    label: label, 
                    pageNumber: pageNum, ...pts 
                });
            }
        }

        return fields;
    }
    finally
    {
        try 
        { 
            fs.rmSync(tempDir, { 
                recursive: true, 
                force: true 
            }); 
        } 
        catch(_) 
        {

        }
    }
}

function measureTextWidth(text, fontSizePx, family = "")
{
    const fam = (family || "").toLowerCase();
    const widthMap = fam.includes("arial") ? ARIAL_WIDTHS : CALIBRI_WIDTHS;
    let w = 0;

    for(const ch of text)
    {
        w += (widthMap[ch] ?? 0.5);
    }

    return w * fontSizePx;
}

function extractFieldsFromXml(xml)
{
    const fontMap = {};
    const fontRe = /<fontspec id="(\d+)" size="(\d+)" family="([^"]+)"/g;
    let fm;

    while((fm = fontRe.exec(xml)) !== null)
    {
        fontMap[fm[1]] = { 
            size: parseInt(fm[2]), 
            family: fm[3] 
        };
    }

    const pageDims = {};
    const pageElems = {};
    let currentPage = 0;

    let pm;

    PAGE_RE_XML.lastIndex = 0;
    while((pm = PAGE_RE_XML.exec(xml)) !== null)
    {
        pageDims[parseInt(pm[1])] = { 
            h: parseInt(pm[2]), 
            w: parseInt(pm[3]) 
        };
    }

    for(const line of xml.split("\n"))
    {
        const pdm = line.match(/<page number="(\d+)"/);
        if(pdm)
        {
            currentPage = parseInt(pdm[1]);
            pageElems[currentPage] = [];
            continue;
        }

        const tm = line.match(/<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="(\d+)"[^>]*>(.*?)<\/text>/);
        if(tm && currentPage)
        {
            const text = tm[6].replace(XML_TAG_RE, "").trim();
            if(text && text.length > 1)
            {
                pageElems[currentPage].push({
                    top: parseInt(tm[1]),
                    left: parseInt(tm[2]),
                    width: parseInt(tm[3]),
                    height: parseInt(tm[4]),
                    fontId: tm[5],
                    text: text
                });
            }
        }
    }

    const fields = [];

    for(const [pageStr, elements] of Object.entries(pageElems))
    {
        const page = parseInt(pageStr);
        const dims = pageDims[page] || { h: 1262, w: 892 };
        const xmlH = dims.h;
        const xmlW = dims.w;
        const pageRight = xmlW - 60;

        for(const e of elements)
        {
            const m = FORM_BLANK_RE.exec(e.text);

            if(!m)
            {
                continue;
            }

            if(SKIP_LINE_RE.test(e.text))
            {
                continue;
            }

            const labelPart = e.text.slice(0, m.index).trim().replace(/:$/, "").trim() || "field";
            const font = fontMap[e.fontId];
            const fontSize = font?.size   ?? 15;
            const fontFamily = font?.family ?? "Calibri";
            const labelPx = measureTextWidth(labelPart + " ", fontSize, fontFamily);
            const blankXmlX = e.left + Math.min(labelPx, e.width * 0.8);
            const blankXmlW = Math.max((e.left + e.width) - blankXmlX - 5, 20);
            const xmlLibY = xmlH - e.top - e.height;

            fields.push({
                label: labelPart,
                pageNumber: page,
                x: Math.round(blankXmlX * PDF_PT_W / xmlW),
                y: Math.round(xmlLibY * PDF_PT_H / xmlH),
                width: Math.round(blankXmlW * PDF_PT_W / xmlW),
                height: Math.round(e.height * PDF_PT_H / xmlH)
            });
        }

        const rows = {};
        for(const e of elements)
        {
            const rowKey = Math.round(e.top / 5) * 5;

            if(!rows[rowKey])
            {
                rows[rowKey] = [];
            }

            rows[rowKey].push(e);
        }

        for(const rowElems of Object.values(rows))
        {
            const meaningful = rowElems.filter(e => e.text.trim().length > 1 && !FORM_BLANK_RE.test(e.text)).sort((a, b) => a.left - b.left);

            if(meaningful.length < 2)
            {
                continue;
            }

            const hasTableLabel = meaningful.some(e => TABLE_LABEL_RE.test(e.text.trim()));

            if(!hasTableLabel)
            {
                continue;
            }

            for(let i = 0; i < meaningful.length; i++)
            {
                const e = meaningful[i];

                if(!TABLE_LABEL_RE.test(e.text.trim()))
                {
                    continue;
                }

                if(/^(Savings|Current|Cash\s*Credit)$/i.test(e.text.trim()))
                {
                    continue;
                }

                const labelEndX = e.left + e.width + 8;
                const nextLeft  = i + 1 < meaningful.length ? meaningful[i + 1].left - 8 : pageRight;
                const cellWidth = nextLeft - labelEndX;

                if(cellWidth < 20)
                {
                    continue;
                }

                const xmlLibY = xmlH - e.top - e.height;
                const label = e.text.trim().replace(/:$/, "").trim();

                const alreadyCaught = fields.some((f) => f.pageNumber === page && Math.abs(f.y - Math.round(xmlLibY * PDF_PT_H / xmlH)) < 5 && f.label.toLowerCase().includes(label.toLowerCase().slice(0, 6)));

                if(alreadyCaught)
                {
                    continue;
                }

                fields.push({
                    label: label,
                    pageNumber: page,
                    x: Math.round(labelEndX * PDF_PT_W / xmlW),
                    y: Math.round(xmlLibY * PDF_PT_H / xmlH),
                    width: Math.round(cellWidth * PDF_PT_W / xmlW),
                    height: Math.round(e.height * PDF_PT_H / xmlH)
                });
            }
        }
    }

    return fields;
}

async function detectFormFields(pdfPath)
{
    let xml = "";
    let pageCount = 1;

    try
    {
        xml = execSync(`pdftohtml -xml -stdout "${pdfPath}"`, { 
            timeout: 30000, 
            maxBuffer: 50 * 1024 * 1024 
        }).toString();

        const pageMatches = [...xml.matchAll(/<page number="(\d+)"/g)];
        pageCount = pageMatches.length || 1;
    }
    catch(err)
    {
        console.warn(`⚠️ pdftohtml failed for ${path.basename(pdfPath)}: ${err.message}`);
    }

    const totalTextLen = xml.replace(XML_TAG_RE, "").replace(/\s+/g, "").length;
    const isImagePdf = totalTextLen < 100;

    if(!isImagePdf)
    {
        const xmlFields = extractFieldsFromXml(xml);

        const pageTextLen = {};
        const pageBlockRe = /<page number="(\d+)"[\s\S]*?<\/page>/g;
        let pb;

        while((pb = pageBlockRe.exec(xml)) !== null)
        {
            const pageNum = parseInt(pb[0].match(/<page number="(\d+)"/)[1]);
            pageTextLen[pageNum] = pb[0].replace(XML_TAG_RE, "").replace(/\s+/g, "").length;
        }

        const IMAGE_PAGE_TEXT_THRESHOLD = 50;
        const pagesCoveredByFields = new Set(xmlFields.map(f => f.pageNumber));
        const allPages = Array.from({ length: pageCount }, (_, i) => i + 1);

        const uncovered = allPages.filter((p) => !pagesCoveredByFields.has(p) && (pageTextLen[p] ?? 0) < IMAGE_PAGE_TEXT_THRESHOLD);

        let extraFields = [];
        if(uncovered.length > 0)
        {
            //console.log(`🔍 Likely image pages: [${uncovered.join(",")}] — running PPM fallback`);
            extraFields = await extractFieldsFromImagePages(pdfPath, pageCount, uncovered);
        }

        const fields = [...xmlFields, ...extraFields];

        if(fields.length > 0)
        {
            //console.log(`✅ detectFormFields → text PDF → ${fields.length} fields (${xmlFields.length} XML + ${extraFields.length} PPM)`);
            return fields;
        }
    }

    //console.log(`🔍 detectFormFields → image PDF fallback → scanning ${pageCount} page(s) via PPM+Tesseract`);
    const fields = await extractFieldsFromImagePages(pdfPath, pageCount);
    //console.log(`✅ detectFormFields → ${fields.length} fields via vision`);
    return fields;
}

module.exports =
{
    extractText,
    terminateWorkerPool,
    detectFormFields
};