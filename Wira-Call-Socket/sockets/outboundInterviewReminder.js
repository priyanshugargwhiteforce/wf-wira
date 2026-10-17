const VoiceActivityManager = require("../CallManager/VoiceActivityManager");
const SarvamManager = require("../CallManager/SarvamManager");
const GeminiManager = require("../CallManager/GeminiManager");
const PlivoManager = require("../CallManager/PlivoManager");
const RedisManager = require("../CallManager/RedisManager");
const DatabaseManager = require("../CallManager/DatabaseManager");
const { runGeminiCall } = require("@wira/shared/AI/executeAI");
const {
    getInterviewReminderSystemPrompt,
    parseControlTags,
} = require("@wira/shared/AI/interviewReminder/interviewPrompts");

const redis = new RedisManager();

class InterviewReminderCallManager
{
    constructor(socket, callUUID, session)
    {
        this.socket = socket;
        this.callUUID = callUUID;
        this.session = session;

        this.isUserSpeaking = false;
        this.isSarvamRunning = false;
        this.isGeminiRunning = false;
        this.isPlivoSpeaking = false;

        this.streamId = null;
        this.introSpoken = false;
        this.vadGateOpen = false;
        this.killPending = false;
        this.turnCount = 0;

        this.language = session.language || "hi";
        this.idleWarningText = session.idleWarningText || "क्या आप अभी भी लाइन पर हैं?";
        this.idleDisconnectText = session.idleDisconnectText || "कोई जवाब न मिलने के कारण यह कॉल अब समाप्त की जा रही है।";

        this.vam = null;
        this.sarvam = null;
        this.gemini = null;
        this.plivo = null;
        this.db = null;
        this.sttRetryActive = false;
    }

    async init()
    {
        const sarvamLanguageCodes = {
            hi: "hi-IN",
            en: "en-IN",
            bn: "bn-IN",
            gu: "gu-IN",
            kn: "kn-IN",
            ml: "ml-IN",
            mr: "mr-IN",
            or: "od-IN",
            pa: "pa-IN",
            ta: "ta-IN",
            te: "te-IN",
        };

        const langCode = sarvamLanguageCodes[this.language] || "hi-IN";

        this.sarvam = new SarvamManager(
            { languageCode: langCode, sampleRate: 16000 },
            { speaker: "neha", language: this.language },
            redis,
        );
        this.sarvam.language = this.language;

        this.gemini = new GeminiManager(redis);
        this.plivo = new PlivoManager(redis);
        this.plivo.attachSocket(this.socket);

        this.db = new DatabaseManager({ speaker: "neha", languageCode: langCode });
        this.db.updateCallStatus(this.session.wiraCallId, "in_progress");

        this.vam = new VoiceActivityManager({
            ...(this.session.callConfig?.vad ?? {}),
            onSpeechRealStart: () => this.#onSpeechRealStart(),
            onSpeechChunk: (mulawBuffer) => this.#onSpeechChunk(mulawBuffer),
            onSpeechEnd: () => this.#onSpeechEnd(),
        });

        this.#initSTTWithRetry();

        await redis.startCostTracking(this.callUUID, async () =>
        {
            if (this.sarvam)
            {
                await this.sarvam.flushSTTCost();
            }
        });

        this.plivo.startBilling(this.callUUID);

        // Max 3 minutes for reminder call
        this.vam.startMaxCallTimer(180000, async () =>
        {
            await this.plivo.hangupCall(this.callUUID);
        });
    }

    #initSTTWithRetry()
    {
        this.sttRetryActive = true;

        const tryConnect = () =>
        {
            if (!this.sttRetryActive || !this.sarvam || !this.callUUID)
            {
                return;
            }

            this.sarvam
                .initSTT(
                    this.callUUID,
                    (transcript) => this.#onTranscript(transcript),
                    null,
                    () =>
                    {
                        if (!this.sttRetryActive)
                        {
                            return;
                        }

                        console.warn(`⚠️ [STT Reminder] Socket closed mid-call, reconnecting...`);
                        setTimeout(() => tryConnect(), 1000);
                    },
                )
                .then(() =>
                {
                    console.log(`✅ [STT Reminder Init] Connected for: ${this.callUUID}`);
                })
                .catch((err) =>
                {
                    if (!this.sttRetryActive)
                    {
                        return;
                    }

                    console.warn(`⚠️ [STT Reminder Init] Failed, retrying in 3s: ${err.message}`);
                    setTimeout(() => tryConnect(), 3000);
                });
        };

        tryConnect();
    }

    #abortAll()
    {
        console.log(`🚫 [Reminder Abort] Killing media streams`);

        if (this.sarvam)
        {
            this.sarvam.abortTTS(this.callUUID, 0);
        }

        if (this.gemini)
        {
            this.gemini.abort();
        }

        if (this.plivo)
        {
            this.plivo.clearAudio();
        }

        this.vam.clearIdleTimers();

        this.isGeminiRunning = false;
        this.isSarvamRunning = false;
        this.isPlivoSpeaking = false;

        if (this.killPending)
        {
            console.log(`💀 [Reminder Kill] Hanging up call after kill tag`);
            this.plivo.hangupCall(this.callUUID);
        }
    }

    #onSpeechRealStart()
    {
        if (!this.vadGateOpen)
        {
            return;
        }

        if (this.killPending)
        {
            console.log(`💀 [Reminder VAD Kill] Speech detected after killTag — hanging up immediately`);
            this.#abortAll();
            this.plivo.hangupCall(this.callUUID);
            return;
        }

        this.isUserSpeaking = true;
        console.log(
            `🗣️ [VAD Reminder] Speech started — gemini: ${this.isGeminiRunning}, sarvam: ${this.isSarvamRunning}, plivo: ${this.isPlivoSpeaking}`,
        );

        this.vam.clearIdleTimers();

        if (this.isGeminiRunning || this.isSarvamRunning || this.isPlivoSpeaking)
        {
            this.#abortAll();
        }
    }

    #onSpeechChunk(mulawBuffer)
    {
        if (!this.vadGateOpen)
        {
            return;
        }

        this.sarvam.sendAudio(this.callUUID, mulawBuffer);
    }

    #onSpeechEnd()
    {
        if (!this.vadGateOpen)
        {
            return;
        }

        console.log(`🗣️ [VAD Reminder] Speech ended`);
        this.isUserSpeaking = false;
        this.vam.clearIdleTimers();
        this.sarvam.pauseSTTTimer();
        this.sarvam.flushSTT();
    }

    async #onTranscript(transcript)
    {
        const userText = typeof transcript === "string" ? transcript.trim() : (transcript?.text?.trim() || "");
        if (!this.vadGateOpen || !userText)
        {
            return;
        }

        if (
            this.isUserSpeaking ||
            this.isGeminiRunning ||
            this.isSarvamRunning ||
            this.isPlivoSpeaking
        )
        {
            return;
        }

        console.log(`🗣️ [Candidate Transcript]: "${userText}"`);

        const session = await redis.getSession(this.callUUID);
        if (!session)
        {
            return;
        }

        session.transcript = session.transcript || [];
        session.transcript.push({
            role: "user",
            content: userText,
        });

        await redis.saveSession(this.callUUID, session);
        this.vam.clearIdleTimers();

        this.#runInterviewReminderAITurn(session, userText).catch((err) =>
        {
            console.error(`❌ [Reminder AI Turn] Error:`, err.message);
        });
    }

    async #runInterviewReminderAITurn(session, userTranscript)
    {
        this.isGeminiRunning = true;
        this.isSarvamRunning = true;
        this.isPlivoSpeaking = true;
        this.turnCount++;

        if (this.gemini)
        {
            this.gemini.abortController = new AbortController();
        }

        try
        {
            const systemPrompt = getInterviewReminderSystemPrompt({
                candidateName: session.candidateName || session.name,
                companyName: session.companyName,
                jobTitle: session.jobTitle,
                interviewDate: session.interviewDate,
                interviewTime: session.interviewTime,
                interviewVenue: session.interviewVenue,
                language: this.language,
            });

            const messages = (session.transcript || []).map((t) => ({
                role: t.role,
                content: t.content,
            }));

            const ttsPromise = this.sarvam.openTTSStream(
                this.callUUID,
                (base64Audio) =>
                {
                    if (
                        !this.isUserSpeaking &&
                        (this.isGeminiRunning || this.isSarvamRunning)
                    )
                    {
                        this.plivo.sendAudio(base64Audio);
                    }
                },
                () =>
                {
                    this.isSarvamRunning = false;
                    if (!this.isUserSpeaking)
                    {
                        this.plivo.sendTTSComplete();
                    }
                },
                () => this.isUserSpeaking,
            );

            let tagBuffer = "";

            const { text: rawText, usage } = await runGeminiCall({
                conversation: messages,
                prompt: systemPrompt,
                modelName: "gemini-3.1-flash-lite",
                temperature: 0.4,
                streaming: true,
                onChunk: (chunk) =>
                {
                    if (this.isUserSpeaking)
                    {
                        return;
                    }

                    tagBuffer += chunk;

                    // Strip any fully completed control tags from the buffer
                    tagBuffer = tagBuffer
                        .replace(/<kill>/gi, "")
                        .replace(/<\/kill>/gi, "")
                        .replace(/<status:[^>]*>/gi, "")
                        .replace(/<reschedule_time:[^>]*>/gi, "")
                        .replace(/<problem_reason:[^>]*>/gi, "");

                    // If there is an unclosed tag starting with '<', hold back until closing '>' arrives
                    const unclosedIndex = tagBuffer.lastIndexOf("<");
                    let textToSend = "";

                    if (unclosedIndex !== -1 && tagBuffer.indexOf(">", unclosedIndex) === -1)
                    {
                        textToSend = tagBuffer.substring(0, unclosedIndex);
                        tagBuffer = tagBuffer.substring(unclosedIndex);
                    }
                    else
                    {
                        textToSend = tagBuffer;
                        tagBuffer = "";
                    }

                    if (textToSend)
                    {
                        this.sarvam.sendTTSChunk(textToSend);
                    }
                },
                signal: this.gemini?.abortController?.signal ?? null,
            });

            // Flush any remaining text in tagBuffer if it's not a tag
            if (tagBuffer && !this.isUserSpeaking)
            {
                const finalClean = tagBuffer
                    .replace(/<kill>/gi, "")
                    .replace(/<\/kill>/gi, "")
                    .replace(/<status:[^>]*>/gi, "")
                    .replace(/<reschedule_time:[^>]*>/gi, "")
                    .replace(/<problem_reason:[^>]*>/gi, "")
                    .trim();

                if (finalClean)
                {
                    this.sarvam.sendTTSChunk(finalClean);
                }
                tagBuffer = "";
            }

            if (usage)
            {
                await redis.recordGemini(this.callUUID, usage);
            }

            const parsed = parseControlTags(rawText);

            console.log(`🎙️ [Reminder AI]: "${parsed.cleanText}"`);
            if (parsed.status)
            {
                console.log(`📋 [Reminder Intent]: status=${parsed.status} | reschedule=${parsed.rescheduleTime} | problem=${parsed.problemReason}`);
            }

            const currentSession = await redis.getSession(this.callUUID);
            if (currentSession)
            {
                if (parsed.cleanText)
                {
                    currentSession.transcript.push({
                        role: "assistant",
                        content: parsed.cleanText,
                    });
                }

                if (parsed.status)
                {
                    currentSession.interviewStatus = parsed.status;
                }

                if (parsed.rescheduleTime)
                {
                    currentSession.rescheduledTime = parsed.rescheduleTime;
                }

                if (parsed.problemReason)
                {
                    currentSession.problemReason = parsed.problemReason;
                }

                await redis.saveSession(this.callUUID, currentSession);
            }

            this.isGeminiRunning = false;
            this.sarvam.flushTTSStream();

            await ttsPromise;

            if (this.isUserSpeaking)
            {
                return;
            }

            if (parsed.kill)
            {
                console.log(`💀 [Reminder Kill] Hangup queued after TTS`);
                this.killPending = true;
                return;
            }
        }
        catch (err)
        {
            console.error(`❌ [Reminder AI Turn] Failed:`, err.message);
        }
        finally
        {
            this.isGeminiRunning = false;
            this.isSarvamRunning = false;
        }
    }

    #startIdleTimers()
    {
        this.vam.startIdleTimers(
            { warningAfterMs: 7000, disconnectAfterMs: 15000 },
            async () =>
            {
                const audio = await this.db.getIdleAudio(this.idleWarningText);
                if (audio)
                {
                    this.plivo.sendAudio(audio);
                }
            },
            async () =>
            {
                const audio = await this.db.getIdleAudio(this.idleDisconnectText);
                if (audio)
                {
                    this.plivo.sendAudio(audio);
                }
                this.plivo.sendCheckpoint("end_call");
            },
        );
    }

    async onMediaPacket(payload)
    {
        if (!this.vadGateOpen || !this.vam || !this.sarvam)
        {
            return;
        }

        try
        {
            await this.vam.process(payload);
        }
        catch (err)
        {
            console.error(`❌ [Reminder VAM Process] Error:`, err.message);
        }
    }

    async onPlayedStream(name)
    {
        console.log(`▶️ [playedStream Reminder] ${name}`);

        if (name === "intro_spoken")
        {
            try
            {
                await this.vam.init();
            }
            catch (vadErr)
            {
                console.error(`⚠️ [Reminder VAM Init] Failed to init VAD:`, vadErr.message);
            }

            this.vadGateOpen = true;
            this.#startIdleTimers();
            console.log(`✅ [Reminder Intro] VAD gate open, listening to candidate`);
            return;
        }

        if (name === "tts_complete")
        {
            this.isPlivoSpeaking = false;

            if (this.killPending)
            {
                this.killPending = false;
                await this.plivo.hangupCall(this.callUUID);
            }
            else
            {
                this.#startIdleTimers();
            }

            return;
        }

        if (name === "end_call")
        {
            await this.plivo.hangupCall(this.callUUID);
        }
    }

    async speakIntro()
    {
        if (this.introSpoken)
        {
            return;
        }

        this.introSpoken = true;

        if (!this.plivo.streamSid && this.streamId)
        {
            this.plivo.setStreamId(this.streamId);
        }

        let introAudio = await redis.getIntroAudioAndInit(this.callUUID);

        if (!introAudio && this.session.intro)
        {
            console.warn(`⚠️ [Reminder Intro] Redis intro audio empty, attempting DB fallback for: "${this.session.intro}"`);
            introAudio = await this.db.getIdleAudio(this.session.intro);
        }

        if (!introAudio)
        {
            console.error(`❌ [Reminder Intro] No intro audio found for call: ${this.callUUID}`);
            return;
        }

        this.plivo.sendAudio(introAudio);
        this.plivo.sendCheckpoint("intro_spoken");
    }

    async destroy()
    {
        this.sttRetryActive = false;

        if (this.plivo)
        {
            this.plivo.destroy(this.callUUID);
        }

        if (this.sarvam)
        {
            await this.sarvam.destroy(this.callUUID);
        }

        if (this.gemini)
        {
            this.gemini.destroy();
        }

        if (this.vam)
        {
            this.vam.destroy();
        }

        this.db.updateCallStatus(this.session.wiraCallId, "finalizing");
        const session = await redis.getSession(this.callUUID);
        const outboundScreeningId = session?.wiraOutboundScreeningId ?? null;

        await redis.stopCostTracking(this.callUUID, outboundScreeningId, this.db);
    }
}

async function waitForSession(callUUID, maxAttempts = 20, intervalMs = 1000)
{
    for (let i = 0; i < maxAttempts; i++)
    {
        const session = await redis.getSession(callUUID);
        if (session)
        {
            return session;
        }

        console.warn(`⏳ [Reminder Init] Session not ready, retrying... (${i + 1}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return null;
}

async function outboundInterviewReminderSocket(socket)
{
    const callUUID = socket.callId;

    const session = await waitForSession(callUUID);

    if (!session)
    {
        console.error(`❌ [Reminder Init] No session found for: ${callUUID}`);
        return;
    }

    const call = new InterviewReminderCallManager(socket, callUUID, session);

    try
    {
        await call.init();
    }
    catch (err)
    {
        console.error(`❌ [Reminder Init] InterviewReminderCallManager.init failed:`, err.message);
        return;
    }

    socket.on("message", async (message) =>
    {
        try
        {
            const packet = JSON.parse(message);

            if (packet.event === "start")
            {
                call.streamId = packet.start?.streamId ?? packet.streamId ?? null;
                if (call.streamId)
                {
                    call.plivo.setStreamId(call.streamId);
                }
            }

            if (packet.event === "media")
            {
                if (!call.streamId)
                {
                    call.streamId =
                        packet.start?.streamId ??
                        packet.media?.streamId ??
                        packet.streamId ??
                        null;

                    if (call.streamId)
                    {
                        call.plivo.setStreamId(call.streamId);
                    }
                }

                if (!call.introSpoken)
                {
                    await call.speakIntro();
                    return;
                }

                call.onMediaPacket(packet.media.payload);
            }

            if (packet.event === "playedStream")
            {
                await call.onPlayedStream(packet.name);
            }

            if (packet.event === "stop")
            {
                console.log(`🛑 [Reminder Stream] Stop received for: ${callUUID}`);
            }

            if (packet.event === "incorrectPayload")
            {
                console.error(`❌ [incorrectPayload Reminder]:`, JSON.stringify(packet));
            }
        }
        catch (err)
        {
            console.error(`❌ [Reminder Socket] Message error:`, err.message);
        }
    });

    socket.on("close", async (closeCode, reason) =>
    {
        console.log(`❌ [Reminder Socket] Closed — call: ${callUUID} | code: ${closeCode} | reason: ${reason?.toString()}`);
        await call.destroy();
    });
}

module.exports = outboundInterviewReminderSocket;
