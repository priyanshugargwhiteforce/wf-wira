const AI = require("@wira/shared/AI/screening/AI.js");

const USD_TO_INR_FALLBACK = 94.5;

const GEMINI_USD_RATES = {
  "gemini-2.5-flash-lite": {
    inputPerToken: 0.1 / 1_000_000,
    cachedInputPerToken: 0.01 / 1_000_000,
    outputPerToken: 0.4 / 1_000_000,
  },
  "gemini-3.1-flash-lite": {
    inputPerToken: 0.25 / 1_000_000,
    cachedInputPerToken: 0.025 / 1_000_000,
    outputPerToken: 1.5 / 1_000_000,
  },
};
const DEFAULT_RATES = GEMINI_USD_RATES["gemini-2.5-flash-lite"];

const SWITCH_TAG_TO_LANGUAGE = {
  switch_to_hindi: "hi",
  switch_to_english: "en",
  switch_to_bengali: "bn",
  switch_to_gujarati: "gu",
  switch_to_kannada: "kn",
  switch_to_malayalam: "ml",
  switch_to_marathi: "mr",
  switch_to_odia: "or",
  switch_to_punjabi: "pa",
  switch_to_tamil: "ta",
  switch_to_telugu: "te",
  switch_to_urdu: "ur",
};

class GeminiManager {
  constructor(redisManager = null) {
    this.redis = redisManager;
    this.cacheId = null;
    this.abortController = null;
    this.usdToInr = USD_TO_INR_FALLBACK;
  }

  async fetchUsdToInr() {
    try {
      const response = await fetch(
        "https://api.exchangerate-api.com/v4/latest/USD",
      );
      const data = await response.json();
      this.usdToInr = data?.rates?.INR ?? USD_TO_INR_FALLBACK;
    } catch (_) {
      this.usdToInr = USD_TO_INR_FALLBACK;
    }
  }

  #calculateCost(usage, modelName) {
    if (!usage) {
      return 0;
    }

    const rates = GEMINI_USD_RATES[modelName] ?? DEFAULT_RATES;

    const totalInput = usage.promptTokenCount ?? 0;
    const cachedInput = usage.cachedContentTokenCount ?? 0;
    const nonCached = Math.max(0, totalInput - cachedInput);
    const outputTokens = usage.candidatesTokenCount ?? 0;

    return (
      nonCached * rates.inputPerToken * this.usdToInr +
      cachedInput * rates.cachedInputPerToken * this.usdToInr +
      outputTokens * rates.outputPerToken * this.usdToInr
    );
  }

  async #recordCost(callUUID, usage, modelName) {
    if (!this.redis || !usage) {
      return;
    }

    const cost = this.#calculateCost(usage, modelName);

    const totalInput = usage.promptTokenCount ?? 0;
    const cachedInput = usage.cachedContentTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;

    await this.redis.recordGemini(callUUID, {
      inputTokens: totalInput,
      cachedInputTokens: cachedInput,
      outputTokens: outputTokens,
      cost: cost,
    });
  }

  #processTag(tag, state) {
    const lower = tag.toLowerCase();

    if (lower === "kill") {
      state.killTag = true;
      return;
    }

    const tagKey = `switch_to_${lower.replace("switch_to_", "")}`;

    if (SWITCH_TAG_TO_LANGUAGE[tagKey]) {
      state.switchLanguage = SWITCH_TAG_TO_LANGUAGE[tagKey];
    }
  }

  #buildStreamingOnChunk(state, callerOnChunk) {
    return (chunk) => {
      if (!chunk) {
        return;
      }

      for (let i = 0; i < chunk.length; i++) {
        const char = chunk[i];

        if (state.inTag) {
          if (char === ">") {
            state.inTag = false;
            this.#processTag(state.tagBuffer, state);
            state.tagBuffer = "";
          } else {
            state.tagBuffer += char;
          }
        } else if (char === "<") {
          state.inTag = true;
          state.tagBuffer = "";

          if (state.cleanBuffer.length > 0 && callerOnChunk) {
            callerOnChunk(state.cleanBuffer);
            state.cleanBuffer = "";
          }
        } else {
          state.cleanBuffer += char;
        }
      }

      if (state.cleanBuffer.length > 0 && !state.inTag && callerOnChunk) {
        callerOnChunk(state.cleanBuffer);
        state.cleanBuffer = "";
      }
    };
  }

  async #updateSession(callUUID, cleanText, switchLanguage) {
    if (!this.redis) {
      return;
    }

    if (!cleanText || cleanText.trim() === "") {
      return;
    }

    const session = await this.redis.getSession(callUUID);

    if (!session) {
      return;
    }

    session.cacheId = this.cacheId;
    session.transcript.push({
      role: "assistant",
      content: cleanText.replace(/\r?\n+/g, " ").trim(),
    });

    if (switchLanguage) {
      session.language = switchLanguage;
    }

    await this.redis.saveSession(callUUID, session);
  }

  async screeningTurn(
    callUUID,
    {
      candidateName,
      jobTitle,
      companyName,
      jobDescription,
      messages,
      language,
      screeningQuestions,
      modelName = "gemini-2.5-flash-lite",
      expiryMinutes = 20,
      onChunk = null,
    },
  ) {
    this.abortController = new AbortController();

    const state = {
      inTag: false,
      tagBuffer: "",
      cleanBuffer: "",
      killTag: false,
      switchLanguage: null,
    };

    const streamingOnChunk = this.#buildStreamingOnChunk(state, onChunk);

    const result = await AI.screeningCall2({
      candidateName,
      jobTitle,
      companyName,
      jobDescription,
      messages,
      language,
      screeningQuestions,
      modelName,
      onChunk: streamingOnChunk,
      cacheId: this.cacheId,
      expiryMinutes,
      signal: this.abortController.signal,
    });

    await this.#recordCost(callUUID, result.usage, modelName);

    this.cacheId = result.cacheId ?? this.cacheId;

    const cleanText = (result.content ?? "")
      .replace(/<kill>/gi, "")
      .replace(/<switch_to_[a-zA-Z]+>/gi, "")
      .trim();

    await this.#updateSession(callUUID, cleanText, state.switchLanguage);

    console.log(`🎙️ [AI]: "${cleanText}"`);

    return {
      cleanText,
      killTag: state.killTag,
      switchLanguage: state.switchLanguage,
    };
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async deleteCache() {
    await AI.deleteContextCache(this.cacheId);
    this.cacheId = null;
  }

  destroy() {
    this.abort();
    this.cacheId = null;
  }
}

module.exports = GeminiManager;
