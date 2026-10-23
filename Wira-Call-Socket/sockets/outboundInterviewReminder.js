const VoiceActivityManager = require("../CallManager/VoiceActivityManager");
const SarvamManager = require("../CallManager/SarvamManager");
const GeminiManager = require("../CallManager/GeminiManager");
const PlivoManager = require("../CallManager/PlivoManager");
const RedisManager = require("../CallManager/RedisManager");
const DatabaseManager = require("../CallManager/DatabaseManager");
const { runGeminiCall } = require("@wira/shared/AI/executeAI");
const sarvamHandler = require("@wira/shared/Utility/sarvamHandler");
const {
    getInterviewReminderSystemPrompt,
    parseControlTags,
} = require("@wira/shared/AI/interviewReminder/interviewPrompts");

const redis = new RedisManager();

// Sound must last this long while AI is speaking before it counts as a barge-in.
// VAD reports speech end ~384ms after sound stops, so ~0.4s noises are ignored.
// OLD: 800 — now shorter speech is judged by its transcript instead (see INTERRUPT_CHECK_WINDOW_MS)
const BARGE_IN_CONFIRM_MS = 1200;
const MAX_BARGE_IN_CHUNKS = 200;

// Short speech while AI is speaking is sent to STT; if its transcript arrives within
// this window and is a real question (not a filler), the AI stops and answers it.
const INTERRUPT_CHECK_WINDOW_MS = 5000;

// After the candidate stops speaking, if no reply has started within this time
// (noise / cough / STT returned nothing), restart the idle warning/disconnect timers
// so a silent call never hangs until the 3-minute limit.
const IDLE_RESUME_AFTER_SPEECH_MS = 3000;

// Fillers / backchannels that must not interrupt the AI
const BACKCHANNEL_WORDS = new Set([
    "हाँ", "हां", "हा", "जी", "हम्म", "हम", "हूँ", "हूं", "ओके", "अच्छा", "ठीक", "है", "हैं", "हेलो", "हैलो",
    "ok", "okay", "yes", "hmm", "haan", "ha", "ji", "acha", "achha", "theek", "hai", "hello",
]);

function isBackchannel(text)
{
    const words = String(text)
        .toLowerCase()
        .replace(/[।.,!?'"\-]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    return words.length > 0 && words.length <= 3 && words.every((word) => BACKCHANNEL_WORDS.has(word));
}

// Hang up anyway if Plivo never confirms the closing message finished playing
const KILL_FALLBACK_MS = 25000;

// Reminder-only VAD sensitivity (VoiceActivityManager default is 0.35 / 0.20)
const REMINDER_VAD_THRESHOLDS = {
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
};

// Idle warning/disconnect audio built on demand when missing from the DB cache.
// Kept in memory only, so screening's idle behaviour is not changed.
const idleAudioCache = new Map();

// Intro is sent as 1s playAudio messages (8kHz mulaw = 8000 bytes/sec), the same
// way live TTS is streamed, instead of one ~145KB message that was played cut short.
const MULAW_BYTES_PER_SEC = 8000;
const INTRO_CHUNK_BYTES = MULAW_BYTES_PER_SEC;

// 0.5s of mulaw silence (0xFF) before the intro, so the first words are not
// lost while the phone's audio path is still settling right after answer
const INTRO_LEAD_IN_SILENCE = Buffer.alloc(MULAW_BYTES_PER_SEC / 2, 0xFF).toString("base64");

function splitMulawAudio(base64Audio)
{
    let bytes = Buffer.from(base64Audio, "base64");

    // Drop a WAV container header if present, so it is not played as a click
    if (bytes.length > 44 && bytes.toString("ascii", 0, 4) === "RIFF")
    {
        const dataIndex = bytes.indexOf("data", 12, "ascii");

        if (dataIndex !== -1)
        {
            bytes = bytes.subarray(dataIndex + 8);
        }
    }

    const chunks = [];

    for (let offset = 0; offset < bytes.length; offset += INTRO_CHUNK_BYTES)
    {
        chunks.push(bytes.subarray(offset, offset + INTRO_CHUNK_BYTES).toString("base64"));
    }

    return {
        chunks: chunks,
        durationSec: bytes.length / MULAW_BYTES_PER_SEC,
    };
}

// Same effective rates GeminiManager uses for "gemini-3.1-flash-lite"
const GEMINI_USD_RATES = {
    inputPerToken: 0.25 / 1_000_000,
    cachedInputPerToken: 0.025 / 1_000_000,
    outputPerToken: 1.5 / 1_000_000,
};
const USD_TO_INR = 94.5;

// Max Plivo packets held while session/init is still loading (~60s of audio)
const MAX_PENDING_PACKETS = 3000;

// runGeminiCall returns raw usageMetadata; RedisManager.recordGemini expects
// { inputTokens, cachedInputTokens, outputTokens, cost }
function toGeminiCostUsage(usage)
{
    const inputTokens = usage?.promptTokenCount ?? 0;
    const cachedInputTokens = usage?.cachedContentTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const nonCachedTokens = Math.max(0, inputTokens - cachedInputTokens);

    const cost = (
        nonCachedTokens * GEMINI_USD_RATES.inputPerToken +
        cachedInputTokens * GEMINI_USD_RATES.cachedInputPerToken +
        outputTokens * GEMINI_USD_RATES.outputPerToken
    ) * USD_TO_INR;

    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        cost,
    };
}

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
        this.introSentAt = null;
        this.introDurationSec = 0;
        this.vadGateOpen = false;
        this.killPending = false;
        this.killFallbackTimer = null;
        this.hangupRequested = false;
        this.turnCount = 0;

        // Incremented on every abort so an aborted AI turn can be detected
        this.turnGeneration = 0;

        this.bargeInTimer = null;
        this.bargeInBuffer = [];

        // Until this time, an incoming transcript is treated as a possible mid-reply question
        this.interruptCheckUntil = 0;

        this.idleResumeTimer = null;

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

        // Warm idle audio now so the warning is not delayed when it fires
        this.#getIdleAudio(this.idleWarningText).catch(() => {});
        this.#getIdleAudio(this.idleDisconnectText).catch(() => {});

        this.vam = new VoiceActivityManager({
            ...REMINDER_VAD_THRESHOLDS,
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
            // OLD: await this.plivo.hangupCall(this.callUUID);
            await this.#hangupOnce("max call duration reached");
        });
    }

    #isAISpeaking()
    {
        return this.isGeminiRunning || this.isSarvamRunning || this.isPlivoSpeaking;
    }

    #clearBargeIn()
    {
        if (this.bargeInTimer)
        {
            clearTimeout(this.bargeInTimer);
            this.bargeInTimer = null;
        }

        this.bargeInBuffer = [];
    }

    #clearIdleResume()
    {
        if (this.idleResumeTimer)
        {
            clearTimeout(this.idleResumeTimer);
            this.idleResumeTimer = null;
        }
    }

    // Speech ended with nothing to reply to yet → if still nothing in a few seconds, resume idle timers
    #scheduleIdleResume()
    {
        this.#clearIdleResume();

        this.idleResumeTimer = setTimeout(() =>
        {
            this.idleResumeTimer = null;

            if (this.killPending || this.hangupRequested || this.isUserSpeaking || this.#isAISpeaking())
            {
                return;
            }

            console.log(`⏳ [Reminder Idle] No reply after candidate's sound — restarting idle timers`);
            this.#startIdleTimers();
        }, IDLE_RESUME_AFTER_SPEECH_MS);
    }

    #clearKillFallback()
    {
        if (this.killFallbackTimer)
        {
            clearTimeout(this.killFallbackTimer);
            this.killFallbackTimer = null;
        }
    }

    async #hangupOnce(reason)
    {
        if (this.hangupRequested)
        {
            return;
        }

        this.hangupRequested = true;
        this.#clearKillFallback();

        console.log(`📵 [Reminder Hangup] ${reason} — call: ${this.callUUID}`);
        await this.plivo.hangupCall(this.callUUID);
    }

    // Closing message decided by AI: ignore all speech from now, hang up once it finishes playing
    #scheduleKill()
    {
        if (this.killPending)
        {
            return;
        }

        this.killPending = true;
        this.#clearBargeIn();
        this.vam.clearIdleTimers();

        console.log(`💀 [Reminder Kill] Closing message — hangup after it finishes playing`);

        this.killFallbackTimer = setTimeout(() =>
        {
            this.killFallbackTimer = null;
            this.#hangupOnce("kill fallback — tts_complete not received");
        }, KILL_FALLBACK_MS);
    }

    async #getIdleAudio(text)
    {
        if (!text || !this.db)
        {
            return null;
        }

        const cacheKey = `${this.db.language}:${this.db.speaker}:${text}`;

        if (!idleAudioCache.has(cacheKey))
        {
            idleAudioCache.set(cacheKey, this.#loadOrBuildIdleAudio(text));
        }

        const audio = await idleAudioCache.get(cacheKey);

        // Failed build → allow a retry next time
        if (!audio)
        {
            idleAudioCache.delete(cacheKey);
        }

        return audio;
    }

    async #loadOrBuildIdleAudio(text)
    {
        const cachedAudio = await this.db.getIdleAudio(text);

        if (cachedAudio)
        {
            return cachedAudio;
        }

        try
        {
            const result = await sarvamHandler.sarvamTTS({
                text: text,
                languageCode: this.db.language,
                speaker: this.db.speaker,
            });

            const audio = result?.audios?.[0] ?? null;

            if (audio)
            {
                console.log(`✅ [Reminder Idle] Built idle audio for: "${text}" [${this.db.language}]`);
            }

            return audio;
        }
        catch (err)
        {
            console.error(`❌ [Reminder Idle] Failed to build idle audio for "${text}":`, err.message);
            return null;
        }
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

        this.turnGeneration++;
        this.#clearBargeIn();

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

        // OLD: hung up immediately here when killPending — cut the closing message mid-sentence
        // if (this.killPending)
        // {
        //     console.log(`💀 [Reminder Kill] Hanging up call after kill tag`);
        //     this.plivo.hangupCall(this.callUUID);
        // }
    }

    #onSpeechRealStart()
    {
        if (!this.vadGateOpen)
        {
            return;
        }

        // OLD: speech after kill tag → abort + immediate hangup (closing message got cut)
        // if (this.killPending)
        // {
        //     console.log(`💀 [Reminder VAD Kill] Speech detected after killTag — hanging up immediately`);
        //     this.#abortAll();
        //     this.plivo.hangupCall(this.callUUID);
        //     return;
        // }
        if (this.killPending)
        {
            console.log(`🔕 [VAD Reminder] Speech ignored — closing message is playing`);
            return;
        }

        // AI is speaking → do not stop it yet; confirm the sound is real speech first
        if (this.#isAISpeaking())
        {
            if (!this.bargeInTimer)
            {
                console.log(`⏳ [VAD Reminder] Sound while AI speaking — confirming barge-in (${BARGE_IN_CONFIRM_MS}ms)`);
                this.bargeInTimer = setTimeout(() => this.#confirmBargeIn(), BARGE_IN_CONFIRM_MS);
            }

            return;
        }

        this.isUserSpeaking = true;
        console.log(
            `🗣️ [VAD Reminder] Speech started — gemini: ${this.isGeminiRunning}, sarvam: ${this.isSarvamRunning}, plivo: ${this.isPlivoSpeaking}`,
        );

        this.vam.clearIdleTimers();
        this.#clearIdleResume();

        // OLD: aborted AI on any sound — background noise restarted the reply
        // if (this.isGeminiRunning || this.isSarvamRunning || this.isPlivoSpeaking)
        // {
        //     this.#abortAll();
        // }
    }

    #confirmBargeIn()
    {
        this.bargeInTimer = null;

        // Sound already stopped, or call is closing → nothing to do
        if (this.killPending || !this.vam?.isUserSpeaking)
        {
            this.bargeInBuffer = [];
            return;
        }

        console.log(`🗣️ [VAD Reminder] Barge-in confirmed — stopping AI and listening`);

        // Take held audio before abort clears the buffer
        const heldChunks = this.bargeInBuffer.splice(0);

        this.isUserSpeaking = true;
        this.vam.clearIdleTimers();

        if (this.#isAISpeaking())
        {
            this.#abortAll();
        }

        for (const chunk of heldChunks)
        {
            this.sarvam.sendAudio(this.callUUID, chunk);
        }
    }

    #onSpeechChunk(mulawBuffer)
    {
        if (!this.vadGateOpen)
        {
            return;
        }

        // OLD: this.sarvam.sendAudio(this.callUUID, mulawBuffer);
        if (this.killPending)
        {
            return;
        }

        // Possible noise while AI is speaking → hold audio until barge-in is confirmed
        if (!this.isUserSpeaking && this.#isAISpeaking())
        {
            if (this.bargeInBuffer.length < MAX_BARGE_IN_CHUNKS)
            {
                this.bargeInBuffer.push(mulawBuffer);
            }

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

        // Sound ended before barge-in was confirmed → could be noise or a short question
        // ("टाइम क्या है?"). AI keeps speaking; the transcript decides (see #onTranscript).
        if (this.bargeInTimer)
        {
            // OLD: dropped the audio — short questions while AI was speaking were never heard
            // this.#clearBargeIn();
            // console.log(`🔕 [VAD Reminder] Short sound ignored — AI continues speaking`);
            const heldChunks = this.bargeInBuffer.splice(0);
            this.#clearBargeIn();

            if (heldChunks.length > 0)
            {
                for (const chunk of heldChunks)
                {
                    this.sarvam.sendAudio(this.callUUID, chunk);
                }

                this.sarvam.pauseSTTTimer();
                this.sarvam.flushSTT();
                this.interruptCheckUntil = Date.now() + INTERRUPT_CHECK_WINDOW_MS;
            }

            console.log(`🔎 [VAD Reminder] Short speech while AI speaking — checking transcript, AI continues`);
            return;
        }

        // Speech that was ignored (closing message) — nothing to send to STT
        if (this.killPending || !this.isUserSpeaking)
        {
            this.isUserSpeaking = false;
            this.bargeInBuffer = [];
            return;
        }

        console.log(`🗣️ [VAD Reminder] Speech ended`);
        this.isUserSpeaking = false;
        this.vam.clearIdleTimers();
        this.sarvam.pauseSTTTimer();
        this.sarvam.flushSTT();

        // OLD: idle timers stayed off if this sound produced no transcript → silent call until 3-min limit
        this.#scheduleIdleResume();
    }

    async #onTranscript(transcript)
    {
        const userText = typeof transcript === "string" ? transcript.trim() : (transcript?.text?.trim() || "");
        if (!this.vadGateOpen || !userText)
        {
            return;
        }

        // OLD: every transcript was dropped while the AI was speaking
        // if (
        //     this.killPending ||
        //     this.isUserSpeaking ||
        //     this.isGeminiRunning ||
        //     this.isSarvamRunning ||
        //     this.isPlivoSpeaking
        // )
        // {
        //     return;
        // }
        if (this.killPending || this.isUserSpeaking)
        {
            return;
        }

        const fromInterruptCheck = Date.now() <= this.interruptCheckUntil;

        if (fromInterruptCheck)
        {
            this.interruptCheckUntil = 0;

            if (isBackchannel(userText))
            {
                console.log(`🔕 [Reminder Interrupt] "${userText}" is a filler — ignored`);
                return;
            }
        }

        if (this.#isAISpeaking())
        {
            // Only short speech we sent to STT during the AI reply may interrupt it;
            // any other late transcript stays ignored as before
            if (!fromInterruptCheck)
            {
                return;
            }

            console.log(`✋ [Reminder Interrupt] Candidate asked mid-reply: "${userText}" — stopping AI to answer`);
            this.#abortAll();
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

        const turnGeneration = this.turnGeneration;

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
                    // OLD: if (this.isUserSpeaking)
                    // Interrupted turn → its late chunks must not leak into the next reply's TTS
                    if (this.isUserSpeaking || turnGeneration !== this.turnGeneration)
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
                        .replace(/<problem_reason:[^>]*>/gi, "")
                        .replace(/<referral:[^>]*>/gi, "")
                        // Any other complete <tag> / <tag:value> is never spoken
                        .replace(/<\/?[a-z_]+(?::[^>]*)?>/gi, "");

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

                    // Remove stray < or > so Sarvam never speaks "less than" / "greater than"
                    textToSend = textToSend.replace(/[<>]/g, "");

                    if (textToSend)
                    {
                        this.sarvam.sendTTSChunk(textToSend);
                    }
                },
                signal: this.gemini?.abortController?.signal ?? null,
            });

            // Interrupted while generating → a newer turn owns TTS and session now
            if (turnGeneration !== this.turnGeneration)
            {
                console.log(`↩️ [Reminder AI] Reply interrupted — rest discarded`);
                return;
            }

            // Flush any remaining text in tagBuffer if it's not a tag
            if (tagBuffer && !this.isUserSpeaking)
            {
                const finalClean = tagBuffer
                    .replace(/<kill>/gi, "")
                    .replace(/<\/kill>/gi, "")
                    .replace(/<status:[^>]*>/gi, "")
                    .replace(/<reschedule_time:[^>]*>/gi, "")
                    .replace(/<problem_reason:[^>]*>/gi, "")
                    .replace(/<referral:[^>]*>/gi, "")
                    .replace(/<\/?[a-z_]+(?::[^>]*)?>/gi, "")
                    .replace(/[<>]/g, "")
                    .trim();

                if (finalClean)
                {
                    this.sarvam.sendTTSChunk(finalClean);
                }
                tagBuffer = "";
            }

            if (usage)
            {
                // OLD: await redis.recordGemini(this.callUUID, usage);  → raw usageMetadata, always recorded 0 cost
                await redis.recordGemini(this.callUUID, toGeminiCostUsage(usage));
            }

            const parsed = parseControlTags(rawText);

            console.log(`🎙️ [Reminder AI]: "${parsed.cleanText}"`);
            if (parsed.status)
            {
                console.log(`📋 [Reminder Intent]: status=${parsed.status} | reschedule=${parsed.rescheduleTime} | problem=${parsed.problemReason} | referral=${parsed.referral}`);
            }

            const currentSession = await redis.getSession(this.callUUID);

            // Re-check: an interruption between the reads above must not overwrite the newer turn's session
            if (currentSession && turnGeneration === this.turnGeneration)
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

                if (parsed.referral)
                {
                    currentSession.referral = parsed.referral;
                }

                await redis.saveSession(this.callUUID, currentSession);
            }

            // Safety net: a reply that asks the candidate something must wait for the answer,
            // even if the model wrongly appended <kill> (e.g. referral question + <kill>).
            // Status / reason tags from this reply are still saved above.
            const asksQuestion = /[?？]/.test(parsed.cleanText);

            if (parsed.kill && asksQuestion)
            {
                console.warn(`⚠️ [Reminder Kill] Ignored — reply asks a question, waiting for the candidate's answer`);
            }

            // Lock in the closing message before it plays, so speech cannot cut it.
            // Skipped if this turn was aborted by a confirmed barge-in.
            // OLD: if (parsed.kill && turnGeneration === this.turnGeneration)
            if (parsed.kill && !asksQuestion && turnGeneration === this.turnGeneration)
            {
                this.#scheduleKill();
            }

            this.isGeminiRunning = false;
            this.sarvam.flushTTSStream();

            await ttsPromise;

            // OLD: kill was only queued after TTS generation finished — speech during playback hung up instantly
            // if (this.isUserSpeaking)
            // {
            //     return;
            // }
            //
            // if (parsed.kill)
            // {
            //     console.log(`💀 [Reminder Kill] Hangup queued after TTS`);
            //     this.killPending = true;
            //     return;
            // }
        }
        catch (err)
        {
            console.error(`❌ [Reminder AI Turn] Failed:`, err.message);
        }
        finally
        {
            // OLD: always reset — an interrupted turn finishing late switched off the NEW turn's flags
            // this.isGeminiRunning = false;
            // this.isSarvamRunning = false;
            if (turnGeneration === this.turnGeneration)
            {
                this.isGeminiRunning = false;
                this.isSarvamRunning = false;
            }
        }
    }

    #startIdleTimers()
    {
        this.#clearIdleResume();

        this.vam.startIdleTimers(
            { warningAfterMs: 7000, disconnectAfterMs: 15000 },
            async () =>
            {
                // OLD: const audio = await this.db.getIdleAudio(this.idleWarningText);  → DB-only, silent when not cached
                const audio = await this.#getIdleAudio(this.idleWarningText);
                if (audio)
                {
                    this.plivo.sendAudio(audio);
                }
            },
            async () =>
            {
                // OLD: const audio = await this.db.getIdleAudio(this.idleDisconnectText);
                const audio = await this.#getIdleAudio(this.idleDisconnectText);
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
            // If this is much shorter than the audio length, Plivo did not play the full intro
            if (this.introSentAt)
            {
                const playedSec = (Date.now() - this.introSentAt) / 1000;
                console.log(`⏱️ [Reminder Intro] Played in ${playedSec.toFixed(1)}s (audio ~${this.introDurationSec.toFixed(1)}s)`);
            }

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
                // OLD:
                // this.killPending = false;
                // await this.plivo.hangupCall(this.callUUID);
                await this.#hangupOnce("closing message finished playing");
            }
            else
            {
                this.#startIdleTimers();
            }

            return;
        }

        if (name === "end_call")
        {
            // OLD: await this.plivo.hangupCall(this.callUUID);
            await this.#hangupOnce("idle disconnect");
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

        if (!this.plivo.streamSid)
        {
            console.error(`❌ [Reminder Intro] streamId missing — intro_spoken checkpoint cannot be sent for call: ${this.callUUID}`);
        }

        // OLD: whole intro in one playAudio message — played cut short on the phone
        // this.plivo.sendAudio(introAudio);
        const { chunks, durationSec } = splitMulawAudio(introAudio);

        this.plivo.sendAudio(INTRO_LEAD_IN_SILENCE);

        for (const chunk of chunks)
        {
            this.plivo.sendAudio(chunk);
        }

        this.plivo.sendCheckpoint("intro_spoken");

        this.introSentAt = Date.now();
        this.introDurationSec = durationSec;
        console.log(`▶️ [Reminder Intro] Intro audio sent — ${chunks.length} chunks, ~${durationSec.toFixed(1)}s — call: ${this.callUUID}`);
    }

    async destroy()
    {
        this.sttRetryActive = false;
        this.#clearKillFallback();
        this.#clearBargeIn();
        this.#clearIdleResume();

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

        // db is null when init() failed before creating it
        if (this.db)
        {
            this.db.updateCallStatus(this.session.wiraCallId, "finalizing");
        }

        const session = await redis.getSession(this.callUUID);
        const outboundScreeningId = session?.wiraOutboundScreeningId ?? null;

        await redis.stopCostTracking(this.callUUID, outboundScreeningId, this.db);
    }
}

async function waitForSession(callUUID, maxAttempts = 20, intervalMs = 1000, isClosed = () => false)
{
    for (let i = 0; i < maxAttempts; i++)
    {
        // Plivo already dropped the stream — stop polling
        if (isClosed())
        {
            return null;
        }

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
    const connectedAt = Date.now();

    const secondsSinceConnect = () => ((Date.now() - connectedAt) / 1000).toFixed(1);

    console.log(`🔌 [Reminder Socket] Connected — call: ${callUUID}`);

    // ─── Listeners are registered BEFORE any await ───────────────────────────────
    // Plivo starts sending "start"/"media" packets immediately after connect.
    // Every packet is queued and processed strictly in order once init() is done,
    // and "close" is handled from the first moment so timers/STT never leak.
    // ─────────────────────────────────────────────────────────────────────────────
    const pendingMessages = [];
    let call = null;
    let callReady = false;
    let socketClosed = false;
    let callDestroyed = false;
    let processingMessages = false;

    const destroyCall = async () =>
    {
        if (!call || callDestroyed)
        {
            return;
        }

        callDestroyed = true;

        try
        {
            await call.destroy();
        }
        catch (err)
        {
            console.error(`❌ [Reminder Socket] destroy failed for ${callUUID}:`, err.message);
        }
    };

    const handleMessage = async (message) =>
    {
        try
        {
            const packet = JSON.parse(message);

            if (packet.event === "start")
            {
                const sid = packet.start?.streamId ?? packet.streamId ?? null;
                if (sid)
                {
                    call.streamId = sid;
                    call.plivo.setStreamId(sid);
                    console.log(`▶️ [Reminder Stream] start — streamId: ${sid}`);
                }
            }

            if (packet.event === "media")
            {
                if (!call.streamId)
                {
                    const sid =
                        packet.start?.streamId ??
                        packet.media?.streamId ??
                        packet.streamId ??
                        null;

                    if (sid)
                    {
                        call.streamId = sid;
                        call.plivo.setStreamId(sid);
                        console.log(`▶️ [Reminder Stream] streamId from media — ${sid}`);
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
                console.log(`🛑 [Reminder Stream] Stop received for: ${callUUID} after ${secondsSinceConnect()}s`);
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
    };

    const processMessages = async () =>
    {
        if (processingMessages || !callReady)
        {
            return;
        }

        processingMessages = true;

        try
        {
            while (pendingMessages.length > 0 && !socketClosed)
            {
                await handleMessage(pendingMessages.shift());
            }
        }
        finally
        {
            processingMessages = false;
        }
    };

    socket.on("message", (message) =>
    {
        if (socketClosed)
        {
            return;
        }

        if (pendingMessages.length >= MAX_PENDING_PACKETS)
        {
            pendingMessages.shift();
        }

        pendingMessages.push(message);
        processMessages();
    });

    socket.on("close", async (closeCode, reason) =>
    {
        socketClosed = true;
        pendingMessages.length = 0;

        console.log(`❌ [Reminder Socket] Closed — call: ${callUUID} | after: ${secondsSinceConnect()}s | code: ${closeCode} | reason: ${reason?.toString()} | intro sent: ${call?.introSpoken ?? false} | vad open: ${call?.vadGateOpen ?? false}`);

        // If init() is still running, destroy happens right after it finishes
        if (callReady)
        {
            await destroyCall();
        }
    });

    socket.on("error", (err) =>
    {
        console.error(`❌ [Reminder Socket] Error — call: ${callUUID}:`, err.message);
    });

    const session = await waitForSession(callUUID, 20, 1000, () => socketClosed);

    if (!session)
    {
        console.error(`❌ [Reminder Init] No session found for: ${callUUID} (socket closed: ${socketClosed}) after ${secondsSinceConnect()}s`);

        if (!socketClosed)
        {
            socket.close();
        }

        return;
    }

    console.log(`✅ [Reminder Init] Session found for: ${callUUID} after ${secondsSinceConnect()}s — language: ${session.language} | from: ${session.fromPhone}`);

    if (socketClosed)
    {
        console.warn(`⚠️ [Reminder Init] Socket closed before init — skipping call: ${callUUID}`);
        return;
    }

    call = new InterviewReminderCallManager(socket, callUUID, session);

    try
    {
        await call.init();
    }
    catch (err)
    {
        console.error(`❌ [Reminder Init] InterviewReminderCallManager.init failed:`, err.message);
        await destroyCall();

        if (!socketClosed)
        {
            socket.close();
        }

        return;
    }

    callReady = true;
    console.log(`✅ [Reminder Init] Call ready for: ${callUUID} after ${secondsSinceConnect()}s — ${pendingMessages.length} buffered packets`);

    // Socket closed while init() was running
    if (socketClosed)
    {
        await destroyCall();
        return;
    }

    await processMessages();
}

/*
// OLD: early-buffer version — "close" registered last, live handler attached before drain
async function outboundInterviewReminderSocketOld(socket)
{
    const callUUID = socket.callId;

    // ─── CRITICAL FIX: Buffer ALL incoming Plivo packets BEFORE init() ────────────
    // Plivo sends "start" and first "media" packets immediately after the WebSocket
    // connection is established — often BEFORE any async init() can finish.
    // If socket.on("message") is registered only AFTER await init(), those early
    // packets are silently dropped: streamId is never captured, speakIntro() never
    // runs, no audio is ever sent, and Plivo disconnects ~4 seconds later.
    // Fix: register a buffer listener immediately, run init(), then drain + switch.
    // ─────────────────────────────────────────────────────────────────────────────
    const earlyMessageBuffer = [];
    let initComplete = false;

    const earlyMessageHandler = (message) =>
    {
        if (!initComplete)
        {
            earlyMessageBuffer.push(message);
        }
    };

    socket.on("message", earlyMessageHandler);

    // ─────────────────────────────────────────────────────────────────────────────

    const session = await waitForSession(callUUID);

    if (!session)
    {
        console.error(`❌ [Reminder Init] No session found for: ${callUUID}`);
        socket.off("message", earlyMessageHandler);
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
        socket.off("message", earlyMessageHandler);
        return;
    }

    // ─── Switch from buffer mode to live mode ────────────────────────────────────
    initComplete = true;
    socket.off("message", earlyMessageHandler);

    const handleMessage = async (message) =>
    {
        try
        {
            const packet = JSON.parse(message);

            if (packet.event === "start")
            {
                const sid = packet.start?.streamId ?? packet.streamId ?? null;
                if (sid)
                {
                    call.streamId = sid;
                    call.plivo.setStreamId(sid);
                    console.log(`▶️ [Reminder Stream] start — streamId: ${sid}`);
                }
            }

            if (packet.event === "media")
            {
                if (!call.streamId)
                {
                    const sid =
                        packet.start?.streamId ??
                        packet.media?.streamId ??
                        packet.streamId ??
                        null;

                    if (sid)
                    {
                        call.streamId = sid;
                        call.plivo.setStreamId(sid);
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
    };

    socket.on("message", handleMessage);

    // ─── Drain buffered early Plivo packets in order ─────────────────────────────
    if (earlyMessageBuffer.length > 0)
    {
        console.log(`▶️ [Reminder Init] Draining ${earlyMessageBuffer.length} early buffered packets`);

        for (const bufferedMsg of earlyMessageBuffer)
        {
            await handleMessage(bufferedMsg);
        }
    }
    // ─────────────────────────────────────────────────────────────────────────────

    socket.on("close", async (closeCode, reason) =>
    {
        console.log(`❌ [Reminder Socket] Closed — call: ${callUUID} | code: ${closeCode} | reason: ${reason?.toString()}`);
        await call.destroy();
    });
}
*/

module.exports = outboundInterviewReminderSocket;
