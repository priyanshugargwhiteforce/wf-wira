const sarvam = require("@wira/shared/Utility/sarvamHandler");

const LANGUAGE_TO_SARVAM_CODE =
{
    hi: "hi-IN",
    en: "en-IN",
    bn: "bn-IN",
    gu: "gu-IN",
    kn: "kn-IN",
    ml: "ml-IN",
    mr: "mr-IN",
    or: "or-IN",
    pa: "pa-IN",
    ta: "ta-IN",
    te: "te-IN",
    ur: "ur-IN"
};

const VALID_SPEAKERS = [
    "aditya", 
    "ritu", 
    "ashutosh", 
    "priya", 
    "neha", 
    "rahul", 
    "pooja", 
    "rohan", 
    "simran", 
    "kavya", 
    "amit", 
    "dev", 
    "ishita", 
    "shreya", 
    "ratan", 
    "varun", 
    "manan", 
    "sumit", 
    "roopa", 
    "kabir", 
    "aayan", 
    "shubh", 
    "advait", 
    "anand", 
    "tanya", 
    "tarun", 
    "sunny", 
    "mani", 
    "gokul", 
    "vijay", 
    "shruti", 
    "suhani", 
    "mohit", 
    "kavitha", 
    "rehan", 
    "soham", 
    "rupali", 
    "niharika"
];

const SARVAM_TTS_RATE = 3 / 1_000;
const SARVAM_STT_RATE = 30 / 3600;

class SarvamManager
{
    constructor(sttConfig = {}, ttsConfig = {}, redisManager = null)
    {
        this.sampleRate = sttConfig.sampleRate ?? 16000;
        this.speaker = VALID_SPEAKERS.includes(ttsConfig.speaker) ? ttsConfig.speaker : "shreya";
        this.language = ttsConfig.language ?? "hi";
        this.sttStream = null;
        this.ttsSockets = [];
        this.onTranscript = null;
        this.onFirstToken = null;
        this.redis = redisManager;
        this.sttStartTime = null;
        this.sttAccumulatedSeconds = 0;
        this.currentCallUUID = null;
        this.ttsGeneration = 0;
        this.ttsCharsSent = 0;
        this.audioQueue = [];
    }

    getLanguageCode(language = this.language)
    {
        return LANGUAGE_TO_SARVAM_CODE[language] ?? "hi-IN";
    }

    #upsample(mulawBuffer)
    {
        const frameCount = Math.floor(mulawBuffer.length / 2);
        const ratio = Math.round(this.sampleRate / 8000);
        const upsampled = new Int16Array(frameCount * ratio);

        for(let i = 0; i < frameCount; i++)
        {
            const current = mulawBuffer.readInt16LE(i * 2);
            const next = mulawBuffer.readInt16LE(Math.min(i + 1, frameCount - 1) * 2);

            for(let j = 0; j < ratio; j++)
            {
                const fraction = j / ratio;
                upsampled[i * ratio + j] = Math.round(current + fraction * (next - current));
            }
        }

        return Buffer.from(upsampled.buffer);
    }

    #mulawToLinear(mulawByte)
    {
        mulawByte = ~mulawByte & 0xFF;
        const sign = mulawByte & 0x80;
        const exponent = (mulawByte >> 4) & 0x07;
        const mantissa = mulawByte & 0x0F;
        let sample = ((mantissa << 3) + 0x84) << exponent;
        sample -= 0x84;
        return sign ? -sample : sample;
    }

    #linearToMulaw(sample)
    {
        const MAX = 32767;
        sample = Math.max(-MAX, Math.min(MAX, sample));
        const sign = sample < 0 ? 0x80 : 0;

        if(sign)
        {
            sample = -sample;
        }

        sample += 33;
        let exponent = 7;

        for(let expMask = 0x4000; exponent > 0 && !(sample & expMask); exponent--, expMask >>= 1);

        const mantissa = (sample >> (exponent + 3)) & 0x0F;
        return ~(sign | (exponent << 4) | mantissa) & 0xFF;
    }

    #downsample(mulawBuffer, inputSampleRate = 22050)
    {
        const inputBuffer = Buffer.isBuffer(mulawBuffer) ? mulawBuffer : Buffer.from(mulawBuffer);
        const ratio = inputSampleRate / 8000;
        const outputLength = Math.floor(inputBuffer.length / ratio);
        const outputBuffer = Buffer.alloc(outputLength);

        for(let i = 0; i < outputLength; i++)
        {
            const srcPos = i * ratio;
            const srcIndex = Math.floor(srcPos);
            const fraction = srcPos - srcIndex;
            const sample1 = this.#mulawToLinear(inputBuffer[srcIndex]);
            const sample2 = this.#mulawToLinear(inputBuffer[Math.min(srcIndex + 1, inputBuffer.length - 1)]);
            const interpolated = Math.round(sample1 + fraction * (sample2 - sample1));
            outputBuffer[i] = this.#linearToMulaw(interpolated);
        }

        return outputBuffer.toString("base64");
    }

    async #recordSTTCost()
    {
        if(!this.redis || !this.currentCallUUID)
        {
            return;
        }

        if(this.sttStartTime)
        {
            this.sttAccumulatedSeconds += (Date.now() - this.sttStartTime) / 1000;
            this.sttStartTime = null;
        }

        if(this.sttAccumulatedSeconds <= 0)
        {
            return;
        }

        const seconds = this.sttAccumulatedSeconds;
        const cost = seconds * SARVAM_STT_RATE;
        this.sttAccumulatedSeconds = 0;

        await this.redis.recordSarvamSTT(this.currentCallUUID, seconds, cost);
    }

    async initSTT(callUUID, onTranscript, onFirstToken, onClose = null)
    {
        this.currentCallUUID = callUUID;
        this.onTranscript = onTranscript;
        this.onFirstToken = onFirstToken ?? null;

        // Check for pre-warmed socket first
        if(global.prewarmSTT?.has(callUUID))
        {
            const prewarmed = global.prewarmSTT.get(callUUID);
            global.prewarmSTT.delete(callUUID);

            if(prewarmed && prewarmed.isReady())
            {
                console.log(`✅ [STT] Using pre-warmed socket for ${callUUID}`);

                this.sttStream = prewarmed;

                this.sttStream.setHandlers({
                    onTranscript: (response) =>
                    {
                        const transcript = response?.data?.transcript?.trim();

                        if(!transcript)
                        {
                            return;
                        }

                        console.log(`📝 [STT] Transcript: "${transcript}"`);
                        this.onTranscript(transcript);
                    },
                    onFirstToken: (transcript) =>
                    {
                        if(this.onFirstToken)
                        {
                            this.onFirstToken(transcript);
                        }
                    },
                    onClose: async () =>
                    {
                        this.sttStream = null;

                        if(onClose)
                        {
                            onClose();
                        }
                    },
                    onError: (err) =>
                    {
                        console.error("⚠️ Sarvam STT error:", err);
                    }
                });

                if(this.audioQueue.length > 0)
                {
                    console.log(`📤 [STT] Flushing ${this.audioQueue.length} queued audio chunks after pre-warm`);
                    const queued = this.audioQueue.splice(0);

                    for(const buf of queued)
                    {
                        const upsampled = this.#upsample(buf);
                        this.sttStream.sendAudio(upsampled);
                    }
                }

                return;
            }

            console.warn(`⚠️ [STT] Pre-warmed socket not ready for ${callUUID} — falling back to new connect`);
        }

        // Fallback — normal connect
        this.sttStream = await sarvam.sarvamSTTStream({
            languageCode: this.getLanguageCode(),
            sampleRate: this.sampleRate,
            onFirstToken: (transcript) =>
            {
                if(this.onFirstToken)
                {
                    this.onFirstToken(transcript);
                }
            },
            onTranscript: (response) =>
            {
                const transcript = response?.data?.transcript?.trim();

                if(!transcript)
                {
                    return;
                }

                console.log(`📝 [STT] Transcript: "${transcript}"`);
                this.onTranscript(transcript);
            },
            onClose: async () =>
            {
                this.sttStream = null;

                if(onClose)
                {
                    onClose();
                }
            },
            onError: (err) =>
            {
                console.error("⚠️ Sarvam STT error:", err);
            }
        });

        if(this.audioQueue.length > 0)
        {
            console.log(`📤 [STT] Flushing ${this.audioQueue.length} queued audio chunks after connect`);
            const queued = this.audioQueue.splice(0);

            for(const buf of queued)
            {
                const upsampled = this.#upsample(buf);
                this.sttStream.sendAudio(upsampled);
            }
        }
    }

    pauseSTTTimer()
    {
        if(!this.sttStartTime)
        {
            return;
        }

        this.sttAccumulatedSeconds += (Date.now() - this.sttStartTime) / 1000;
        this.sttStartTime = null;
    }

    sendAudio(callUUID, mulawBuffer)
    {
        if(!this.sttStream || !this.sttStream.isReady())
        {
            if(this.audioQueue.length < 100)
            {
                this.audioQueue.push(mulawBuffer);
            }
            return;
        }

        if(!this.sttStartTime)
        {
            this.sttStartTime = Date.now();
        }

        const upsampled = this.#upsample(mulawBuffer);
        this.sttStream.sendAudio(upsampled);
    }

    flushSTT()
    {
        if(!this.sttStream)
        {
            return;
        }

        this.sttStream.flush();
    }

    async switchLanguage(callUUID, language)
    {
        this.language = language;

        if(this.sttStream)
        {
            try
            {
                this.sttStream.abort();
            }
            catch(_)
            {

            }

            this.sttStream = null;
        }

        await this.#recordSTTCost();
        await this.initSTT(callUUID, this.onTranscript, this.onFirstToken);
        await this.#waitForSTTReady();
    }

    async #waitForSTTReady(maxWaitMs = 3000, intervalMs = 100)
    {
        const deadline = Date.now() + maxWaitMs;

        while(Date.now() < deadline)
        {
            if(this.sttStream && this.sttStream.isReady())
            {
                return;
            }

            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

        console.warn(`⚠️ [STT] Socket not ready after ${maxWaitMs}ms — language switch may be unstable`);
    }

    async resetSTT(callUUID)
    {
        this.closeSTT();
        await this.#recordSTTCost();
        await this.initSTT(callUUID, this.onTranscript, this.onFirstToken);
    }

    abortTTS(callUUID = null, charsSent = 0)
    {
        if(this.ttsSockets.length === 0)
        {
            return;
        }

        for(const socket of this.ttsSockets)
        {
            try
            {
                socket.abort();
            }
            catch(_)
            {

            }
        }

        this.ttsSockets = [];
        console.log(`🛑 [TTS] All sockets aborted.`);

        if(this.redis && callUUID && this.ttsCharsSent > 0)
        {
            const cost = this.ttsCharsSent * SARVAM_TTS_RATE;
            this.redis.recordSarvamTTS(callUUID, this.ttsCharsSent, cost);
            this.ttsCharsSent = 0;
        }
    }

    #cleanMarkdown(text)
    {
        if(!text)
        {
            return "";
        }

        return text
            .replace(/\[.*?\]:?/g, "")
            .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/[*_]{1,3}(.*?)[*_]{1,3}/g, "$1")
            .replace(/~~(.*?)~~/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/^[#>]\s+/gm, "")
            .replace(/\.{2,}/g, "")
            .replace(/["']/g, "")
            .replace(/[—–−]/g, ",")
            .replace(/[|•·※◦▪▸→←↑↓]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    async streamTTS(callUUID, text, onChunk, onComplete, shouldAbort)
    {
        const cleanText = this.#cleanMarkdown(text);
        console.log(`🔊 [TTS] "${cleanText}"`);

        this.abortTTS();

        let ttsSocket;
        let charsSent = 0;
        let chunkCount = 0;
        let totalAudioBytes = 0;

        try
        {
            ttsSocket = await sarvam.sarvamTTSStream({
                languageCode: this.getLanguageCode(),
                speaker: this.speaker ?? "shreya",
                onAudio: (response) =>
                {
                    if(shouldAbort())
                    {
                        console.log(`🛑 [TTS] Abort triggered during chunk ${chunkCount}`);
                        this.abortTTS(callUUID, charsSent);
                        return;
                    }

                    const audioData = response?.data?.audio;

                    if(!audioData)
                    {
                        console.warn(`⚠️ [TTS] Empty audio in chunk ${chunkCount}`);
                        return;
                    }

                    chunkCount++;
                    const audioBuffer = Buffer.from(audioData, "base64");
                    totalAudioBytes += audioBuffer.length;

                    const mulawBuffer = audioBuffer;
                    const plivoAudio = this.#downsample(mulawBuffer, 22050);
                    onChunk(plivoAudio);
                },
                onComplete: () =>
                {
                    console.log(`✅ [TTS] Stream completed — ${chunkCount} chunks, ${totalAudioBytes} total bytes, ${charsSent} chars sent`);

                    this.ttsSockets = this.ttsSockets.filter(s => s !== ttsSocket);

                    if(this.redis)
                    {
                        const cost = charsSent * SARVAM_TTS_RATE;
                        this.redis.recordSarvamTTS(callUUID, charsSent, cost);
                    }

                    if(!shouldAbort() && onComplete)
                    {
                        onComplete();
                    }
                },
                onError: (err) =>
                {
                    console.error(`❌ [TTS] Stream error:`, err.message);
                    this.ttsSockets = this.ttsSockets.filter(s => s !== ttsSocket);
                }
            });
        }
        catch(err)
        {
            console.error(`❌ [TTS] Failed to establish socket:`, err.message);
            return;
        }

        this.ttsSockets.push(ttsSocket);

        if(shouldAbort())
        {
            this.abortTTS(callUUID, charsSent);
            return;
        }

        const phrases = this.#splitIntoPhrases(cleanText);
        console.log(`📤 [TTS] Sending ${phrases.length} phrases to Sarvam`);

        for(const phrase of phrases)
        {
            if(shouldAbort())
            {
                this.abortTTS(callUUID, charsSent);
                return;
            }

            const phraseWithSpace = phrase + " ";
            ttsSocket.sendText(phraseWithSpace);
            charsSent += phraseWithSpace.length;
            console.log(`📤 [TTS] Sent phrase: "${phrase}"`);
        }

        console.log(`📤 [TTS] Flushing after sending ${charsSent} characters`);
        ttsSocket.flush();
    }

    #splitIntoPhrases(text)
    {
        if(!text)
        {
            return [];
        }

        const phrases = [];
        const segments = text.split(/([,!?।])/);
        let current = "";

        for(let i = 0; i < segments.length; i++)
        {
            const segment = segments[i];
            const isPunctuation = /^[,!?।]$/.test(segment);

            if(isPunctuation)
            {
                current += segment;

                if(current.trim().length > 0)
                {
                    phrases.push(current.trim());
                    current = "";
                }   
            }
            else
            {
                current += segment;
            }
        }

        if(current.trim().length > 0)
        {
            phrases.push(current.trim());
        }

        return phrases.filter(p => p.length > 0);
    }

    async openTTSStream(callUUID, onChunk, onComplete, shouldAbort)
    {
        this.ttsGeneration++;
        const myGeneration = this.ttsGeneration;
        this.abortTTS();

        let ttsSocket;
        this.ttsCharsSent = 0;
        let chunkCount = 0;
        let totalAudioBytes = 0;

        return new Promise(async (resolve, reject) =>
        {
            try
            {
                ttsSocket = await sarvam.sarvamTTSStream({
                    languageCode: this.getLanguageCode(),
                    speaker: this.speaker ?? "shreya",
                    onAudio: (response) =>
                    {
                        if(this.ttsGeneration !== myGeneration)
                        {
                            return;
                        }

                        if(shouldAbort())
                        {
                            this.abortTTS(callUUID);
                            return;
                        }

                        const audioData = response?.data?.audio;

                        if(!audioData)
                        {
                            return;
                        }

                        chunkCount++;
                        const audioBuffer = Buffer.from(audioData, "base64");
                        totalAudioBytes += audioBuffer.length;

                        const plivoAudio = this.#downsample(audioBuffer, 22050);
                        onChunk(plivoAudio);
                    },
                    onComplete: () =>
                    {
                        console.log(`✅ [TTS] Stream completed — ${chunkCount} chunks, ${totalAudioBytes} total bytes, ${this.ttsCharsSent} chars sent`);

                        if(this.ttsGeneration !== myGeneration)
                        {
                            return;
                        }

                        this.ttsSockets = this.ttsSockets.filter(s => s !== ttsSocket);

                        if(this.redis)
                        {
                            const cost = this.ttsCharsSent * SARVAM_TTS_RATE;
                            this.redis.recordSarvamTTS(callUUID, this.ttsCharsSent, cost);
                        }

                        if(!shouldAbort() && onComplete)
                        {
                            onComplete();
                        }

                        resolve();
                    },
                    onError: (err) =>
                    {
                        if(this.ttsGeneration !== myGeneration)
                        {
                            return;
                        }

                        console.error(`❌ [TTS] Stream error:`, err.message);
                        this.ttsSockets = this.ttsSockets.filter(s => s !== ttsSocket);
                        resolve();
                    }
                });
            }
            catch(err)
            {
                console.error(`❌ [TTS] Failed to establish socket:`, err.message);
                resolve();
                return;
            }

            this.ttsSockets.push(ttsSocket);
            this.activeTTSSocket = ttsSocket;
        });
    }

    sendTTSChunk(chunk)
    {
        if(!this.activeTTSSocket)
        {
            return;
        }

        const cleanChunk = this.#cleanMarkdown(chunk);

        if(!cleanChunk)
        {
            return;
        }

        if(!/[\p{L}\p{N}]/u.test(cleanChunk))
        {
            return;
        }

        this.ttsCharsSent += cleanChunk.length;
        this.activeTTSSocket.sendText(cleanChunk);
    }

    flushTTSStream()
    {
        if(!this.activeTTSSocket)
        {
            return;
        }

        console.log(`📤 [TTS] Flushing stream`);
        this.activeTTSSocket.flush();
        this.activeTTSSocket = null;
    }

    async flushSTTCost()
    {
        if(!this.redis || !this.currentCallUUID)
        {
            return;
        }

        if(this.sttStartTime)
        {
            this.sttAccumulatedSeconds += (Date.now() - this.sttStartTime) / 1000;
            this.sttStartTime = null;
        }

        if(this.sttAccumulatedSeconds <= 0)
        {
            return;
        }

        const seconds = this.sttAccumulatedSeconds;
        const cost = seconds * SARVAM_STT_RATE;
        this.sttAccumulatedSeconds = 0;

        await this.redis.recordSarvamSTT(this.currentCallUUID, seconds, cost);
    }

    closeSTT()
    {
        if(this.sttStream)
        {
            try
            {
                this.sttStream.close();
            }
            catch(_)
            {

            }

            this.sttStream = null;
        }
    }

    async destroy(callUUID = null)
    {
        this.closeSTT();
        await this.#recordSTTCost();
        this.abortTTS(callUUID, 0);
        this.onTranscript = null;
        this.onFirstToken = null;
        this.currentCallUUID = null;
    }
}

module.exports = SarvamManager;