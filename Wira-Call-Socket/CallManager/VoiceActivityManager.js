const avrVad = require('avr-vad');

const VAD_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512;
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

const MIN_SPEECH_MS = 48;
const REDEMPTION_MS = 384;
const PRE_SPEECH_MS = 800;

const MIN_SPEECH_FRAMES = Math.round(MIN_SPEECH_MS / VAD_FRAME_MS);
const REDEMPTION_FRAMES = Math.round(REDEMPTION_MS / VAD_FRAME_MS);
const PRE_SPEECH_PAD = Math.round(PRE_SPEECH_MS / VAD_FRAME_MS);

class VoiceActivityManager
{
    constructor(vadConfig = {})
    {
        this.debugChunks = [];
        this.positiveSpeechThreshold = vadConfig.positiveSpeechThreshold ?? 0.35;
        this.negativeSpeechThreshold = vadConfig.negativeSpeechThreshold ?? 0.20;
        this.onSpeechRealStart = vadConfig.onSpeechRealStart ?? null;
        this.onSpeechChunk = vadConfig.onSpeechChunk ?? null;
        this.onSpeechEnd = vadConfig.onSpeechEnd ?? null;
 
        this.vad = null;
        this.sampleRate = VAD_SAMPLE_RATE;
 
        this.isUserSpeaking = false;
        this.preRollBuffer = [];
        this.preRollMaxChunks = vadConfig.preRollMaxChunks ?? 20;
 
        this.idleWarningTimer = null;
        this.idleDisconnectTimer = null;
        this.maxCallTimer = null;
    }
 
    async init()
    {
        this.vad = await avrVad.RealTimeVAD.new(
        {
            model: 'v5',
            sampleRate: VAD_SAMPLE_RATE,
            frameSamples: VAD_FRAME_SAMPLES,
            positiveSpeechThreshold: this.positiveSpeechThreshold,
            negativeSpeechThreshold: this.negativeSpeechThreshold,
            minSpeechFrames: MIN_SPEECH_FRAMES,
            redemptionFrames: REDEMPTION_FRAMES,
            preSpeechPadFrames: PRE_SPEECH_PAD,
            onSpeechRealStart: () =>
            {
                this.isUserSpeaking = true;
                console.log(`🗣️ [VAD] User started speaking.`);
 
                if(this.onSpeechChunk && this.preRollBuffer.length > 0)
                {
                    for(const bufferedChunk of this.preRollBuffer)
                    {
                        this.onSpeechChunk(bufferedChunk);
                    }
                }
 
                this.preRollBuffer = [];
 
                if(this.onSpeechRealStart)
                {
                    this.onSpeechRealStart();
                }
            },
            onSpeechEnd: (audio) =>
            {
                this.isUserSpeaking = false;
                this.preRollBuffer = [];
                console.log(`🤫 [VAD] User stopped speaking.`);
 
                if(this.onSpeechEnd)
                {
                    this.onSpeechEnd(audio);
                }
            }
        });
 
        this.vad.start();
    }

    #pcmUpsampled(pcmBuffer)
    {
        const sampleCount = Math.floor(pcmBuffer.length / 2);
        const ratio = Math.round(this.sampleRate / 8000);
        const upsampled = new Int16Array(sampleCount * ratio);

        for(let i = 0; i < sampleCount; i++)
        {
            const current = pcmBuffer.readInt16LE(i * 2);
            const nextIndex = Math.min(i + 1, sampleCount - 1);
            const next = pcmBuffer.readInt16LE(nextIndex * 2);

            for(let j = 0; j < ratio; j++)
            {
                const fraction = j / ratio;
                upsampled[i * ratio + j] = Math.round(current + fraction * (next - current));
            }
        }

        return upsampled;
    }

    #int16ToFloat32(int16Array)
    {
        const float32 = new Float32Array(int16Array.length);

        for(let i = 0; i < int16Array.length; i++)
        {
            float32[i] = int16Array[i] / 32768.0;
        }

        return float32;
    }

    /*#concatInt16(a, b)
    {
        const merged = new Int16Array(a.length + b.length);
        merged.set(a, 0);
        merged.set(b, a.length);
        return merged;
    }*/

    async process(base64Payload)
    {
        const audioBuffer = Buffer.from(base64Payload, 'base64');

        if(audioBuffer.length === 0)
        {
            return;
        }

        const upsampled = this.#pcmUpsampled(audioBuffer);
        this.debugChunks.push(upsampled);

        const floatSamples = this.#int16ToFloat32(upsampled);
        await this.vad.processAudio(floatSamples);

        if(this.isUserSpeaking && this.onSpeechChunk)
        {
            this.onSpeechChunk(audioBuffer);
        }
        else if(!this.isUserSpeaking)
        {
            this.preRollBuffer.push(audioBuffer);

            if(this.preRollBuffer.length > this.preRollMaxChunks)
            {
                this.preRollBuffer.shift();
            }
        }
    }

    startIdleTimers(idleConfig, onWarning, onDisconnect)
    {
        this.clearIdleTimers();

        const warningAfterMs = idleConfig?.warningAfterMs ?? 15000;
        const disconnectAfterMs = idleConfig?.disconnectAfterMs ?? 30000;

        this.idleWarningTimer = setTimeout(() =>
            {
                onWarning();
            }, 
            warningAfterMs
        );

        this.idleDisconnectTimer = setTimeout(() =>
            {
                onDisconnect();
            }, 
            disconnectAfterMs
        );
    }

    clearIdleTimers()
    {
        if(this.idleWarningTimer)
        {
            clearTimeout(this.idleWarningTimer);
            this.idleWarningTimer = null;
        }

        if(this.idleDisconnectTimer)
        {
            clearTimeout(this.idleDisconnectTimer);
            this.idleDisconnectTimer = null;
        }
    }

    startMaxCallTimer(durationMs = 600000, onExpire)
    {
        this.clearMaxCallTimer();

        this.maxCallTimer = setTimeout(() =>
        {
            onExpire();
        }, durationMs);
    }

    clearMaxCallTimer()
    {
        if(this.maxCallTimer)
        {
            clearTimeout(this.maxCallTimer);
            this.maxCallTimer = null;
        }
    }

    destroy()
    {
        this.clearIdleTimers();
        this.clearMaxCallTimer();

        this.isUserSpeaking = false;

        /*if(this.debugChunks && this.debugChunks.length > 0)
        {
            try
            {
                let merged = new Int16Array(0);

                for(const chunk of this.debugChunks)
                {
                    merged = this.#concatInt16(merged, chunk);
                }

                const header = Buffer.alloc(44);
                const dataSize = merged.length * 2;

                header.write('RIFF', 0);
                header.writeUInt32LE(36 + dataSize, 4);
                header.write('WAVE', 8);
                header.write('fmt ', 12);
                header.writeUInt32LE(16, 16);
                header.writeUInt16LE(1, 20);
                header.writeUInt16LE(1, 22);
                header.writeUInt32LE(this.sampleRate, 24);
                header.writeUInt32LE(this.sampleRate * 2, 28);
                header.writeUInt16LE(2, 32);
                header.writeUInt16LE(16, 34);
                header.write('data', 36);
                header.writeUInt32LE(dataSize, 40);

                const filePath = path.join(__dirname, `vad-debug-${Date.now()}.wav`);
                fs.writeFileSync(filePath, Buffer.concat([header, Buffer.from(merged.buffer)]));

                console.log(`💾 [VAD Debug] WAV saved: ${filePath} (${merged.length} samples, ${(merged.length / this.sampleRate).toFixed(1)}s)`);
            }
            catch(err)
            {
                console.error(`❌ [VAD Debug] Write failed:`, err.message);
            }
        }*/

        if(this.vad)
        {
            this.vad.destroy();
            this.vad = null;
        }
    }
}

module.exports = VoiceActivityManager;