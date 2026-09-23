//builder.js
const templater = require("./template1");
const JDTemplater = require("./jdTemplate");
const officialResume = require("./officialResume");
const officialBatchHeader = require("./officialBatchHeader");
const { composeTenderLetterHead } = require("./composeTenderLetterHead");
const puppeteer = require("puppeteer");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

const RESUME_ASSETS_DIR = path.join(__dirname, "..", "assets", "official_resume_assets");

async function stampFooterOnPDF(inputPath, outputPath)
{
    const footerPath  = path.join(RESUME_ASSETS_DIR, "footerr.jpg");
    const pdfBytes    = await fs.readFile(inputPath);
    const footerBytes = await fs.readFile(footerPath);

    const pdfDoc      = await PDFDocument.load(pdfBytes);
    const footerImage = await pdfDoc.embedJpg(footerBytes);

    const pages = pdfDoc.getPages();

    pages.forEach(page =>
    {
        const { width, height } = page.getSize();
        const footerH = (footerImage.height / footerImage.width) * width;

        page.drawImage(footerImage, {
            x:      0,
            y:      0,
            width:  width,
            height: footerH,
        });
    });

    const stamped = await pdfDoc.save();
    await fs.writeFile(outputPath, stamped);
}

async function mergePDFs(inputPaths, outputPath)
{
    const mergedDoc = await PDFDocument.create();

    for(const filePath of inputPaths)
    {
        const bytes = await fs.readFile(filePath);
        const doc   = await PDFDocument.load(bytes);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        pages.forEach(page => mergedDoc.addPage(page));
    }

    const mergedBytes = await mergedDoc.save();
    await fs.writeFile(outputPath, mergedBytes);
}

async function convertHTMLtoPDF(htmlContent, outputPath, options = {}) 
{
    let browser;

    try 
    {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-web-security",
                "--allow-running-insecure-content",
                "--disable-features=IsolateOrigins",
                "--disable-site-isolation-trials",
            ],
        });

        const page = await browser.newPage();

        await page.setExtraHTTPHeaders({
            "Accept": "image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8",
        });

        page.on("requestfailed", req => {
            console.warn(`❌ Failed to load: ${req.url()} — ${req.failure()?.errorText}`);
        });
        page.on("response", res => {
            if (res.url().includes("official_resume_assets")) {
                console.log(`✅ Asset loaded [${res.status()}]: ${res.url()}`);
            }
        });

        await page.setViewport({
            width: 794,
            height: 1123,
            deviceScaleFactor: 1,
        });

        await page.setContent(htmlContent, {
            waitUntil: ["domcontentloaded"],
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log("Generating PDF...");
        await page.pdf({
            path: outputPath,
            format: "A4",
            printBackground: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            width: "210mm",
            height: "297mm",
            preferCSSPageSize: true,
            ...options,
        });

        console.log("✅ PDF created successfully at " + outputPath);
        return outputPath;
    } 
    finally 
    {
        if(browser)
        { 
            await browser.close();
        }
    }
}

async function createResume(data, credentials = true) 
{
    try
    {
        if(!data || !data.fullName) 
        {
            return {
                fileName: null,
                publicUrl: null,
                message: "Invalid data provided.",
                statusCode: 402,
            };
        }
        
        const htmlContent = templater.template2({ data }, credentials);
        
        const outputDir = path.join(__dirname, "..", "assets", "resumes");
        await fs.mkdir(outputDir, { recursive: true });
        
        const safeName = data.fullName.replace(/\s+/g, "_");
        const fileName = `resume_${safeName}_${Date.now()}.pdf`;
        const outputPath = path.join(outputDir, fileName);
        
        await convertHTMLtoPDF(htmlContent, outputPath);
        
        return {
            fileName: fileName,
            message: "Resume created successfully.",
            statusCode: 200,
            publicUrl: `https://astro-buddy.in/AI/assets/resumes/${fileName}`,
        };
    }
    catch(error)
    {
        console.error("Error in createResume:", error);
        return {
            fileName: null,
            publicUrl: null,
            message: "An error occurred while creating the resume.",
            statusCode: 500,
        };
    }
}

async function createJD(data, req) 
{
    try
    {
        if(!data || !data.title) 
        {
            return {
                fileName: null,
                publicUrl: null,
                message: "Invalid data provided.",
                statusCode: 402,
            };
        }
        
        const htmlContent = JDTemplater.template1(data);
        
        const outputDir = path.join(__dirname, "..", "assets", "JD");
        await fs.mkdir(outputDir, { recursive: true });
        
        const safeName = data.title.replace(/\s+/g, "_");
        const fileName = `resume_${safeName}_${Date.now()}.pdf`;
        const outputPath = path.join(outputDir, fileName);
        
        await convertHTMLtoPDF(htmlContent, outputPath);
        
        return {
            fileName: fileName,
            message: "JD created successfully.",
            statusCode: 200,
            publicUrl: `https://astro-buddy.in/AI/assets/JD/${fileName}`,
        };
    }
    catch(error)
    {
        console.error("Error in createJD:", error);
        return {
            fileName: null,
            publicUrl: null,
            message: "An error occurred while creating the JD.",
            statusCode: 500,
        };
    }
}

async function createOfficialResume(data, allowCredentials = false)
{
    try
    {
        if(!data || !data.name)
        {
            return {
                fileName: null,
                publicUrl: null,
                message: "Invalid data provided.",
                statusCode: 402,
            };
        }

        const htmlContent = officialResume.buildResumeHTML(data, allowCredentials);

        const outputDir = path.join(__dirname, "..", "assets", "official_resumes");
        await fs.mkdir(outputDir, { recursive: true });

        const safeName   = data.name.replace(/\s+/g, "_");
        const stamp      = Date.now();
        const tempPath   = path.join(outputDir, `_temp_${safeName}_${stamp}.pdf`);
        const fileName   = `official_resume_${safeName}_${stamp}.pdf`;
        const outputPath = path.join(outputDir, fileName);

        await convertHTMLtoPDF(htmlContent, tempPath);
        await stampFooterOnPDF(tempPath, outputPath);
        fsSync.unlinkSync(tempPath);

        return {
            fileName: fileName,
            message: "Official resume created successfully.",
            statusCode: 200,
            publicUrl: `https://astro-buddy.in/AI/assets/official_resumes/${fileName}`,
        };
    }
    catch(error)
    {
        console.error("Error in createOfficialResume:", error);
        return {
            fileName: null,
            publicUrl: null,
            message: "An error occurred while creating the official resume.",
            statusCode: 500,
        };
    }
}

async function createOfficialBatchHeader(data)
{
    try
    {
        if(!data || !data.name)
        {
            return {
                fileName: null,
                publicUrl: null,
                message: "Invalid data provided.",
                statusCode: 402,
            };
        }

        const htmlContent = officialBatchHeader.buildSummaryHTML(data);

        const outputDir = path.join(__dirname, "..", "assets", "official_batch_headers");
        await fs.mkdir(outputDir, { recursive: true });

        const safeName = data.name.replace(/\s+/g, "_");
        const fileName = `batch_header_${safeName}_${Date.now()}.pdf`;
        const outputPath = path.join(outputDir, fileName);

        await convertHTMLtoPDF(htmlContent, outputPath);

        return {
            fileName: fileName,
            message: "Official batch header created successfully.",
            statusCode: 200,
            publicUrl: `https://astro-buddy.in/AI/assets/official_batch_headers/${fileName}`,
        };
    }
    catch(error)
    {
        console.error("Error in createOfficialBatchHeader:", error);
        return {
            fileName: null,
            publicUrl: null,
            message: "An error occurred while creating the official batch header.",
            statusCode: 500,
        };
    }
}

async function createOfficialFullPacket(batchHeaderData, resumeData, allowCredentials = false)
{
    const tempDir  = path.join(__dirname, "..", "assets", "_temp");
    const stamp    = Date.now();
    const safeName = batchHeaderData?.name?.replace(/\s+/g, "_") ?? "unknown";

    const tempHeaderPath      = path.join(tempDir, `_header_${safeName}_${stamp}.pdf`);
    const tempResumeRawPath   = path.join(tempDir, `_resume_raw_${safeName}_${stamp}.pdf`);
    const tempResumeStampPath = path.join(tempDir, `_resume_${safeName}_${stamp}.pdf`);

    try
    {
        if(!batchHeaderData || !batchHeaderData.name || !resumeData || !resumeData.name)
        {
            return {
                fileName: null,
                publicUrl: null,
                message: "Invalid data provided.",
                statusCode: 402,
            };
        }

        await fs.mkdir(tempDir, { recursive: true });

        console.log("📄 Generating batch header and resume in parallel...");

        await Promise.all([
            convertHTMLtoPDF(officialBatchHeader.buildSummaryHTML(batchHeaderData), tempHeaderPath),
            convertHTMLtoPDF(officialResume.buildResumeHTML(resumeData, allowCredentials), tempResumeRawPath),
        ]);

        console.log("🖼️  Stamping footer on resume...");
        await stampFooterOnPDF(tempResumeRawPath, tempResumeStampPath);

        console.log("🔗 Merging PDFs...");

        const outputDir  = path.join(__dirname, "..", "assets", "official_full_packets");
        await fs.mkdir(outputDir, { recursive: true });

        const fileName   = `full_packet_${safeName}_${stamp}.pdf`;
        const outputPath = path.join(outputDir, fileName);

        await mergePDFs([tempHeaderPath, tempResumeStampPath], outputPath);

        console.log(`✅ Full packet created: ${fileName}`);

        return {
            fileName: fileName,
            message: "Full packet created successfully.",
            statusCode: 200,
            publicUrl: `https://astro-buddy.in/AI/assets/official_full_packets/${fileName}`,
        };
    }
    catch(error)
    {
        console.error("Error in createOfficialFullPacket:", error);
        return {
            fileName: null,
            publicUrl: null,
            message: "An error occurred while creating the full packet.",
            statusCode: 500,
        };
    }
    finally
    {
        for(const tmpPath of [tempHeaderPath, tempResumeRawPath, tempResumeStampPath])
        {
            try   { fsSync.unlinkSync(tmpPath); }
            catch { /* already gone or never created — safe to ignore */ }
        }
    }
}

function toWinAnsi(text)
{
    return text
        .replace(/₹/g, "Rs.")
        .replace(/[^\x00-\xFF]/g, "?");  // catch-all for anything else outside WinAnsi range
}

async function fillPDFFormFields(fileName, formFields)
{
    try
    {
        const filePath = path.join(__dirname, "..", "assets", fileName);

        const pdfBytes = await fs.readFile(filePath);
        const pdfDoc   = await PDFDocument.load(pdfBytes);
        const pages    = pdfDoc.getPages();

        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const fieldsToFill = formFields.filter(f => !f.needsInput && f.value && String(f.value).trim() !== "");

        for(const field of fieldsToFill)
        {
            const pageIndex = (field.pageNumber || 1) - 1;
            const page      = pages[pageIndex];

            if(!page)
            {
                console.warn(`⚠️ Page ${field.pageNumber} not found — skipping "${field.label}"`);
                continue;
            }

            const { height: pageH } = page.getSize();
            const rawValue          = toWinAnsi(String(field.value).trim());
            const preferredSize     = field.fontSize || 9;
            const cellW             = field.width    || 200;
            const cellH             = field.height   || 12;
            const x                 = field.x + 2;
            const baseY             = field.coordinateSystem === "top-down"
                                        ? pageH - field.y - cellH
                                        : field.y;

            if(field.multiLine)
            {
                const { size } = truncateToWidth(rawValue, font, preferredSize, cellW);
                const words    = rawValue.split(" ");
                const lines    = [];
                let   current  = "";

                for(const word of words)
                {
                    const candidate = current ? `${current} ${word}` : word;
                    try
                    {
                        if(font.widthOfTextAtSize(candidate, size) <= cellW) { current = candidate; }
                        else { if(current) lines.push(current); current = word; }
                    }
                    catch { lines.push(current); current = word; }
                }
                if(current) lines.push(current);

                const lineH = size + 2;
                lines.forEach((line, i) =>
                {
                    page.drawText(line, {
                        x,
                        y:     baseY + cellH - lineH * (i + 1),
                        size,
                        font,
                        color: rgb(0, 0, 0),
                    });
                });
            }
            else
            {
                const { text, size } = truncateToWidth(rawValue, font, preferredSize, cellW);
                const centeredY      = baseY + (cellH - size) / 2;

                page.drawText(text, {
                    x,
                    y:     centeredY,
                    size,
                    font,
                    color: rgb(0, 0, 0),
                });
            }
        }

        const filledBytes = await pdfDoc.save();
        await fs.writeFile(filePath, filledBytes);

        console.log(`✅ PDF filled in-place: ${fileName} (${fieldsToFill.length} fields written)`);

        return {
            success:       true,
            fileName,
            fieldsWritten: fieldsToFill.length,
            fieldsSkipped: formFields.length - fieldsToFill.length,
        };
    }
    catch(error)
    {
        console.error("❌ Error in fillPDFFormFields:", error);
        return {
            success: false,
            error:   error.message
        };
    }
}

function truncateToWidth(text, font, fontSize, maxWidth)
{
    for(let size = fontSize; size >= 5; size -= 0.5)
    {
        try
        {
            if(font.widthOfTextAtSize(text, size) <= maxWidth) return { text, size };
        }
        catch { break; }
    }

    let truncated = text;
    while(truncated.length > 0)
    {
        try
        {
            if(font.widthOfTextAtSize(truncated, 5) <= maxWidth) return { text: truncated, size: 5 };
        }
        catch { break; }
        truncated = truncated.slice(0, -1);
    }

    return { text: "", size: 5 };
}

async function createComposedDocuments(composedDocuments, companyIndex)
{
    const outputDir = path.join(__dirname, "..", "assets", "filled_tenders");
    await fs.mkdir(outputDir, { recursive: true });

    const results = [];

    for(const doc of composedDocuments)
    {
        try
        {
            console.log(`📄 Composing document: ${doc.fileName} (${doc.title}) HTML: ${doc.htmlFragment}`);
            const shell = composeTenderLetterHead(doc.htmlFragment);

            const fileName = `${doc.fileName}_${Date.now()}.pdf`;
            const outputPath = path.join(outputDir, fileName);

            await convertHTMLtoPDF(shell, outputPath);

            console.log(`✅ Composed document created: ${fileName}`);

            results.push({
                success:     true,
                fileName,
                title:       doc.title,
                description: doc.description,
                stage:       doc.stage,
                serverPath:  `/assets/filled_tenders/${fileName}`,
                publicUrl:   `https://astro-buddy.in/AI/assets/filled_tenders/${fileName}`,
            });
        }
        catch(error)
        {
            console.error(`❌ Failed to create composed document ${doc.fileName}:`, error.message);

            results.push({
                success:     false,
                fileName:    doc.fileName,
                title:       doc.title,
                description: doc.description,
                stage:       doc.stage,
                serverPath:  null,
                publicUrl:   null,
                error:       error.message,
            });
        }
    }

    return results;
}

async function createWiraResume(data)
{
    try
    {
        if(!data || !data.name)
        {
            return {
                fileName: null,
                fileSize: null,
                fileType: null,
                filePath: null,
                transcript: null,
                message: "Invalid data provided.",
                statusCode: 402,
                success: false,
            };
        }

        const wiraDir = path.join(__dirname, "..", "assets", "Wira");
        await fs.mkdir(wiraDir, { recursive: true });

        const safeName = data.name.replace(/\s+/g, "_");
        const stamp = Date.now();
        const tempDir = path.join(__dirname, "..", "assets", "_temp");
        await fs.mkdir(tempDir, { recursive: true });

        const tempRawPath = path.join(tempDir, `_wira_raw_${safeName}_${stamp}.pdf`);
        const tempStampPath = path.join(tempDir, `_wira_stamp_${safeName}_${stamp}.pdf`);
        const fileName = `official_resume_${safeName}_${stamp}.pdf`;
        const finalPath = path.join(wiraDir, fileName);

        const htmlContent = officialResume.buildResumeHTML(data, false);
        await convertHTMLtoPDF(htmlContent, tempRawPath);
        await stampFooterOnPDF(tempRawPath, tempStampPath);

        await fs.rename(tempStampPath, finalPath).catch(async () =>
        {
            const buf = await fs.readFile(tempStampPath);
            await fs.writeFile(finalPath, buf);
            fsSync.unlinkSync(tempStampPath);
        });

        const stat = await fs.stat(finalPath);
        const sizeKb = parseFloat((stat.size / 1024).toFixed(2));
        const publicUrl = `https://astro-buddy.in/AI/assets/Wira/${encodeURIComponent(fileName)}`;

        const pdfBytes = await fs.readFile(finalPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pageCount = pdfDoc.getPageCount();

        const transcriptLines = [];
        transcriptLines.push(`Resume: ${data.name}`);

        if(data.designation)
        {
            transcriptLines.push(`Designation: ${data.designation}`);
        }

        if(data.location)
        {
            transcriptLines.push(`Location: ${data.location}`);
        }
        
        if(data.totalExperience)
        {
            transcriptLines.push(`Total Experience: ${data.totalExperience}`);
        }

        if(data.summary)
        {
            transcriptLines.push(`Summary: ${data.summary}`);
        }

        const technical = data.skills?.technical ?? (Array.isArray(data.skills) ? data.skills : []);
        const soft = data.skills?.soft ?? [];

        if(technical.length > 0)
        {
            transcriptLines.push(`Technical Skills: ${technical.join(", ")}`);
        }
        if(soft.length > 0)
        {
            transcriptLines.push(`Soft Skills: ${soft.join(", ")}`);
        }

        const jobs = (data.jobs ?? []).filter(j => j && (j.company || j.position));
        for(const job of jobs)
        {
            const parts = [job.company, job.position, job.period, job.location].filter(Boolean).join(" | ");
            transcriptLines.push(`Experience: ${parts}`);

            if(job.description)
            {
                transcriptLines.push(job.description);
            }
        }

        const projects = (data.projects ?? []).filter(p => p && p.title);
        for(const proj of projects)
        {
            const parts = [proj.title, proj.period, proj.technologies ? `Tech: ${proj.technologies}` : null].filter(Boolean).join(" | ");
            transcriptLines.push(`Project: ${parts}`);

            if(proj.description)
            {
                transcriptLines.push(proj.description);
            }
        }

        const certs = (data.certifications ?? []).filter(c => c && (c.name || c.title));
        for(const c of certs)
        {
            transcriptLines.push(`Certification: ${[c.name ?? c.title, c.issuer, c.year].filter(Boolean).join(" | ")}`);
        }

        const edu = (data.educationList ?? []).filter(e => e && (e.degree || e.institution));
        for(const e of edu)
        {
            transcriptLines.push(`Education: ${[e.degree, e.institution, e.years].filter(Boolean).join(" | ")}`);
        }

        const langs = (data.languages ?? []).filter(Boolean);
        if(langs.length > 0)
        {
            const langLine = langs.map(l => typeof l === "string" ? l : [l.name, l.proficiency].filter(Boolean).join(" ")).join(", ");
            transcriptLines.push(`Languages: ${langLine}`);
        }

        const personalFields = [
            data.dob && `Date of Birth: ${data.dob}`,
            data.age && `Age: ${data.age}`,
            data.gender && `Gender: ${data.gender}`,
            data.maritalStatus && `Marital Status: ${data.maritalStatus}`,
            data.noticePeriod && `Notice Period: ${data.noticePeriod}`,
        ].filter(Boolean);

        transcriptLines.push(...personalFields);
        const transcript = transcriptLines.join("\n");

        try 
        { 
            fsSync.unlinkSync(tempRawPath); 
        } 
        catch 
        { 

        }

        return {
            fileName: fileName,
            fileSize: sizeKb,
            fileType: "pdf",
            filePath: finalPath,
            publicUrl: publicUrl,
            transcript: transcript,
            pageCount: pageCount,
            message: "Wira resume created successfully.",
            statusCode: 200,
            success: true,
        };
    }
    catch(error)
    {
        console.error("Error in createWiraResume:", error);

        return {
            fileName: null,
            fileSize: null,
            fileType: null,
            filePath: null,
            publicUrl: null,
            transcript: null,
            pageCount: null,
            message: "An error occurred while creating the Wira resume.",
            statusCode: 500,
            success: false,
        };
    }
}

module.exports = {
    createResume,
    createJD,
    createOfficialResume,
    createOfficialBatchHeader,
    createOfficialFullPacket,
    fillPDFFormFields,
    createComposedDocuments,
    createWiraResume
};