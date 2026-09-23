// SYSTEM IMPORTS
const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const dotEnv = require("dotenv");

dotEnv.config(
    { 
        path: path.resolve(__dirname, "../.env"), 
        quiet: true 
    }
);

dotEnv.config(
    { 
        path: path.resolve(__dirname, ".env"), 
        override: true, 
        quiet: true 
    }
);

const socketInitializer = require("./sockets/socket");
const upgradeRoute = require("./routes/upgradeRoute");
const app = express();

app.use(
    cors({
        origin: "*",
        methods: [
            "GET",
            "POST",
            "OPTIONS"
        ],
    })
);

app.get("/health", (request, response) => 
{
    response.send("Raw Socket Handler Isolated Service is running.");
});

app.use("/upgrade", upgradeRoute);
const server = http.createServer(app);
socketInitializer.socketHandler(server);

const PORT = process.env.PORT || 5002;

function startServer() 
{
    server.listen(PORT, "0.0.0.0", () => 
    {
        console.log(`Wira Call Socket Server started on port ${PORT}`);
    });
}

startServer();

process.on("SIGTERM", () => 
{
    console.log("SIGTERM received. Closing server...");

    server.close(() => 
        {
            process.exit(0);
        }
    );
});

process.on("SIGINT", () => 
{
    console.log("SIGINT received. Closing server...");

    server.close(() => 
        {
            process.exit(0);
        }
    );
});