const avrVad = require('avr-vad');
const sarvam = require("@wira/shared/Utility/sarvamHandler");

/*
FLUSH: flush means telling sarvam user has stopped speaking, and we now want the audio to be generated.
PRE ROLL BUFFER: it is audio data collected before the user starts speaking, so that sarvam has more data to work with.
AUDIO QUEUE: it is specifically stored for sarvam, so if sarvam unexpectedly drops connection or fails to process, we can resend the audio data to it.
*/

class Speech
{
    constructor(manager, session, functions)
    {
        //Data passed from Manager.
        this.manager = manager;
        this.session = session;
        this.functions = functions;

        //Sarvam Configuration
        this.languageToSarvamCode = 
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

        this.validSpeakers = 
        [
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

        this.sarvamTtsRate = 3 / 1_000;
        this.sarvamSttRate = 30 / 3600;
        this.speechToTextStream = null;
        this.audioQueue = [];
        this.speechToTextStartTime = null;
        this.speechToTextAccumulatedSeconds = 0;

        //VAD Configuration
        this.sampleRate = 16000;
        this.frameSamples = 512;
        this.vadFrameMiliseconds = (this.frameSamples / this.sampleRate) * 1000;
        this.minimumSpeechMiliseconds = 48;
        this.redemptionMiliseconds = 384;
        this.preSpeechMiliseconds = 800;
        this.minimumSpeechFrames = Math.round(this.minimumSpeechMiliseconds / this.vadFrameMiliseconds);
        this.redemptionFrames = Math.round(this.redemptionMiliseconds / this.vadFrameMiliseconds);
        this.preSpeechPadFrames = Math.round(this.preSpeechMiliseconds / this.vadFrameMiliseconds);
        this.positiveSpeechThreshold = 0.35;
        this.negativeSpeechThreshold = 0.20;
        this.preRollBuffer = [];
        this.preRollMaxChunks = 20;
    }

    async init()
    {
        this.vad = await avrVad.RealTimeVAD.new(
            {
                model: 'v5',
                sampleRate: this.sampleRate,
                frameSamples: this.frameSamples,
                positiveSpeechThreshold: this.positiveSpeechThreshold,
                negativeSpeechThreshold: this.negativeSpeechThreshold,
                minSpeechFrames: this.minimumSpeechFrames,
                redemptionFrames: this.redemptionFrames,
                preSpeechPadFrames: this.preSpeechPadFrames,
                onSpeechRealStart: this.onSpeakingStart,
                onSpeechEnd: this.onSpeakingEnd,
            }
        );

        this.vad.start();
    }

    onSpeakingStart()
    {
        this.manager.isSpeaking = true;
        if(this.functions.onSpeakingStart)
        {
            this.functions.onSpeakingStart();
        }

        if(this.preRollBuffer.length > 0)
        {
            this.preRollBuffer.forEach((chunk) => 
                {
                    this.speechToText(chunk);
                }
            );
        }
         
        this.preRollBuffer = [];
    }

    onSpeakingEnd()
    {
        this.manager.isSpeaking = false;
        this.preRollBuffer = [];
         
        if(this.functions.onSpeakingEnd)
        {
            this.functions.onSpeakingEnd();
        }

        if(this.speechToTextStartTime)
        {
            this.speechToTextAccumulatedSeconds += (Date.now() - this.speechToTextStartTime) / 1000;
            this.speechToTextStartTime = null;
        }

        if(this.speechToTextStream)
        {
            this.speechToTextStream.flush();
        }
    }

    speechToText(chunk)
    {
        if(!this.speechToTextStream || !this.speechToTextStream.isReady())
        {
            if(this.audioQueue.length < 100)
            {
                this.audioQueue.push(mulawBuffer);
            }

            return;
        }

        if(!this.speechToTextStartTime)
        {
            this.speechToTextStartTime = Date.now();
        }

        const upsampled = this.manager.utility.upsample(chunk);
        this.speechToTextStream.sendAudio(upsampled);
    }
}

module.exports = Speech;