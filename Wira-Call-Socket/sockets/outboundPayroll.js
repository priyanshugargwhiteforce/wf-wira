const VoiceActivityManager = require("../CallManager/VoiceActivityManager");
const SarvamManager = require("../CallManager/SarvamManager");
const GeminiManager = require("../CallManager/GeminiManager");
const PlivoManager = require("../CallManager/PlivoManager");
const RedisManager = require("../CallManager/RedisManager");
const DatabaseManager = require("../CallManager/DatabaseManager");
const { runGeminiCall } = require("@wira/shared/AI/executeAI");

const redis = new RedisManager();

class PayrollCallManager {
  constructor(socket, callUUID, session) {
    this.socket = socket;
    this.callUUID = callUUID;
    this.session = session;
    this.subType = session.subType || "reminder";

    this.isUserSpeaking = false;
    this.isSarvamRunning = false;
    this.isGeminiRunning = false;
    this.isPlivoSpeaking = false;

    this.streamId = null;
    this.introSpoken = false;
    this.vadGateOpen = false;
    this.killPending = false;
    this.turnCount = 0;

    this.idleWarningText =
      session.idleWarningText || "Are you still on the line?";
    this.idleDisconnectText =
      session.idleDisconnectText ||
      "No response received. This call will now be disconnected. Thank you.";

    this.vam = null;
    this.sarvam = null;
    this.gemini = null;
    this.plivo = null;
    this.db = null;
    this.sttRetryActive = false;
  }

  async init() {
    this.sarvam = new SarvamManager(
      { languageCode: "en-IN", sampleRate: 16000 },
      { speaker: "shreya", language: "en" },
      redis,
    );
    this.sarvam.language = "en";

    this.gemini = new GeminiManager(redis);
    this.plivo = new PlivoManager(redis);
    this.plivo.attachSocket(this.socket);

    this.db = new DatabaseManager({ speaker: "shreya", languageCode: "en-IN" });
    this.db.updateCallStatus(this.session.wiraCallId, "in_progress");

    this.vam = new VoiceActivityManager({
      ...(this.session.callConfig?.vad ?? {}),
      onSpeechRealStart: () => this.#onSpeechRealStart(),
      onSpeechChunk: (mulawBuffer) => this.#onSpeechChunk(mulawBuffer),
      onSpeechEnd: () => this.#onSpeechEnd(),
    });

    this.#initSTTWithRetry();

    await redis.startCostTracking(this.callUUID, async () => {
      if (this.sarvam) {
        await this.sarvam.flushSTTCost();
      }
    });

    this.plivo.startBilling(this.callUUID);

    this.vam.startMaxCallTimer(
      180000, // Max 3 minutes for payroll calls
      async () => {
        await this.plivo.hangupCall(this.callUUID);
      },
    );
  }

  #initSTTWithRetry() {
    this.sttRetryActive = true;

    const tryConnect = () => {
      if (!this.sttRetryActive || !this.sarvam || !this.callUUID) {
        return;
      }

      this.sarvam
        .initSTT(
          this.callUUID,
          (transcript) => this.#onTranscript(transcript),
          null,
          () => {
            if (!this.sttRetryActive) {
              return;
            }

            console.warn(
              `⚠️ [STT Payroll] Socket closed mid-call, reconnecting...`,
            );
            setTimeout(() => tryConnect(), 1000);
          },
        )
        .then(() => {
          console.log(`✅ [STT Payroll Init] Connected for: ${this.callUUID}`);
        })
        .catch((err) => {
          if (!this.sttRetryActive) {
            return;
          }

          console.warn(
            `⚠️ [STT Payroll Init] Failed, retrying in 3s: ${err.message}`,
          );
          setTimeout(() => tryConnect(), 3000);
        });
    };

    tryConnect();
  }

  #abortAll() {
    console.log(`🚫 [Payroll Abort] Killing all media streams`);

    if (this.sarvam) {
      this.sarvam.abortTTS(this.callUUID, 0);
    }

    if (this.gemini) {
      this.gemini.abort();
    }

    if (this.plivo) {
      this.plivo.clearAudio();
    }

    this.vam.clearIdleTimers();

    this.isGeminiRunning = false;
    this.isSarvamRunning = false;
    this.isPlivoSpeaking = false;

    if (this.killPending) {
      console.log(
        `💀 [Payroll Abort Kill] Abort triggered with killPending — hanging up call`,
      );
      this.plivo.hangupCall(this.callUUID);
    }
  }

  #onSpeechRealStart() {
    if (!this.vadGateOpen) {
      return;
    }

    if (this.killPending) {
      console.log(
        `💀 [Payroll VAD Kill] Speech detected after killTag — hanging up immediately`,
      );
      this.#abortAll();
      this.plivo.hangupCall(this.callUUID);
      return;
    }

    this.isUserSpeaking = true;
    console.log(`🗣️ [VAD Payroll] User started speaking.`);

    this.vam.clearIdleTimers();

    if (this.isGeminiRunning || this.isSarvamRunning || this.isPlivoSpeaking) {
      this.#abortAll();
    }
  }

  #onSpeechChunk(mulawBuffer) {
    if (!this.vadGateOpen) {
      return;
    }

    this.sarvam.sendAudio(this.callUUID, mulawBuffer);
  }

  #onSpeechEnd() {
    if (!this.vadGateOpen) {
      return;
    }

    this.isUserSpeaking = false;
    this.sarvam.pauseSTTTimer();
    this.sarvam.flushSTT();
  }

  async #onTranscript(transcript) {
    if (!this.vadGateOpen || !transcript || transcript.trim() === "") {
      return;
    }

    if (
      this.isUserSpeaking ||
      this.isGeminiRunning ||
      this.isSarvamRunning ||
      this.isPlivoSpeaking
    ) {
      return;
    }

    console.log(`🗣️ [Client Transcript]: "${transcript}"`);

    const currentSession = await redis.getSession(this.callUUID);
    if (!currentSession) {
      return;
    }

    currentSession.transcript.push({ role: "user", content: transcript });
    await redis.saveSession(this.callUUID, currentSession);

    this.vam.clearIdleTimers();

    this.#runPayrollAITurn(currentSession, transcript).catch((err) => {
      console.error(`❌ [Payroll AI Turn] Error:`, err.message);
    });
  }

  async #runPayrollAITurn(session, userTranscript) {
    this.isGeminiRunning = true;
    this.isSarvamRunning = true;
    this.isPlivoSpeaking = true;

    this.turnCount++;

    try {
      // Build system prompt based on subType and turn count
      let systemPrompt;

      if (this.subType === "overdue") {
        const today = new Date().toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        });

        // After 6 turns, force a graceful closing regardless of outcome
        if (this.turnCount >= 6) {
          systemPrompt = `You are Wira calling from ${session.companyName || "White Force"}. This is your final message to ${session.clientName || "the client"} regarding their overdue payment of ₹${session.amount || "the due amount"}. Politely thank them for their time, let them know you will follow up, and end the call professionally. End your response with <kill>.`;
        } else {
          systemPrompt = `You are Wira, a professional payment recovery assistant calling from ${session.companyName || "White Force"}.

Context:
- Client Name: ${session.clientName || "Valued Client"}
- Overdue Amount: ₹${session.amount || "the due amount"}
- Original Due Date: ${session.dueDate || "the scheduled date"}
- Today's Date: ${today}

Your goals (in strict priority order):
1. SPECIFIC DATE (e.g., "15th October", "by this Friday") → Accept. Confirm the date warmly, use <commit_date:DD Month YYYY> tag, thank them, end with <kill>.
2. RELATIVE TIMEFRAME (e.g., "next week", "within 2 days", "by end of month") → Accept. Calculate the approximate date from today (${today}), acknowledge it, use <commit_date:DD Month YYYY>, thank them, end with <kill>.
3. VAGUE / NON-COMMITTAL (e.g., "soon", "bahut jaldi", "kuch dino mein", "shortly", "ASAP", "very soon") → DO NOT accept. Politely but firmly ask: "Could you please confirm a specific date or at least the week by when you can make this payment?"
4. QUESTIONS (who are you, amount details, company name) → Answer clearly and briefly, then redirect to payment commitment.
5. UPSET / EXCUSES → Acknowledge empathetically, stay professional, redirect to commitment.
6. Conversation naturally closing (e.g., user says goodbye or thanks) → Thank them and end with <kill>.

Rules:
- Always respond in English, professionally and concisely (under 40 words).
- NEVER end with <kill> unless a date/timeframe has been confirmed OR the conversation is naturally complete.
- Date capture format (mandatory): <commit_date:DD Month YYYY> — example: <commit_date:28 September 2026>
- For relative timeframes, calculate from today (${today}) and use that approximate date in <commit_date:...>.
- Do NOT repeat the overdue notice. You are mid-conversation — respond naturally to what the client just said.`;
        }
      } else {
        // reminder subType — simple one-shot prompt, behaviour unchanged
        systemPrompt = `You are Wira calling from ${session.companyName || "White Force"} regarding payment reminder. The client said: "${userTranscript}". Politely thank them in English and end your response with <kill>.`;
      }

      const ttsPromise = this.sarvam.openTTSStream(
        this.callUUID,
        (base64Audio) => {
          if (
            !this.isUserSpeaking &&
            (this.isGeminiRunning || this.isSarvamRunning)
          ) {
            this.plivo.sendAudio(base64Audio);
          }
        },
        () => {
          this.isSarvamRunning = false;
          if (!this.isUserSpeaking) {
            this.plivo.sendTTSComplete();
          }
        },
        () => this.isUserSpeaking,
      );

      // For overdue: pass full conversation history for multi-turn context.
      // For reminder: keep it simple — just the current user message (one-shot).
      // Direct Gemini call — no context cache (payroll prompts are too small
      // for Google's 2048 token minimum, so we skip caching entirely)
      const messages =
        this.subType === "overdue"
          ? (session.transcript || []).map((t) => ({
              role: t.role,
              content: t.content,
            }))
          : [{ role: "user", content: userTranscript }];

      const { text: rawText } = await runGeminiCall({
        conversation: messages,
        prompt: systemPrompt,
        modelName: "gemini-2.5-flash-lite",
        temperature: 0.6,
        streaming: true,
        onChunk: (chunk) => {
          if (!this.isUserSpeaking) {
            // Strip all control tags before sending to TTS
            const clean = chunk
              .replace(/<kill>/gi, "")
              .replace(/<\/kill>/gi, "")
              .replace(/<commit_date:[^>]*>/gi, "");
            if (clean) {
              this.sarvam.sendTTSChunk(clean);
            }
          }
        },
        signal: this.gemini?.abortController?.signal ?? null,
      });

      const killTag = /<kill>/i.test(rawText);
      const cleanText = rawText
        .replace(/<kill>/gi, "")
        .replace(/<\/kill>/gi, "")
        .replace(/<commit_date:[^>]*>/gi, "")
        .trim();

      console.log(`🎙️ [Payroll AI]: "${cleanText}"`);

      // Parse commit_date tag and update transcript in a single Redis write
      const commitDateMatch = rawText.match(/<commit_date:([^>]+)>/i);
      const currentSession = await redis.getSession(this.callUUID);

      if (currentSession) {
        if (commitDateMatch) {
          const promisedDate = commitDateMatch[1].trim();
          currentSession.promisedDate = promisedDate;
          console.log(
            `✅ [Payroll Commit] promisedDate captured: "${promisedDate}"`,
          );
        }

        if (cleanText) {
          currentSession.transcript.push({
            role: "assistant",
            content: cleanText,
          });
        }

        await redis.saveSession(this.callUUID, currentSession);
      }

      this.isGeminiRunning = false;
      this.sarvam.flushTTSStream();

      await ttsPromise;

      if (this.isUserSpeaking) {
        return;
      }

      if (killTag) {
        console.log(`💀 [Payroll Kill] Scheduling hangup after TTS`);
        this.killPending = true;
        return;
      }
    } catch (err) {
      console.error(`❌ [Payroll AI Turn] Failed:`, err.message);
    } finally {
      this.isGeminiRunning = false;
      this.isSarvamRunning = false;
    }
  }

  #startIdleTimers() {
    this.vam.startIdleTimers(
      { warningAfterMs: 7000, disconnectAfterMs: 15000 },
      async () => {
        const audio = await this.db.getIdleAudio(this.idleWarningText);
        if (audio) {
          this.plivo.sendAudio(audio);
        }
      },
      async () => {
        const audio = await this.db.getIdleAudio(this.idleDisconnectText);
        if (audio) {
          this.plivo.sendAudio(audio);
        }
        this.plivo.sendCheckpoint("end_call");
      },
    );
  }

  async onMediaPacket(payload) {
    if (!this.vadGateOpen || !this.vam || !this.sarvam) {
      return;
    }

    await this.vam.process(payload);
  }

  async onPlayedStream(name) {
    console.log(`▶️ [playedStream Payroll] ${name}`);

    if (name === "intro_spoken") {
      if (this.subType === "reminder") {
        console.log(
          `💀 [Payroll Reminder] Intro spoken — hanging up call immediately`,
        );
        await this.plivo.hangupCall(this.callUUID);
        return;
      }

      await this.vam.init();
      this.vadGateOpen = true;
      this.#startIdleTimers();
      console.log(`✅ [Payroll Intro] VAD gate open`);
      return;
    }

    if (name === "tts_complete") {
      this.isPlivoSpeaking = false;

      if (this.killPending) {
        this.killPending = false;
        await this.plivo.hangupCall(this.callUUID);
      } else {
        this.#startIdleTimers();
      }

      return;
    }

    if (name === "end_call") {
      await this.plivo.hangupCall(this.callUUID);
    }
  }

  async speakIntro() {
    if (this.introSpoken) {
      return;
    }

    this.introSpoken = true;

    const introAudio = await redis.getIntroAudioAndInit(this.callUUID);

    if (!introAudio) {
      console.error(`❌ [Payroll Intro] No intro audio found`);
      return;
    }

    this.plivo.sendAudio(introAudio);
    this.plivo.sendCheckpoint("intro_spoken");
  }

  async destroy() {
    this.sttRetryActive = false;

    if (this.plivo) {
      this.plivo.destroy(this.callUUID);
    }

    if (this.sarvam) {
      await this.sarvam.destroy(this.callUUID);
    }

    if (this.gemini) {
      this.gemini.destroy();
    }

    if (this.vam) {
      this.vam.destroy();
    }

    this.db.updateCallStatus(this.session.wiraCallId, "finalizing");
    const session = await redis.getSession(this.callUUID);
    const outboundScreeningId = session?.wiraOutboundScreeningId ?? null;

    await redis.stopCostTracking(this.callUUID, outboundScreeningId, this.db);
  }
}

async function waitForSession(callUUID, maxAttempts = 20, intervalMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    const session = await redis.getSession(callUUID);
    if (session) {
      return session;
    }

    console.warn(
      `⏳ [Payroll Init] Session not ready, retrying... (${i + 1}/${maxAttempts})`,
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

async function outboundPayrollSocket(socket) {
  const callUUID = socket.callId;

  const session = await waitForSession(callUUID);

  if (!session) {
    console.error(`❌ [Payroll Init] No session found for: ${callUUID}`);
    return;
  }

  const call = new PayrollCallManager(socket, callUUID, session);

  try {
    await call.init();
  } catch (err) {
    console.error(
      `❌ [Payroll Init] PayrollCallManager.init failed:`,
      err.message,
    );
    return;
  }

  socket.on("message", async (message) => {
    try {
      const packet = JSON.parse(message);

      if (packet.event === "media") {
        if (!call.streamId) {
          call.streamId =
            packet.start?.streamId ??
            packet.media?.streamId ??
            packet.streamId ??
            null;

          if (call.streamId) {
            call.plivo.setStreamId(call.streamId);
          }
        }

        if (!call.introSpoken) {
          await call.speakIntro();
          return;
        }

        call.onMediaPacket(packet.media.payload);
      }

      if (packet.event === "playedStream") {
        await call.onPlayedStream(packet.name);
      }

      if (packet.event === "stop") {
        console.log(`🛑 [Payroll Stream] Stop received for: ${callUUID}`);
      }
    } catch (err) {
      console.error(`❌ [Payroll Socket] Message error:`, err.message);
    }
  });

  socket.on("close", async (closeCode, reason) => {
    console.log(
      `❌ [Payroll Socket] Closed — call: ${callUUID} | code: ${closeCode} | reason: ${reason?.toString()}`,
    );
    await call.destroy();
  });
}

module.exports = outboundPayrollSocket;
