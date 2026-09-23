const VoiceActivityManager = require("../CallManager/VoiceActivityManager");
const SarvamManager = require("../CallManager/SarvamManager");
const GeminiManager = require("../CallManager/GeminiManager");
const PlivoManager = require("../CallManager/PlivoManager");
const RedisManager = require("../CallManager/RedisManager");
const DatabaseManager = require("../CallManager/DatabaseManager");

const redis = new RedisManager();

class CallManager {
  constructor(socket, callUUID, session) {
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

    this.fillerTimer = null;
    this.fillerAudio = null;
    this.fillerPlaying = false;
    this.fillerBuffer = [];

    this.killPending = false;

    this.idleWarningText = session.idleWarningText ?? null;
    this.idleDisconnectText = session.idleDisconnectText ?? null;

    this.vam = null;
    this.sarvam = null;
    this.gemini = null;
    this.plivo = null;
    this.db = null;
    this.sttRetryActive = false;
  }

  async init() {
    this.sarvam = new SarvamManager(
      this.session.callConfig?.stt ?? {},
      this.session.callConfig?.tts ?? {},
      redis,
    );

    this.sarvam.language = this.session.language ?? "hi";

    this.gemini = new GeminiManager(redis);
    this.gemini.cacheId = this.session.cacheId ?? null;

    this.plivo = new PlivoManager(redis);
    this.plivo.attachSocket(this.socket);

    this.db = new DatabaseManager(this.session.callConfig?.tts ?? {});
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
      this.session.callConfig?.maxCallDurationMs ?? 600000,
      async () => {
        const audio = await this.db.getIdleAudio(this.idleDisconnectText);

        if (audio) {
          this.plivo.sendAudio(audio);
        }

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

            console.warn(`⚠️ [STT] Socket closed mid-call, reconnecting...`);
            setTimeout(() => tryConnect(), 1000);
          },
        )
        .then(() => {
          console.log(`✅ [STT Init] Connected for: ${this.callUUID}`);
        })
        .catch((err) => {
          if (!this.sttRetryActive) {
            return;
          }

          console.warn(`⚠️ [STT Init] Failed, retrying in 3s: ${err.message}`);
          setTimeout(() => tryConnect(), 3000);
        });
    };

    tryConnect();
  }

  #abortAll() {
    console.log(
      `🚫 [Abort] Killing all — gemini: ${this.isGeminiRunning}, sarvam: ${this.isSarvamRunning}, plivo: ${this.isPlivoSpeaking}`,
    );

    if (this.fillerTimer) {
      clearTimeout(this.fillerTimer);
      this.fillerTimer = null;
    }

    this.fillerAudio = null;
    this.fillerPlaying = false;
    this.fillerBuffer = [];

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
  }

  #onSpeechRealStart() {
    if (!this.vadGateOpen) {
      return;
    }

    this.isUserSpeaking = true;
    console.log(
      `🗣️ [VAD] Speech started — gemini: ${this.isGeminiRunning}, sarvam: ${this.isSarvamRunning}, plivo: ${this.isPlivoSpeaking}`,
    );

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
    if (!this.vadGateOpen) {
      return;
    }

    if (this.isUserSpeaking) {
      console.log(`⏳ [STT] User still speaking — discarding transcript`);
      return;
    }

    if (this.isGeminiRunning || this.isSarvamRunning || this.isPlivoSpeaking) {
      console.log(
        `⏳ [STT] Barge-in in progress — discarding stale transcript`,
      );
      return;
    }

    const currentSession = await redis.getSession(this.callUUID);

    if (!currentSession) {
      return;
    }

    currentSession.transcript.push({ role: "user", content: transcript });
    await redis.saveSession(this.callUUID, currentSession);

    this.vam.clearIdleTimers();

    this.fillerAudio = null;
    this.fillerPlaying = false;
    this.fillerBuffer = [];

    this.db.getThinkingFillerAudio().then((audio) => {
      this.fillerAudio = audio;
    });

    this.fillerTimer = setTimeout(() => {
      this.fillerTimer = null;

      if (this.isUserSpeaking || !this.fillerAudio) {
        return;
      }

      console.log(`🤔 [Filler] Playing thinking filler`);
      this.fillerPlaying = true;
      this.plivo.sendAudio(this.fillerAudio);
      this.plivo.sendCheckpoint("filler_spoken");
    }, 2000);

    this.#runAITurn(currentSession).catch((err) => {
      console.error(`❌ [AI Turn] Uncaught:`, err.message);
    });
  }

  async #runAITurn(session) {
    this.isGeminiRunning = true;
    this.isSarvamRunning = true;
    this.isPlivoSpeaking = true;

    let killTag = false;
    let switchLanguage = null;

    try {
      const ttsPromise = this.sarvam.openTTSStream(
        this.callUUID,
        (base64Audio) => {
          if (
            this.isUserSpeaking ||
            (!this.isGeminiRunning && !this.isSarvamRunning)
          ) {
            return;
          }

          if (this.fillerPlaying) {
            this.fillerBuffer.push(base64Audio);
            return;
          }

          this.plivo.sendAudio(base64Audio);
        },
        () => {
          this.isSarvamRunning = false;

          if (this.isUserSpeaking) {
            return;
          }

          if (this.fillerPlaying) {
            return;
          }

          this.plivo.sendTTSComplete();
        },
        () => this.isUserSpeaking,
      );

      const result = await this.gemini.screeningTurn(this.callUUID, {
        candidateName: session.devCandidateName,
        jobTitle: session.devJobTitle,
        companyName: session.devCompanyName,
        jobDescription: session.jobDescription,
        messages: session.transcript,
        language: session.language,
        screeningQuestions: session.screeningQuestions,
        modelName: "gemini-3.1-flash-lite",
        onChunk: (chunk) => {
          if (this.isUserSpeaking) {
            return;
          }

          if (this.fillerTimer) {
            clearTimeout(this.fillerTimer);
            this.fillerTimer = null;
          }

          this.sarvam.sendTTSChunk(chunk);
        },
      });

      killTag = result.killTag;
      switchLanguage = result.switchLanguage;

      this.isGeminiRunning = false;
      this.sarvam.flushTTSStream();

      await ttsPromise;

      if (this.isUserSpeaking) {
        return;
      }

      if (switchLanguage) {
        await this.sarvam.switchLanguage(this.callUUID, switchLanguage);

        const idleMessages = session.callConfig?.messages ?? {};
        const warningMap = idleMessages.idleWarning ?? {};
        const disconnectMap = idleMessages.idleDisconnect ?? {};

        this.idleWarningText =
          warningMap[switchLanguage] ?? this.idleWarningText;
        this.idleDisconnectText =
          disconnectMap[switchLanguage] ?? this.idleDisconnectText;
        this.db.language = this.sarvam.getLanguageCode(switchLanguage);
      }

      if (killTag) {
        console.log(`💀 [Kill] Scheduling hangup after TTS`);
        this.killPending = true;
        return;
      }
    } catch (err) {
      console.error(`❌ [AI Turn] Failed:`, err.message);
    } finally {
      this.isGeminiRunning = false;
      this.isSarvamRunning = false;
    }
  }

  #startIdleTimers() {
    this.vam.startIdleTimers(
      { warningAfterMs: 7000, disconnectAfterMs: 17000 },
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
    console.log(`▶️ [playedStream] ${name}`);

    if (name === "intro_spoken") {
      await this.vam.init();
      this.vadGateOpen = true;
      this.#startIdleTimers();
      console.log(`✅ [Intro] VAD gate open`);
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

    if (name === "filler_spoken") {
      setTimeout(() => {
        this.fillerPlaying = false;

        const buffered = this.fillerBuffer.splice(0);

        for (const chunk of buffered) {
          this.plivo.sendAudio(chunk);
        }

        if (!this.isSarvamRunning && !this.isGeminiRunning) {
          this.plivo.sendTTSComplete();
        }
      }, 500);

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
      console.error(`❌ [Intro] No intro audio found`);
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
    const outboundScreeningId =
      session?.wiraOutboundScreeningId ?? session?.outboundScreeningId ?? null;

    await redis.stopCostTracking(this.callUUID, outboundScreeningId, this.db);
  }
}

async function waitForSession(callUUID, maxAttempts = 20, intervalMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    const session = await redis.getSession(callUUID);

    if (session) {
      return session;
    }

    if (i === 0) {
      try {
        const wiraCallId = await redis.client.get(
          `screening:bridge:${callUUID}`,
        );

        if (wiraCallId) {
          const legacyRaw = await redis.client.get(`screening:${wiraCallId}`);

          if (legacyRaw) {
            const legacySession = JSON.parse(legacyRaw);
            const repairedSession = { ...legacySession, callId: callUUID };
            await redis.saveSession(callUUID, repairedSession);
            return repairedSession;
          }
        }
      } catch (err) {
        console.warn(`⚠️ [Init] Fallback lookup failed:`, err.message);
      }
    }

    console.warn(
      `⏳ [Init] Session not ready, retrying... (${i + 1}/${maxAttempts})`,
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

async function outboundScreeningSocket(socket) {
  const callUUID = socket.callId;

  const session = await waitForSession(callUUID);

  if (!session) {
    console.error(`❌ [Init] No session found for: ${callUUID}`);
    return;
  }

  const call = new CallManager(socket, callUUID, session);

  try {
    await call.init();
  } catch (err) {
    console.error(`❌ [Init] CallManager.init failed:`, err.message);
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
        console.log(`🛑 [Stream] Stop received for: ${callUUID}`);
      }

      if (packet.event === "incorrectPayload") {
        console.error(`❌ [incorrectPayload]:`, JSON.stringify(packet));
      }
    } catch (err) {
      console.error(`❌ [Socket] Message error:`, err.message);
    }
  });

  socket.on("close", async (closeCode, reason) => {
    console.log(
      `❌ [Socket] Closed — call: ${callUUID} | code: ${closeCode} | reason: ${reason?.toString()}`,
    );
    await call.destroy();
  });
}

module.exports = outboundScreeningSocket;
