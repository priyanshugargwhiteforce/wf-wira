const WiraPrompts = require("./WiraPrompts");
const AI = require("@wira/shared/AI/executeAI");

class WiraGemini
{
    constructor(session, database, prerequisites, retrieve, perform, specialists, shapes)
    {
        this.session = session;
        this.database = database;
        this.prerequisites = prerequisites;
        this.retrieve = retrieve;
        this.perform = perform;
        this.specialists = specialists;
        this.shapes = shapes;
        this.model = "gemini-3.1-flash-lite";
        this.ttl = 1200
        this.prompts = new WiraPrompts(database, session, prerequisites, retrieve, perform, specialists, shapes);
    }

    async resolveCache(type, promptName, promptText, model, ttlSeconds, phone = null)
    {
        const cached = type === "universal" ? await this.session.getUniversalCache(promptName) : await this.session.getUserCache(phone, promptName);

        if(cached)
        {
            const stillExists = await AI.checkContextCacheExists(cached.cacheId);

            if(stillExists)
            {
                return cached.cacheId;
            }

            type === "universal" ? await this.session.deleteUniversalCache(promptName) : await this.session.deleteUserCache(phone, promptName);
        }

        const result = await AI.createContextCache(model, promptText, ttlSeconds / 60);

        const dbId = await this.database.createCacheCost(
            result.cacheName,
            promptName,
            model,
            result.metrics.totalTokens,
            new Date().toISOString()
        );

        const payload = {
            cacheId: result.cacheName,
            modelName: model,
            cachedTokens: result.metrics.totalTokens,
            dbId: dbId,
            costPerSecond: result.metrics.costPerSecond,
            createdAt: new Date().toISOString()
        };

        type === "universal" ? await this.session.setUniversalCache(promptName, payload, ttlSeconds) : await this.session.setUserCache(phone, promptName, payload, ttlSeconds);
        return payload.cacheId;
    }

    #recordCost(promptName, modelName, usage, phone)
    {
        if(!usage)
        {
            return;
        }

        (async () =>
        {
            try
            {
                let USD_TO_INR = 84;

                try
                {
                    const ratesResponse = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR");

                    if(ratesResponse.ok)
                    {
                        const ratesData = await ratesResponse.json();
                        USD_TO_INR = ratesData.rates.INR ?? 84;
                    }
                }
                catch(ratesError)
                {
                    console.warn("⚠️ WiraGemini.#recordCost: failed to fetch exchange rate, using fallback:", ratesError.message);
                }

                const pricing =
                {
                    "gemini-3.1-flash-lite": {
                        input: (0.25  / 1_000_000) * USD_TO_INR,
                        output: (1.50  / 1_000_000) * USD_TO_INR,
                        cached: (0.025 / 1_000_000) * USD_TO_INR
                    },
                    "gemini-2.5-flash-lite": {
                        input: (0.10  / 1_000_000) * USD_TO_INR,
                        output: (0.40  / 1_000_000) * USD_TO_INR,
                        cached: (0.01  / 1_000_000) * USD_TO_INR
                    }
                };

                const rates = pricing[modelName] ?? { input: 0.0, output: 0.0, cached: 0.0 };
                const inputTokens = usage.promptTokenCount ?? 0;
                const outputTokens = usage.candidatesTokenCount ?? 0;
                const cachedTokens = usage.cachedContentTokenCount ?? 0;

                const entry =
                {
                    prompt: promptName,
                    inputTokens: inputTokens,
                    outputTokens: outputTokens,
                    cachedTokens: cachedTokens,
                    inputCost: inputTokens * rates.input,
                    outputCost: outputTokens * rates.output,
                    cachedCost: cachedTokens * rates.cached,
                    totalCost: 0
                };

                entry.totalCost = entry.inputCost + entry.outputCost + entry.cachedCost;
                const currentSession = await this.session.getSession(phone);

                if(!currentSession)
                {
                    return;
                }

                if(!currentSession.turnNotebook || typeof currentSession.turnNotebook !== "object" || Array.isArray(currentSession.turnNotebook))
                {
                    currentSession.turnNotebook = { costs: [], iterations: {} };
                }

                if(!Array.isArray(currentSession.turnNotebook.costs))
                {
                    currentSession.turnNotebook.costs = [];
                }

                currentSession.turnNotebook.costs.push(entry)
                await this.session.updateSession(phone, currentSession);
            }
            catch(error)
            {
                console.error("❌ WiraGemini.#recordCost failed:", error.message);
            }
        })();
    }

    async router(activePrompt, messages, signal, phone)
    {
        const promptText = await this.prompts.router();

        const cacheId = await this.resolveCache(
            "universal",
            "wira-router",
            promptText,
            this.model,
            this.ttl
        );

        const result = await AI.runWiraGeminiCall({
            conversation: messages,
            cacheId: cacheId,
            modelName: this.model,
            temperature: 0.0,
            streaming: false,
            jsonMode: true,
            signal: signal
        });

        if(result.aborted)
        {
            return {
                prerequisites: [],
                skills: [],
                prompts: [],
                aborted: true
            };
        }

        this.#recordCost("wira-router", this.model, result.usage, phone);

        try
        {
            const output = JSON.parse(result.text);
            return this.prompts.resolveContext(activePrompt, output.skills ?? [], output.prerequisites ?? []);
        }
        catch
        {
            console.error("❌ WiraGemini.router: failed to parse response:", result.text);

            return {
                prerequisites: [],
                skills: [],
                prompts: []
            };
        }
    }

    async conversation(phone, conversation, files = [], onChunk, signal)
    {
        const promptText = await this.prompts.conversation(phone);

        const cacheId = await this.resolveCache(
            "user",
            "wira-conversation",
            promptText,
            this.model,
            this.ttl,
            phone
        );

        const filePaths = Array.isArray(files) ? files.filter(f => !f.transcript && f.storagePath).map(f => f.storagePath) : [];

        const result = await AI.runWiraGeminiCall({
            conversation: conversation,
            cacheId: cacheId,
            modelName: this.model,
            temperature: 0.7,
            streaming: true,
            jsonMode: true,
            onChunk: onChunk,
            signal: signal,
            files: filePaths
        });

        if(result.aborted)
        {
            return {
                output: null,
                aborted: true
            };
        }

        this.#recordCost("wira-conversation", this.model, result.usage, phone);

        try
        {
            const output = JSON.parse(result.text);

            const instructions = output?.instruction?.instructions ?? [];
            const forwardTo = output?.instruction?.forwardTo ?? null;

            if(instructions.length > 0 && forwardTo === null)
            {
                console.warn("⚠️ WiraGemini.conversation: instructions non-empty but forwardTo is null — forcing forwardTo to 'conversation'");

                output.instruction.forwardTo = "conversation";
                output.processing = false;

                if(!output.instruction.forwardInfo)
                {
                    output.instruction.forwardInfo = `Auto-recovered turn. Instructions issued: ${instructions.map(i => i.command).join(", ")}. Await results and reply accordingly.`;
                }

                const contentLength = (output.content ?? "").length;
                if(contentLength > 40)
                {
                    output.content = "On it...";
                }
            }

            return {
                output: output,
                aborted: false
            };
        }
        catch
        {
            console.error("❌ WiraGemini.conversation: failed to parse response:", result.text);

            return {
                output: null,
                aborted: false
            };
        }
    }

    async resume(phone, conversation, files = [], onChunk, signal)
    {
        const promptText = this.prompts.resume();

        const cacheId = await this.resolveCache(
            "universal",
            "wira-resume",
            promptText,
            this.model,
            this.ttl
        );

        const filePaths = Array.isArray(files) ? files : [];

        const result = await AI.runWiraGeminiCall({
            conversation: conversation,
            cacheId: cacheId,
            modelName: this.model,
            temperature: 1,
            streaming: true,
            jsonMode: true,
            onChunk: onChunk,
            signal: signal,
            files: filePaths
        });

        if(result.aborted)
        {
            return {
                output: null,
                aborted: true
            };
        }

        this.#recordCost("wira-resume", this.model, result.usage, phone);

        try
        {
            const output = JSON.parse(result.text);

            return {
                output: output,
                aborted: false
            };
        }
        catch
        {
            console.error("❌ WiraGemini.resume: failed to parse response:", result.text);

            return {
                output: null,
                aborted: false
            };
        }
    }

    async eligibility(phone, conversation, files = [], onChunk, signal)
    {
        const promptText = this.prompts.eligibility();

        const cacheId = await this.resolveCache(
            "universal",
            "wira-eligibility",
            promptText,
            this.model,
            this.ttl
        );

        const result = await AI.runWiraGeminiCall({
            conversation: conversation,
            cacheId: cacheId,
            modelName: this.model,
            temperature: 1,
            streaming: true,
            jsonMode: true,
            onChunk: onChunk,
            signal: signal
        });

        if(result.aborted)
        {
            return {
                output: null,
                aborted: true
            };
        }

        this.#recordCost("wira-eligibility", this.model, result.usage, phone);

        try
        {
            const output = JSON.parse(result.text);

            return {
                output: output,
                aborted: false
            };
        }
        catch
        {
            console.error("❌ WiraGemini.eligibility: failed to parse response:", result.text);

            return {
                output: null,
                aborted: false
            };
        }
    }
}

module.exports = WiraGemini;