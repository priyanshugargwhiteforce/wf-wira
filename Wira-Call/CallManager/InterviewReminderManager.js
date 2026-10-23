const validator = require("validator");
const sarvamHandler = require("@wira/shared/Utility/sarvamHandler");
const InterviewReminderQueueManager = require("./InterviewReminderQueueManager");
const {
    evaluateScreeningEligibility,
    buildInterviewReminderIntroText
} = require("@wira/shared/AI/interviewReminder/interviewPrompts");

/**
 * InterviewReminderManager
 * 
 * Orchestrates interview reminder calls:
 * - Validates candidate screening qualification (score >= 50%, MEDIUM/HIGH interest, fulfilled)
 * - Generates multilingual intro TTS audio batch
 * - Persists call records to PostgreSQL and transient session to Redis
 * - Queues calls into dedicated InterviewReminderQueueManager
 * - Flushes billing costs and interview outcomes upon call termination
 */
class InterviewReminderManager
{
    constructor(
        redis,
        database,
        phonePool,
        perNumberConcurrency,
        languageToSarvamCodes,
        defaultVad,
        availableCallTypes,
    )
    {
        this.redis = redis;
        this.database = database;
        this.phonePool = phonePool;
        this.perNumberConcurrency = perNumberConcurrency;
        this.languageToSarvamCodes = languageToSarvamCodes;
        this.defaultVad = defaultVad;
        this.availableCallTypes = availableCallTypes;

        // OLD: dedicated env number with fallback to screening pool
        // const reminderNumber = process.env.PLIVO_REMINDER_PHONE_NUMBER;
        // this.reminderPhonePool = reminderNumber ? [reminderNumber] : [...this.phonePool];

        // Reminder calls dial from the screening numbers, but slots are tracked
        // separately in "reminder-active-calls" — screening concurrency is untouched.
        this.reminderPhonePool = [...this.phonePool];

        // Max live reminder calls at a time, across all numbers
        this.maxActiveCalls = 10;

        // Session must survive queue wait (call window / busy slots)
        this.sessionTTLSeconds = 86400;

        // Intro TTS speed — slightly faster than the shared default 1.15
        this.introPace = 1.25;

        this.reminderQueueManager = new InterviewReminderQueueManager(
            this.redis,
            this.database,
        );
        this.reminderQueueManager.phonePool = this.reminderPhonePool;
        this.reminderQueueManager.perNumberConcurrency = this.perNumberConcurrency;
        this.reminderQueueManager.maxActiveCalls = this.maxActiveCalls;
        this.reminderQueueManager.initWorker();
    }

    deepMerge(target, source)
    {
        const output = Object.assign({}, target);

        if (this.#isObject(target) && this.#isObject(source))
        {
            Object.keys(source).forEach((key) =>
            {
                if (this.#isObject(source[key]))
                {
                    if (!(key in target))
                    {
                        Object.assign(output, { [key]: source[key] });
                    }
                    else
                    {
                        output[key] = this.deepMerge(target[key], source[key]);
                    }
                }
                else
                {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }

        return output;
    }

    #isObject(item)
    {
        return item && typeof item === "object" && !Array.isArray(item);
    }

    /**
     * Check if candidate passed previous screening call
     */
    async #verifyCandidateScreeningEligibility(phone, candidateId, jobId)
    {
        try
        {
            let candidateRecord = null;

            if (candidateId)
            {
                const res = await this.database.db.fetchWiraCandidates({ id: candidateId });
                candidateRecord = res?.rows?.[0] ?? null;
            }
            else if (phone)
            {
                const res = await this.database.db.fetchWiraCandidates({ phone });
                candidateRecord = res?.rows?.[0] ?? null;
            }

            if (!candidateRecord)
            {
                // If candidate record does not exist yet, allow reminder setup if direct call
                return {
                    eligible: true,
                    screeningFound: false,
                    reason: "No previous candidate record found, skipping screening pre-filter."
                };
            }

            // Find previous calls for this candidate
            const callsResult = await this.database.db.fetchWiraCalls({
                wiraCandidateId: candidateRecord.id,
                type: "outbound-screening"
            });

            const screeningCalls = callsResult?.rows ?? [];
            if (screeningCalls.length === 0)
            {
                return {
                    eligible: true,
                    screeningFound: false,
                    reason: "No screening call history found for candidate."
                };
            }

            // Prefer latest completed screening call over failed/cancelled attempts
            const targetCall = screeningCalls.find((c) => c.status === "completed") || screeningCalls[0];
            const screeningDataResult = await this.database.db.fetchWiraOutboundScreenings({
                wiraCallId: targetCall.id
            });
            const latestScreening = screeningDataResult?.rows?.[0] ?? null;

            const evaluation = evaluateScreeningEligibility(latestScreening, targetCall);

            if (!evaluation.qualified)
            {
                return {
                    eligible: false,
                    screeningFound: true,
                    reason: evaluation.reason,
                    score: evaluation.score,
                    jobInterest: evaluation.jobInterest,
                    hangupCause: evaluation.hangupCause
                };
            }

            return {
                eligible: true,
                screeningFound: true,
                reason: "Candidate qualified with screening score >= 50% and MEDIUM/HIGH interest.",
                score: evaluation.score,
                jobInterest: evaluation.jobInterest
            };
        }
        catch (error)
        {
            console.error("❌ Error verifying screening eligibility:", error.message);
            // In case of DB read error, allow safe fallback so system doesn't crash
            return {
                eligible: true,
                screeningFound: false,
                reason: "Error checking screening eligibility, bypassing check: " + error.message
            };
        }
    }

    async checkEligibility({ phone, candidateId, jobId })
    {
        return this.#verifyCandidateScreeningEligibility(phone, candidateId, jobId);
    }

    /**
     * Builds reminder intro audio at `introPace` (slightly faster than the shared 1.15).
     * Intros are personalised (name/date/time), so they are generated directly and not
     * written to the shared intro_audio_template cache.
     * Returns the same shape as WiraDatabase.getOrBuildAudioBatch: { cacheMap, preCostChars }.
     */
    async #buildIntroAudioBatch(textsWithLanguages, ttsSpeaker)
    {
        const cacheMap = new Map();
        let preCostChars = 0;

        const buildOne = async (entry) =>
        {
            for (let attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    const result = await sarvamHandler.sarvamTTS({
                        text: entry.text,
                        languageCode: entry.languageCode,
                        speaker: ttsSpeaker,
                        pace: this.introPace,
                    });

                    const audio = result?.audios?.[0] ?? null;

                    if (audio)
                    {
                        cacheMap.set(`${entry.languageCode}:${entry.text}`, audio);
                        preCostChars += entry.text.length;
                    }

                    return;
                }
                catch (error)
                {
                    if (attempt === 3)
                    {
                        console.error("❌ [Reminder Intro] TTS failed for:", entry.text, error.message);
                        return;
                    }

                    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
                }
            }
        };

        // Small batches to stay within Sarvam rate limits
        for (let i = 0; i < textsWithLanguages.length; i += 3)
        {
            await Promise.all(textsWithLanguages.slice(i, i + 3).map(buildOne));
        }

        return {
            cacheMap,
            preCostChars,
        };
    }

    async handleIntroAudio(data)
    {
        try
        {
            const textsWithLanguages = [];
            const ttsSpeaker = "neha";

            data.forEach((item) =>
            {
                const candidateName = item.name || item.candidateName || "";
                const companyName = item.companyName || "White Force";
                const jobTitle = item.jobTitle || "the position";
                const interviewDate = item.interviewDate || "";
                const interviewTime = item.interviewTime || "";
                const interviewVenue = item.interviewVenue || "";
                const language = item.language || "hi";

                if (!item.intro)
                {
                    item.intro = buildInterviewReminderIntroText({
                        candidateName,
                        companyName,
                        jobTitle,
                        interviewDate,
                        interviewTime,
                        interviewVenue,
                        language
                    });
                }

                const langCode = this.languageToSarvamCodes[language] || "hi-IN";

                const alreadyAdded = textsWithLanguages.find(
                    (e) => e.text === item.intro && e.languageCode === langCode,
                );

                if (!alreadyAdded)
                {
                    textsWithLanguages.push({
                        text: item.intro,
                        languageCode: langCode,
                    });
                }
            });

            // OLD: shared cache builder — always generated at default pace 1.15
            // const audioBatchResult = await this.database.getOrBuildAudioBatch(
            //     textsWithLanguages,
            //     ttsSpeaker,
            // );
            const audioBatchResult = await this.#buildIntroAudioBatch(
                textsWithLanguages,
                ttsSpeaker,
            );

            if (!audioBatchResult || !audioBatchResult.cacheMap)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to generate intro audios for interview reminder call.",
                    data: null,
                };
            }

            data.forEach((item) =>
            {
                const language = item.language || "hi";
                const langCode = this.languageToSarvamCodes[language] || "hi-IN";
                const audio = audioBatchResult.cacheMap.get(`${langCode}:${item.intro}`);

                if (audio)
                {
                    item.introAudio = audio;
                }
            });

            const missingAudio = data.find((item) => !item.introAudio);
            if (missingAudio)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to generate intro audio for candidate: " + (missingAudio.name || missingAudio.to),
                    data: null,
                };
            }

            return {
                statusCode: 200,
                success: true,
                message: "Interview reminder intro audios mapped successfully.",
                data: {
                    items: data,
                    preCostChars: audioBatchResult.preCostChars,
                },
            };
        }
        catch (error)
        {
            console.error("❌ Error generating intro audio in interview reminder call:", error);

            return {
                statusCode: 500,
                success: false,
                message: "Internal Server Error.",
                data: null,
            };
        }
    }

    async validateReminderBody(data)
    {
        try
        {
            const validityPromises = data.map(async (body, index) =>
            {
                const missingFieldMessages = [];

                if (!body.to)
                {
                    missingFieldMessages.push("To number is required.");
                }
                else if (!validator.isMobilePhone(body.to, "any"))
                {
                    missingFieldMessages.push("Invalid To number.");
                }

                if (!body.type)
                {
                    missingFieldMessages.push("Call type is required.");
                }

                if (!body.companyName)
                {
                    missingFieldMessages.push("Company name is required.");
                }

                if (missingFieldMessages.length > 0)
                {
                    return {
                        statusCode: 400,
                        success: false,
                        message: "Fields Missing.",
                        data: { missingFieldMessages },
                    };
                }

                return {
                    statusCode: 200,
                    success: true,
                    message: "Interview reminder call body validated successfully.",
                    data: body,
                };
            });

            const validity = await Promise.all(validityPromises);

            if (validity.find((item) => item.success !== true))
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "Validation failed for interview reminder call.",
                    data: validity,
                };
            }

            const payload = await this.createBodyPayload(data);
            if (!payload.success)
            {
                return payload;
            }

            const finalResponse = await this.handleDatabaseAndRedisSave(payload);
            return finalResponse;
        }
        catch (error)
        {
            console.error("❌ Error occurred validating interview reminder body:", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal Server Error.",
                data: null,
            };
        }
    }

    async createBodyPayload(data)
    {
        try
        {
            const audioResult = await this.handleIntroAudio(data);

            if (!audioResult.success)
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Failed to fetch Intro Audio in interview reminder call.",
                    data: null,
                };
            }

            const enrichedItems = audioResult.data.items;
            const preCostChars = audioResult.data.preCostChars;

            const finalArray = enrichedItems.map((item) =>
            {
                const candidateName = item.name || item.candidateName || "Candidate";
                const language = item.language || "hi";
                const langCode = this.languageToSarvamCodes[language] || "hi-IN";

                const callConfig = item.callConfig
                    ? this.deepMerge(this.defaultVad, item.callConfig)
                    : this.deepMerge({}, this.defaultVad);

                callConfig.tts = { speaker: "neha", languageCode: langCode };
                callConfig.stt = { languageCode: langCode, sampleRate: 16000 };
                callConfig.language = language;

                const idleWarningText = this.defaultVad?.messages?.idleWarning?.[language] || "क्या आप अभी भी लाइन पर हैं?";
                const idleDisconnectText = this.defaultVad?.messages?.idleDisconnect?.[language] || "कोई जवाब न मिलने के कारण यह कॉल अब समाप्त की जा रही है।";

                return {
                    to: item.to,
                    from: this.reminderPhonePool[0],
                    name: candidateName,
                    candidateName: candidateName,
                    email: item.email ?? null,
                    jobTitle: item.jobTitle || "the position",
                    companyName: item.companyName,
                    jobId: item.jobId ?? null,
                    interviewDate: item.interviewDate ?? null,
                    interviewTime: item.interviewTime ?? null,
                    interviewVenue: item.interviewVenue ?? null,
                    type: item.type,
                    intro: item.intro,
                    introAudio: item.introAudio ?? null,
                    callConfig: callConfig,
                    language: language,
                    idleWarningText: idleWarningText,
                    idleDisconnectText: idleDisconnectText,
                    status: "initiated",
                    startedAt: new Date().toISOString(),
                    startTime: null,
                    transcript: [],
                    recordingUrl: null,
                    hangupBy: null,
                    hangupCause: null,
                    endedAt: null,
                    duration: null,
                    preCostChars: preCostChars,
                    priority: item.priority ?? 0,
                    interviewOutcome: null,
                };
            });

            return {
                statusCode: 200,
                success: true,
                message: "Body payload created successfully.",
                data: finalArray,
            };
        }
        catch (error)
        {
            console.error("❌ Error creating reminder call payload:", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal Server Error.",
                data: null,
            };
        }
    }

    async handleDatabaseAndRedisSave(payload)
    {
        try
        {
            const items = payload.data;
            const isSingle = items.length === 1;
            const results = [];

            for (const item of items)
            {
                try
                {
                    const wiraCandidate = await this.database.candidateFindOrCreate(
                        item.to,
                        item.email ?? null,
                        null,
                        item.name ?? null,
                        null,
                    );

                    if (!wiraCandidate)
                    {
                        results.push({
                            to: item.to,
                            from: item.from,
                            success: false,
                            message: "Failed to find or create candidate.",
                        });
                        continue;
                    }

                    const { call: wiraCall, screening: wiraOutboundScreening } =
                        await this.database.createCallWithScreening({
                            wiraCandidateId: wiraCandidate.id,
                            fromPhone: item.from,
                            type: item.type,
                            jobId: item.jobId,
                            jobTitle: `Interview Reminder - ${item.jobTitle}`,
                            jobDescription: `Interview: ${item.jobTitle} at ${item.companyName} | Date: ${item.interviewDate || "N/A"} | Time: ${item.interviewTime || "N/A"} | Venue: ${item.interviewVenue || "N/A"}`,
                            companyName: item.companyName,
                            intro: item.intro,
                            screeningQuestions: [],
                            preCost: 0,
                            language: item.language,
                        });

                    if (!wiraCall || !wiraOutboundScreening)
                    {
                        results.push({
                            to: item.to,
                            from: item.from,
                            success: false,
                            message: "Failed to create call record in database.",
                        });
                        continue;
                    }

                    item.wiraCallId = wiraCall.id;
                    item.wiraOutboundScreeningId = wiraOutboundScreening.id;
                    item.wiraCandidateId = wiraCandidate.id;

                    await this.redis.set(
                        `screening:callId:${wiraCall.id}`,
                        JSON.stringify(item),
                        "EX",
                        // OLD: 3600
                        this.sessionTTLSeconds,
                    );

                    const queueResult = await this.reminderQueueManager.pushToQueue(
                        item.to,
                        wiraCall.id,
                        item.priority,
                    );

                    if (!queueResult.success)
                    {
                        results.push({
                            to: item.to,
                            from: item.from,
                            success: false,
                            message: "Failed to add reminder call to queue.",
                        });
                        continue;
                    }

                    results.push({
                        to: item.to,
                        from: item.from,
                        wiraCallId: wiraCall.id,
                        wiraCandidateId: wiraCandidate.id,
                        wiraOutboundScreeningId: wiraOutboundScreening.id,
                        success: true,
                        message: "Interview reminder call queued successfully.",
                    });
                }
                catch (itemError)
                {
                    console.error("❌ Error processing single reminder item:", itemError.message);
                    results.push({
                        to: item.to,
                        from: item.from,
                        success: false,
                        message: itemError.message,
                    });
                }
            }

            if (isSingle)
            {
                const single = results[0];
                return {
                    statusCode: single.success ? 200 : 500,
                    success: single.success,
                    message: single.message,
                    data: single.success ? single : null,
                };
            }

            const allSuccess = results.every((r) => r.success);
            return {
                statusCode: allSuccess ? 200 : 207,
                success: allSuccess,
                message: allSuccess
                    ? "All interview reminder calls queued successfully."
                    : "Some calls failed to queue.",
                data: results,
            };
        }
        catch (error)
        {
            console.error("❌ Error in handleDatabaseAndRedisSave (reminder):", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Internal Server Error.",
                data: null,
            };
        }
    }

    async handleInterviewReminderCall(items)
    {
        try
        {
            const body = Array.isArray(items) ? items : [items];
            if (body.length === 0)
            {
                return {
                    statusCode: 400,
                    success: false,
                    message: "Request body is required.",
                    data: null,
                };
            }

            const result = await this.validateReminderBody(body);
            return result;
        }
        catch (error)
        {
            console.error("❌ Error in handleInterviewReminderCall:", error);

            return {
                statusCode: 500,
                success: false,
                message: "Internal server error.",
                data: null,
            };
        }
    }

    async flushCallEnd(callUUID, hangupBy, callStatus, session)
    {
        try
        {
            const costRaw = await this.redis.get(`cost:callId:${callUUID}`);
            const costRecord = costRaw ? JSON.parse(costRaw) : null;

            const endedAt = new Date();
            const startedAt = session.startTime ? new Date(session.startTime) : null;
            const durationSeconds = startedAt
                ? Math.floor((endedAt - startedAt) / 1000)
                : null;

            const allBuckets = [...(costRecord?.buckets ?? [])];
            const currentBucket = costRecord?.currentBucket;

            if (currentBucket && currentBucket.totalCost > 0)
            {
                allBuckets.push(currentBucket);
            }

            const sarvamTotal = allBuckets.reduce(
                (sum, b) => sum + (b.sarvamTTS?.cost ?? 0) + (b.sarvamSTT?.cost ?? 0),
                0,
            );
            const plivoTotal = allBuckets.reduce(
                (sum, b) => sum + (b.plivo?.cost ?? 0),
                0,
            );
            const geminiTotal = allBuckets.reduce(
                (sum, b) => sum + (b.gemini?.cost ?? 0),
                0,
            );

            const costSummary = {
                sarvamTotal: sarvamTotal,
                plivoTotal: plivoTotal,
                geminiTotal: geminiTotal,
                updatedPreCost: 0,
                updatedGeminiPostCost: 0,
                grandTotal: sarvamTotal + plivoTotal + geminiTotal,
            };

            // Map outcome to summary and interest
            const interviewStatus = session.interviewStatus || "unknown";
            let summaryText = `Interview Reminder Call for ${session.candidateName || "Candidate"} regarding ${session.jobTitle || "role"}. Status: ${interviewStatus}.`;
            if (session.rescheduledTime)
            {
                summaryText += ` Rescheduled to: ${session.rescheduledTime}.`;
            }
            if (session.problemReason)
            {
                // OLD: summaryText += ` Candidate concern: ${session.problemReason}.`;
                const reasonLabel = interviewStatus === "declined" ? "Decline reason" : "Candidate concern";
                summaryText += ` ${reasonLabel}: ${session.problemReason}.`;
            }
            if (session.referral)
            {
                summaryText += ` Referral: ${session.referral}.`;
            }

            // Voicemail / call assistant answered → candidate was never reached: no interest, score 0
            const isVoicemail = interviewStatus === "voicemail";
            if (isVoicemail)
            {
                summaryText += " Voicemail / call assistant answered — candidate not reached.";
            }

            // OLD: voicemail fell into the default "MEDIUM" interest / score 50
            const interestValue = isVoicemail
                ? null
                : (interviewStatus === "confirmed" ? "HIGH" : (interviewStatus === "declined" ? "LOW" : "MEDIUM"));

            const analysisResult = {
                cleanTranscript: session.transcript || [],
                qna: [],
                interest: interestValue,
                hangupCause: session.hangupCause || callStatus,
                score: isVoicemail ? 0 : (interviewStatus === "confirmed" ? 100 : (interviewStatus === "rescheduled" ? 75 : 50)),
                scoreReason: summaryText,
                summary: summaryText,
                geminiPostCost: 0,
                jobInterest: interestValue
            };

            await this.database.persistCallEnd({
                session: session,
                analysisResult: analysisResult,
                costSummary: costSummary,
                callUUID: callUUID,
                callStatus: callStatus,
                hangupBy: hangupBy,
                durationSeconds: durationSeconds,
                endedAt: endedAt,
                startedAt: startedAt,
                buckets: allBuckets,
            });

            await this.redis.del(`screening:callId:${callUUID}`);
            await this.redis.del(`cost:callId:${callUUID}`);

            // OLD: await this.reminderQueueManager.deallocateNumber(session.fromPhone);
            await this.reminderQueueManager.releaseSlot(session.wiraCallId);
            console.log(`✅ [Interview Reminder] Call ${callUUID} successfully flushed and slot released.`);
        }
        catch (error)
        {
            console.error("❌ Error occurred in flushCallEnd in interview reminder manager:", error);
        }
    }
}

module.exports = InterviewReminderManager;
