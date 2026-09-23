const express = require("express");
const router = express.Router();
const CallManager = require("../CallManager/CallManager");

const manager = new CallManager();

const protectedRoutes = [
    "/make-plivo-call",
    "/make-plivo-call-batch",
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

router.post("/make-plivo-call", (request, response) =>
{
    return manager.handleOutboundCall(
        request, 
        response
    );
});

router.post("/make-plivo-call-batch", (request, response) =>
{
    return manager.handleOutboundCall(
        request, 
        response
    );
});

router.get("/plivo-answer", (request, response) =>
{
    return manager.handlePlivoAnswerGet(
        request, 
        response
    );
});

router.post("/plivo-answer", (request, response) =>
{
    return manager.handlePlivoAnswerPost(
        request, 
        response
    );
});

router.post("/plivo-recording", (request, response) =>
{
    return manager.handlePlivoRecording(
        request, 
        response
    );
});

module.exports = router;