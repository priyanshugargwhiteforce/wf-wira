const axios = require("axios");

class WiraWhatsapp
{
    constructor(session)
    {
        this.session = session;
    }

    async sendMessage(phone, data)
    {
        try
        {
            const payload = {
                statusCode: 200,
                success: true,
                message: "Sending whatsapp message successfully.",
                data: {
                    phone: phone,
                    content: (data.content && data.content.length > 0) ? data.content : "", 
                    links: (data.urls && Array.isArray(data.urls) && data.urls.length > 0) ? data.urls : [],
                    options: (data.options && Array.isArray(data.options) && data.options.length > 0) ? data.options : null,
                    data: data
                }
            };

            console.log("Sending to Whatsapp: ", payload);

            const response = await axios.post("https://wfadmanager.astro-buddy.in/api/whatsapp-chatbot/wira-hit-msg", payload,
            {
                headers: {
                    "x-wira-internal-secret": process.env.WHATSAPP_API_KEY
                }
            });

            if(response.data.success)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Whatsapp message sent successfully",
                    data: {
                        ...response.data.data,
                        whatsappId: response.data.data.whatsappId ?? null,
                        whatsappPayload: response.data.data.whatsappPayload ?? null
                    }
                }
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error sending message to whatsapp user.",
                    data: null
                }
            }
        }
        catch(error)
        {
            console.error("Error sending message to whatsapp user: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error sending message to whatsapp user.",
                data: null
            }
        }
    }

    async sendError(phone, message = "Error occured handling whatsapp message to wira.", data)
    {
        try
        {
            const payload = {
                statusCode: 500,
                success: false,
                message: message,
                data: {
                    phone: phone,
                    data: data
                }
            };

            console.log("Sending error message to Whatsapp: ", payload);

            const response = await axios.post("https://wfadmanager.astro-buddy.in/api/whatsapp-chatbot/wira-hit-msg", payload,
            {
                headers: {
                    "x-wira-internal-secret": process.env.WHATSAPP_API_KEY
                }
            });

            if(response.data.success)
            {
                return {
                    statusCode: 200,
                    success: true,
                    message: "Whatsapp error sent successfully",
                    data: response.data.data ?? null
                }
            }
            else
            {
                return {
                    statusCode: 500,
                    success: false,
                    message: "Error sending error message to whatsapp user.",
                    data: null
                }
            }
        }
        catch(error)
        {
            console.error("Error sending error message to whatsapp user: ", error);

            return {
                statusCode: 500,
                success: false,
                message: "Error sending error message to whatsapp user.",
                data: null
            }
        }
    }
}

module.exports = WiraWhatsapp;