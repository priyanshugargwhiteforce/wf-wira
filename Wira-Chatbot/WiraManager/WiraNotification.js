const axios = require("axios");
const crypto = require('crypto');

class WiraNotification
{
    constructor(session)
    {
        this.session = session;
    }

    generateRandomTag()
    {
        const timestamp = Date.now().toString(36);
        const randomBytes = crypto.randomBytes(3).toString('hex');

        return `wira-${timestamp}-${randomBytes}`;
    }

    async getTag(phone)
    {
        const session = await this.session.getSession(phone);
        return session?._notifTag ?? null;
    }

    async setTag(phone, tag)
    {
        const session = await this.session.getSession(phone);

        if(!session)
        {
            return;
        }

        session._notifTag = tag;
        await this.session.updateSession(phone, session);
    }

    async clearTag(phone)
    {
        const session = await this.session.getSession(phone);

        if(!session)
        {
            return;
        } 
        
        session._notifTag = null;
        await this.session.updateSession(phone, session);
    }

    async sendProcessing(phone, token, tag)
    {
        try
        {
            const metadata = {
                route: "chatbot",
                tag: tag ?? null
            };

            const response = await axios.post("https://astro-buddy.in/django/api/jobs/notifications/send-wira/",
            {
                title: "Wira AI",
                body: "Analyzing...",
                fcm_token: token,
                metadata: metadata,
                tag: tag ?? null
            },
            {
                headers: {
                    "X-API-KEY": process.env.WIRA_NOTIFICATION_KEY
                }
            });

            if(response.data.success)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Processing notification sent successfully.",
                    data: response.data
                };
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured sending processing notification.",
                    data: null
                };
            }
        }
        catch(error)
        {
            console.error("Error occured sending processing notification: ", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured sending processing notification.",
                data: null
            };
        }
    }

    async sendMessage(phone, token, title, message, imageUrl, tag, final = false)
    {
        try
        {
            const metadata = {
                route: "chatbot",
                tag: tag ?? null
            };

            const response = await axios.post("https://astro-buddy.in/django/api/jobs/notifications/send-wira/",
            {
                title: title ?? "Wira AI",
                body: message,
                fcm_token: token,
                imageUrl: imageUrl ?? "",
                metadata: metadata,
                tag: tag ?? null
            },
            {
                headers: {
                    "X-API-KEY": process.env.WIRA_NOTIFICATION_KEY
                }
            });

            if(response.data.success)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Message notification sent successfully.",
                    data: response.data
                };
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error occured sending message notification.",
                    data: null
                };
            }
        }
        catch(error)
        {
            console.error("Error occured sending message notification: ", error.message);

            return {
                statusCode: 500,
                success: false,
                message: "Error occured sending message notification.",
                data: null
            };
        }
    }
}

module.exports = WiraNotification;