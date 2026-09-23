const Manager = require("../CallManager2/Manager.js");

const managerMap = new Map();
const RECONNECT_GRACE_MS = 10000;

async function inboundCallSocket(socket)
{
    const callId = socket.callId;

    if(managerMap.has(callId))
    {
        const entry = managerMap.get(callId);
        clearTimeout(entry.destroyTimer);
        entry.manager.reattach(socket);
    }
    else
    {
        const manager = new Manager(socket);
        managerMap.set(callId, 
            { 
                manager: manager, 
                destroyTimer: null 
            }
        );
    }

    const managerData = managerMap.get(callId);
    const manager = managerData.manager;

    function scheduleDestroy()
    {
        const entry = managerMap.get(callId);
        if(!entry)
        {
            return;
        }

        clearTimeout(entry.destroyTimer);
        
        entry.destroyTimer = setTimeout(() =>
            {
                entry.manager.destroy();
                managerMap.delete(callId);
            }, 
            RECONNECT_GRACE_MS
        );
    };

    socket.on('message', async (data) =>
        {
            await manager.message(data);
        }
    );

    socket.on('close', (code, reason) =>
        {
            manager.close(code, reason);
            scheduleDestroy();
        }
    );

    socket.on('error', (error) => 
        {
            manager.error(error);
            scheduleDestroy();
        }
    );
}

module.exports = inboundCallSocket;