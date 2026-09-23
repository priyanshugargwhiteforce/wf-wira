const ollama = require("ollama").default;
const Groq = require("groq-sdk");
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");
const redisClient = require("@wira/shared/config/redisConfig");

require("dotenv").config({
  quiet: true,
  path: path.resolve(__dirname, "../../.env"),
});

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;
const OPENCLAW_MODEL = "minimax-m2.7:cloud";
const OPENCLAW_RETRIES = 3;
const OPENCLAW_DELAY_MS = 2000;
const CACHE_REF_PATH = path.resolve(
  __dirname,
  "../../Wira-Tender/tenderFiles/cacheReference.json",
);
const CACHE_MODEL = "gemini-3.1-flash-lite";
const CACHE_TTL = `${23 * 60 * 60}s`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadKeyPool() {
  const keys = [];
  let i = 1;

  while (process.env[`GROQ_KEY${i}`]) {
    keys.push(process.env[`GROQ_KEY${i++}`]);
  }

  if (keys.length === 0 && process.env.GROQ_KEY) {
    keys.push(process.env.GROQ_KEY);
  }

  if (keys.length === 0) {
    throw new Error(
      "No Groq API keys found. Set GROQ_KEY1, GROQ_KEY2, ... in .env",
    );
  }

  console.log(`🔑 Groq key pool: ${keys.length} key(s) loaded`);
  return keys;
}

const KEY_POOL = loadKeyPool();

async function getActiveKeyIndex() {
  try {
    const val = await redisClient.get("wira:groq_key_index");
    return val ? parseInt(val, 10) % KEY_POOL.length : 0;
  } catch (err) {
    return 0;
  }
}

async function rotateKeyIndex() {
  try {
    const current = await getActiveKeyIndex();
    const next = (current + 1) % KEY_POOL.length;
    await redisClient.set("wira:groq_key_index", next, "EX", 60);
  } catch (err) {
    console.warn(`⚠️  Failed to rotate key index in Redis: ${err.message}`);
  }
}

function resolveGroqModel(name) {
  if (name === "gpt-oss") {
    return "openai/gpt-oss-120b";
  }

  if (name === "gpt-oss2") {
    return "openai/gpt-oss-20b";
  }

  return name;
}

function resolveOllamaModel(name) {
  if (name === "gpt-oss2" || name === "gpt-oss-20b") {
    return "gpt-oss:20b-cloud";
  }

  return "gpt-oss:120b-cloud";
}

function groqSequenceFor(name) {
  if (name === "gpt-oss" || name === "gpt-oss2") {
    const primary = resolveGroqModel(name);
    const fallback =
      name === "gpt-oss" ? "openai/gpt-oss-20b" : "openai/gpt-oss-120b";
    return [primary, fallback];
  }

  return [resolveGroqModel(name), "openai/gpt-oss-120b", "openai/gpt-oss-20b"];
}

function extractContent(output) {
  const fromChoices = output?.choices?.[0]?.message?.content;

  if (fromChoices != null) {
    return fromChoices;
  }

  const fromMessage = output?.message?.content;

  if (fromMessage != null) {
    return fromMessage;
  }

  console.warn(
    "⚠️  Unexpected response shape:",
    JSON.stringify(output)?.slice(0, 300),
  );
  throw new Error("Unknown response format from model");
}

function fileToBase64(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString("base64");

  const ext = path.extname(filePath).toLowerCase();
  let mimeType = "application/octet-stream";

  if (ext === ".pdf") {
    mimeType = "application/pdf";
  } else if (ext === ".txt") {
    mimeType = "text/plain";
  } else if (ext === ".json") {
    mimeType = "application/json";
  } else if (ext === ".png") {
    mimeType = "image/png";
  } else if (ext === ".jpg" || ext === ".jpeg") {
    mimeType = "image/jpeg";
  } else if (ext === ".webp") {
    mimeType = "image/webp";
  } else if (ext === ".gif") {
    mimeType = "image/gif";
  }

  return {
    data: base64Data,
    mimeType: mimeType,
  };
}

function buildGeminiContents(messages, systemPrompt) {
  const allMessages = [...messages];

  if (systemPrompt && allMessages.length > 0) {
    const first = allMessages[0];
    allMessages[0] = {
      ...first,
      content: `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n[/SYSTEM INSTRUCTIONS]\n\n${first.content}`,
    };
  }

  return allMessages;
}

async function tryGroqOnce(
  model,
  messages,
  streaming,
  temperature,
  jsonMode,
  apiKey,
) {
  try {
    const groq = new Groq({ apiKey: apiKey });
    const params = {
      model,
      messages,
      temperature,
      stream: streaming,
    };

    if (jsonMode && !streaming) {
      params.response_format = { type: "json_object" };
    }

    const output = await groq.chat.completions.create(params);

    if (streaming) {
      let response = "";

      for await (const chunk of output) {
        const text = chunk.choices?.[0]?.delta?.content || "";
        process.stdout.write(text);
        response += text;
      }

      console.log("\n✅ Stream ended");

      return {
        success: true,
        result: response,
      };
    }

    return {
      success: true,
      result: extractContent(output),
    };
  } catch (err) {
    const status =
      err.status ?? err.message?.match(/\b(4\d\d|5\d\d)\b/)?.[0] | 0;
    const rateLimited =
      status === 429 ||
      status === 413 ||
      err.message?.includes("429") ||
      err.message?.includes("413");
    const modelError = status === 400 || err.message?.includes("400");

    return {
      success: false,
      rateLimited,
      modelError,
      error: err.message,
    };
  }
}

async function tryGroqWithKeyRotation(
  modelName,
  messages,
  streaming,
  temperature,
  jsonMode,
  explicitKey,
) {
  const sequence = groqSequenceFor(modelName);

  for (const model of sequence) {
    if (explicitKey) {
      const r = await tryGroqOnce(
        model,
        messages,
        streaming,
        temperature,
        jsonMode,
        explicitKey,
      );

      if (r.success) {
        console.log(`✅ Groq [${model}] responded (explicit)`);
        return { success: true, result: r.result };
      }

      console.warn(
        `⚠️  Groq [${model}] explicit key failed (${r.error}) → skipping model`,
      );
      continue;
    }

    for (let keyAttempt = 0; keyAttempt < KEY_POOL.length; keyAttempt++) {
      const activeKeyIndex = await getActiveKeyIndex();
      const currentKey = KEY_POOL[activeKeyIndex];
      const keyLabel = `key${activeKeyIndex + 1}`;
      let shouldRotateKey = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const r = await tryGroqOnce(
          model,
          messages,
          streaming,
          temperature,
          jsonMode,
          currentKey,
        );

        if (r.success) {
          console.log(`✅ Groq [${model}] responded (${keyLabel})`);
          return { success: true, result: r.result };
        }

        if (r.modelError) {
          console.warn(
            `⚠️  Groq [${model}] 400 on ${keyLabel} → rotating to next key`,
          );
          shouldRotateKey = true;
          break;
        }

        if (r.rateLimited) {
          console.warn(`⚠️  Groq [${model}] 429 on ${keyLabel} → rotating key`);
          shouldRotateKey = true;
          break;
        }

        console.warn(
          `⚠️  Groq [${model}] attempt ${attempt}/${MAX_RETRIES} (${keyLabel}): ${r.error}`,
        );

        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
        }
      }

      if (shouldRotateKey) {
        await rotateKeyIndex();
      }
    }

    console.warn(`🔑 [${model}] all keys exhausted → trying next model`);
  }

  return { success: false };
}

async function tryOllamaModel(
  model,
  messages,
  streaming,
  temperature,
  ctx,
  topP,
  jsonMode,
) {
  const base = {
    model,
    messages,
    stream: streaming,
    options: { temperature, num_ctx: ctx, top_p: topP },
    ...(jsonMode && !streaming ? { format: "json" } : {}),
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const output = await ollama.chat(base);
      console.log(`✅ Ollama [${model}] responded (attempt ${attempt})`);

      if (streaming) {
        let response = "";

        for await (const chunk of output) {
          const text = chunk.message?.content || "";
          process.stdout.write(text);
          response += text;
        }

        console.log("\n✅ Stream ended");

        return {
          success: true,
          result: response,
        };
      }

      return {
        success: true,
        result: extractContent(output),
      };
    } catch (err) {
      console.warn(
        `⚠️  Ollama [${model}] attempt ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  return {
    success: false,
  };
}

async function runGemini({
  messages,
  systemPrompt = null,
  streaming = false,
  temperature = 0.0,
  jsonMode = false,
  apiKey = null,
} = {}) {
  const key = apiKey || process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No Gemini API key found. Set GEMINI_API_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });
  const builtMessages = buildGeminiContents(messages, systemPrompt);

  const history = builtMessages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = builtMessages.at(-1)?.content ?? "";

  const chat = genAI.chats.create({
    model: "gemini-2.5-flash",
    history,
    config: {
      temperature,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (streaming) {
        const streamResult = await chat.sendMessageStream({
          message: lastMessage,
        });
        let response = "";

        for await (const chunk of streamResult) {
          const text = chunk.text ?? "";
          process.stdout.write(text);
          response += text;
        }

        console.log("\n✅ Gemini stream ended");
        return response;
      }

      const result = await chat.sendMessage({ message: lastMessage });
      const text = result.text ?? "";

      console.log("✅ Gemini [gemini-2.5-flash] responded");
      return text;
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");
      console.warn(
        `⚠️  Gemini attempt ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );

      if (is429 || attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function runGemini2({
  messages,
  files = [],
  systemPrompt = null,
  modelName = "gemini-2.5-flash",
  streaming = false,
  temperature = 0.0,
  jsonMode = false,
  apiKey = null,
  onChunk = null,
  thinkingBudget,
  cachedContentName = null,
} = {}) {
  const key = apiKey || process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No Gemini API key found. Set GEMINI_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });
  const builtMessages = buildGeminiContents(messages, systemPrompt);

  const fileParts = [];
  const inlineTexts = [];

  for (const filePath of files) {
    try {
      const { mimeType } = fileToBase64(filePath);
      const isJsonOrTxt =
        mimeType === "application/json" || mimeType === "text/plain";

      if (isJsonOrTxt) {
        const content = fs.readFileSync(filePath, "utf-8");
        inlineTexts.push(
          `=== FILE: ${path.basename(filePath)} ===\n\n${content}\n\n=== END ===`,
        );
        console.log(`✅ Loaded inline: ${path.basename(filePath)}`);
      } else {
        console.log(`⬆️  Uploading via File API: ${path.basename(filePath)}`);

        const uploaded = await genAI.files.upload({
          file: filePath,
          config: { mimeType },
        });

        let fileData = uploaded;
        let attempts = 0;

        while (fileData.state === "PROCESSING" && attempts < 20) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          fileData = await genAI.files.get({ name: fileData.name });
          attempts++;
          console.log(`⏳ File state: ${fileData.state} (attempt ${attempts})`);
        }

        if (fileData.state !== "ACTIVE") {
          throw new Error(
            `File ${path.basename(filePath)} failed to become ACTIVE (state: ${fileData.state})`,
          );
        }

        console.log(`📄 File URI: ${fileData.uri}`);
        console.log(`📄 File state: ${fileData.state}`);
        console.log(`📄 File size: ${fileData.sizeBytes} bytes`);

        fileParts.push({
          fileData: {
            mimeType: fileData.mimeType,
            fileUri: fileData.uri,
          },
        });

        console.log(
          `✅ Uploaded via File API: ${path.basename(filePath)} → ${fileData.uri}`,
        );
      }
    } catch (err) {
      console.warn(`⚠️  Failed to load file ${filePath}: ${err.message}`);
    }
  }

  const history = builtMessages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = builtMessages.at(-1)?.content ?? "";

  const fullLastMessage =
    inlineTexts.length > 0
      ? `${lastMessage}\n\n${inlineTexts.join("\n\n")}`
      : lastMessage;

  const lastParts = [{ text: fullLastMessage }, ...fileParts];

  const chat = genAI.chats.create({
    model: modelName,
    history,
    config: {
      temperature,
      thinkingConfig: {
        thinkingBudget: thinkingBudget,
      },
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
      ...(cachedContentName ? { cachedContent: cachedContentName } : {}),
    },
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (streaming) {
        const streamResult = await chat.sendMessageStream({
          message: lastParts,
        });
        let response = "";

        for await (const chunk of streamResult) {
          const text = chunk.text ?? "";
          response += text;

          if (onChunk) {
            onChunk(text);
          }
        }

        console.log("\n✅ Gemini stream ended");
        return response;
      }

      const result = await chat.sendMessage({ message: lastParts });
      const text = result.text ?? "";

      console.log(`✅ Gemini [${modelName}] responded`);
      return text;
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");
      console.warn(
        `⚠️  Gemini attempt ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );

      if (is429 || attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function runGemini3({
  messages,
  modelName = "gemini-2.5-flash-lite",
  systemPrompt = null,
  streaming = false,
  temperature = 0.0,
  jsonMode = false,
  apiKey = null,
} = {}) {
  const key = apiKey || process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No Gemini API key found. Set GEMINI_API_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });
  const builtMessages = buildGeminiContents(messages, systemPrompt);

  const history = builtMessages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = builtMessages.at(-1)?.content ?? "";

  const chat = genAI.chats.create({
    model: modelName ? modelName : "gemini-2.5-flash-lite",
    history,
    config: {
      temperature,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (streaming) {
        const streamResult = await chat.sendMessageStream({
          message: lastMessage,
        });
        let response = "";

        for await (const chunk of streamResult) {
          const text = chunk.text ?? "";
          process.stdout.write(text);
          response += text;
        }

        console.log("\n✅ Gemini stream ended");
        return response;
      }

      const result = await chat.sendMessage({ message: lastMessage });
      const text = result.text ?? "";

      console.log(`✅ Gemini [${modelName}] responded`);
      return text;
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");
      console.warn(
        `⚠️  Gemini attempt ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );

      if (is429 || attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function run({
  messages,
  systemPrompt = null,
  modelName = "gpt-oss",
  streaming = false,
  apiKey = null,
  temperature = 0.0,
  ctx = 1024,
  topP = 0.1,
  jsonMode = false,
}) {
  const builtMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const groqResult = await tryGroqWithKeyRotation(
    modelName,
    builtMessages,
    streaming,
    temperature,
    jsonMode,
    apiKey,
  );

  if (groqResult.success) {
    return groqResult.result;
  }

  console.warn("↩️  Groq exhausted → falling back to Ollama...");
  const cloud = await tryOllamaModel(
    resolveOllamaModel(modelName),
    builtMessages,
    streaming,
    temperature,
    ctx,
    topP,
    jsonMode,
  );

  if (cloud.success) {
    return cloud.result;
  }

  if (modelName !== "gpt-oss" && modelName !== "gpt-oss2") {
    const local = await tryOllamaModel(
      "llama3.2",
      builtMessages,
      streaming,
      temperature,
      ctx,
      topP,
      jsonMode,
    );

    if (local.success) {
      return local.result;
    }
  }

  throw new Error(`run(): all providers exhausted for "${modelName}"`);
}

async function runAudioToText({
  audioFile,
  modelName = "whisper-large-v3-turbo",
  language = null,
  prompt = null,
  apiKey = null,
} = {}) {
  const MODELS = {
    "whisper-large-v3": "whisper-large-v3",
    "whisper-large-v3-turbo": "whisper-large-v3-turbo",
    "distil-whisper": "distil-whisper-large-v3-en",
  };

  const resolvedModel = MODELS[modelName] ?? modelName;
  const isEnglishOnlyModel = resolvedModel === "distil-whisper-large-v3-en";

  if (!isEnglishOnlyModel && !language && !prompt) {
    language = "hi";
    prompt =
      "nahi, haan, theek hai, bilkul, shukriya, achha, karo, abhi, koi baat nahi, nahi chahiye, rehne do, chhod do, ek second, samajh gaya";
  }

  let fileStream;

  try {
    fileStream = fs.createReadStream(audioFile);
    console.log(`✅ Loaded audio file: ${path.basename(audioFile)}`);
  } catch (err) {
    throw new Error(
      `runAudioToText(): failed to load file "${audioFile}": ${err.message}`,
    );
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const activeIdx = await getActiveKeyIndex();
      const key = apiKey || KEY_POOL[activeIdx];
      const groq = new Groq({ apiKey: key });

      const transcription = await groq.audio.transcriptions.create({
        file: fileStream,
        model: resolvedModel,
        response_format: "json",
        ...(language ? { language } : {}),
        ...(prompt ? { prompt } : {}),
      });

      console.log(
        `✅ Groq [${resolvedModel}] transcribed: "${path.basename(audioFile)}" (lang: ${language ?? "auto"})`,
      );
      return transcription.text;
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");
      console.warn(
        `⚠️  runAudioToText() attempt ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );

      if (is429) {
        await rotateKeyIndex();
      }

      if (attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function runTextToAudio({
  text,
  modelName = "canopylabs/orpheus-v1-english",
  voice = "diana",
  responseFormat = "wav",
  speed = 1.0,
  outputFile = null,
  apiKey = null,
} = {}) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const activeIdx = await getActiveKeyIndex();
      const key = apiKey || KEY_POOL[activeIdx];
      const groq = new Groq({ apiKey: key });

      const response = await groq.audio.speech.create({
        model: modelName,
        input: text,
        voice,
        response_format: responseFormat,
        speed,
      });

      const arrayBuffer = await response.arrayBuffer();

      if (outputFile) {
        fs.writeFileSync(outputFile, Buffer.from(arrayBuffer));
        console.log(
          `✅ Groq [${modelName}] audio saved: "${path.basename(outputFile)}"`,
        );
      } else {
        console.log(`✅ Groq [${modelName}] audio generated`);
      }

      return arrayBuffer;
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");
      console.warn(
        `⚠️  runTextToAudio() attempt ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );

      if (is429) {
        await rotateKeyIndex();
      }

      if (attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function runTextToAudioStream({
  text,
  modelName = "canopylabs/orpheus-v1-english",
  voice = "diana",
  responseFormat = "wav",
  speed = 1.0,
  apiKey = null,
} = {}) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const activeIdx = await getActiveKeyIndex();
      const key = apiKey || KEY_POOL[activeIdx];
      const groq = new Groq({ apiKey: key });

      const response = await groq.audio.speech
        .create({
          model: modelName,
          input: text,
          voice,
          response_format: responseFormat,
          speed,
        })
        .asResponse();

      console.log(`✅ Groq [${modelName}] audio stream open`);
      return response.body;
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");
      console.warn(
        `⚠️  runTextToAudioStream() attempt ${attempt}/${MAX_RETRIES}: ${err.message}`,
      );

      if (is429) {
        await rotateKeyIndex();
      }

      if (attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function runNoGroq({
  messages,
  systemPrompt = null,
  modelName = "gpt-oss2",
  streaming = false,
  temperature = 0.0,
  ctx = 1024,
  topP = 0.1,
}) {
  const builtMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const cloud = await tryOllamaModel(
    resolveOllamaModel(modelName),
    builtMessages,
    streaming,
    temperature,
    ctx,
    topP,
    false,
  );

  if (cloud.success) {
    return cloud.result;
  }

  const local = await tryOllamaModel(
    "llama3.2",
    builtMessages,
    streaming,
    temperature,
    ctx,
    topP,
    false,
  );

  if (local.success) {
    return local.result;
  }

  throw new Error("runNoGroq(): all Ollama providers failed");
}

async function runLocal({
  messages,
  systemPrompt = null,
  temperature = 0.0,
  ctx = 1024,
  topP = 0.1,
}) {
  const builtMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const result = await tryOllamaModel(
    "llama3.2",
    builtMessages,
    false,
    temperature,
    ctx,
    topP,
    false,
  );

  if (result.success) {
    return result.result;
  }

  throw new Error("runLocal(): failed after maximum retries");
}

async function runGroqBatch({
  items,
  modelName = "openai/gpt-oss-20b",
  apiKey = null,
}) {
  const activeIdx = await getActiveKeyIndex();
  const groq = new Groq({ apiKey: apiKey || KEY_POOL[activeIdx] });
  const model = resolveGroqModel(modelName);
  const tempPath = path.join(__dirname, `groq-batch-${Date.now()}.jsonl`);

  const jsonlLines = items.map((item) =>
    JSON.stringify({
      custom_id: item.id,
      method: "POST",
      url: "/v1/chat/completions",
      body: { model, temperature: 0, messages: item.messages },
    }),
  );

  fs.writeFileSync(tempPath, jsonlLines.join("\n"));

  try {
    let file;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        file = await groq.files.create({
          file: fs.createReadStream(tempPath),
          purpose: "batch",
        });
        break;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          throw err;
        }

        console.warn(`⚠️  File upload attempt ${attempt}: ${err.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }

    let batch;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        batch = await groq.batches.create({
          input_file_id: file.id,
          endpoint: "/v1/chat/completions",
          completion_window: "24h",
        });
        break;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          throw err;
        }

        console.warn(`⚠️  Batch create attempt ${attempt}: ${err.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }

    let batchStatus;

    do {
      await sleep(1500);

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          batchStatus = await groq.batches.retrieve(batch.id);
          break;
        } catch (err) {
          if (attempt === MAX_RETRIES) {
            throw err;
          }

          console.warn(`⚠️  Batch poll attempt ${attempt}: ${err.message}`);
          await sleep(RETRY_DELAY_MS);
        }
      }
    } while (batchStatus.status !== "completed");

    let outputRaw;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        outputRaw = await groq.files.content(batchStatus.output_file_id);
        break;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          throw err;
        }

        console.warn(`⚠️  Output fetch attempt ${attempt}: ${err.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }

    const results = {};

    for (const line of outputRaw.split("\n").filter(Boolean)) {
      const obj = JSON.parse(line);
      results[obj.custom_id] =
        obj.response?.body?.choices?.[0]?.message?.content ?? null;
    }

    return results;
  } finally {
    fs.unlinkSync(tempPath);
  }
}

async function runOpenClaw({
  messages,
  systemPrompt = null,
  temperature = 0.0,
  jsonMode = false,
  ctx = 4096,
} = {}) {
  const builtMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  for (let attempt = 1; attempt <= OPENCLAW_RETRIES; attempt++) {
    try {
      const response = await ollama.chat({
        model: OPENCLAW_MODEL,
        messages: builtMessages,
        options: {
          temperature,
          num_ctx: ctx,
          ...(jsonMode ? { format: "json" } : {}),
        },
      });

      const text = response.message?.content ?? "";
      console.log(`✅ OpenClaw [${OPENCLAW_MODEL}] responded`);
      return text;
    } catch (err) {
      console.warn(
        `⚠️ OpenClaw attempt ${attempt}/${OPENCLAW_RETRIES}: ${err.message}`,
      );

      if (attempt === OPENCLAW_RETRIES) {
        throw err;
      }

      await new Promise((r) => setTimeout(r, OPENCLAW_DELAY_MS * attempt));
    }
  }
}

async function saveCompanyProfileToCache(companyIndex, profilePath) {
  const key = process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const indexStr = String(companyIndex);
  const genAI = new GoogleGenAI({ apiKey: key });
  const profileText = fs.readFileSync(profilePath, "utf-8");

  const cached = await genAI.caches.create({
    model: "gemini-3.1-flash-lite",
    config: {
      displayName: `company-profile-${indexStr}`,
      ttl: CACHE_TTL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `=== COMPANY PROFILE ===\n\n${profileText}\n\n=== END ===`,
            },
          ],
        },
      ],
    },
  });

  const ref = fs.existsSync(CACHE_REF_PATH)
    ? JSON.parse(fs.readFileSync(CACHE_REF_PATH, "utf-8"))
    : {};

  ref[indexStr] = { cacheId: cached.name, cachedAt: new Date().toISOString() };
  fs.writeFileSync(CACHE_REF_PATH, JSON.stringify(ref, null, 2), "utf-8");

  console.log(`✅ Cache saved for index ${indexStr}: ${cached.name}`);
  return cached.name;
}

async function resolveCompanyCache(companyIndex, profilePath) {
  const key = process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const indexStr = String(companyIndex);
  const genAI = new GoogleGenAI({ apiKey: key });

  const ref = fs.existsSync(CACHE_REF_PATH)
    ? JSON.parse(fs.readFileSync(CACHE_REF_PATH, "utf-8"))
    : {};
  const entry = ref[indexStr];

  if (entry?.cacheId) {
    try {
      const existing = await genAI.caches.get({ name: entry.cacheId });
      const existingModel = existing.model?.replace("models/", "");
      const expectedModel = "gemini-3.1-flash-lite";

      if (existingModel !== expectedModel) {
        console.warn(
          `⚠️  Cache model mismatch for index ${indexStr}: got ${existingModel}, need ${expectedModel} — recreating...`,
        );
        await genAI.caches.delete({ name: entry.cacheId }).catch(() => {});
        throw new Error("model mismatch");
      }

      console.log(`✅ Cache hit for index ${indexStr}: ${entry.cacheId}`);
      return entry.cacheId;
    } catch {
      console.warn(`⚠️  Cache gone for index ${indexStr} — recreating...`);
    }
  }

  return saveCompanyProfileToCache(companyIndex, profilePath);
}

async function createContextCache(model, text, expiryMinutes = 20) {
  const key = process.env.GEMINI_KEY;
  const USD_TO_INR = 94.5;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });
  const ttlSeconds = expiryMinutes * 60;

  const cached = await genAI.caches.create({
    model: model,
    config: {
      displayName: `custom-cache-${Date.now()}`,
      ttl: `${ttlSeconds}s`,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: text,
            },
          ],
        },
      ],
    },
  });

  const totalTokens = cached.usageMetadata?.totalTokenCount || 0;
  const lowerModel = model.toLowerCase();

  let hourlyStorageRate = 1.0;
  let cacheWriteRate = 0.3;

  if (lowerModel.includes("3.1-flash-lite")) {
    hourlyStorageRate = 1.0;
    cacheWriteRate = 0.25;
  } else if (lowerModel.includes("flash-lite")) {
    hourlyStorageRate = 1.0;
    cacheWriteRate = 0.1;
  } else if (lowerModel.includes("pro")) {
    hourlyStorageRate = 4.5;
    cacheWriteRate = 0.5;
  }

  const oneTimeWriteCostUsd = (totalTokens / 1_000_000) * cacheWriteRate;
  const costPerHourUsd = (totalTokens / 1_000_000) * hourlyStorageRate;
  const costPerSecondUsd = costPerHourUsd / 3600;
  const totalLifespanCostUsd = costPerSecondUsd * ttlSeconds;

  return {
    cacheName: cached.name,
    metrics: {
      totalTokens: totalTokens,
      oneTimeWriteCost: oneTimeWriteCostUsd * USD_TO_INR,
      costPerSecond: costPerSecondUsd * USD_TO_INR,
      totalLifespanCost: totalLifespanCostUsd * USD_TO_INR,
    },
  };
}

async function checkContextCacheExists(cacheId) {
  const key = process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });

  try {
    await genAI.caches.get({ name: cacheId });
    return true;
  } catch (err) {
    return false;
  }
}

async function deleteContextCache(cacheId) {
  const key = process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });

  try {
    await genAI.caches.delete({ name: cacheId });
    return true;
  } catch (err) {
    console.error(
      `❌ [Gemini Cache] Failed to delete cache ${cacheId}:`,
      err.message,
    );
    return false;
  }
}

async function runGeminiCall({
  conversation,
  prompt = null,
  cacheId = null,
  modelName = "gemini-2.5-flash-lite",
  temperature = 0.6,
  thinkingBudget = null,
  streaming = true,
  onChunk = null,
  apiKey = null,
  signal = null,
} = {}) {
  const key = apiKey || process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });

  const history = conversation.slice(0, -1).map((m) => {
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: m.content,
        },
      ],
    };
  });

  const lastMessage = conversation.at(-1)?.content ?? "";

  const config = {
    temperature: temperature,
  };

  if (thinkingBudget) {
    config.thinkingConfig = {
      thinkingBudget: thinkingBudget,
    };
  }

  if (cacheId) {
    config.cachedContent = cacheId;
  } else if (prompt) {
    config.systemInstruction = prompt;
  }

  const chat = genAI.chats.create({
    model: modelName,
    history: history,
    config: config,
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (streaming) {
        const streamResult = await chat.sendMessageStream(
          { message: lastMessage },
          { signal },
        );
        let response = "";
        let usage = null;

        for await (const chunk of streamResult) {
          if (signal?.aborted) {
            break;
          }

          const text = chunk.text ?? "";
          process.stdout.write(text);
          response += text;

          if (onChunk) {
            onChunk(text);
          }

          if (chunk.usageMetadata) {
            usage = chunk.usageMetadata;
          }
        }

        return { text: response, usage: usage };
      }

      const result = await chat.sendMessage(
        { message: lastMessage },
        { signal },
      );

      return {
        text: result.text ?? "",
        usage: result.usageMetadata ?? null,
      };
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");

      if (is429 || attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function runGeminiCacheOnly({
  prompt,
  modelName = "gemini-2.5-flash-lite",
  temperature = 0.0,
  expiryMinutes = 2,
  apiKey = null,
  signal = null,
} = {}) {
  const key = apiKey || process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });

  const cacheObj = await createContextCache(modelName, prompt, expiryMinutes);
  const cacheId = cacheObj.cacheName;

  try {
    const chat = genAI.chats.create({
      model: modelName,
      history: [],
      config: {
        temperature: temperature,
        cachedContent: cacheId,
      },
    });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await chat.sendMessage(
          { message: "Proceed." },
          { signal },
        );

        return {
          text: result.text ?? "",
          usage: result.usageMetadata ?? null,
          cacheId: cacheId,
          costPerSecond: cacheObj.metrics?.costPerSecond ?? 0,
        };
      } catch (err) {
        const is429 = err.status === 429 || err.message?.includes("429");

        if (is429 || attempt === MAX_RETRIES) {
          throw err;
        }

        await sleep(RETRY_DELAY_MS);
      }
    }
  } finally {
    await deleteContextCache(cacheId);
  }
}

async function runGeminiAnalysis({
  systemPrompt,
  userMessage,
  modelName = "gemini-2.5-flash-lite",
  temperature = 0.0,
  apiKey = null,
  signal = null,
} = {}) {
  const key = apiKey || process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const USD_TO_INR = 94.5;

  const MODEL_RATES_PER_MILLION = {
    "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
    "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  };

  const rates = MODEL_RATES_PER_MILLION[modelName];

  if (!rates) {
    throw new Error(`No pricing configured for model: ${modelName}`);
  }

  const genAI = new GoogleGenAI({ apiKey: key });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await genAI.models.generateContent(
        {
          model: modelName,
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          config: {
            temperature: temperature,
            systemInstruction: systemPrompt,
          },
        },
        { signal },
      );

      const usage = result.usageMetadata ?? null;

      const inputTokens = usage?.promptTokenCount ?? 0;
      const outputTokens = usage?.candidatesTokenCount ?? 0;

      const costUsd =
        (inputTokens / 1_000_000) * rates.input +
        (outputTokens / 1_000_000) * rates.output;
      const costInr = costUsd * USD_TO_INR;

      return {
        text: result.text ?? "",
        usage: usage,
        costInr: costInr,
      };
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");

      if (is429 || attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function runWiraGeminiCall({
  conversation,
  prompt = null,
  cacheId = null,
  files = [],
  modelName = "gemini-2.5-flash-lite",
  temperature = 0.6,
  thinkingBudget = null,
  streaming = true,
  onChunk = null,
  jsonMode = false,
  apiKey = null,
  signal = null,
} = {}) {
  const key = apiKey || process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  const genAI = new GoogleGenAI({ apiKey: key });
  const fileParts = [];

  for (const filePath of files) {
    try {
      const uploaded = await genAI.files.upload({ file: filePath });

      let fileData = uploaded;
      let attempts = 0;

      while (fileData.state === "PROCESSING" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        fileData = await genAI.files.get({ name: fileData.name });
        attempts++;
      }

      if (fileData.state !== "ACTIVE") {
        throw new Error(
          `File ${path.basename(filePath)} failed to become ACTIVE (state: ${fileData.state})`,
        );
      }

      fileParts.push({
        fileData: {
          mimeType: fileData.mimeType,
          fileUri: fileData.uri,
        },
      });
    } catch (err) {
      console.warn(`⚠️  Failed to upload file ${filePath}: ${err.message}`);
    }
  }

  const history = conversation.slice(0, -1).map((m) => {
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    };
  });

  const lastMessage = conversation.at(-1)?.content ?? "";
  const lastParts = [{ text: lastMessage }, ...fileParts];

  const config = {
    temperature: temperature,
  };

  if (thinkingBudget) {
    config.thinkingConfig = {
      thinkingBudget: thinkingBudget,
    };
  }

  if (jsonMode) {
    config.responseMimeType = "application/json";
  }

  if (cacheId) {
    config.cachedContent = cacheId;
  } else if (prompt) {
    config.systemInstruction = prompt;
  }

  const chat = genAI.chats.create({
    model: modelName,
    history: history,
    config: config,
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (streaming) {
        const streamResult = await chat.sendMessageStream(
          { message: lastParts },
          { signal },
        );
        let response = "";
        let usage = null;

        for await (const chunk of streamResult) {
          if (signal?.aborted) {
            break;
          }

          const text = chunk.text ?? "";
          process.stdout.write(text);
          response += text;

          if (onChunk) {
            onChunk(text);
          }

          if (chunk.usageMetadata) {
            usage = chunk.usageMetadata;
          }
        }

        return {
          text: response,
          usage: usage,
          aborted: signal?.aborted ?? false,
        };
      }

      const result = await chat.sendMessage(
        {
          message: lastParts,
        },
        {
          signal: signal,
        },
      );

      return {
        text: result.text ?? "",
        usage: result.usageMetadata ?? null,
        aborted: false,
      };
    } catch (err) {
      if (err.name === "AbortError" || signal?.aborted) {
        return {
          text: "",
          usage: null,
          aborted: true,
        };
      }

      const is429 = err.status === 429 || err.message?.includes("429");

      if (is429 || attempt === MAX_RETRIES) {
        throw err;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function runWiraEmbedChunks({
  chunks,
  taskType = "RETRIEVAL_DOCUMENT",
  outputDimensionality = 1536,
  batchSize = 50,
  apiKey = null,
} = {}) {
  const key = apiKey || process.env.GEMINI_KEY;

  if (!key) {
    throw new Error("No GEMINI_KEY in .env");
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { vectors: [], costInr: 0 };
  }

  const genAI = new GoogleGenAI({ apiKey: key });
  const MODEL = "gemini-embedding-001";
  const EMBED_MAX_RETRIES = 4;
  const EMBED_RETRY_DELAY = 1200;
  const EMBED_PRICE_PER_MILLION = 0.15;
  const USD_TO_INR = 94.5;

  const batches = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }

  async function embedBatch(batch, batchIndex) {
    for (let attempt = 1; attempt <= EMBED_MAX_RETRIES; attempt++) {
      try {
        const response = await genAI.models.embedContent({
          model: MODEL,
          contents: batch,
          config: {
            taskType: taskType,
            outputDimensionality: outputDimensionality,
          },
        });

        if (
          !response.embeddings ||
          response.embeddings.length !== batch.length
        ) {
          throw new Error(
            `Expected ${batch.length} embeddings, got ${response.embeddings?.length ?? 0}`,
          );
        }

        const tokensUsed = response.metadata?.billableCharacterCount
          ? Math.ceil(response.metadata.billableCharacterCount / 4)
          : response.embeddings.reduce(
              (sum, _, i) => sum + Math.ceil(batch[i].length / 4),
              0,
            );

        return {
          vectors: response.embeddings.map((e) => e.values),
          tokens: tokensUsed,
        };
      } catch (err) {
        const is429 = err.status === 429 || err.message?.includes("429");
        console.warn(
          `⚠️  [Embed] Batch ${batchIndex + 1} attempt ${attempt}/${EMBED_MAX_RETRIES}: ${err.message}`,
        );

        if (attempt === EMBED_MAX_RETRIES) {
          throw new Error(
            `[Embed] Batch ${batchIndex + 1} failed after ${EMBED_MAX_RETRIES} attempts: ${err.message}`,
          );
        }

        const delay = is429
          ? EMBED_RETRY_DELAY * attempt * 2
          : EMBED_RETRY_DELAY;
        await sleep(delay);
      }
    }
  }

  const batchResults = await Promise.all(
    batches.map((batch, i) => embedBatch(batch, i)),
  );

  const allVectors = batchResults.flatMap((r) => r.vectors);
  const totalTokens = batchResults.reduce((sum, r) => sum + r.tokens, 0);
  const costInr =
    (totalTokens / 1_000_000) * EMBED_PRICE_PER_MILLION * USD_TO_INR;

  return {
    vectors: allVectors,
    costInr: costInr,
  };
}

module.exports = {
  run,
  runNoGroq,
  runLocal,
  runGemini,
  runGemini2,
  runGemini3,
  runGroqBatch,
  runAudioToText,
  runTextToAudio,
  runTextToAudioStream,
  runOpenClaw,
  saveCompanyProfileToCache,
  resolveCompanyCache,
  createContextCache,
  checkContextCacheExists,
  runGeminiCall,
  deleteContextCache,
  runGeminiCacheOnly,
  runGeminiAnalysis,
  runWiraGeminiCall,
  runWiraEmbedChunks,
};
