const cheerio = require("cheerio");
const DB = require("../database/tenderDBFunctions");
 
function cleanText(text)
{
    if(!text)
    {
        return null;
    }

    const clean = text.replace(/\s+/g, " ").trim();
    return clean === "" ? null : clean;
}
 
function parseDate(text)
{
    if(!text)
    {
        return null;
    }

    const clean = text.replace(/\s+/g, " ").trim();
    const match = clean.match(/^(\d{2})-(\d{2})-(\d{4})$/);

    if(!match)
    {
        return null;
    }

    const [, day, month, year] = match;
    const iso = `${year}-${month}-${day}`;
    return isNaN(new Date(iso).getTime()) ? null : iso;
}
 
function parseAmount(text)
{
    if(!text)
    {
        return null;
    }

    const clean = text.replace(/INR|₹|\/\-|,/gi, "").trim();

    if(/refer|ref\./i.test(clean))
    {
        return null;
    }

    if(/crore/i.test(clean))
    {
        const num = parseFloat(clean.replace(/crore/i, "").trim());
        return isNaN(num) ? null : Math.round(num * 10000000);
    }

    if(/lakh/i.test(clean))
    {
        const num = parseFloat(clean.replace(/lakh/i, "").trim());
        return isNaN(num) ? null : Math.round(num * 100000);
    }
 
    const num = parseFloat(clean);
    return isNaN(num) ? null : Math.round(num);
}
 
function getInfoField($, label)
{
    let value = null;
    $("table.notice-info-table tr").each((i, row) =>
    {
        const cells = $(row).find("td");

        if(cells.length < 2)
        {
            return;
        }

        const key = cleanText($(cells[0]).text());

        if(key && key.toLowerCase() === label.toLowerCase())
        {
            value = cleanText($(cells[1]).text());
        }
    });
    return value;
}
 
function getTdr($)
{
    const fromHidden = cleanText($("#HDNOurrefno").val() || $("#HDNOurRefNo").val());

    if(fromHidden)
    {
        return parseInt(fromHidden) || fromHidden;
    }

    const fromTable = getInfoField($, "TDR");

    if(fromTable)
    {
        return parseInt(fromTable) || fromTable;
    }

    return null;
}
 
function getBrief($)
{
    const cell = $("td.tender-desc");

    if(!cell.length)
    {
        return null;
    }

    cell.find("span.text-danger").remove();
    return cleanText(cell.text());
}
 
function getDescription($)
{
    const card = $("h5.card-title").filter((i, el) => $(el).text().trim() === "Tender Details").first().closest(".card");

    if(!card.length)
    {
        return null;
    }

    return cleanText(card.find(".card-body p").text());
}
 
function getCorrigendums($)
{
    const card = $("h5.card-title").filter((i, el) => $(el).text().trim() === "Corrigendum Details").first().closest(".card");
    
    if(!card.length)
    {
        return null;
    }

    const results = [];
    card.find("table tbody tr").each((i, row) =>
    {
        const cells = $(row).find("td");

        if(cells.length < 5)
        {
            return;
        }
 
        const docLinks = [];
        const docCell = cells[5] ? $(cells[5]) : $(cells[cells.length - 1]);
        docCell.find("a[href]").each((j, a) =>
        {
            const href = $(a).attr("href");

            if(href)
            {
                docLinks.push(href.trim());
            }
        });
 
        results.push(
        {
            sr : parseInt(cleanText($(cells[0]).text())) || null,
            date : parseDate(cleanText($(cells[1]).text())),
            description : cleanText($(cells[2]).text()) || null,
            type : cleanText($(cells[3]).text()) || null,
            newDeadline : parseDate(cleanText($(cells[4]).text())),
            docs : docLinks.length > 0 ? docLinks : null
        });
    });
 
    return results.length > 0 ? results : null;
}
 
function getDates($)
{
    const card = $("h5.card-title").filter((i, el) => $(el).text().trim() === "Key Dates").first().closest(".card");

    const out = {};

    if(!card.length)
    {
        out.publishDate = parseDate(getInfoField($, "Publish Date"));
        out.deadline = null;
        out.openingDate = parseDate(getInfoField($, "Tender Opening Date"));
        return out;
    }
 
    card.find("table tr").each((i, row) =>
    {
        const cells = $(row).find("td");

        if(cells.length < 2)
        {
            return;
        }

        const key = cleanText($(cells[0]).text()) || "";
        const val = cleanText($(cells[1]).text());

        if(/publish date/i.test(key))
        {
            out.publishDate = parseDate(val);
        }

        if(/last date of bid submission/i.test(key))
        {
            out.deadline = parseDate(val);
        }

        if(/tender opening date/i.test(key))
        {
            out.openingDate = parseDate(val);
        }
    });
 
    return out;
}
 
function getContact($)
{
    const card = $("h5.card-title").filter((i, el) => $(el).text().trim() === "Contact Information").first().closest(".card");
    const out = {};
 
    if(!card.length)
    {
        out.company = getInfoField($, "Company Name");
        out.address = getInfoField($, "Address");
        out.pincode = getInfoField($, "Pincode");
        out.person = getInfoField($, "Contact Person");
        return out;
    }
 
    card.find("table tr").each((i, row) =>
    {
        const cells = $(row).find("td");

        if(cells.length < 2)
        {
            return;
        }
        const key = cleanText($(cells[0]).text()) || "";
        const val = cleanText($(cells[1]).text());

        if(/company name/i.test(key))
        {
            out.company = val;
        }

        if(/^address$/i.test(key))
        {
            out.address = val;
        }

        if(/pincode/i.test(key))
        {
            out.pincode = val;
        }

        if(/contact person/i.test(key))
        {
            out.person  = val;
        }
    });
 
    return out;
}
 
function getSource($)
{
    const card = $("h5.card-title").filter((i, el) => $(el).text().trim() === "Other Detail").first().closest(".card");

    if(!card.length)
    {
        return getInfoField($, "Information Source");
    }

    const link = card.find("a[href]").first();

    if(link.length)
    {
        return cleanText(link.attr("href"));
    }
    
    return getInfoField($, "Information Source");
}

function extractRealUrl(href)
{
    try
    {
        const match = href.match(/\/tenders\/DownloadDocument\/\d+\/\d+\/(.+?)\/\d+$/);

        if(match)
        {
            return decodeURIComponent(match[1]);
        }

        if(href.startsWith("http"))
        {
            return href;
        }

        return null;
    }
    catch(err)
    {
        return null;
    }
}

function getDocs($)
{
    const card = $("h5.card-title").filter((i, el) => $(el).text().trim() === "View Original Notice/Document").first().closest(".card");

    if(!card.length)
    {
        return null;
    }

    const results = [];
    
    card.find("table tbody tr").each((i, row) =>
    {
        const cells = $(row).find("td");
        
        if(cells.length < 3)
        {
            return;
        }

        const fileUrl = extractRealUrl($(cells[0]).find("a[href]").attr("href") || "");
        const name = cleanText($(cells[1]).text());
        const desc = cleanText($(cells[2]).text());

        if(fileUrl && name)
        {
            results.push(
            {
                name: name,
                url: fileUrl.trim(),
                description: desc || null
            });
        }
    });
 
    return results.length > 0 ? results : null;
}
 
function isGem(tenderNo, source)
{
    if(tenderNo && /^gem\//i.test(tenderNo))
    {
        return true;
    }

    if(source && /gem\.gov\.in/i.test(source))
    {
        return true;
    }

    return false;
}
 
function hasCorrigendum($, corrigendums)
{
    if(corrigendums && corrigendums.length > 0)
    {
        return true;
    }

    if($("td.tender-desc span.text-danger").length > 0)
    {
        return true;
    }

    return false;
}
 
async function extractTenderDetails(url, category)
{
    if(typeof url !== "string" || !url.startsWith("http"))
    {
        const payload = { 
            success: false, 
            url: String(url).slice(0, 200), 
            category, 
            error: "Invalid URL" 
        };

        console.log(JSON.stringify(payload, null, 2));
        return payload;
    }
 
    let html;
 
    try
    {
        const response = await fetch(url,
        {
            method : "GET",
            signal : AbortSignal.timeout(15000),
            headers:
            {
                "User-Agent" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language" : "en-US,en;q=0.5"
            }
        });
 
        if(!response.ok)
        {
            const payload = { 
                success: false, 
                url: url, 
                category: category, 
                error: `HTTP ${response.status}` 
            };

            console.log(JSON.stringify(payload, null, 2));
            return payload;
        }
 
        html = await response.text();
    }
    catch(err)
    {
        const payload = { 
            success: false, 
            url: url, 
            category: category, 
            error: err.message 
        };

        console.log(JSON.stringify(payload, null, 2));
        return payload;
    }
 
    const $ = cheerio.load(html);
    const tenderNo = getInfoField($, "Tender No");
    const valueRaw = getInfoField($, "Tender Value");
    const emdRaw = getInfoField($, "EMD");
    const docFeesRaw = getInfoField($, "Document Fees");
    const source = getSource($);
    const corrigendums = getCorrigendums($);
    const dates = getDates($);
    const contact = getContact($);
 
    const exemptionRaw = getInfoField($, "Exemption");
    let exemption = null;

    if(/^yes$/i.test(exemptionRaw))
    {
        exemption = true;
    }

    else if(/^no$/i.test(exemptionRaw))
    {
        exemption = false;
    }
 
    const tenderId = getInfoField($, "Tender ID");
    const tdr = getTdr($);
 
    const payload =
    {
        success : true,
        url : url,
        category : category,
        scrapedAt : new Date().toISOString(),
        tdr : tdr,
        tenderNo : tenderNo,
        tenderId : tenderId,
        authority : getInfoField($, "Tendering Authority"),
        city : getInfoField($, "City"),
        state : getInfoField($, "State"),
        brief : getBrief($),
        description : getDescription($),
        value : parseAmount(valueRaw),
        valueRaw : cleanText(valueRaw),
        emd : parseAmount(emdRaw),
        emdRaw : cleanText(emdRaw),
        docFees : parseAmount(docFeesRaw),
        docFeesRaw : cleanText(docFeesRaw),
        type : getInfoField($, "Tender Type"),
        tenderCategory : getInfoField($, "Tender Category"),
        biddingType : getInfoField($, "Bidding Type"),
        competitionType : getInfoField($, "Competition Type"),
        exemption : exemption,
        gem : isGem(tenderNo, source),
        corrigendum : hasCorrigendum($, corrigendums),
        publishDate : dates.publishDate || null,
        deadline : dates.deadline || null,
        openingDate : dates.openingDate || null,
        company : contact.company || null,
        person : contact.person || null,
        address : contact.address || null,
        pincode : contact.pincode || null,
        source : source,
        corrigendums : corrigendums,
        docs : getDocs($)
    };
 
    const existsResult = await DB.tenderExists({ tdr, tenderNo, tenderId });
 
    if(existsResult.success && !existsResult.exists)
    {
        const insertResult = await DB.insertTenderPool2(payload);
        payload.inserted = insertResult.success;
    }
    else
    {
        payload.inserted = false;
    }
 
    console.log(JSON.stringify(payload, null, 2));
    return payload;
}

async function main()
{
    const payload = await extractTenderDetails("https://www.tenderdetail.com/Indian-Tenders/TenderNotice/56604709/B77243A6-E0B5-4C4D-B571-E588F64084F8/78698/52058992/32f813bc-ee1c-4493-950a-8cfb97441409", "HouseKeeping");
}

main();

module.exports = { 
    extractTenderDetails 
};