const { SarvamAIClient } = require("sarvamai");

async function sarvamTTS({ text, languageCode = "hi-IN", speaker = "shreya", audioCodec = "mulaw", sampleRate = 8000 })
{
    try
    {
        const client = new SarvamAIClient({
            apiSubscriptionKey: process.env.SARVAM_KEY
        });

        const response = await client.textToSpeech.convert({
            text: text,
            target_language_code: languageCode,
            model: "bulbul:v3",
            speaker: speaker,
            output_audio_codec: audioCodec,
            speech_sample_rate: sampleRate
        });

        return response;
    }
    catch (error)
    {
        throw error;
    }
}

async function sarvamSTT({ audioBuffer, languageCode = "hi-IN" })
{
    try
    {
        const client = new SarvamAIClient({
            apiSubscriptionKey: process.env.SARVAM_KEY
        });

        const response = await client.speechToText.transcribe({
            file: audioBuffer,
            model: "saaras:v3",
            language_code: languageCode
        });

        return response;
    }
    catch (error)
    {
        throw error;
    }
}

async function sarvamTTSStream({ text, languageCode = "hi-IN", speaker = "shreya", onAudio, onComplete, onError })
{
    const client = new SarvamAIClient({
        apiSubscriptionKey: process.env.SARVAM_KEY
    });

    const socket = await client.textToSpeechStreaming.connect({
        model: "bulbul:v3",
        send_completion_event: true,
        "Api-Subscription-Key": process.env.SARVAM_KEY
    });

    let charactersSent = 0;
    let aborted = false;

    socket.on("open", function()
    {
        console.log(`🟢 [TTS Socket] Opened`);
        try 
        {
            socket.configureConnection(
                {
                    target_language_code: languageCode,
                    speaker: speaker,
                    output_audio_codec: "mulaw"
                }
            );

            console.log(`⚙️ [TTS Socket] configureConnection sent`);
        } 
        catch(err) 
        {
            console.error(`❌ [TTS Socket] configureConnection threw:`, err.message);
        }
    });

    socket.on("message", function(response)
    {
        if (response.type === "audio")
        {
            if (onAudio)
            {
                onAudio(response);
            }
        }
        else if (response.type === "event" && response.data && response.data.event_type === "final")
        {
            if (onComplete)
            {
                onComplete({ charactersSent });
            }
        }
    });

    socket.on("error", function(err)
    {
        if (onError)
        {
            onError(err);
        }
    });

    socket.on("close", function(event)
    {
        if (!aborted && onComplete)
        {
            onComplete({ charactersSent });
        }
    });

    await socket.waitForOpen();

    return {
        sendText: function(chunk)
        {
            if (aborted)
            {
                return;
            }
            charactersSent += chunk.length;
            socket.convert(chunk);
        },
        flush: function()
        {
            if (!aborted)
            {
                socket.flush();
            }
        },
        abort: function()
        {
            aborted = true;
            socket.close();
        },
        getCharactersSent: function()
        {
            return charactersSent;
        }
    };
}

function destroySocket(sock)
{
    if(!sock)
    {
        return;
    }

    try
    {
        if(typeof sock.removeAllListeners === "function")
        {
            sock.removeAllListeners();
        }

        if(sock._ws)
        {
            sock._ws.onopen = null;
            sock._ws.onclose = null;
            sock._ws.onerror = null;
            sock._ws.onmessage = null;

            try 
            { 
                sock._ws.close(); 
            } 
            catch(_) 
            {

            }
        }

        if(sock.ws)
        {
            sock.ws.onopen = null;
            sock.ws.onclose = null;
            sock.ws.onerror = null;
            sock.ws.onmessage = null;

            try 
            { 
                sock.ws.close(); 
            } 
            catch(_) 
            {
                
            }
        }

        if(typeof sock.close === "function")
        {
            sock.close();
        }
    }
    catch(_) 
    {

    }
}

async function sarvamSTTStream({ languageCode = "hi-IN", sampleRate = 8000, onTranscript, onFirstToken, onClose, onError, maxRetries = 5 })
{
    const client = new SarvamAIClient({
        apiSubscriptionKey: process.env.SARVAM_KEY
    });

    let socket = null;
    let lastError = null;

    for(let attempt = 1; attempt <= maxRetries; attempt++)
    {
        try
        {
            socket = await client.speechToTextStreaming.connect({
                model: "saaras:v3",
                mode: "transcribe",
                "language-code": languageCode,
                sample_rate: String(sampleRate),
                flush_signal: "true",
                "Api-Subscription-Key": process.env.SARVAM_KEY
            });

            await socket.waitForOpen();
            console.log(`✅ [Sarvam STT] WebSocket connected successfully on attempt ${attempt}`);
            break;
        }
        catch(err)
        {
            lastError = err;
            console.warn(`⚠️ [Sarvam STT] Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
            if(socket)
            {
                destroySocket(socket);
                socket = null;
            }
            if(attempt < maxRetries)
            {
                const backoffMs = (1500 * attempt) + Math.floor(Math.random() * 500);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
        }
    }
    if(!socket)
    {
        throw lastError || new Error("Failed to connect to Sarvam STT WebSocket after retries");
    }

    let audioBytesSent = 0;
    let aborted = false;
    let firstTokenFired = false;

    const bytesPerSecond = sampleRate * 2;

    socket.on("message", function(response)
    {
        if(!firstTokenFired && response?.transcript && response.transcript.length > 0)
        {
            firstTokenFired = true;

            if(onFirstToken)
            {
                onFirstToken(response.transcript);
            }
        }   

        if(onTranscript)
        {
            onTranscript(response);
        }
    });

    socket.on("close", function(event)
    {
        console.warn(`⚠️ [STT] Socket closed — event:`, JSON.stringify(event));
        const secondsSent = audioBytesSent / bytesPerSecond;
        if(onClose)
        {
            onClose({ secondsSent });
        }
    });

    socket.on("error", function(err)
    {
        console.log("⚠️ [STT] Socket Error: ", err);
        if(onError)
        {
            onError(err);
        }
    });

    return {
        sendAudio: function(chunk)
        {
            if(aborted)
            {
                return;
            }

            audioBytesSent += chunk.length;
            const base64Audio = chunk.toString("base64");

            try
            {
                socket.transcribe({
                    audio: base64Audio,
                    sample_rate: sampleRate
                });
            }
            catch(err)
            {
                console.error(`❌ [STT:transcribe] threw:`, err.message, `| readyState:`, socket.readyState);
            }
        },
        flush: function()
        {
            if(!aborted)
            {
                try
                {
                    socket.flush();
                }
                catch(err)
                {
                    console.error(`❌ [STT:flush] threw:`, err.message, `| readyState:`, socket.readyState);
                }
            }
        },
        abort: function()
        {
            aborted = true;
            destroySocket(socket);
        },
        getSecondsSent: function()
        {
            return audioBytesSent / bytesPerSecond;
        },
        close: function()
        {
            aborted = true;
            destroySocket(socket);
        },
        isReady: function()
        {
            return !aborted && socket.readyState === 1;
        },
        setHandlers: function({ onTranscript: newOnTranscript, onFirstToken: newOnFirstToken, onClose: newOnClose, onError: newOnError } = {})
        {
            if(newOnTranscript !== undefined)
            {
                onTranscript = newOnTranscript;
            }

            if(newOnFirstToken !== undefined)
            {
                onFirstToken = newOnFirstToken;
            }

            if(newOnClose !== undefined)
            {
                onClose = newOnClose;
            }

            if(newOnError !== undefined)
            {
                onError = newOnError;
            }
        },
    };
}

module.exports = {
    sarvamTTS,
    sarvamSTT,
    sarvamTTSStream,
    sarvamSTTStream
};