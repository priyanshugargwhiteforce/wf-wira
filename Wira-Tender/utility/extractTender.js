const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const cheerio = require("cheerio");

const IMAP_CONFIG = {
    host: "imap.zoho.in",
    port: 993,
    secure: true
};

const TARGET_SENDER = "tenders@tenderdetail.com";
const TARGET_URL_PREFIX = "https://www.tenderdetail.com/dailytenders/";

const categories = [
    {
        name: "HouseKeeping",
        divPlacement: "next"
    },
    {
        name: "Man Power",
        divPlacement: "next"
    },
    {
        name: "Training Services",
        divPlacement: "next"
    },
    {
        name: "Security Services",
        divPlacement: "next"
    },
    {
        name: "Digitization",
        divPlacement: "next"
    },
    {
        name: "Computer Tenders",
        divPlacement: "next"
    },
    {
        name: "Networking Work",
        divPlacement: "next"
    },
    {
        name: "Website Development",
        matchId: "websitedevelopement",
        divPlacement: "next"
    },
    {
        name: "Mobile Application",
        divPlacement: "next"
    },
    {
        name: "Softwares",
        divPlacement: "next"
    },
    {
        name: "Civil Works",
        divPlacement: "next"
    },
    {
        name: "Electrical Works",
        divPlacement: "next"
    },
    {
        name: "Interior Work",
        divPlacement: "next"
    },
    {
        name: "Solar Power Projects",
        divPlacement: "next"
    },
    {
        name: "Security Guard",
        divPlacement: "next"
    }
];

const INDIAN_STATES = new Set([
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh",
    "goa", "gujarat", "haryana", "himachal pradesh", "jharkhand", "karnataka",
    "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya", "mizoram",
    "nagaland", "odisha", "punjab", "rajasthan", "sikkim", "tamil nadu",
    "telangana", "tripura", "uttar pradesh", "uttarakhand", "west bengal",
    "andaman and nicobar islands", "chandigarh", "dadra and nagar haveli and daman and diu",
    "delhi", "jammu and kashmir", "ladakh", "lakshadweep", "puducherry"
]);

const CATEGORY_HEADING_STRATEGIES = [
    ($, targetIdNormalized) =>
    {
        let heading = $("");

        $("h6[id]").each((_, el) =>
        {
            const currentId = $(el).attr("id").toLowerCase().replace(/[\s-_]/g, "");
            if(currentId === targetIdNormalized)
            {
                heading = $(el);
                return false;
            }
        });

        if(heading.length === 0)
        {
            return null;
        }

        const cardBody = heading.closest(".card").find(".card-body");
        return cardBody.length ? cardBody : null;
    },
    ($, targetIdNormalized, divPlacement) =>
    {
        let el = $("");

        $("[id]").each((_, node) =>
        {
            const currentId = $(node).attr("id").toLowerCase().replace(/[\s-_]/g, "");
            if(currentId === targetIdNormalized)
            {
                el = $(node);
                return false;
            }
        });

        if(el.length === 0)
        {
            return null;
        }

        const parentDiv = el.parent();
        if(parentDiv.length === 0)
        {
            return null;
        }

        const containerDiv = divPlacement === "next" ? parentDiv.next() : parentDiv.prev();
        return containerDiv.length ? containerDiv : null;
    }
];

const CARD_SELECTORS = [".m-mainTR", ".tender-box"];

const FIELD_STRATEGIES = {
    authority: [
        ($card) => cleanCardText($card.find(".m-r-td-title").text().replace(/^\d+\.\s*/, "")),
        ($card) => cleanCardText($card.find(".row").first().find(".col-md-8 b span.tender-blue").first().text())
    ],
    location: [
        ($card) => cleanCardText($card.find(".m-td-state").text()),
        ($card) => cleanCardText($card.find(".row").first().find(".col-md-4.text-right b.tender-blue").first().text())
    ],
    briefBlockText: [
        ($card) => $card.find("p.m-td-brief").first().text(),
        ($card) => $card.find(".col-md-12.mt-2").first().text()
    ],
    documentType: [
        ($card) => cleanCardText($card.find(".m-p-document").text())
    ],
    valueDateRows: [
        ($, $card) => $card.find("p.m-td-brief"),
        ($, $card) => $card.find(".row.mt-2 .col-md-4")
    ],
    url: [
        ($card) => $card.find("a[href^='/Indian-Tenders/TenderNotice/']").attr("href")
    ]
};

function extractTrackingLinks(html)
{
    const links = [];
    const regexes = [
        /https:\/\/tck\.analytics\.kasplo\.in\/[^\s"'>]+/g,
        /https:\/\/connect\.tenderdetail\.com\/click\/[^\s"'>]+/g
    ];

    for(const regex of regexes)
    {
        const matches = html.match(regex) || [];

        for(const match of matches)
        {
            const clean = match.replace(/&amp;/g, "&");
            if(!links.includes(clean))
            {
                links.push(clean);
            }
        }
    }

    return links;
}

async function resolveRedirect(url)
{
    try
    {
        const response = await fetch(
            url, 
            {
                method: "GET",
                redirect: "follow",
                signal: AbortSignal.timeout(8000)
            }
        );

        return response.url || null;
    }
    catch(err)
    {
        return null;
    }
}

async function resolveFirstMatchingTrackingLink(trackingLinks)
{
    for(const link of trackingLinks)
    {
        const resolved = await resolveRedirect(link);

        if(resolved && resolved.startsWith(TARGET_URL_PREFIX))
        {
            return resolved;
        }
    }

    return null;
}

function parseTenderValue(text)
{
    if(!text || text.trim().toLowerCase() === "ref.document")
    {
        return null;
    }

    const clean = text.replace(/,/g, "").trim();
    if(clean.toLowerCase().includes("crore"))
    {
        const num = parseFloat(clean.replace(/crore/gi, "").trim());
        return isNaN(num) ? null : Math.round(num * 10000000);
    }

    if(clean.toLowerCase().includes("lakh") || clean.toLowerCase().includes("lakhs"))
    {
        const num = parseFloat(clean.replace(/lakhs?/gi, "").trim());
        return isNaN(num) ? null : Math.round(num * 100000);
    }

    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
}

function parseCardDate(text)
{
    if(!text)
    {
        return null;
    }

    const clean = text.trim();

    if(clean.toLowerCase() === "ref.document" || clean === "")
    {
        return null;
    }

    if(/\d{2}-\d{2}-\d{4}/.test(clean))
    {
        return clean;
    }

    if(/\d{2}-[A-Za-z]{3}-\d{4}/.test(clean))
    {
        return clean;
    }

    return null;
}

function cleanCardText(text)
{
    if(!text)
    {
        return null;
    }

    const clean = text.replace(/\s+/g, " ").trim();
    return clean === "" ? null : clean;
}

function firstNonEmpty(strategies, ...args)
{
    for(const strategy of strategies)
    {
        try
        {
            const result = strategy(...args);
            if(result !== null && result !== undefined && result !== "")
            {
                return result;
            }
        }
        catch(err)
        {
            continue;
        }
    }

    return null;
}

function resolveCategoryContainer($, category)
{
    const targetIdNormalized = category.matchId || category.name.toLowerCase().replace(/[\s-_]/g, "");

    for(const strategy of CATEGORY_HEADING_STRATEGIES)
    {
        const container = strategy($, targetIdNormalized, category.divPlacement);

        if(container && container.length > 0)
        {
            return container;
        }
    }

    return null;
}

function findCards($, container)
{
    for(const selector of CARD_SELECTORS)
    {
        const cards = container.find(selector);

        if(cards.length > 0)
        {
            return cards;
        }
    }

    return $("");
}

function extractLocation($card)
{
    const locationRaw = firstNonEmpty(FIELD_STRATEGIES.location, $card);

    let city = null;
    let state = null;

    if(!locationRaw)
    {
        return { 
            city: city, 
            state: state 
        };
    }

    const normalized = locationRaw.trim().toLowerCase();

    if(normalized.includes(","))
    {
        const [cityPart, ...stateParts] = normalized.split(",");
        city = cityPart.trim() || null;
        state = stateParts.join(",").trim() || null;

        return { 
            city: city, 
            state: state 
        };
    }

    const words = normalized.split(/\s+/);

    for(let i = 0; i < words.length; i++)
    {
        const candidate = words.slice(i).join(" ");
        if(INDIAN_STATES.has(candidate))
        {
            city = words.slice(0, i).join(" ") || null;
            state = candidate;

            return { 
                city: city, 
                state: state 
            };
        }
    }

    city = null;
    state = normalized || null;
    return { 
        city: city, 
        state: state 
    };
}

function extractTdrAndBrief($card)
{
    const rawText = firstNonEmpty(FIELD_STRATEGIES.briefBlockText, $card) || "";
    const tdrMatch = rawText.match(/TDR:(\d+)/);
    const tdr = tdrMatch ? parseInt(tdrMatch[1]) : null;
    const isCorrigendum = rawText.toLowerCase().includes("corrigendum");
    const brief = cleanCardText(rawText.replace(/TDR:\d+/g, "").replace(/corrigendum\s*:/gi, "").trim());

    return { 
        tdr: tdr, 
        isCorrigendum: isCorrigendum, 
        brief: brief 
    };
}

function extractValueAndDate($, $card)
{
    let tenderValueRaw = null;
    let tenderValue = null;
    let dueDate = null;
    let rowSet = null;

    for(const strategy of FIELD_STRATEGIES.valueDateRows)
    {
        const result = strategy($, $card);
        if(result && result.length > 0)
        {
            rowSet = result;
            break;
        }
    }

    if(!rowSet)
    {
        return { 
            tenderValueRaw: tenderValueRaw, 
            tenderValue: tenderValue, 
            dueDate: dueDate 
        };
    }

    rowSet.each((_, node) =>
    {
        const text = $(node).text();
        if(!text)
        {
            return;
        }

        if(text.includes("Tender Value:"))
        {
            tenderValueRaw = cleanCardText(text.replace("Tender Value:", "").trim());
            tenderValue = parseTenderValue(tenderValueRaw);
        }

        if(text.includes("Due Date:"))
        {
            dueDate = parseCardDate(cleanCardText(text.replace("Due Date:", "").trim()));
        }
    });

    return { 
        tenderValueRaw: tenderValueRaw, 
        tenderValue: tenderValue, 
        dueDate: dueDate 
    };
}

async function extractTenderUrlsFromPage(pageUrl)
{
    try
    {
        const response = await fetch(
            pageUrl,
            {
                method: "GET",
                signal: AbortSignal.timeout(8000)
            }
        );

        if(!response.ok)
        {
            return [];
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        const result = [];

        categories.forEach((category) =>
        {
            const container = resolveCategoryContainer($, category);
            if(!container)
            {
                result.push({ 
                    category: category.name, 
                    tenders: [] 
                });

                return;
            }

            const cards = findCards($, container);
            const tenders = [];

            cards.each((i, cardEl) =>
            {
                const $card = $(cardEl);

                const authority = firstNonEmpty(FIELD_STRATEGIES.authority, $card);
                const { city, state } = extractLocation($card);
                const { tdr, isCorrigendum, brief } = extractTdrAndBrief($card);
                const documentType = firstNonEmpty(FIELD_STRATEGIES.documentType, $card);
                const { tenderValueRaw, tenderValue, dueDate } = extractValueAndDate($, $card);

                const href = firstNonEmpty(FIELD_STRATEGIES.url, $card);
                const url = href ? "https://www.tenderdetail.com" + href : null;

                if(url)
                {
                    tenders.push({
                        tdr: tdr,
                        authority: authority,
                        city: city,
                        state: state,
                        brief: brief,
                        isCorrigendum: isCorrigendum,
                        documentType: documentType,
                        tenderValue: tenderValue,
                        tenderValueRaw: tenderValueRaw,
                        dueDate: dueDate,
                        url: url
                    });
                }
            });

            result.push({ 
                category: category.name, 
                tenders: tenders 
            });
        });

        return result;
    }
    catch(err)
    {
        return [];
    }
}

async function fetchEmailsSince(client, fromDate)
{
    const searchCriteria = fromDate ? { since: new Date(fromDate) } : {};
    const messageIds = await client.search(searchCriteria, { uid: true }) || [];
    return messageIds;
}

async function parseSenderEmail(client, uid)
{
    const message = await client.fetchOne(uid, { source: true }, { uid: true });
    if(!message?.source)
    {
        return null;
    }

    return await simpleParser(message.source);
}

function isFromTargetSender(parsed)
{
    const senderAddresses = parsed.from?.value || [];
    return senderAddresses.some(addr => addr.address?.toLowerCase() === TARGET_SENDER.toLowerCase());
}

async function processTenderEmail(parsed)
{
    if(!parsed.html)
    {
        return [];
    }

    const trackingLinks = extractTrackingLinks(parsed.html);
    const resolvedUrl = await resolveFirstMatchingTrackingLink(trackingLinks);

    if(!resolvedUrl)
    {
        return [];
    }

    return await extractTenderUrlsFromPage(resolvedUrl);
}

async function extractTenderEmails(fromDate)
{
    const email = process.env.TENDER_APP_ID;
    const password = process.env.TENDER_APP_PASSWORD;

    if(!email || !password)
    {
        throw new Error("TENDER_APP_ID or TENDER_APP_PASSWORD is not set in environment.");
    }

    const client = new ImapFlow(
        {
            ...IMAP_CONFIG,
            auth: 
            { 
                user: email, 
                pass: password 
            },
            logger: false
        }
    );

    const tenderUrls = [];

    try
    {
        await client.connect();
        const mailboxList = await client.list();

        for(const mailbox of mailboxList)
        {
            let lock;

            try
            {
                lock = await client.getMailboxLock(mailbox.path);
            }
            catch(err)
            {
                console.log(`✗ Cannot access mailbox "${mailbox.path}": ${err.message}`);
                continue;
            }

            try
            {
                const messageIds = await fetchEmailsSince(client, fromDate);

                for(const uid of messageIds)
                {
                    const parsed = await parseSenderEmail(client, uid);
                    if(!parsed)
                    {
                        continue;
                    }

                    if(!isFromTargetSender(parsed))
                    {
                        continue;
                    }

                    const urls = await processTenderEmail(parsed);
                    for(const url of urls)
                    {
                        if(!tenderUrls.includes(url))
                        {
                            tenderUrls.push(url);
                        }
                    }
                }
            }
            finally
            {
                lock.release();
            }
        }

        await client.logout();

        const categorySummaryMap = {};
        for(const item of tenderUrls)
        {
            if(!categorySummaryMap[item.category])
            {
                categorySummaryMap[item.category] = 0;
            }

            categorySummaryMap[item.category] += item.tenders ? item.tenders.length : 0;
        }

        const categorySummary = Object.keys(categorySummaryMap).map(categoryName => ({
            categoryName,
            count: categorySummaryMap[categoryName]
        }));

        const finalResult = tenderUrls.map(item => ({
            categorySummary,
            category: item.category,
            tenders: item.tenders
        }));

        return finalResult;
    }
    catch(err)
    {
        try 
        { 
            await client.logout(); 
        } 
        catch 
        {

        }

        throw err;
    }
}

module.exports = { 
    extractTenderEmails 
};