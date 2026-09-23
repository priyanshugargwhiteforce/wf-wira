const prompter = require("@wira/shared/prompts");
const AI = require("@wira/shared/executeAI");
const crypto = require("crypto");
const fs   = require("fs");
const path = require("path");
const { extractText } = require("@wira/shared/Utility/extractText");
const extractor = require("@wira/shared/Utility/extractText");

const SYSTEM_MESSAGE = `You are a JSON generator. Output ONLY valid JSON that can be parsed by JSON.parse(). No markdown, no explanations, no code blocks. All strings properly quoted. No newlines in strings. Use null for missing values.`;

function cleanJsonResponse(text)
{
    let cleaned = text
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/gi, "")
        .trim();

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd   = cleaned.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart)
    {
        throw new Error("No JSON object found");
    }

    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
    cleaned = cleaned.replace(/\r\n/g, " ");
    cleaned = cleaned.replace(/\n/g, " ");
    cleaned = cleaned.replace(/\r/g, " ");
    cleaned = cleaned.replace(/  +/g, " ");

    try
    {
        JSON.parse(cleaned);
        return cleaned;
    }
    catch (err)
    {
        throw new Error(`Invalid JSON: ${err.message}`);
    }
}

function buildFormPageBlock(extractedText)
{
    if (!extractedText || extractedText.trim().length === 0)
    {
        return ""
    }

    const THRESHOLD = 5

    function countFieldsOnPage(text)
    {
        const counts = {}

        counts.underscoreBlanks  = (text.match(/_{4,}/g)                                     || []).length
        counts.dottedBlanks      = (text.match(/\.{5,}/g)                                    || []).length
        counts.ellipsisBlanks    = (text.match(/…{2,}/g)                                     || []).length
        counts.dashBlanks        = (text.match(/-{4,}/g)                                     || []).length
        counts.msBlanks          = (text.match(/m\/s\.?\s*[-_\.…]{3,}/gi)                    || []).length
        counts.rsBlanks          = (text.match(/rs\.?\s*[-_\.…]{3,}/gi)                      || []).length
        counts.rupeesBlanks      = (text.match(/rupees\s*[-_\.…]{3,}/gi)                     || []).length
        counts.dateBlanks        = (text.match(/dated?\s*[:\-]?\s*[-_\.…]{3,}/gi)            || []).length
        counts.colonBlanks       = (text.match(/:\s*[-_\.…]{4,}/g)                           || []).length
        counts.tableInputCells   = (text.match(/\|[\s]*\|/g)                                 || []).length
        counts.signatureLines    = (text.match(/signature\s+of/gi)                           || []).length
        counts.placeDateLines    = (text.match(/^(place|date)\s*[:\-]?\s*$/gim)              || []).length
        counts.checkboxOptions   = (text.match(/\b(savings|current|cash\s+credit)\b/gi)      || []).length
        counts.sealStampLines    = (text.match(/\b(seal|stamp)\s*[&and]*\s*(signature)?\b/gi)|| []).length
        counts.namedBlanks       = (text.match(/\b(name|address|designation|city|place|pin\s*code|pan|gstin?|mobile|email|branch|ifsc|micr|account\s+(?:no|number|type)|bank\s+name)\s*[:\-]?\s*[-_\.…]{3,}/gi) || []).length

        const total = Object.values(counts).reduce((sum, n) => sum + n, 0)

        const breakdown = Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k}:${n}`)
            .join(", ")

        return { total, breakdown, counts }
    }

    function scorePageForForm(text)
    {
        let score  = 0
        const hits = []

        const blankPatterns = [
            { re: /_{5,}/g,                                                                    label: "Blank fields (underscores)" },
            { re: /\.{6,}/g,                                                                   label: "Blank fields (dots)"        },
            { re: /…{2,}/g,                                                                    label: "Blank fields (ellipsis)"    },
            { re: /\[_{3,}\]/g,                                                                label: "Bracket blanks"             },
            { re: /:\s*_{3,}/g,                                                                label: "Colon-blank fields"         },
            { re: /:\s*\.{5,}/g,                                                               label: "Colon-dot fields"           },
            { re: /:\s*…{2,}/g,                                                                label: "Colon-ellipsis fields"      },
            { re: /\(\s*_{3,}\s*\)/g,                                                         label: "Paren blanks"               },
            { re: /\b(Name|Date|Place|Signature|Designation|Address|Ref|Subject)\s*:\s*[_\.…]{3,}/gi, label: "Named blank fields" },
        ]

        for (const { re, label } of blankPatterns)
        {
            const matches = text.match(re)

            if (matches && matches.length >= 2)
            {
                score += 3
                hits.push(label)
                break
            }
        }

        const structuralHeaders = [
            { re: /^[\s\*\-#]*annexure[\s\-–]*[a-z]?\s*(i{1,3}|iv|vi{0,3}|ix|x{0,3}|\d{1,2}|[a-z])\.?\s*$/im,   label: "Annexure header"         },
            { re: /^[\s\*\-#]*appendix[\s\-–]*[a-z]?\s*(i{1,3}|iv|vi{0,3}|ix|x{0,3}|\d{1,2}|[a-z])\.?\s*$/im,   label: "Appendix header"         },
            { re: /^[\s\*\-#]*schedule[\s\-–]*[a-z]?\s*(i{1,3}|iv|vi{0,3}|ix|x{0,3}|\d{1,2}|[a-z])\.?\s*$/im,   label: "Schedule header"         },
            { re: /^[\s\*\-#]*enclosure[\s\-–]*[a-z]?\s*(i{1,3}|iv|vi{0,3}|ix|x{0,3}|\d{1,2}|[a-z])\.?\s*$/im,  label: "Enclosure header"        },
            { re: /^[\s\*\-#]*(form|format|proforma|performa)\s*(no\.?|number)?\s*[-–]?\s*[\w\d]+\.?\s*$/im,       label: "Form header"             },
            { re: /^[\s\*\-#]*proforma\s+of\b/im,                                                                   label: "Proforma header"         },
            { re: /^[\s\*\-#]*price\s+bid\s*$/im,                                                                   label: "Price bid header"        },
            { re: /^[\s\*\-#]*financial\s+bid\s*(format|schedule|form)?\s*$/im,                                     label: "Financial bid header"    },
            { re: /^[\s\*\-#]*technical\s+bid\s*(format|schedule|form)?\s*$/im,                                     label: "Technical bid header"    },
            { re: /^[\s\*\-#]*mandate\s+form\b/im,                                                                  label: "Mandate form header"     },
            { re: /^[\s\*\-#]*declaration\s+of\s+site\s+visit\s*$/im,                                              label: "Site visit declaration"  },
            { re: /^[\s\*\-#]*work\s+completion\s+certificate\s*$/im,                                               label: "Work completion cert"    },
            { re: /^[\s\*\-#]*indemnity\s+bond\s*$/im,                                                              label: "Indemnity bond"          },
            { re: /^[\s\*\-#]*power\s+of\s+attorney\s*$/im,                                                         label: "Power of attorney"       },
            { re: /^[\s\*\-#]*affidavit\s*$/im,                                                                     label: "Affidavit"               },
            { re: /^[\s\*\-#]*letter\s+of\s+authoris?ation\s*$/im,                                                 label: "Letter of authorisation" },
            { re: /^[\s\*\-#]*(undertaking|self.?declaration)\s*$/im,                                               label: "Undertaking"             },
            { re: /^[\s\*\-#]*declaration\s*$/im,                                                                   label: "Declaration"             },
            { re: /^[\s\*\-#]*(bank\s+)?guarantee\s*(format|proforma|form)?\s*$/im,                                 label: "Guarantee format"        },
            { re: /^[\s\*\-#]*rate\s+(schedule|card|list)\s*$/im,                                                   label: "Rate schedule"           },
            { re: /^[\s\*\-#]*bill\s+of\s+quantities?\s*$/im,                                                      label: "BOQ"                     },
            { re: /^[\s\*\-#]*performance\s+(security|guarantee)\s*(format|form|proforma)?\s*$/im,                  label: "Performance guarantee"   },
            { re: /^[\s\*\-#]*no\s+claim\s+certificate\s*$/im,                                                      label: "No claim certificate"    },
            { re: /^[\s\*\-#]*integrity\s+pact\s*$/im,                                                              label: "Integrity pact"          },
            { re: /^[\s\*\-#]*(experience|eligibility)\s+certificate\s*$/im,                                        label: "Experience certificate"  },
        ]

        for (const { re, label } of structuralHeaders)
        {
            if (re.test(text))
            {
                score += 3
                hits.push(label)
            }
        }

        const contextualSignals = [
            { re: /proforma\s+of\s+bank\s+guarantee/i,                                        label: "Bank guarantee proforma"   },
            { re: /on\s+non[- ]judicial\s+stamp\s+paper/i,                                    label: "Stamp paper reference"     },
            { re: /to\s+be\s+(filled|submitted)\s+(in\s+)?(duplicate|triplicate)/i,           label: "Submission instruction"    },
            { re: /please\s+fill\s+(in\s+)?(the\s+)?information/i,                            label: "Fill instruction"          },
            { re: /\bsignature\s+of\s+(the\s+)?(authorized|authorised|party|bidder)\b/i,      label: "Signature line"            },
            { re: /\bbank.?s?\s+stamp\b/i,                                                     label: "Bank stamp field"          },
            { re: /\bseal\s*[&and]+\s*signature\b/i,                                          label: "Seal and signature"        },
            { re: /\brtgs\s*[\/\\]\s*ifsc\s*(code)?\b/i,                                      label: "RTGS/IFSC field"           },
            { re: /\baccount\s+(type|number|no\.?)\b/i,                                        label: "Bank account fields"       },
            { re: /\bmicr\s+(no|code|number)\.?\b/i,                                          label: "MICR field"                },
            { re: /\bpan\s*(no\.?|number|card)?\b/i,                                          label: "PAN field"                 },
            { re: /\bgstin?\s*(no\.?|number|registration)?\s*[:/]/i,                          label: "GST number field"          },
            { re: /\(to\s+be\s+filled\s+(up\s+)?by\s+(the\s+)?(bidder|contractor|vendor)\)/i, label: "Bidder fill instruction"  },
            { re: /hereby\s+(certify|declare|undertake|confirm|state)\s+that/i,                label: "Declaration phrasing"      },
            { re: /m\/s\.?\s*[-_\.…]{4,}/i,                                                   label: "M/s blank"                 },
            { re: /rs\.?\s*[-_\.…]{4,}/i,                                                     label: "Rs blank"                  },
            { re: /(tender|rfq|nit|enquiry)\s*(no\.?|number)?\s*[:\-]\s*[-_\.…\s]{3,}/i,     label: "Tender no field"           },
            { re: /work\s+order\s*(no\.?|number)?\s*[:\-]\s*[-_\.…\s]{3,}/i,                 label: "Work order no field"       },
            { re: /\bdated?\s*[:\-]?\s*[-_\.…]{4,}/i,                                         label: "Date blank"                },
            { re: /authoris?ed?\s+signatory/i,                                                 label: "Authorised signatory"      },
            { re: /duly\s+signed\s+and\s+sealed/i,                                            label: "Signed and sealed"         },
            { re: /yours\s+(faithfully|truly|sincerely)/i,                                     label: "Letter closing"            },
            { re: /\bitem\s+(no\.?|code)\s*[:\-]?\s*\d/i,                                     label: "Item code row"             },
            { re: /sl\.?\s*no\.?\s+(description|particulars)\s+of\s+(work|items?)/i,          label: "BOQ table header"          },
            { re: /rate\s+per\s+(manday|man.day|unit|day|month|hour|sq\.?\s*ft|rm)/i,         label: "Rate field"                },
            { re: /minimum\s+wages?\s*(rate|schedule)?/i,                                      label: "Wage rate field"           },
            { re: /\bepf?\s*(employer.?s?\s+contribution|@\s*\d+%)/i,                         label: "PF contribution field"     },
            { re: /\besic?\s*(@\s*\d+%|contribution)/i,                                       label: "ESIC field"                },
            { re: /\bbonus\s*(@\s*\d+%|as\s+per)/i,                                           label: "Bonus field"               },
            { re: /\bedli\b/i,                                                                 label: "EDLI field"                },
            { re: /contractor.?s?\s*(premium|profit|margin|service\s+charge)/i,               label: "Contractor premium field"  },
            { re: /validity\s+(period|date|upto|till)\b/i,                                     label: "Validity field"            },
            { re: /\bguarantor\b/i,                                                            label: "Guarantor field"           },
            { re: /beneficiary\s+(name|address|bank)/i,                                        label: "Beneficiary field"         },
            { re: /sfms\b/i,                                                                   label: "SFMS field"                },
            { re: /\bifsc\s+code\b/i,                                                          label: "IFSC field"                },
            { re: /stamp\s+duty\b/i,                                                           label: "Stamp duty field"          },
            { re: /notary\b/i,                                                                 label: "Notary field"              },
            { re: /\budyam\b/i,                                                                label: "UDYAM field"               },
            { re: /\buam\s*(no\.?|number|registration)?\b/i,                                  label: "UAM field"                 },
            { re: /\bdin\s+(no\.?|number)?\b/i,                                               label: "DIN field"                 },
            { re: /\bcin\s+(no\.?|number)?\b/i,                                               label: "CIN field"                 },
        ]

        for (const { re, label } of contextualSignals)
        {
            if (re.test(text))
            {
                score += 1
                hits.push(label)
            }
        }

        const denseBlankCount = (text.match(/_{4,}|\.{5,}|…{2,}/g) || []).length
        if (denseBlankCount >= 4)
        {
            score += 2
            hits.push("Dense blank fields")
        }

        const tableRowCount = (text.match(/\|[^\|]+\|[^\|]+\|/g) || []).length
        if (tableRowCount >= 3)
        {
            score += 1
            hits.push("Table structure")
        }

        const repeatedDashLines = (text.match(/^[-–]{5,}\s*$/gm) || []).length
        if (repeatedDashLines >= 2)
        {
            score += 1
            hits.push("Repeated dash lines")
        }

        return { score, hits }
    }

    function extractLabel(text, hits)
    {
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 3 && l.length < 150)

        const headerCandidates = lines.filter(line =>
            /annexure|appendix|schedule|enclosure|proforma|performa|declaration|undertaking|mandate|affidavit|certificate|bond|format|price\s*bid|financial\s*bid|rate\s*(schedule|card)|integrity\s*pact/i.test(line) &&
            line.length < 100
        )

        if (headerCandidates.length > 0)
        {
            return headerCandidates.slice(0, 2).join(" | ")
        }

        if (hits.length > 0)
        {
            return hits[0]
        }

        return "Form/Annexure"
    }

    const segments = extractedText.split(/\[Page\s+(\d+)\]/gi)

    if (segments.length <= 1)
    {
        console.warn("⚠️ buildFormPageBlock → no [Page N] markers found in text — cannot split into pages")
        return ""
    }

    const formPageMap    = {}
    const pageContentMap = {}
    const pageFieldCount = {}

    for (let i = 1; i < segments.length; i += 2)
    {
        const pageNum     = parseInt(segments[i], 10)
        const pageContent = segments[i + 1] || ""

        if (!pageContent.trim())
        {
            continue
        }

        pageContentMap[pageNum] = pageContent

        const { score, hits } = scorePageForForm(pageContent)

        if (score >= THRESHOLD)
        {
            const label            = extractLabel(pageContent, hits)
            formPageMap[pageNum]   = [label, ...hits.slice(0, 3)]
            pageFieldCount[pageNum] = countFieldsOnPage(pageContent)
        }
    }

    const totalPages   = Object.keys(pageContentMap).length
    const flaggedPages = Object.keys(formPageMap).length

    console.log(`🔍 buildFormPageBlock → ${totalPages} pages scored | ${flaggedPages} flagged → [${Object.keys(formPageMap).join(", ")}]`)

    if (flaggedPages === 0)
    {
        console.warn("⚠️ buildFormPageBlock → no form pages detected — formPageBlock will be empty")
        return ""
    }

    const sortedPages = Object.keys(formPageMap).map(Number).sort((a, b) => a - b)

    const outputLines = []

    outputLines.push("FORM PAGE MAP — PRE-DETECTED (MANDATORY):")
    outputLines.push("These pages were confirmed to contain forms, annexures, declarations,")
    outputLines.push("proformas, or fillable content via automated scan.")
    outputLines.push("You MUST process EVERY page listed below using the 7-step field")
    outputLines.push("extraction sequence. Do NOT skip any of these pages.")
    outputLines.push("These detections take priority over your own form discovery.")
    outputLines.push("")
    outputLines.push("FIELD COUNT CONSTRAINTS (HARD MINIMUM — NON-NEGOTIABLE):")
    outputLines.push("Each page below has a machine-counted minimum field count.")
    outputLines.push("Your fields array for that page MUST contain AT LEAST this many entries.")
    outputLines.push("If your count is lower, you have missed fields. Go back and find them.")
    outputLines.push("")

    for (const pageNum of sortedPages)
    {
        const labels     = formPageMap[pageNum].join(" | ")
        const fieldCount = pageFieldCount[pageNum]
        outputLines.push(`Page ${pageNum}: ${labels} | MIN_FIELDS: ${fieldCount.total} (${fieldCount.breakdown})`)
    }

    outputLines.push("")
    outputLines.push("ISOLATED PAGE CONTENT FOR ALL DETECTED FORM PAGES:")
    outputLines.push("Use the raw text below as your primary source when extracting fields.")
    outputLines.push("Read every word on each page.")
    outputLines.push("Every dash sequence (---), dotted line (......), underscore sequence (___),")
    outputLines.push("ellipsis sequence (……), or any blank placeholder embedded in a sentence")
    outputLines.push("or paragraph = one field entry. Do not collapse multiple blanks into one field.")
    outputLines.push("For tables: every row that accepts input = one field entry per input cell.")
    outputLines.push("For BG proformas: every M/s.--, Rs.--, dated--, valid upto-- = separate field entries.")
    outputLines.push("")

    for (const pageNum of sortedPages)
    {
        const labels     = formPageMap[pageNum].join(", ")
        const fieldCount = pageFieldCount[pageNum]

        outputLines.push(`--- PAGE ${pageNum} [${labels}] ---`)
        outputLines.push(`⚠ MACHINE COUNT: This page has at least ${fieldCount.total} input fields. Your fields array must have AT LEAST ${fieldCount.total} entries for this page. Breakdown: ${fieldCount.breakdown}`)
        outputLines.push(pageContentMap[pageNum].trim())
        outputLines.push(`--- END PAGE ${pageNum} ---`)
        outputLines.push("")
    }

    return outputLines.join("\n")
}

async function analyzeTenderPDF(tenderPdfPaths, tenderRules, maxRetries = 3, onChunk = null)
{
    const filesArray      = Array.isArray(tenderPdfPaths) ? tenderPdfPaths : [tenderPdfPaths];
    const tenderRulesJson = typeof tenderRules === "string" ? tenderRules : JSON.stringify(tenderRules, null, 2);
    const systemPrompt    = prompter.getTenderAnalysisPrompt(tenderRulesJson);

    for (let attempt = 0; attempt < maxRetries; attempt++)
    {
        try
        {
            const t0 = Date.now();
            console.log(`   Attempt ${attempt + 1}/${maxRetries}...`);

            const raw = await AI.runGemini2({
                messages: [{
                    role:    "user",
                    content: `Analyze the attached tender documents and output JSON. Combine all files as parts of a single tender.`
                }],
                files:        filesArray,
                systemPrompt: SYSTEM_MESSAGE + "\n\n" + systemPrompt,
                modelName:    "gemini-2.5-flash-lite",
                streaming:    true,
                jsonMode:     false,
                temperature:  0,
                onChunk
            });

            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            console.log(`   ✅ Response in ${elapsed}s`);

            const clean  = cleanJsonResponse(raw);
            const parsed = JSON.parse(clean);

            return {
                status:      "success",
                data:        parsed,
                tenderFiles: filesArray,
                timestamp:   new Date().toISOString()
            };
        }
        catch (err)
        {
            console.warn(`⚠️ Error: ${err.message}`);

            if (attempt < maxRetries - 1)
            {
                const waitMs = 1000 + (attempt * 500);
                console.log(`⏳ Retry in ${waitMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }

    throw new Error(`Failed after ${maxRetries} attempts`);
}

async function analyzeTenderPDF2(tenderPdfPaths, maxRetries = 3, onChunk = null, language = "English", companyIndex = null, profilePath = null)
{
    const filesArray  = Array.isArray(tenderPdfPaths) ? tenderPdfPaths : [tenderPdfPaths];
    const pdfFiles    = filesArray.filter(f => path.extname(f).toLowerCase() === ".pdf");
    const nonPdfFiles = filesArray.filter(f => path.extname(f).toLowerCase() !== ".pdf");

    const seenHashes     = new Set();
    const extractedParts = [];
    let   totalChars     = 0;

    for (const pdfPath of pdfFiles)
    {
        try
        {
            console.log(`📄 Extracting text: ${path.basename(pdfPath)}`);
            const result = await extractText(pdfPath);

            if (result)
            {
                const hash = crypto.createHash("sha256").update(result).digest("hex");

                if (seenHashes.has(hash))
                {
                    console.log(`⚠️ Duplicate content skipped: ${path.basename(pdfPath)}`);
                    continue;
                }

                seenHashes.add(hash);
                extractedParts.push(`=== TENDER DOCUMENT: ${path.basename(pdfPath)} ===\n\n${result}\n\n=== END ===`);
                totalChars += result.length;
                console.log(`✅ Extracted ${result.length.toLocaleString()} chars from ${path.basename(pdfPath)}`);
            }
            else
            {
                console.warn(`⚠️ No text extracted from ${path.basename(pdfPath)} — falling back to file upload`);
                nonPdfFiles.push(pdfPath);
            }
        }
        catch (err)
        {
            console.warn(`⚠️ Extraction failed for ${path.basename(pdfPath)}: ${err.message} — falling back to file upload`);
            nonPdfFiles.push(pdfPath);
        }
    }

    const dedupedNonPdfFiles = [];

    for (const filePath of nonPdfFiles)
    {
        try
        {
            const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

            if (seenHashes.has(hash))
            {
                console.log(`⚠️ Duplicate file skipped: ${path.basename(filePath)}`);
                continue;
            }

            seenHashes.add(hash);
            dedupedNonPdfFiles.push(filePath);
        }
        catch (err)
        {
            console.warn(`⚠️ Could not hash ${path.basename(filePath)}: ${err.message} — keeping it`);
            dedupedNonPdfFiles.push(filePath);
        }
    }

    console.log(`📊 Total extracted: ${totalChars.toLocaleString()} chars across ${extractedParts.length} PDF(s)`);

    const totalPages   = Math.max(Math.round(totalChars / 1500), 1);
    const expectedReqs = totalPages <= 5  ? 10
                       : totalPages <= 10 ? 12
                       : totalPages <= 20 ? 14
                       : totalPages <= 40 ? 16
                       : totalPages <= 60 ? 18
                       : 20;

    console.log(`📊 Estimated pages: ${totalPages} → expected requirements: ${expectedReqs}`);

    const textBlock   = extractedParts.join("\n\n");
    const userMessage = textBlock
        ? `${textBlock}\n\n---\nDocument stats: ${extractedParts.length} file(s), ~${totalPages} pages, ~${totalChars.toLocaleString()} characters, minimum ${expectedReqs} expected requirements.\n\nBegin Phase 1. Output JSON only.`
        : `Analyze the attached tender documents. Begin Phase 1. Output JSON only.`;

    for (let attempt = 0; attempt < maxRetries; attempt++)
    {
        try
        {
            const t0 = Date.now();
            console.log(`   Attempt ${attempt + 1}/${maxRetries}...`);

            const raw = await AI.runGemini2({
                messages: [{
                    role:    "user",
                    content: userMessage
                }],
                files:        dedupedNonPdfFiles,
                systemPrompt: SYSTEM_MESSAGE + "\n\n" + prompter.getTenderAnalysisPrompt2(language),
                modelName:    "gemini-3.1-flash-lite",
                streaming:    true,
                jsonMode:     false,
                temperature:  0,
                onChunk,
                thinkingBudget:    3000,
                cachedContentName: null
            });

            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            console.log(`✅ Response in ${elapsed}s`);

            const clean  = cleanJsonResponse(raw);
            const parsed = JSON.parse(clean);

            console.log(`📋 Requirements extracted: ${parsed?.requirements?.length || 0} (expected was ${expectedReqs})`);

            return {
                status:      "success",
                data:        parsed,
                tenderFiles: filesArray,
                tenderText: textBlock,
                timestamp:   new Date().toISOString(),
            };
        }
        catch (err)
        {
            console.warn(`⚠️ Error: ${err.message}`);

            if (attempt < maxRetries - 1)
            {
                const waitMs = 1000 + (attempt * 500);
                console.log(`⏳ Retry in ${waitMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }

    throw new Error(`Failed after ${maxRetries} attempts`);
}

async function analyzeAnnexures(tenderPdfPaths, companyProfilePaths, maxRetries = 3, onChunk = null, language = "English")
{
    const tenderFilesArray  = Array.isArray(tenderPdfPaths)      ? tenderPdfPaths      : [tenderPdfPaths];
    const profileFilesArray = Array.isArray(companyProfilePaths) ? companyProfilePaths : (companyProfilePaths ? [companyProfilePaths] : []);
    const systemPrompt      = prompter.getTenderAnnexurePrompt(language);

    const pdfFiles    = tenderFilesArray.filter(f => path.extname(f).toLowerCase() === ".pdf");
    const nonPdfFiles = tenderFilesArray.filter(f => path.extname(f).toLowerCase() !== ".pdf");

    const seenHashes     = new Set();
    const extractedParts = [];
    let   totalChars     = 0;

    for (const pdfPath of pdfFiles)
    {
        try
        {
            console.log(`📄 Extracting text for annexures: ${path.basename(pdfPath)}`);
            const result = await extractText(pdfPath);

            if (result)
            {
                const hash = crypto.createHash("sha256").update(result).digest("hex");

                if (seenHashes.has(hash))
                {
                    console.log(`⚠️ Duplicate content skipped: ${path.basename(pdfPath)}`);
                    continue;
                }

                seenHashes.add(hash);
                extractedParts.push(`=== TENDER DOCUMENT: ${path.basename(pdfPath)} ===\n\n${result}\n\n=== END ===`);
                totalChars += result.length;
                console.log(`✅ Extracted ${result.length.toLocaleString()} chars from ${path.basename(pdfPath)}`);
            }
            else
            {
                console.warn(`⚠️ No text extracted from ${path.basename(pdfPath)} — falling back to file upload`);
                nonPdfFiles.push(pdfPath);
            }
        }
        catch (err)
        {
            console.warn(`⚠️ Extraction failed for ${path.basename(pdfPath)}: ${err.message} — falling back to file upload`);
            nonPdfFiles.push(pdfPath);
        }
    }

    const dedupedNonPdfFiles = [];

    for (const filePath of nonPdfFiles)
    {
        try
        {
            const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

            if (seenHashes.has(hash))
            {
                console.log(`⚠️ Duplicate file skipped: ${path.basename(filePath)}`);
                continue;
            }

            seenHashes.add(hash);
            dedupedNonPdfFiles.push(filePath);
        }
        catch (err)
        {
            console.warn(`⚠️ Could not hash ${path.basename(filePath)}: ${err.message} — keeping it`);
            dedupedNonPdfFiles.push(filePath);
        }
    }

    console.log(`📊 Annexure pass — ${totalChars.toLocaleString()} chars across ${extractedParts.length} PDF(s)`);

    const textBlock   = extractedParts.join("\n\n");
    const attachments = [...dedupedNonPdfFiles, ...profileFilesArray];

    const userMessage = textBlock
        ? `${textBlock}\n\n---\n\nThe above is the complete extracted text of the tender document(s). The company profile is attached separately.\n\nYour task: find EVERY annexure, appendix, declaration, BG proforma, mandate form, rate schedule, and fillable form present in the tender text above. Pre-fill each field to the maximum extent possible from the tender text and the company profile. Output JSON only.`
        : `The tender document(s) and company profile are attached. Find every annexure, appendix, declaration, BG proforma, mandate form, rate schedule, and fillable form. Pre-fill each field to the maximum extent possible. Output JSON only.`;

    for (let attempt = 0; attempt < maxRetries; attempt++)
    {
        try
        {
            const t0 = Date.now();
            console.log(`   Annexure attempt ${attempt + 1}/${maxRetries}...`);

            const raw = await AI.runGemini2({
                messages: [{
                    role:    "user",
                    content: userMessage
                }],
                files:        attachments,
                systemPrompt: SYSTEM_MESSAGE + "\n\n" + systemPrompt,
                modelName:    "gemini-3.1-flash-lite",
                streaming:    true,
                jsonMode:     false,
                temperature:  0,
                onChunk,
                thinkingBudget: 8000
            });

            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            console.log(`✅ Annexure response in ${elapsed}s`);

            const clean  = cleanJsonResponse(raw);
            const parsed = JSON.parse(clean);

            console.log(`📋 Forms extracted: ${parsed?.forms?.length || 0}`);

            return {
                status:      "success",
                data:        parsed,
                tenderFiles: tenderFilesArray,
                timestamp:   new Date().toISOString()
            };
        }
        catch (err)
        {
            console.warn(`⚠️ Annexure error: ${err.message}`);

            if (attempt < maxRetries - 1)
            {
                const waitMs = 1000 + (attempt * 500);
                console.log(`⏳ Retry in ${waitMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }

    throw new Error(`Annexure analysis failed after ${maxRetries} attempts`);
}

async function analyzeTenderDeepDive(tenderPdfPaths, companyProfilePaths, existingRequirements = [], hasAnnexures = false, maxRetries = 3, onChunk = null, language = "English", companyIndex = null, profilePath = null)
{
    const tenderFilesArray  = Array.isArray(tenderPdfPaths)      ? tenderPdfPaths      : [tenderPdfPaths];
    const profileFilesArray = Array.isArray(companyProfilePaths) ? companyProfilePaths : (companyProfilePaths ? [companyProfilePaths] : []);

    const pdfFiles    = tenderFilesArray.filter(f => path.extname(f).toLowerCase() === ".pdf");
    const nonPdfFiles = tenderFilesArray.filter(f => path.extname(f).toLowerCase() !== ".pdf");

    const seenHashes     = new Set();
    const extractedParts = [];
    let   totalChars     = 0;
    let   formPageBlock  = "";

    for (const pdfPath of pdfFiles)
    {
        try
        {
            console.log(`📄 Extracting text for deep dive: ${path.basename(pdfPath)}`);
            const result = await extractText(pdfPath, true);

            if (result)
            {
                const hash = crypto.createHash("sha256").update(result).digest("hex");

                if (seenHashes.has(hash))
                {
                    console.log(`⚠️ Duplicate content skipped: ${path.basename(pdfPath)}`);
                    continue;
                }

                seenHashes.add(hash);

                const block = buildFormPageBlock(result);
                if (block) formPageBlock += (formPageBlock ? "\n\n" : "") + block;

                extractedParts.push(`=== TENDER DOCUMENT: ${path.basename(pdfPath)} ===\n\n${result}\n\n=== END ===`);
                totalChars += result.length;
                console.log(`✅ Extracted ${result.length.toLocaleString()} chars from ${path.basename(pdfPath)} | formPageBlock: ${block ? "yes" : "none"}`);
            }
            else
            {
                console.warn(`⚠️ No text extracted from ${path.basename(pdfPath)} — falling back to file upload`);
                nonPdfFiles.push(pdfPath);
            }
        }
        catch (err)
        {
            console.warn(`⚠️ Extraction failed for ${path.basename(pdfPath)}: ${err.message} — falling back to file upload`);
            nonPdfFiles.push(pdfPath);
        }
    }

    const dedupedNonPdfFiles = [];

    for (const filePath of nonPdfFiles)
    {
        try
        {
            const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

            if (seenHashes.has(hash))
            {
                console.log(`⚠️ Duplicate file skipped: ${path.basename(filePath)}`);
                continue;
            }

            seenHashes.add(hash);
            dedupedNonPdfFiles.push(filePath);
        }
        catch (err)
        {
            console.warn(`⚠️ Could not hash ${path.basename(filePath)}: ${err.message} — keeping it`);
            dedupedNonPdfFiles.push(filePath);
        }
    }

    console.log(`📊 Deep dive pass — ${totalChars.toLocaleString()} chars across ${extractedParts.length} PDF(s) | hasAnnexures: ${hasAnnexures} | existingRequirements: ${existingRequirements.length}`);

    const attachments = [...dedupedNonPdfFiles, ...profileFilesArray];
    const textBlock   = extractedParts.join("\n\n");

    const jobDescription = hasAnnexures
        ? `1. Find any requirements missed in the first pass and return them in "missedRequirements".\n2. Match the best company work orders to each experience requirement and return them in "workOrderMatches".\n3. Find every annexure, form, declaration, BG proforma, mandate form, rate schedule, and fillable form in the tender — pre-fill each field to the maximum extent possible from the tender text and company profile — and return them in "forms".`
        : `1. Find any requirements missed in the first pass and return them in "missedRequirements".\n2. Match the best company work orders to each experience requirement and return them in "workOrderMatches".`;

    const userMessage = textBlock
        ? `${textBlock}\n\n---\n\nThe above is the complete extracted text of the tender document(s). The company profile is attached separately.\n\nYour task has ${hasAnnexures ? "three" : "two"} jobs:\n${jobDescription}\n\nOutput valid JSON only.${formPageBlock ? "\n\n---\n\n" + formPageBlock : ""}`
        : `The tender document(s) and company profile are attached.\n\nYour task has ${hasAnnexures ? "three" : "two"} jobs:\n${jobDescription}\n\nOutput valid JSON only.${formPageBlock ? "\n\n---\n\n" + formPageBlock : ""}`;

    const systemPrompt = SYSTEM_MESSAGE + "\n\n" + prompter.getTenderDeepDivePrompt(existingRequirements, hasAnnexures, language);

    for (let attempt = 0; attempt < maxRetries; attempt++)
    {
        try
        {
            const t0 = Date.now();
            console.log(`   Deep dive attempt ${attempt + 1}/${maxRetries}...`);

            const raw = await AI.runGemini2({
                messages: [{
                    role:    "user",
                    content: userMessage
                }],
                files:             attachments,
                systemPrompt:      systemPrompt,
                modelName:         "gemini-3.1-flash-lite",
                streaming:         true,
                jsonMode:          false,
                temperature:       0,
                onChunk,
                thinkingBudget:    6000,
                cachedContentName: null
            });

            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            console.log(`✅ Deep dive response in ${elapsed}s`);

            const clean  = cleanJsonResponse(raw);
            const parsed = JSON.parse(clean);

            console.log(`📋 Missed requirements: ${parsed?.missedRequirements?.length || 0}`);
            console.log(`🎯 Work order matches:  ${parsed?.workOrderMatches?.length  || 0}`);

            if (hasAnnexures)
            {
                console.log(`📝 Forms extracted: ${parsed?.forms?.length || 0}`);
            }

            return {
                status:      "success",
                data:        parsed,
                tenderFiles: tenderFilesArray,
                timestamp:   new Date().toISOString()
            };
        }
        catch (err)
        {
            console.warn(`⚠️ Deep dive error: ${err.message}`);

            if (attempt < maxRetries - 1)
            {
                const waitMs = 1000 + (attempt * 500);
                console.log(`⏳ Retry in ${waitMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }

    throw new Error(`Deep dive analysis failed after ${maxRetries} attempts`);
}

async function batchAnalyzeTenders(tenderPdfPaths, companyProfile, options = {})
{
    const { maxRetries = 2, concurrency = 1, delayBetweenBatches = 1000 } = options;

    if (!Array.isArray(tenderPdfPaths) || tenderPdfPaths.length === 0)
    {
        throw new Error("tenderPdfPaths must be a non-empty array");
    }

    console.log(`\n📊 Batch: ${tenderPdfPaths.length} tenders (concurrency: ${concurrency})\n`);

    const results = [];

    for (let batchStart = 0; batchStart < tenderPdfPaths.length; batchStart += concurrency)
    {
        const batchEnd = Math.min(batchStart + concurrency, tenderPdfPaths.length);
        const batch    = tenderPdfPaths.slice(batchStart, batchEnd);

        console.log(`[Batch ${Math.floor(batchStart / concurrency) + 1}] ${batch.length} tenders\n`);

        const batchPromises = batch.map((batchPath, idx) =>
            analyzeTenderPDF(batchPath, companyProfile, maxRetries)
                .then(result =>
                {
                    console.log(`   [${batchStart + idx + 1}/${tenderPdfPaths.length}] ✅`);
                    return result;
                })
                .catch(err =>
                {
                    console.error(`   [${batchStart + idx + 1}/${tenderPdfPaths.length}] ❌ ${err.message}`);
                    return {
                        status:      "error",
                        error:       err.message,
                        tenderFile:  batchPath,
                        timestamp:   new Date().toISOString()
                    };
                })
        );

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        if (batchEnd < tenderPdfPaths.length)
        {
            console.log(`\n⏳ Waiting ${delayBetweenBatches}ms before next batch...\n`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
    }

    const successful = results.filter(r => r.status === "success").length;
    const failed     = results.filter(r => r.status === "error").length;

    console.log(`\n📊 Complete: ${successful} success, ${failed} failed\n`);

    return {
        results,
        summary:
        {
            total:       results.length,
            successful,
            failed,
            successRate: ((successful / results.length) * 100).toFixed(1) + "%",
            timestamp:   new Date().toISOString()
        }
    };
}

async function analyzeTenderEnhance(tenderPdfPaths, companyProfilePaths, documentsFilePaths, maxRetries = 3, onChunk = null, language = "English")
{
    const tenderFilesArray    = Array.isArray(tenderPdfPaths)      ? tenderPdfPaths      : [tenderPdfPaths];
    const profileFilesArray   = Array.isArray(companyProfilePaths) ? companyProfilePaths : (companyProfilePaths ? [companyProfilePaths] : []);
    const documentsFilesArray = Array.isArray(documentsFilePaths)  ? documentsFilePaths  : (documentsFilePaths ? [documentsFilePaths] : []);

    const pdfFiles    = tenderFilesArray.filter(f => path.extname(f).toLowerCase() === ".pdf");
    const nonPdfFiles = tenderFilesArray.filter(f => path.extname(f).toLowerCase() !== ".pdf");

    const seenHashes     = new Set();
    const extractedParts = [];
    let   totalChars     = 0;

    for (const pdfPath of pdfFiles)
    {
        try
        {
            console.log(`📄 Extracting text for enhance: ${path.basename(pdfPath)}`);
            const result = await extractText(pdfPath, true);

            if (result)
            {
                const hash = crypto.createHash("sha256").update(result).digest("hex");

                if (seenHashes.has(hash))
                {
                    console.log(`⚠️ Duplicate content skipped: ${path.basename(pdfPath)}`);
                    continue;
                }

                seenHashes.add(hash);
                extractedParts.push(`=== TENDER DOCUMENT: ${path.basename(pdfPath)} ===\n\n${result}\n\n=== END ===`);
                totalChars += result.length;
                console.log(`✅ Extracted ${result.length.toLocaleString()} chars from ${path.basename(pdfPath)}`);
            }
            else
            {
                console.warn(`⚠️ No text extracted from ${path.basename(pdfPath)} — falling back to file upload`);
                nonPdfFiles.push(pdfPath);
            }
        }
        catch (err)
        {
            console.warn(`⚠️ Extraction failed for ${path.basename(pdfPath)}: ${err.message} — falling back to file upload`);
            nonPdfFiles.push(pdfPath);
        }
    }

    const dedupedNonPdfFiles = [];

    for (const filePath of nonPdfFiles)
    {
        try
        {
            const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

            if (seenHashes.has(hash))
            {
                console.log(`⚠️ Duplicate file skipped: ${path.basename(filePath)}`);
                continue;
            }

            seenHashes.add(hash);
            dedupedNonPdfFiles.push(filePath);
        }
        catch (err)
        {
            console.warn(`⚠️ Could not hash ${path.basename(filePath)}: ${err.message} — keeping it`);
            dedupedNonPdfFiles.push(filePath);
        }
    }

    console.log(`📊 Enhance pass — ${totalChars.toLocaleString()} chars across ${extractedParts.length} PDF(s)`);

    const attachments = [...dedupedNonPdfFiles, ...profileFilesArray, ...documentsFilesArray];
    const textBlock   = extractedParts.join("\n\n");

    const userMessage = textBlock
        ? `${textBlock}\n\n---\n\nThe above is the complete extracted text of the tender document(s). The company profile and document inventory are attached separately.\n\nBegin Phase 0. Output valid JSON only.`
        : `The tender document(s), company profile and document inventory are attached.\n\nBegin Phase 0. Output valid JSON only.`;

    for (let attempt = 0; attempt < maxRetries; attempt++)
    {
        try
        {
            const t0 = Date.now();
            console.log(`   Enhance attempt ${attempt + 1}/${maxRetries}...`);

            const raw = await AI.runGemini2({
                messages:     [{ role: "user", content: userMessage }],
                files:        attachments,
                systemPrompt: SYSTEM_MESSAGE + "\n\n" + prompter.getTenderEnhancePrompt(language),
                modelName:    "gemini-3.1-flash-lite",
                streaming:    true,
                jsonMode:     false,
                temperature:  0,
                onChunk,
                thinkingBudget:    4000,
                cachedContentName: null
            });

            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            console.log(`✅ Enhance response in ${elapsed}s`);

            const clean  = cleanJsonResponse(raw);
            const parsed = JSON.parse(clean);

            console.log(`📋 Documents found:          ${parsed?.documents?.length         || 0}`);
            console.log(`📝 Composed docs generated:  ${parsed?.composedDocuments?.length || 0}`);

            return {
                status:      "success",
                data:        parsed,
                tenderFiles: tenderFilesArray,
                timestamp:   new Date().toISOString()
            };
        }
        catch (err)
        {
            console.warn(`⚠️ Enhance error: ${err.message}`);

            if (attempt < maxRetries - 1)
            {
                const waitMs = 1000 + (attempt * 500);
                console.log(`⏳ Retry in ${waitMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }

    throw new Error(`Enhance analysis failed after ${maxRetries} attempts`);
}

function getTenderDecision(result)
{
    if (result.status !== "success")
    {
        return {
            status: "error",
            error:  result.error
        };
    }

    const { tender, eligible, reasonsForEligibility, reasonsForNotEligible, requirements, summary } = result.data;

    return {
        tenderId:             tender.referenceNumber || "N/A",
        tenderName:           tender.title           || "N/A",
        estimatedValue:       tender.estimatedValue  || "N/A",
        bidDeadline:          tender.bidDeadline     || "N/A",
        location:             tender.location        || "N/A",
        eligible,
        reasonsForCount:      (reasonsForEligibility  || []).length,
        reasonsAgainstCount:  (reasonsForNotEligible  || []).length,
        requirementCount:     (requirements            || []).length,
        summaryLength:        (summary                 || "").length,
        reasonsForEligibility: reasonsForEligibility  || [],
        reasonsForNotEligible: reasonsForNotEligible  || [],
        requirements:          requirements            || []
    };
}

function rankTendersByViability(results)
{
    return results
        .filter(r => r.status === "success")
        .map(r => getTenderDecision(r))
        .filter(d => d.status !== "error")
        .sort((a, b) => b.eligible - a.eligible);
}

function exportToCSV(results)
{
    const escape = (str) => `"${String(str).replace(/"/g, "\"\"")}"`;

    const rows = results
        .filter(r => r.status === "success")
        .map(result =>
        {
            const d = getTenderDecision(result);
            if (d.status === "error") return null;

            return [
                escape(d.tenderId),
                escape(d.tenderName),
                escape(d.estimatedValue),
                escape(d.bidDeadline),
                d.eligible ? "YES" : "NO",
                d.reasonsForCount,
                d.reasonsAgainstCount,
                d.requirementCount
            ].join(",");
        })
        .filter(Boolean);

    const header = "Tender ID,Tender Name,Estimated Value,Bid Deadline,Eligible,Reasons For,Reasons Against,Requirements\n";
    return header + rows.join("\n");
}

async function interpretTenderQuery(userMessage, conversationHistory = [])
{
    const { systemPrompt, messages, model } = prompter.getQueryInterpreterPrompt(userMessage, conversationHistory);

    while(true)
    {
        try
        {
            const start    = Date.now();
            const response = await AI.run({ messages, systemPrompt, modelName: model, streaming: false, jsonMode: true });
            console.log(`Query interpreter responded in ${((Date.now() - start) / 1000).toFixed(2)}s`);

            const clean  = cleanJsonResponse(response);
            const result = JSON.parse(clean);

            if(typeof result.statement === "string" && typeof result.needsCompanyData === "boolean" && typeof result.needsTenderData === "boolean")
            {
                return result;
            }

            console.warn("⚠️  interpretTenderQuery: invalid shape, retrying...");
        }
        catch(err)
        {
            console.warn("⚠️  interpretTenderQuery: parse failed, retrying...", err.message);
        }
    }
}

async function getTenderChatResponse(userMessage, statement, companyChunks = [], tenderChunks = [], conversationHistory = [], language = "English")
{
    const { systemPrompt, messages, model } = prompter.getMainTenderChatPrompt(userMessage, statement, companyChunks, tenderChunks, conversationHistory, language);

    while(true)
    {
        try
        {
            const start    = Date.now();
            const response = await AI.run({ messages, systemPrompt, modelName: model, streaming: false, jsonMode: true });
            console.log(`Tender chat responded in ${((Date.now() - start) / 1000).toFixed(2)}s`);

            const clean  = cleanJsonResponse(response);
            const result = JSON.parse(clean);

            if(typeof result.content === "string" && result.content.trim().length > 0)
            {
                return result;
            }

            console.warn("⚠️  getTenderChatResponse: invalid shape, retrying...");
        }
        catch(err)
        {
            console.warn("⚠️  getTenderChatResponse: parse failed, retrying...", err.message);
        }
    }
}

async function crossCheckRequirements(allRequirements, maxRetries = 3)
{
    const commonRaw  = fs.readFileSync(path.resolve(__dirname, "../tenderFiles/commonRequirements.json"), "utf-8");
    const common     = JSON.parse(commonRaw).filter(r => r.canBeProvided === true);

    const noRequirements = allRequirements
        .map((r, i) => ({ index: i, requirement: r.requirement }))
        .filter((_, i) => allRequirements[i].status === "No");

    if (noRequirements.length === 0)
    {
        console.log("✅ crossCheckRequirements → no No-status requirements to check");
        return allRequirements;
    }

    console.log(`🔁 crossCheckRequirements → ${noRequirements.length} No-status item(s) to cross-check against ${common.length} common requirements`);

    const prompt = prompter.getTenderCrossCheckPrompt(common, noRequirements);

    for (let attempt = 0; attempt < maxRetries; attempt++)
    {
        try
        {
            console.log(`   Cross-check attempt ${attempt + 1}/${maxRetries}...`);

            const raw   = await AI.run({ messages: [{ role: "user", content: prompt }], modelName: "gpt-oss", streaming: false });
            const clean = cleanJsonResponse(raw);
            const parsed = JSON.parse(clean);

            if (!Array.isArray(parsed.toFlip))
            {
                throw new Error("toFlip is not an array");
            }

            console.log(`✅ Cross-check done → flipping ${parsed.toFlip.length} requirement(s): [${parsed.toFlip.join(", ")}]`);

            const updated = allRequirements.map((r, i) =>
            {
                if (parsed.toFlip.includes(i))
                {
                    return { ...r, status: "Yes" };
                }
                return r;
            });

            return updated;
        }
        catch (err)
        {
            console.warn(`⚠️ Cross-check attempt ${attempt + 1} failed: ${err.message}`);

            if (attempt < maxRetries - 1)
            {
                await new Promise(resolve => setTimeout(resolve, 1000 + (attempt * 500)));
            }
        }
    }

    console.warn("⚠️ Cross-check failed after all attempts — returning requirements unchanged");
    return allRequirements;
}

module.exports = {
    analyzeTenderPDF,
    analyzeTenderPDF2,
    analyzeAnnexures,
    batchAnalyzeTenders,
    getTenderDecision,
    rankTendersByViability,
    exportToCSV,
    cleanJsonResponse,
    analyzeTenderDeepDive,
    analyzeTenderEnhance,
    interpretTenderQuery,
    getTenderChatResponse,
    crossCheckRequirements
};