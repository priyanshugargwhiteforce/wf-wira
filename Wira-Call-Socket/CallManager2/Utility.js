class Utility
{
    logError(socket, message, error)
    {
        if(error)
        {
            const display = typeof error === 'object' ? JSON.stringify(error, null, 2) : error;
            console.error(`❌ [${socket.type}] ${message}:\n${display}`);
        }
        else
        {
            console.error(`❌ [${socket.type}] ${message}`);
        }
    }

    log(socket, message, data)
    {
        if(data)
        {
            const display = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
            console.log(`🟢 [${socket.type}] ${message}:\n${display}`);
        }
        else
        {
            console.log(`🟢 [${socket.type}] ${message}`);
        }
    }

    upsample(buffer)
    {
        const frameCount = Math.floor(buffer.length / 2);
        const ratio = Math.round(this.sampleRate / 8000);
        const upsampled = new Int16Array(frameCount * ratio);

        for(let i = 0; i < frameCount; i++)
        {
            const current = buffer.readInt16LE(i * 2);
            const next = buffer.readInt16LE(Math.min(i + 1, frameCount - 1) * 2);

            for(let j = 0; j < ratio; j++)
            {
                const fraction = j / ratio;
                upsampled[i * ratio + j] = Math.round(current + fraction * (next - current));
            }
        }

        return Buffer.from(upsampled.buffer);
    }

    downsample(mulawBuffer, inputSampleRate = 22050)
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
            const sample1 = this.mulawToLinear(inputBuffer[srcIndex]);
            const sample2 = this.mulawToLinear(inputBuffer[Math.min(srcIndex + 1, inputBuffer.length - 1)]);
            const interpolated = Math.round(sample1 + fraction * (sample2 - sample1));
            outputBuffer[i] = this.linearToMulaw(interpolated);
        }

        return outputBuffer.toString("base64");
    }

    mulawToLinear(mulawByte)
    {
        mulawByte = ~mulawByte & 0xFF;
        const sign = mulawByte & 0x80;
        const exponent = (mulawByte >> 4) & 0x07;
        const mantissa = mulawByte & 0x0F;
        let sample = ((mantissa << 3) + 0x84) << exponent;
        sample -= 0x84;
        return sign ? -sample : sample;
    }

    linearToMulaw(sample)
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
}

module.exports = Utility;