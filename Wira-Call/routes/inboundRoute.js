const express = require("express");
const router = express.Router();
const CallManager = require("../CallManager/CallManager");
const manager = new CallManager();

router.post("/inbound-answer", (request, response) =>
{
    return manager.handleInboundAnswer(
        request, 
        response
    );
});

router.get("/inbound-stream", (request, response) =>
{
    return manager.handleInboundStream(
        request, 
        response
    );
});


router.post("/inbound-stream", (request, response) =>
{
    return manager.handleInboundStream(
        request, 
        response
    );
});

module.exports = router;