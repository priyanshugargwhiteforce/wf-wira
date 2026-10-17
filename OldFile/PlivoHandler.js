const plivo = require('plivo');

const FROM_NUMBER = "+918031320770";

const auth1Numbers = [
    "+918031320770"
];

const auth2Numbers = [
    "+918031903192"
];

const client1 = (process.env.PLIVO_AUTH_ID && process.env.PLIVO_AUTH_TOKEN) ? new plivo.Client(process.env.PLIVO_AUTH_ID, process.env.PLIVO_AUTH_TOKEN) : null;
const client2 = (process.env.PLIVO_AUTH_ID_2 && process.env.PLIVO_AUTH_TOKEN_2) ? new plivo.Client(process.env.PLIVO_AUTH_ID_2, process.env.PLIVO_AUTH_TOKEN_2) : null;

function getClient(fromNumber)
{
    if(auth2Numbers.includes(fromNumber))
    {
        return client2 || client1;
    }

    return client1 || client2;
}

async function initiateCall(toNumber, fromNumber, routeName)
{
    try
    {
        const targetClient = getClient(fromNumber);

        if(!targetClient)
        {
            throw new Error("Plivo credentials not configured in environment variables.");
        }
        
        const baseUrl = "https://wira-ai.com/call/plivo-answer";
        const finalAnswerUrl = `${baseUrl}?routeName=${encodeURIComponent(routeName)}`;

        const response = await targetClient.calls.create(
            fromNumber || FROM_NUMBER,
            toNumber,
            finalAnswerUrl,
            {
                answerMethod: "GET",
                machineDetection: "false"
            }
        );
        
        return response;
    }
    catch (error)
    {
        throw new Error(error.message || error);
    }
}

async function getAvailableNumbers()
{
    try
    {
        const activeClient = client1 || client2;

        if(!activeClient)
        {
            throw new Error("No Plivo client configured.");
        }

        const numbers = await activeClient.numbers.list();
        return numbers.map(n => "+" + n.number);
    }
    catch (error)
    {
        throw new Error(`Failed to fetch available numbers: ${error.message}`);
    }
}

async function hangupCall(callUUID, fromNumber = null)
{
    const primaryClient = fromNumber ? getClient(fromNumber) : (client1 || client2);

    if(!primaryClient)
    {
        throw new Error(`Failed to hangup call ${callUUID}: Plivo client not configured`);
    }

    try
    {
        await primaryClient.calls.hangup(callUUID);
        return true;
    }
    catch (error)
    {
        const fallbackClient = (primaryClient === client1) ? client2 : client1;

        if(fallbackClient)
        {
            try
            {
                await fallbackClient.calls.hangup(callUUID);
                return true;
            }
            catch(_)
            {
                // Fallback attempt failed, proceed to throw original error
            }
        }

        throw new Error(`Failed to hangup call ${callUUID}: ${error.message || error}`);
    }
}

module.exports = {
    initiateCall,
    getAvailableNumbers,
    hangupCall
};