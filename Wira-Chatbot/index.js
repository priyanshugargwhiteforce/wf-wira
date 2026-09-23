// SYSTEM IMPORTS
const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotEnv = require("dotenv");
const { Server } = require("socket.io");

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

const WiraRoute = require("./routes/WiraRoute");
const socket = require("./sockets/socket");

const app = express();

app.use(bodyParser.json(
    { 
        limit: '50mb' 
    }
));

app.use(bodyParser.urlencoded(
    { 
        limit: '50mb', 
        extended: true 
    }
));

app.use(
    cors(
        {
            origin: "*",
            methods: [
                "GET", 
                "POST", 
                "PUT", 
                "DELETE", 
                "OPTIONS"
            ]
        }
    )
);

app.get("/health", (request, response) => 
{
    response.send("Wira Chatbot Microservice is running.");
});

app.use("/", WiraRoute);

const server = http.createServer(app);
const io = new Server(server, 
{
    path: "/socket.io",
    cors: 
    {
        origin: "*",
        methods: [
            "GET", 
            "POST"
        ]
    } 
});

socket.socketIOHandler(io);
const PORT = process.env.PORT || 5005;

function startServer() 
{
    server.listen(PORT, "0.0.0.0", () => 
    {
        console.log(`Wira Chatbot Server started on port ${PORT}`);
    });
}

startServer();

process.on("SIGTERM", () => 
{
    console.log("SIGTERM received. Closing server...");

    server.close(() => 
    {
        process.exit(0);
    });
});

process.on("SIGINT", () => 
{
    console.log("SIGINT received. Closing server...");

    server.close(() => 
    {
        process.exit(0);
    });
});