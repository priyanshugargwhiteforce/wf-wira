const WebSocket = require('ws');
const url = require('url');
const outboundScreeningSocket = require("./outboundScreening.js");
const inboundCallSocket = require("./inboundCall.js");
const outboundPayrollSocket = require("./outboundPayroll.js");

let globalWss = null;

const acceptedPaths = [
    {
        pathname: "/outbound-screening",
        handler: async (socket, request, queryParams) => 
        {   
            if(!queryParams.CallUUID)
            {
                console.error("❌ [outbound-screening] No CallUUID in queryParams — closing socket");
                socket.close();
                return;
            }

            socket.type = "outbound-screening";
            socket.table = "wira_outbound_screening";
            socket.callId = queryParams.CallUUID;
            await outboundScreeningSocket(socket); 
        }
    },
    {
        pathname: "/outbound-payroll-reminder",
        handler: async (socket, request, queryParams) => 
        {   
            if(!queryParams.CallUUID)
            {
                console.error("❌ [outbound-payroll-reminder] No CallUUID in queryParams — closing socket");
                socket.close();
                return;
            }

            socket.type = "outbound-payroll-reminder";
            socket.table = "wira_payroll_call";
            socket.callId = queryParams.CallUUID;
            await outboundPayrollSocket(socket); 
        }
    },
    {
        pathname: "/outbound-payroll-overdue",
        handler: async (socket, request, queryParams) => 
        {   
            if(!queryParams.CallUUID)
            {
                console.error("❌ [outbound-payroll-overdue] No CallUUID in queryParams — closing socket");
                socket.close();
                return;
            }

            socket.type = "outbound-payroll-overdue";
            socket.table = "wira_payroll_call";
            socket.callId = queryParams.CallUUID;
            await outboundPayrollSocket(socket); 
        }
    },
    {
        pathname: "/inbound-call",
        handler: async (socket, request, queryParams) => 
        {
            if(!queryParams.CallUUID)
            {
                console.error("❌ [inbound-call] No CallUUID in queryParams — closing socket");
                socket.close();
                return;
            }

            socket.type = "inbound-call";
            socket.table = "wira_inbound_call";
            socket.callId = queryParams.CallUUID;
            await inboundCallSocket(socket); 
        }
    }
];

function initializeUpgradeGatekeeper(server)
{
    const wssInstance = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (request, socket, head) =>
    {
        const pathname = url.parse(request.url).pathname; 
        const matched = acceptedPaths.find(entry => pathname && pathname.startsWith(entry.pathname));

        if(matched)
        {
            wssInstance.handleUpgrade(request, socket, head, (ws) =>
            {
                wssInstance.emit('connection', ws, request);
            });
        }
        else
        {
            socket.destroy(); 
        }
    });

    return wssInstance;
}

function socketHandler(server)
{
    globalWss = initializeUpgradeGatekeeper(server);

    globalWss.on('connection', (ws, request) =>
    {
        const parsed = url.parse(request.url, true);
        const pathname = parsed.pathname;
        const queryParams = parsed.query;
        const matched = acceptedPaths.find(entry => pathname && pathname.startsWith(entry.pathname));

        if(!matched)
        {
            ws.close();
            return;
        }

        console.log(`🚀 SUCCESS! WebSocket connected natively to module: ${pathname}`);

        matched.handler(ws, request, queryParams);
    });
}

function getWssInstance()
{
    return globalWss;
}

module.exports = {
    socketHandler,
    getWssInstance
};