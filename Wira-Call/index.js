const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const bodyParser = require("body-parser");
const compression = require("compression");
const dotEnv = require("dotenv");
const handleSocket = require("./sockets/socket");

const outboundRoute = require("./routes/outboundRoute.js");
const monitoringRoute = require("./routes/monitoringRoute.js");
const inboundRoute = require("./routes/inboundRoute.js");

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

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(compression());
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

const ignoreConsole = [
  "/candidate-extension/list/",
];

app.use((request, response, next) => 
{
    const shouldIgnore = ignoreConsole.some((item) => request.url.startsWith(item));

    if(!shouldIgnore)
    {
        console.log("Incoming request:", request.method, request.url);
    }
    
    next();
});

app.get("/health", (request, response) => 
{
    response.send("Call Isolated Service is running.");
});

app.use("/", outboundRoute);
app.use("/", monitoringRoute);
app.use("/", inboundRoute);

const server = http.createServer(app);
handleSocket(server);

function startServer() 
{
    const PORT = process.env.PORT || 5001;

    server.listen(PORT, "0.0.0.0", () => 
    {
        console.log(`Wira Call Server started on port ${PORT}`);
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