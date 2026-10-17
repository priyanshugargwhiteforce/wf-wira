const puppeteer = require("puppeteer");
const pdfLib = require("pdf-lib");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

//TEMPLATES
const atsResume = require("./Templates/atsResume");

class PDF
{
    constructor(pdfSettings = null, viewport = null)
    {
        this.wiraAssetsDirectory = path.join(__dirname, "..", "..", "Wira-Chatbot", "assets");
        this.wiraPublicURL = "https://wira-ai.com/chat/assets";

        this.defaultViewport = 
        { 
            width: 794, 
            height: 1123, 
            deviceScaleFactor: 1 
        };

        this.defaultPdfSettings = 
        {
            format: "A4",
            printBackground: true,
            margin: 
            { 
                top: 0, 
                right: 0, 
                bottom: 0, 
                left: 0 
            },
            width: "210mm",
            height: "297mm",
            preferCSSPageSize: true,
        };

        this.viewport = viewport || this.defaultViewport;
        this.pdfSettings = pdfSettings || this.defaultPdfSettings;
    }

    async #convertHTMLtoPDF(htmlContent, outputPath)
    {
        let browser;

        try
        {
            browser = await puppeteer.launch(
                {
                    headless: "new",
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-web-security",
                        "--allow-running-insecure-content",
                        "--disable-features=IsolateOrigins",
                        "--disable-site-isolation-trials",
                    ],
                }
            );

            const page = await browser.newPage();

            await page.setViewport(this.viewport);
            await page.setContent(
                htmlContent, 
                { 
                    waitUntil: 
                    [
                        "domcontentloaded"
                    ] 
                }
            );

            await new Promise((resolve) => 
                {
                    return setTimeout(resolve, 1000);
                }
            );

            await page.pdf(
                {
                    ...this.pdfSettings,
                    path: outputPath,
                }
            );
        }
        finally
        {
            if(browser)
            {
                await browser.close();
            }
        }
    }

    async #stampFooter(inputPath, outputPath, footerPath)
    {
        const [pdfBytes, footerBytes] = await Promise.all(
            [
                fs.readFile(inputPath),
                fs.readFile(footerPath),
            ]
        );

        const pdfDoc = await pdfLib.PDFDocument.load(pdfBytes);
        const footerImage = await pdfDoc.embedJpg(footerBytes);

        pdfDoc.getPages().forEach((page) =>
            {
                const pageData = page.getSize();
                const footerH = (footerImage.height / footerImage.width) * pageData.width;

                page.drawImage(
                    footerImage, 
                    { 
                        x: 0, 
                        y: 0, 
                        width: pageData.width, 
                        height: footerH 
                    }
                );
            }
        );

        await fs.writeFile(outputPath, await pdfDoc.save());
    }

    #buildTranscript(data)
    {
        const lines = [];
        const push = (label, value) => value && lines.push(`${label}: ${value}`);

        push("Resume", data.name);
        push("Designation", data.designation);
        push("Location", data.location);
        push("Total Experience", data.totalExperience);
        push("Summary", data.summary);

        const technical = data.skills?.technical ?? (Array.isArray(data.skills) ? data.skills : []);
        const soft = data.skills?.soft ?? [];

        if(technical.length > 0)
        {
            lines.push(`Technical Skills: ${technical.join(", ")}`);
        }

        if(soft.length > 0)
        {
            lines.push(`Soft Skills: ${soft.join(", ")}`);
        }

        for(const job of (data.jobs ?? []).filter(j => j && (j.company || j.position)))
        {
            lines.push(`Experience: ${[job.company, job.position, job.period, job.location].filter(Boolean).join(" | ")}`);
            if(job.description)
            {
                lines.push(job.description);
            }
        }

        for(const proj of (data.projects ?? []).filter(p => p && p.title))
        {
            lines.push(`Project: ${[proj.title, proj.period, proj.technologies ? `Tech: ${proj.technologies}` : null].filter(Boolean).join(" | ")}`);
            if(proj.description)
            {
                lines.push(proj.description);
            }
        }

        for(const c of (data.certifications ?? []).filter(c => c && (c.name || c.title)))
        {
            lines.push(`Certification: ${[c.name ?? c.title, c.issuer, c.year].filter(Boolean).join(" | ")}`);
        }

        for(const e of (data.educationList ?? []).filter(e => e && (e.degree || e.institution)))
        {
            lines.push(`Education: ${[e.degree, e.institution, e.years].filter(Boolean).join(" | ")}`);
        }

        const langs = (data.languages ?? []).filter(Boolean);
        if(langs.length > 0)
        {
            const langLine = langs.map(l => typeof l === "string" ? l : [l.name, l.proficiency].filter(Boolean).join(" ")).join(", ");
            lines.push(`Languages: ${langLine}`);
        }

        const personalFields = 
        [
            data.dob && `Date of Birth: ${data.dob}`,
            data.age && `Age: ${data.age}`,
            data.gender && `Gender: ${data.gender}`,
            data.maritalStatus && `Marital Status: ${data.maritalStatus}`,
            data.noticePeriod && `Notice Period: ${data.noticePeriod}`,
        ]
        .filter(Boolean);

        lines.push(...personalFields);
        return lines.join("\n");
    }

    async createAtsResume(data)
    {
        if(!data || !data.name)
        {
            return {
                success: false,
                statusCode: 402,
                message: "Invalid data provided.",
                fileName: null,
                fileSize: null,
                fileType: null,
                filePath: null,
                publicUrl: null,
                transcript: null,
                pageCount: null,
            };
        }

        const safeName = data.name.replace(/\s+/g, "_");
        const stamp = Date.now();
        const fileName = `ats_resume_${safeName}_${stamp}.pdf`;

        const resumeDir = path.join(this.wiraAssetsDirectory, "resumes");
        const tempDir = path.join(this.wiraAssetsDirectory, "_temp");

        const tempRawPath = path.join(tempDir, `_ats_raw_${safeName}_${stamp}.pdf`);
        const tempStampPath = path.join(tempDir, `_ats_stamp_${safeName}_${stamp}.pdf`);
        const finalPath = path.join(resumeDir, fileName);
        const footerPath = path.join(this.wiraAssetsDirectory, "resumeAssets", "footerr.jpg");

        try
        {
            await Promise.all(
                [
                    fs.mkdir(
                        resumeDir, 
                        { 
                            recursive: true 
                        }
                    ),
                    fs.mkdir(
                        tempDir,   
                        { 
                            recursive: true 
                        }
                    ),
                ]
            );

            const htmlContent = atsResume.buildResumeHTML(data, false);

            await this.#convertHTMLtoPDF(htmlContent, tempRawPath);
            await this.#stampFooter(tempRawPath, tempStampPath, footerPath);
            await fs.rename(tempStampPath, finalPath).catch(async () =>
                {
                    await fs.writeFile(finalPath, await fs.readFile(tempStampPath));
                    fsSync.unlinkSync(tempStampPath);
                }
            );

            const stat = await fs.stat(finalPath);
            const sizeKb = parseFloat((stat.size / 1024).toFixed(2));
            const publicUrl = `${this.wiraPublicURL}/resumes/${encodeURIComponent(fileName)}`;

            const pdfDoc = await pdfLib.PDFDocument.load(await fs.readFile(finalPath));
            const pageCount = pdfDoc.getPageCount();
            const transcript = this.#buildTranscript(data);

            return {
                success: true,
                statusCode: 200,
                message: "ATS resume created successfully.",
                fileName: fileName,
                fileSize: sizeKb,
                fileType: "pdf",
                filePath: finalPath,
                publicUrl: publicUrl,
                transcript: transcript,
                pageCount: pageCount,
            };
        }
        catch(error)
        {
            console.error("Error in createAtsResume:", error);

            return {
                success: false,
                statusCode: 500,
                message: "An error occurred while creating the ATS resume.",
                fileName: null,
                fileSize: null,
                fileType: null,
                filePath: null,
                publicUrl: null,
                transcript: null,
                pageCount: null,
            };
        }
        finally
        {
            // Clean up temp files regardless of success or failure
            for(const tmpPath of [tempRawPath, tempStampPath])
            {
                try   
                { 
                    fsSync.unlinkSync(tmpPath); 
                }
                catch 
                {  
                    /* already gone or never created */ 
                }
            }
        }
    }
}

module.exports = PDF;