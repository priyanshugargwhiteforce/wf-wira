class CallManager
{
    constructor(socket, session, callUUID, wiraCallId)
    {
        this.socket = socket;
        this.session = session;
        this.callUUID = callUUID;
        this.wiraCallId = wiraCallId;
    }

    async process(message)
    {
        try
        {
            const data = JSON.parse(message);
            const event = data.event;

            switch(event)
            {
                case "media":
                    await this.handleMedia(data);
                    break;

                case "playedStream":
                    await this.handlePlayedStream(data);
                    break;

                case "stop":
                    await this.handleStop(data);
                    break;

                case "incorrectPayload":
                    await this.handleIncorrectPayload(data);
                    break;

                default:
                    await this.handleUnknownEvent(data);
                    break;
            }
        }
        catch(error)
        {
            console.error(`Error occured in Call Manager process: `, error);
        }
    }

    async handleUnknownEvent(data)
    {
        console.log(`Event not recognized: `, data);
    }

    async handleMedia(data)
    {
        console.log(`Media event: `, data);
    }

    async handlePlayedStream(data)
    {
        console.log(`Played stream event: `, data);
    }

    async handleStop(data)
    {
        console.log(`Stop event: `, data);
    }

    async handleIncorrectPayload(data)
    {
        console.log(`Incorrect payload event: `, data);
    }

    async send()
    {

    }
}

module.exports = CallManager;