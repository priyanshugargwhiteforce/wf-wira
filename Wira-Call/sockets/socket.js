const socket = require("socket.io");
const RealtimeCallViewer = require("../database/realTimeCallViewerDB");

function handleSocket(server)
{
    const io = new socket.Server(
        server, 
        {
            cors: 
            { 
                origin: "*", 
                methods: 
                [
                    "GET", 
                    "POST"
                ] 
            }
        }
    );

    io.use((socket, next) =>
    {
        const apiKey = socket.handshake.auth?.apiKey;

        if(apiKey !== process.env.WIRA_API_KEY)
        {
            return next(new Error("Unauthorized"));
        }

        next();
    });

    io.on("connection", (socket) =>
    {
        console.log(`🚀 Socket connected: ${socket.id}`);
        new RealtimeCallViewer(socket);
    });
}

module.exports = handleSocket;