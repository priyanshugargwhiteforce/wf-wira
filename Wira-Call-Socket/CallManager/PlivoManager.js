const plivo = require("@wira/shared/Utility/PlivoHandler");

const PLIVO_INR_RATE = 0.6 / 60;

class PlivoManager
{
    constructor(redisManager = null)
    {
        this.redis = redisManager;
        this.billingTimer = null;
        this.ws = null;
        this.streamSid = null;
    }

    attachSocket(ws)
    {
        this.ws = ws;
    }

    setStreamId(streamSid)
    {
        this.streamSid = streamSid;
        console.log("streamSid: ",this.streamSid);
    }

    startBilling(callUUID)
    {
        if(this.billingTimer)
        {
            return;
        }

        this.billingTimer = setInterval(async () =>
        {
            if(this.redis)
            {
                const cost = 1 * PLIVO_INR_RATE;
                await this.redis.recordPlivo(callUUID, 1, cost);
            }
        }, 1000);

        console.log(`💰 [Plivo] Billing started for call: ${callUUID}`);
    }

    stopBilling(callUUID)
    {
        if(this.billingTimer)
        {
            clearInterval(this.billingTimer);
            this.billingTimer = null;
            console.log(`💰 [Plivo] Billing stopped for call: ${callUUID}`);
        }
    }

    sendAudio(base64Audio)
    {
        if(!this.ws)
        {
            return;
        }

        this.ws.send(JSON.stringify(
        {
            event: "playAudio",
            media:
            {
                contentType: "audio/x-mulaw",
                sampleRate: 8000,
                payload: base64Audio
            }
        }));
    }

    sendMark(markName)
    {
        if(!this.ws)
        {
            return;
        }

        if(!this.streamSid)
        {
            console.error(`❌ [Mark] Cannot send mark — streamSid is null`);
            return;
        }

        this.ws.send(JSON.stringify(
        {
            event: "mark",
            streamId: this.streamSid,
            mark:
            {
                name: markName
            }
        }));
    }

    clearAudio()
    {
        if(!this.ws)
        {
            return;
        }

        console.log(`🔇 [Plivo] Clearing buffered audio`);

        this.ws.send(JSON.stringify(
        {
            event: "clearAudio",
            streamId: this.streamSid
        }));
    }

    sendCheckpoint(checkpointName)
    {
        if(!this.ws)
        {
            return;
        }

        if(!this.streamSid)
        {
            console.error(`❌ [Checkpoint] Cannot send checkpoint — streamSid is null`);
            return;
        }

        this.ws.send(JSON.stringify(
        {
            event: "checkpoint",
            streamId: this.streamSid,
            name: checkpointName
        }));
    }

    sendTTSComplete()
    {
        this.sendCheckpoint("tts_complete");
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

    downsampleForPlivo(mulawBuffer, inputSampleRate = 22050)
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

    sendDownsampledAudio(mulawBuffer, inputSampleRate = 22050)
    {
        const base64Audio = this.downsampleForPlivo(mulawBuffer, inputSampleRate);
        this.sendAudio(base64Audio);
    }

    async hangupCall(callUUID, fromNumber = null)
    {
        try
        {
            await plivo.hangupCall(callUUID, fromNumber);
            console.log(`📵 [Plivo] Call hung up: ${callUUID}`);
        }
        catch(err)
        {
            console.error(`❌ [Plivo] Failed to hang up call ${callUUID}:`, err.message);
        }
        finally
        {
            if(this.ws)
            {
                try
                {
                    console.log(`🔌 [Plivo] Closing socket connection for call: ${callUUID}`);
                    this.ws.close();
                }
                catch(wsErr)
                {
                    console.error(`❌ [Plivo] Error closing websocket:`, wsErr.message);
                }
            }
        }
    }

    destroy(callUUID)
    {
        this.stopBilling(callUUID);
        this.ws = null;
        this.streamSid = null;
    }
}

module.exports = PlivoManager;