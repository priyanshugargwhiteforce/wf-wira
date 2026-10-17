const Session = require("./Session");
const PDF = require("./PDF");
const Prompts = require("./Prompts");
const WiraFileDB = require("./Database/WiraFile");
const WiraFileChunksDB = require("./Database/WiraFileChunks");
const google = require("@google/genai");
const path = require("path");
const extractor = require("../Utility/extractText");

require("dotenv").config(
    {
        quiet: true,
        path: path.resolve(__dirname, "../../.env")
    }
);

class AI
{
    constructor(phone = null, session = null)
    {
        this.phone = phone;
        this.session = session ?? new Session(phone);
        this.pdf = new PDF();
        this.prompts = new Prompts();
        this.fileDB = new WiraFileDB();
        this.fileChunksDB = new WiraFileChunksDB();

        this.gemini = new google.GoogleGenAI(
            { 
                apiKey: process.env.GEMINI_KEY 
            }
        );

        this.rate = 96.96;

        this.geminiRates =
        [
            { 
                modelName: "gemini-2.5-flash-lite",  
                input: 0.10,  
                output: 0.40,  
                cache: 0.01  
            },
            { 
                modelName: "gemini-2.5-flash",        
                input: 0.30,  
                output: 2.50,  
                cache: 0.03  
            },
            { 
                modelName: "gemini-2.5-pro",  
                input: 1.25,  
                output: 10.00, 
                cache: 0.125 
            },
            { 
                modelName: "gemini-3.1-flash-lite",   
                input: 0.25,  
                output: 1.50,  
                cache: 0.025 
            },
            { 
                modelName: "gemini-3.1-pro-preview",  
                input: 2.00,  
                output: 12.00, 
                cache: 0.20  
            },
            { 
                modelName: "gemini-3-flash-preview",  
                input: 0.50,  
                output: 3.00,  
                cache: 0.05  
            },
            { 
                modelName: "gemini-3.5-flash",        
                input: 1.50,  
                output: 9.00,  
                cache: 0.15  
            },
            { 
                modelName: "gemini-3.5-flash-lite",   
                input: 0.30,  
                output: 2.50,  
                cache: 0.03  
            },
            { 
                modelName: "gemini-3.6-flash",  
                input: 0.75,  
                output: 3.75,  
                cache: 0.075 
            },
            { 
                modelName: "gemini-3.7-flash",  
                input: 0.75,  
                output: 3.75,  
                cache: 0.075 
            },
            { 
                modelName: "gemini-3.8-flash",  
                input: 0.75,  
                output: 3.75,  
                cache: 0.075 
            }
        ];

        this.#updateUsdToInr();
        this.#updateGeminiRates();
    }

    #chunkText(text, maxWords = 250)
    {
        const words = text.split(/\s+/).filter(Boolean);
        const chunks = [];

        for(let i = 0; i < words.length; i += maxWords)
        {
            chunks.push(words.slice(i, i + maxWords).join(" "));
        }

        return chunks;
    }

    async #embedChunks(chunks)
    {
        try
        {
            const results = await Promise.all(
                chunks.map(chunk =>
                    this.gemini.models.embedContent(
                        {
                            model: "text-embedding-004",
                            content: 
                            { 
                                parts: 
                                [
                                    { 
                                        text: chunk 
                                    }
                                ] 
                            }
                        }
                    )
                )
            );

            return results.map(r => r.embeddings[0].values);
        }
        catch(error)
        {
            console.error("Error occured embedding chunks in AI Class in Wira: ", error);
            return null;
        }
    }

    #normalizeModelName(name)
    {
        return name.toLowerCase().replace(/\s+/g, "-");
    }

    async #updateUsdToInr()
    {
        try
        {
            const response = await fetch("https://open.er-api.com/v6/latest/USD");
            const data = await response.json();

            if(data?.rates?.INR)
            {
                this.rate = data.rates.INR;
            }
        }
        catch(error)
        {

        }
    }

    async #updateGeminiRates()
    {
        try
        {
            const response = await fetch("https://llmpricingapi.com/api/models");
            const data = await response.json();

            const googleModels = data.models.filter(m => m.provider === "google");
            if(googleModels.length === 0)
            {
                return;
            }

            for(const local of this.geminiRates)
            {
                const match = googleModels.find(m =>
                    this.#normalizeModelName(m.name) === local.modelName
                );

                if(!match)
                {
                    continue;
                }

                local.input = match.input_price;
                local.output = match.output_price;
                local.cache = match.cache_read_price ?? local.cache;
            }
        }
        catch(error)
        {

        }
    }

    #calcGeminiCost(rates, usage, modelName)
    {
        if(!rates || !usage)
        {
            return null;
        }

        const inputTokens = usage.promptTokenCount ?? 0;
        const outputTokens = usage.candidatesTokenCount ?? 0;
        const cacheTokens = usage.cachedContentTokenCount ?? 0;

        const inputCostUsd = ((inputTokens - cacheTokens) / 1_000_000) * rates.input;
        const outputCostUsd = (outputTokens / 1_000_000) * rates.output;
        const cacheCostUsd = (cacheTokens / 1_000_000) * rates.cache;
        const totalCostUsd = inputCostUsd + outputCostUsd + cacheCostUsd;

        return {
            modelName: modelName,
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            cachedTokens: cacheTokens,
            inputCostInr: parseFloat((inputCostUsd * this.rate).toFixed(6)),
            outputCostInr: parseFloat((outputCostUsd * this.rate).toFixed(6)),
            cacheCostInr: parseFloat((cacheCostUsd * this.rate).toFixed(6)),
            totalCostInr: parseFloat((totalCostUsd * this.rate).toFixed(6))
        };
    }

    async createGeminiCache(modelName, promptText, expiryMinutes = 20)
    {
        try
        {
            const ttlSeconds = expiryMinutes * 60;
            const cached = await this.gemini.caches.create(
                {
                    model: modelName,
                    config:
                    {
                        displayName: `wira-cache-${Date.now()}`,
                        ttl: `${ttlSeconds}s`,
                        contents:
                        [
                            {
                                role:  "user",
                                parts: 
                                [
                                    { 
                                        text: promptText 
                                    }
                                ]
                            }
                        ]
                    }
                }
            );

            const rates = this.geminiRates.find(r => r.modelName === modelName);
            const totalTokens = cached.usageMetadata?.totalTokenCount ?? 0;
            const storageRatePerHour = rates ? (rates.cache / 1_000_000) * totalTokens : 0;
            const costPerSecondUsd = storageRatePerHour / 3600;
            const costPerSecondInr = parseFloat((costPerSecondUsd * this.rate).toFixed(8));

            return {
                statusCode: 200,
                success: true,
                message: "Gemini cache created successfully.",
                data:
                {
                    cacheId: cached.name,
                    totalTokens: totalTokens,
                    costPerSecondInr: costPerSecondInr,
                }
            };
        }
        catch(error)
        {
            console.error("Error occured creating Gemini cache in AI Class in Wira: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured creating Gemini cache.",
                data: null,
            };
        }
    }

    async deleteGeminiCache(cacheId)
    {
        try
        {
            await this.gemini.caches.delete(
                { 
                    name: cacheId 
                }
            );

            return {
                statusCode: 200,
                success: true,
                message: "Gemini cache deleted successfully.",
                data: 
                {
                    cacheId: cacheId
                }
            };
        }
        catch(error)
        {
            console.error("Error occured deleting Gemini cache in AI Class in Wira: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured deleting Gemini cache.",
                data: null,
            };
        }
    }

    async runGemini(modelName, conversation, systemPrompt = null, cacheId = null, files = [], temperature = 0.0, thinkingBudget = null, jsonMode = false, streaming = false, onChunk = null, signal = null, maxRetries = 3, retryDelay = 800)
    {
        try
        {
            const fileParts = [];
            for(const filePath of files)
            {
                try
                {
                    const uploaded = await this.gemini.files.upload(
                        { 
                            file: filePath 
                        }   
                    );

                    let fileData = uploaded;
                    let attempts = 0;

                    while(fileData.state === "PROCESSING" && attempts < 20)
                    {
                        await new Promise((resolve) =>
                            {
                                return setTimeout(resolve, 2000);
                            }   
                        );

                        fileData = await this.gemini.files.get(
                            { 
                                name: fileData.name 
                            }
                        );

                        attempts++;
                    }

                    if(fileData.state !== "ACTIVE")
                    {
                        console.warn(`⚠️ File ${filePath} failed to become ACTIVE`);
                        continue;
                    }

                    fileParts.push(
                        {
                            fileData:
                            {
                                mimeType: fileData.mimeType,
                                fileUri: fileData.uri
                            }
                        }
                    );
                }
                catch(error)
                {
                    console.warn(`⚠️ Failed to upload file ${filePath}: ${error.message}`);
                }
            }

            const history = conversation.slice(0, -1).map((message) =>
                {
                    return {
                        role: message.role === "assistant" ? "model" : "user",
                        parts:
                        [
                            { 
                                text: message.content 
                            }
                        ]
                    };
                }
            );

            const lastMessage = conversation.at(-1)?.content ?? "";
            const lastParts =
            [
                { 
                    text: lastMessage 
                },
                ...fileParts
            ];

            const config = 
            {    
                temperature: temperature 
            };

            if(thinkingBudget)
            {
                config.thinkingConfig = 
                { 
                    thinkingBudget: thinkingBudget 
                };
            }

            if(jsonMode)
            {
                config.responseMimeType = "application/json";
            }

            if(cacheId)
            {
                config.cachedContent = cacheId;
            }
            else if(systemPrompt)
            {
                config.systemInstruction = systemPrompt;
            }

            const chat = this.gemini.chats.create(
                { 
                    model: modelName, 
                    history: history, 
                    config: config 
                }
            );

            const rates = this.geminiRates.find(r => r.modelName === modelName);

            for(let attempt = 1; attempt <= maxRetries; attempt++)
            {
                try
                {
                    if(streaming)
                    {
                        const stream = await chat.sendMessageStream(
                            { 
                                message: lastParts 
                            },
                            { 
                                signal: signal 
                            }
                        );

                        let text = "";
                        let usage = null;

                        for await(const chunk of stream)
                        {
                            if(signal?.aborted)
                            {
                                break;
                            }

                            text += chunk.text ?? "";

                            if(onChunk)
                            {
                                onChunk(chunk.text ?? "");
                            }

                            if(chunk.usageMetadata)
                            {
                                usage = chunk.usageMetadata;
                            }
                        }

                        if(signal?.aborted)
                        {
                            return {
                                statusCode: 200,
                                success: true,
                                message: "Gemini stream aborted.",
                                data:
                                {
                                    text: text,
                                    usage: usage,
                                    aborted: true
                                },
                                cost: this.#calcGeminiCost(rates, usage, modelName)
                            };
                        }

                        return {
                            statusCode: 200,
                            success: true,
                            message: "Gemini stream completed successfully.",
                            data:
                            {
                                text: text,
                                usage: usage,
                                aborted: false
                            },
                            cost: this.#calcGeminiCost(rates, usage, modelName)
                        };
                    }

                    const result = await chat.sendMessage(
                        { 
                            message: lastParts 
                        },
                        { 
                            signal: signal 
                        }
                    );

                    const usage = result.usageMetadata ?? null;

                    return {
                        statusCode: 200,
                        success: true,
                        message: "Gemini response generated successfully.",
                        data:
                        {
                            text: result.text ?? "",
                            usage: usage,
                            aborted: false
                        },
                        cost: this.#calcGeminiCost(rates, usage, modelName)
                    };
                }
                catch(err)
                {
                    if(err.name === "AbortError" || signal?.aborted)
                    {
                        return {
                            statusCode: 200,
                            success: true,
                            message: "Gemini request aborted.",
                            data:
                            {
                                text: "",
                                usage: null,
                                aborted: true
                            },
                            cost: null
                        };
                    }

                    const is429 = err.status === 429 || err.message?.includes("429");
                    if(is429 || attempt === maxRetries)
                    {
                        throw err;
                    }

                    await new Promise((resolve) =>
                        {
                            return setTimeout(resolve, retryDelay);
                        }
                    );
                }
            }
        }
        catch(error)
        {
            console.error("Error occured running Gemini in AI Class in Wira: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured running Gemini.",
                data: null,
                cost: null
            };
        }
    }

    async parseResume(fileName)
    {
        try
        {
            let conversationContent = null;
            let filePaths = [];

            //FETCH FILE RECORD FROM DATABASE — ATTEMPT TO USE EXTRACTED CHUNKS FIRST.
            const fileResult = await this.fileDB.fetchFile(
                { 
                    fileName: fileName 
                },
                { 
                    paginated: false 
                }
            );

            const file = (fileResult.success && fileResult.data.files.length > 0) ? fileResult.data.files[0] : null;
            if(file && file.extracted && file.chunkCount > 0)
            {
                const chunksResult = await this.fileChunksDB.fetchFileChunk(
                    { 
                        wiraFileId: file.id 
                    },
                    {    
                        paginated: false 
                    }
                );

                if(chunksResult.success && chunksResult.data.chunks.length > 0)
                {
                    const sorted = chunksResult.data.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
                    const transcript = sorted.map(c => c.content).join(" ");
                    const wordCount = transcript.split(/\s+/).filter(Boolean).length;

                    if(wordCount <= 2000)
                    {
                        //SMALL ENOUGH — PASS AS TEXT.
                        conversationContent = transcript;
                    }
                    else if(file.storagePath)
                    {
                        //TOO LARGE — PASS FILE DIRECTLY USING STORED PATH.
                        filePaths = [file.storagePath];
                        conversationContent = "Parse this resume.";
                    }
                    else
                    {
                        //NO STORAGE PATH — FALL BACK TO TEXT EVEN IF LARGE.
                        conversationContent = transcript;
                    }
                }
            }

            //NO CHUNKS, NO DB RECORD, OR EXTRACTION FAILED — PASS FILE DIRECTLY.
            if(!conversationContent)
            {
                filePaths = [file?.storagePath ?? fileName];
                conversationContent = "Parse this resume.";
            }

            const result = await this.runGemini(
                "gemini-3.1-flash-lite",
                [
                    { 
                        role: "user", 
                        content: conversationContent 
                    }
                ],
                this.prompts.parseResume(),
                null,
                filePaths,
                0.7,
                null,
                true
            );

            if(!result.success)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to parse resume.",
                    data: null,
                    cost: null
                };
            }

            let parsed = null;
            try
            {
                parsed = JSON.parse(result.data.text);
            }
            catch(_)
            {
                parsed = result.data.text;
            }

            return {
                statusCode: 200,
                success: true,
                message: "Resume parsed successfully.",
                data: parsed,
                cost: result.cost
            };
        }
        catch(error)
        {
            console.error("Error occured parsing resume in AI Class in Wira: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured parsing resume.",
                data: null,
                cost: null
            };
        }
    }

    async generateTest(jobData)
    {
        try
        {
            const result = await this.runGemini(
                "gemini-3.1-flash-lite",
                [
                    {
                        role: "user", 
                        content: "Generate the interview preparation test now." 
                    }
                ],
                this.prompts.generateTest(jobData),
                null,
                [],
                0.7,
                null,
                true
            );

            if(!result.success)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to generate test.",
                    data: null,
                    cost: null
                };
            }

            let parsed = null;
            try
            {
                parsed = JSON.parse(result.data.text);
            }
            catch(_)
            {
                parsed = result.data.text;
            }

            return {
                statusCode: 200,
                success: true,
                message: "Test generated successfully.",
                data: parsed,
                cost: result.cost
            };
        }
        catch(error)
        {
            console.error("Error occured generating test in AI Class in Wira: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured generating test.",
                data: null,
                cost: null
            };
        }
    }

    async generateScreening(jobData)
    {
        try
        {
            const result = await this.runGemini(
                "gemini-3.1-flash-lite",
                [
                    {
                        role: "user", 
                        content: "Generate the screening questions now." 
                    }
                ],
                this.prompts.generateScreening(jobData),
                null,
                [],
                0.7,
                null,
                true
            );

            if(!result.success)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to generate screening.",
                    data: null,
                    cost: null
                };
            }

            let parsed = null;
            try
            {
                parsed = JSON.parse(result.data.text);
            }
            catch(_)
            {
                parsed = result.data.text;
            }

            return {
                statusCode: 200,
                success: true,
                message: "Screening generated successfully.",
                data: parsed,
                cost: result.cost
            };
        }
        catch(error)
        {
            console.error("Error occured generating screening in AI Class in Wira: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured generating screening.",
                data: null,
                cost: null
            };
        }
    }

    async createResume(data, wiraCandidateId = null)
    {
        try
        {
            //STEP 1 — USE AI TO STRUCTURE THE CANDIDATE PROFILE INTO THE FORMAT THE PDF TEMPLATE EXPECTS.
            const result = await this.runGemini(
                "gemini-3.1-flash-lite",
                [
                    { 
                        role: "user", 
                        content: "Generate the structured ATS resume data now." 
                    }
                ],
                this.prompts.createResume(data),
                null,
                [],
                0.7,
                null,
                true
            );

            if(!result.success)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to structure resume data.",
                    data: null,
                    cost: null
                };
            }

            let resumeData = null;

            try
            {
                resumeData = JSON.parse(result.data.text);
            }
            catch(_)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to parse structured resume data.",
                    data: null,
                    cost: result.cost
                };
            }

            //STEP 2 — BUILD THE PDF FROM THE AI-STRUCTURED DATA.
            const pdfResult = await this.pdf.createAtsResume(resumeData);
            if(!pdfResult.success)
            {
                return {
                    statusCode: pdfResult.statusCode,
                    success: false,
                    message: pdfResult.message,
                    data: null,
                    cost: result.cost
                };
            }

            //STEP 3 — SAVE FILE RECORD TO DATABASE AND FIRE-AND-FORGET EMBEDDING IF wiraCandidateId IS PROVIDED.
            if(wiraCandidateId)
            {
                const fileResult = await this.fileDB.createFile(
                    {
                        wiraCandidateId: wiraCandidateId,
                        fileName: pdfResult.fileName,
                        fileType: "pdf",
                        sizeKb: pdfResult.fileSize,
                        mimeType: "application/pdf",
                        extracted: false,
                        storagePath: pdfResult.filePath
                    }
                );

                //BACKGROUND — CHUNK TRANSCRIPT, EMBED, AND SAVE CHUNKS TO DATABASE.
                if(fileResult.success && pdfResult.transcript)
                {
                    const fileId = fileResult.data.file.id;

                    (async () =>
                    {
                        try
                        {
                            const chunks = this.#chunkText(pdfResult.transcript, 250);
                            const vectors = await this.#embedChunks(chunks);

                            if(!vectors)
                            {
                                throw new Error("Embedding failed — no vectors returned.");
                            }

                            const chunkData = chunks.map((content, i) =>
                                {
                                    return {
                                        wiraFileId: fileId,
                                        chunkIndex: i,
                                        content: content,
                                        wordCount: content.split(/\s+/).filter(Boolean).length,
                                        embedding: JSON.stringify(vectors[i])
                                    };
                                }
                            );

                            await this.fileChunksDB.createFileChunks(chunkData);
                            await this.fileDB.updateFile(
                                {
                                    extracted: true,
                                    extractedAt: new Date(),
                                    chunkCount: chunks.length
                                },
                                {    
                                    ids: 
                                    [
                                        fileId
                                    ] 
                                }
                            );
                        }
                        catch(error)
                        {
                            console.error(`❌ Background embedding failed for resume file ${fileId}:`, error.message);

                            await this.fileDB.updateFile(
                                { 
                                    extracted: false 
                                },
                                { 
                                    ids: 
                                    [
                                        fileId
                                    ] 
                                }
                            )
                            .catch(() => {});
                        }
                    })();
                }
            }

            return {
                statusCode: 200,
                success: true,
                message: "ATS friendly resume generated successfully.",
                data:
                {
                    fileName: pdfResult.fileName,
                    fileSize: pdfResult.fileSize,
                    fileType: pdfResult.fileType,
                    filePath: pdfResult.filePath,
                    publicUrl: pdfResult.publicUrl,
                    transcript: pdfResult.transcript,
                    pageCount: pdfResult.pageCount
                },
                cost: result.cost
            };
        }
        catch(error)
        {
            console.error("Error occured generating ATS friendly resume in AI Class in Wira: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured generating ATS friendly resume.",
                data: null,
                cost: null
            };
        }
    }
}

module.exports = AI;