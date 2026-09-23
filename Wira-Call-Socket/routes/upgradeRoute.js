const express = require("express");
const webSocket = require("../sockets/socket");
const router = express.Router();

router.get("/outbound-screening", (request, response) =>
{
    const wss = webSocket.getWssInstance();
    
    if(!wss)
    {
        return response.status(500).send("WebSocket Server Offline");
    }
    
    const socket = request.socket;
    const head = Buffer.alloc(0);
    
    wss.handleUpgrade(request, socket, head, (ws) =>
        {
            wss.emit("connection", ws, request);
        }
    );
});

router.get("/inbound-call", (request, response) =>
{
    const wss = webSocket.getWssInstance();
    if(!wss)
    {
        console.error(
            "WebSocket server not initialized", 
            { 
                route: "/inbound-call" 
            }
        );

        return response.status(500).send("WebSocket Server Offline");
    }

    const socket = request.socket;
    const head = Buffer.alloc(0);
    
    wss.handleUpgrade(request, socket, head, (ws) =>
        {
            wss.emit("connection", ws, request);
        }
    );
});

module.exports = router;