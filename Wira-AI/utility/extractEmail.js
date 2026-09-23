const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const path = require("path");
const extractor = require("@wira/shared/Utility/extractText");

function hasPdfAttachment(bodyStructure) 
{
    if(!bodyStructure)
    {
        return false;
    }

    const disposition = bodyStructure.disposition?.toLowerCase();
    const type = bodyStructure.type?.toLowerCase();
    const subtype = bodyStructure.subtype?.toLowerCase();
    const name = (bodyStructure.parameters?.name || bodyStructure.dispositionParameters?.filename || "").toLowerCase();

    if((disposition === "attachment" || type === "application") && name.endsWith(".pdf"))
    {
        return true;
    }

    if(type === "application" && subtype === "pdf")
    {
        return true;
    }

    if(bodyStructure.childNodes?.length) 
    {
        return bodyStructure.childNodes.some(child => hasPdfAttachment(child));
    }

    return false;
}

async function extractEmails({ email, password, config, fromDate }) 
{
    const client = new ImapFlow(
        {
            ...config,
            auth: 
            { 
                user: email, 
                pass: password 
            },
            logger: false
        }
    );

    const extractedFiles = [];
    const tempDir = path.join(process.cwd(), "assets", "emails");

    if(!fs.existsSync(tempDir))
    {
        fs.mkdirSync(
            tempDir, 
            { 
                recursive: true 
            }
        );
    }

    try 
    {
        await client.connect();
        const mailboxes = await client.list();
        const targetMailboxes = mailboxes.filter(box => box.path === "INBOX" || box.path.includes("Spam"));

        for(const box of targetMailboxes)
        {
            const lock = await client.getMailboxLock(box.path);

            try
            {
                const searchCriteria = fromDate ? { since: new Date(fromDate) } : {};
                const messageIds = await client.search(searchCriteria, { uid: true }) || [];

                const pdfUids = [];
                for await (const msg of client.fetch(messageIds, { bodyStructure: true }, { uid: true }))
                {
                    if(hasPdfAttachment(msg.bodyStructure))
                    {
                        pdfUids.push(msg.uid);
                    }
                }

                if(!pdfUids.length)
                {
                    continue;
                }

                for(const uid of pdfUids)
                {
                    const message = await client.fetchOne(uid, { source: true }, { uid: true });
                    if(!message?.source)
                    {
                        continue;
                    }

                    const parsed = await simpleParser(message.source);
                    if(!parsed.attachments?.length)
                    {
                        continue;
                    }

                    for(const attachment of parsed.attachments)
                    {
                        if(!attachment.filename)
                        {
                            continue;
                        }

                        if(!attachment.filename.toLowerCase().endsWith(".pdf"))
                        {
                            continue;
                        }

                        const safeName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
                        const tempFile = `${Date.now()}_${uid}_${safeName}`;
                        const filePath = path.join(tempDir, tempFile);

                        try 
                        {
                            await fs.promises.writeFile(filePath, attachment.content);
                            let extractedRaw = null;

                            try
                            {
                                extractedRaw = await extractor.extractText(filePath);
                            }
                            catch(extractErr)
                            {
                                if(extractErr.name === "PasswordException" || extractErr.name === "InvalidPDFException")
                                {
                                    continue;
                                }

                                throw extractErr;
                            }

                            if(!extractedRaw)
                            {
                                extractedFiles.push({
                                    fileName: safeName,
                                    extractedRaw: null
                                });

                                continue;
                            }
                                 
                            extractedFiles.push({
                                fileName: safeName,
                                extractedRaw: extractedRaw
                            });
                        } 
                        finally 
                        {
                            try 
                            {
                                await fs.promises.unlink(filePath);
                            } 
                            catch 
                            {

                            }
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
        return extractedFiles;
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
  extractEmails
};