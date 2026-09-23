const Speech = require("./Speech.js");
const Session = require("./Session.js");
const Utility = require("./Utility.js")

class Manager
{
    constructor(socket)
    {
        this.socket = socket;

        this.audioFunctions = 
        {
            onSpeakingStart: this.onSpeakingStart,
            onSpeakingEnd: this.onSpeakingEnd,
            onSpeechToText: this.onSpeechToText,
        };

        this.isSpeaking = false;
        this.vadGateOpen = false;

        this.utility = new Utility();
        this.session = new Session();
        this.speech = new Speech(this, this.session, this.audioFunctions);
    }

    //Handles message event from plivo socket directly.
    async message(message)
    {
        try
        {
            const data = JSON.parse(message);
            const event = data.event;
            
            //Switch case for event.
            switch(event)
            {
                case "media":
                    await this.media(this.socket, data);
                    break;

                case "playedStream":
                    await this.playedStream(this.socket, data);
                    break;

                case "stop":
                    await this.stop(this.socket, data);
                    break;

                case "incorrectPayload":
                    await this.incorrectPayload(this.socket, data);
                    break;

                default:
                    this.utility.log(this.socket, `Unknown event message`, message);
                    break;
            }
        }
        catch(error)
        {
            this.utility.logError(this.socket, `Message Error`, error);
        }
    }

    //Handles close event from plivo socket directly.
    async close(code, reason)
    {
        this.utility.log(this.socket, 'WebSocket closed', 
            {
                code: code, 
                reason: reason
            }
        );
    }

    //Handles error event from plivo socket directly.
    async error(error)
    {
        this.utility.logError(this.socket, 'WebSocket error', error);
    }

    //Handles media event from plivo message.
    async media(data)
    {
        try
        {
            //Setting Stream Id for future events to be triggered.
            if(!this.socket.streamId)
            {
                this.socket.streamId = data.start?.streamId ?? data.media?.streamId ?? data.streamId ?? null;
            }

            //Checking if intro has been spoken
            if(!('introSpoken' in this.socket))
            {
                const session = await this.session.getSession(this.socket);
                if(!session)
                {
                    this.socket.introSpoken = false;
                    await this.playIntro(this.socket, session);

                    this.utility.logError(this.socket, `No session found for ${this.socket.callId}`);
                }
                else
                {
                    if(!session.introSpoken)
                    {
                        this.socket.introSpoken = true;
                        await this.playIntro(this.socket, session);
                    }
                    else
                    {
                        await this.speech.process(this.socket, data.media.payload);
                    }
                }
            }
            else
            {
                if(!this.socket.introSpoken)
                {
                    await this.playIntro(this.socket);
                }
                else
                {
                    await this.speech.process(this.socket, data.media.payload);
                }
            }
        }
        catch(error)
        {
            this.utility.logError(this.socket, `Error in process event`, error);
        }
    }

    async playIntro(session = null)
    {
        try
        {
            //Making sure intro isn't playing multiple times
            if(this.socket.introPlaying)
            {
                return;
            }
            else
            {
                this.socket.introPlaying = true;
            }

            //Session check
            if(!session)
            {
                session = await this.session.getSession(this.socket);

                if(!session)
                {
                    this.utility.logError(this.socket, `No session found for ${this.socket.callId}`);
                    return;
                }
            }

            this.socket.introSpoken = true;
        }
        catch(error)
        {
            this.utility.logError(this.socket, `Error in playIntro event`, error);
        }
    }

    //Handles playedStream event from plivo message.
    async playedStream(data)
    {

    }

    //Handles stop event from plivo message.
    async stop(data)
    {

    }

    //Handles Incorrect payload event from plivo message.
    async incorrectPayload(data)
    {

    }

    // swap socket reference when client reconnects
    reattach(socket)
    {
        this.socket = socket;
        this.utility.log(this.socket, "Socket Reattached", socket);
    }

    // called only after grace period expires
    destroy()
    {
        if(this.socket?.vad)
        {
            this.socket.vad.destroy();
        }
    }
}

module.exports = Manager