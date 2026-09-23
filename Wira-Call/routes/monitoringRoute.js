const express = require("express");
const router = express.Router();
const WiraDatabase = require("../../Wira-Chatbot/WiraManager/WiraDatabase");

const database = new WiraDatabase();

const protectedRoutes = [
    "/conversation-candidates",
    "/conversation-candidates/:id/conversation-calls",
    "/conversation-calls/:callId/full",
    "/conversation-candidates/:id/calls-full",
    "/candidates-with-calls",
];

router.use(protectedRoutes, (request, response, next) =>
{
    const apiKey = request.headers["x-api-key"];

    if (!apiKey || apiKey !== process.env.WIRA_API_KEY)
    {
        return response.status(401).json(
        {
            statusCode: 401,
            success: false,
            message: "Unauthorized.",
            data: null
        });
    }

    next();
});

router.get("/conversation-candidates", async (request, response) =>
{
    try
    {
        const query = request.query;
        const page = parseInt(query.page) || 1;
        const limit = parseInt(query.limit) || 20;
        const filters = {};

        if(query.id !== undefined) 
        { 
            filters.id = parseInt(query.id); 
        }

        if(query.candidateId !== undefined) 
        { 
            filters.candidateId = parseInt(query.candidateId); 
        }

        if(query.phone !== undefined) 
        { 
            filters.phone = query.phone; 
        }

        if(query.email !== undefined) 
        { 
            filters.email = query.email; 
        }

        if(query.name !== undefined) 
        { 
            filters.name = query.name; 
        }

        if(query.hasCall !== undefined) 
        { 
            filters.hasCall = query.hasCall === "true"; 
        }

        if(query.hasWhatsapp !== undefined) 
        { 
            filters.hasWhatsapp = query.hasWhatsapp === "true"; 
        }

        if(query.hasApp !== undefined) 
        { 
            filters.hasApp = query.hasApp === "true"; 
        }

        const result = await database.db.fetchWiraCandidates(filters, page, limit);

        if(!result)
        {
            return response.json({ 
                statusCode: 500, 
                success: false, 
                message: "Database error while fetching candidates.", 
                data: null 
            });
        }

        return response.json(
        {
            statusCode: 200,
            success: true,
            data:
            {
                candidates: result.rows,
                pagination:
                {
                    total: result.total,
                    page: result.page,
                    limit: result.limit,
                    pages: Math.ceil(result.total / result.limit)
                }
            }
        });
    }
    catch (err)
    {
        return response.status(500).json({ 
            statusCode: 500, 
            success: false, 
            message: "Internal server error.", 
            data: null 
        });
    }
});

router.get("/conversation-candidates/:id/conversation-calls", async (request, response) =>
{
    try
    {
        const candidateId = parseInt(request.params.id);

        if(isNaN(candidateId))
        {
            return response.json({ 
                statusCode: 400, 
                success: false, 
                message: "':id' must be a valid integer.", 
                data: null 
            });
        }

        const query = request.query;
        const page = parseInt(query.page) || 1;
        const limit = parseInt(query.limit) || 20;
        const filters = { wiraCandidateId: candidateId };

        if(query.callId !== undefined) 
        { 
            filters.callId = query.callId; 
        }

        if(query.fromPhone !== undefined) 
        { 
            filters.fromPhone = query.fromPhone; 
        }

        if(query.bound !== undefined) 
        { 
            filters.bound = query.bound; 
        }

        if(query.type !== undefined) 
        { 
            filters.type = query.type; 
        }

        if(query.status !== undefined) 
        { 
            filters.status = query.status; 
        }

        const result = await database.db.fetchWiraCalls(filters, page, limit);

        if(!result)
        {
            return response.json({ 
                statusCode: 500, 
                success: false, 
                message: "Database error while fetching calls.", 
                data: null 
            });
        }

        return response.json(
        {
            statusCode: 200,
            success: true,
            data:
            {
                calls: result.rows,
                pagination:
                {
                    total: result.total,
                    page: result.page,
                    limit: result.limit,
                    pages: Math.ceil(result.total / result.limit)
                }
            }
        });
    }
    catch (err)
    {
        return response.status(500).json({ 
            statusCode: 500, 
            success: false, 
            message: "Internal server error.", 
            data: null 
        });
    }
});

router.get("/conversation-calls/:callId/full", async (request, response) =>
{
    try
    {
        const callId = request.params.callId;
        const fullCall = await database.getFullCallByCallId(callId);

        if(fullCall === null)
        {
            return response.json({ 
                statusCode: 500, 
                success: false,
                message: "Database error while fetching call.", 
                data: null 
            });
        }

        if(!fullCall.wiraCall)
        {
            return response.json({ 
                statusCode: 404, 
                success: false, 
                message: `No call found for callId: ${callId}`, 
                data: null 
            });
        }

        return response.json(
        {
            statusCode: 200,
            success: true,
            data:
            {
                conversationCandidate: fullCall.wiraCandidate,
                conversationCall: fullCall.wiraCall,
                outboundScreening: fullCall.outboundScreening,
                conversationCosts: fullCall.callCosts
            }
        });
    }
    catch (err)
    {
        return response.status(500).json({ 
            statusCode: 500, 
            success: false, 
            message: "Internal server error.", 
            data: null 
        });
    }
});

router.get("/conversation-candidates/:id/calls-full", async (request, response) =>
{
    try
    {
        const wiraCandidateId = parseInt(request.params.id);

        if(isNaN(wiraCandidateId))
        {
            return response.json({ 
                statusCode: 400, 
                success: false, 
                message: "':id' must be a valid integer.", 
                data: null 
            });
        }

        const query = request.query;
        const page = parseInt(query.page) || 1;
        const limit = parseInt(query.limit) || 50;
        const filters = {};

        if(query.jobTitle !== undefined) 
        { 
            filters.jobTitle = query.jobTitle; 
        }

        if(query.companyName !== undefined) 
        { 
            filters.companyName = query.companyName; 
        }

        if(query.status !== undefined) 
        { 
            filters.status = query.status; 
        }

        if(query.language !== undefined) 
        { 
            filters.language = query.language; 
        }

        if(query.hangupBy !== undefined) 
        { 
            filters.hangupBy = query.hangupBy; 
        }

        if(query.hangupCause !== undefined) 
        { 
            filters.hangupCause = query.hangupCause; 
        }

        if(query.interest !== undefined) 
        { 
            filters.interest = query.interest; 
        }

        const result = await database.getCandidateCallsFull(wiraCandidateId, filters, page, limit);

        if(!result)
        {
            return response.json({ 
                statusCode: 500, 
                success: false, 
                message: "Database error while fetching calls.", 
                data: null 
            });
        }

        return response.json(
        {
            statusCode: 200,
            success: true,
            data:
            {
                calls: result.rows,
                pagination:
                {
                    total: result.total,
                    page: result.page,
                    limit: result.limit,
                    pages: Math.ceil(result.total / result.limit)
                }
            }
        });
    }
    catch (err)
    {
        return response.status(500).json({ 
            statusCode: 500, 
            success: false, 
            message: "Internal server error.", 
            data: null 
        });
    }
});

router.post("/candidates-with-calls", async (request, response) =>
{
    try
    {
        const body = request.body ?? {};
        const pageNo = parseInt(body.pageNo ?? 1);
        const perPage = parseInt(body.perPage ?? 40);
        const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
        const result = await database.getCandidatesWithCalls(filters, pageNo, perPage);

        if(result === null)
        {
            return response.status(500).json({ 
                statusCode: 500, 
                success: false, 
                message: "Failed to fetch candidates.", 
                data: null 
            });
        }

        return response.json(
        {
            statusCode: 200,
            success: true,
            data:
            {
                candidates: result.candidates,
                pagination:
                {
                    total: result.total,
                    page: pageNo,
                    perPage: perPage,
                    pages: Math.ceil(result.total / perPage)
                },
                analysis: result.analysis
            }
        });
    }
    catch (err)
    {
        return response.status(500).json({ 
            statusCode: 500, 
            success: false, 
            message: "Internal server error.", 
            data: null 
        });
    }
});

module.exports = router;