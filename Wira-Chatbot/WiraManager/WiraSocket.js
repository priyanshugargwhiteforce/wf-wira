class WiraSocket
{
    constructor(io, notification, session)
    {
        this.io = io;
        this.notification = notification;
        this.session = session;
        this.notificationAllowedEvents = 
        [
            "onMessage", 
            "onChunk"
        ];
    }

    handleCallBack(callback, statusCode, success, message, data)
    {
        if(typeof callback !== "function")
        {
            return;
        }

        callback({
            statusCode: statusCode,
            success: success,
            message: message,
            data: data
        });
    }

    async forward(phone, eventName, body, start = true, end = false)
    {
        const sessionKey = this.session.getSessionKey(phone);
        this.io.to(sessionKey).emit(eventName, body);

        if(this.notificationAllowedEvents.includes(eventName))
        {
            const session = await this.session.getSession(phone);
            if(!session)
            {
                return;
            }

            const socketsWithToken = session.sockets.filter(s => s.fcmToken);
            if(socketsWithToken.length === 0)
            {
                return;
            }

            const isEnd = eventName === "onMessage";
            const isChunk = eventName === "onChunk";

            if(isChunk || isEnd)
            {
                const tag = (isChunk && body.new) ? this.notification.generateRandomTag() : await this.notification.getTag(phone);
                if(!tag)
                {
                    return;
                }

                for(const socket of socketsWithToken)
                {
                    if(isChunk)
                    {
                        await this.notification.sendProcessing(phone, socket.fcmToken, tag);
                    }
                    else
                    {
                        await this.notification.sendMessage(phone, socket.fcmToken, null, body.content, null, tag, true);
                    }
                }

                if(isChunk && body.new)
                {
                    await this.notification.setTag(phone, tag);
                }
                else if(isEnd)
                {
                    await this.notification.clearTag(phone);
                }
            }
            else
            {
                const tag = start ? this.notification.generateRandomTag() : await this.notification.getTag(phone);
                if(!tag)
                {
                    return;
                }

                for(const socket of socketsWithToken)
                {
                    if(start)
                    {
                        await this.notification.sendProcessing(phone, socket.fcmToken, tag);
                    }
                    else
                    {
                        await this.notification.sendMessage(phone, socket.fcmToken, null, body.content, null, tag, end);
                    }
                }

                if(start)
                {
                    await this.notification.setTag(phone, tag);
                }
                else if(end)
                {
                    await this.notification.clearTag(phone);
                }
            }
        }
    }
}

module.exports = WiraSocket;