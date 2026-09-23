class WiraValidation
{
    async validateWhatsappMessage(body, session)
    {
        const { 
            whatsappId, 
            whatsappPayload, 
            content, 
            files 
        } = body;

        if(session.processing.whatsapp)
        {
            return {
                statusCode: 429,
                success: false,
                message: "Already processing a message.",
                data: null
            };
        }

        if(!whatsappId)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Missing whatsappId.",
                data: null
            };
        }

        if(!whatsappPayload)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Missing whatsappPayload.",
                data: null
            };
        }

        const hasContent = content && typeof content === "string" && content.trim() !== "";
        const hasFiles = files && Array.isArray(files) && files.length > 0;

        if(!hasContent && !hasFiles)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Either content or files must be provided.",
                data: null
            };
        }

        return {
            statusCode: 200,
            success: true,
            message: "Valid.",
            data: null
        };
    }

    async validateAppMessage(body, session)
    {
        const { 
            content, 
            files 
        } = body;

        if(session.processing.app)
        {
            return {
                statusCode: 429,
                success: false,
                message: "Already processing a message.",
                data: null
            };
        }

        const hasContent = content && typeof content === "string" && content.trim() !== "";
        const hasFiles = files && Array.isArray(files) && files.length > 0;

        if(!hasContent && !hasFiles)
        {
            return {
                statusCode: 400,
                success: false,
                message: "Either content or files must be provided.",
                data: null
            };
        }

        return {
            statusCode: 200,
            success: true,
            message: "Valid.",
            data: null
        };
    }
}

module.exports = WiraValidation