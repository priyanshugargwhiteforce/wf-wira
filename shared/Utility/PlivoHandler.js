const plivo = require('plivo');

const FROM_NUMBER = "+918031320770";

const auth1Numbers = [
    "+918031320770"
];

const auth2Numbers = [
    "+918031903192"
];

const payrollNumbers = [
    process.env.PLIVO_PAYROLL_PHONE_NUMBER || "+918031703171",
    "+918031703171"
];

const client1 = (process.env.PLIVO_AUTH_ID && process.env.PLIVO_AUTH_TOKEN) ? new plivo.Client(process.env.PLIVO_AUTH_ID, process.env.PLIVO_AUTH_TOKEN) : null;
const client2 = (process.env.PLIVO_AUTH_ID_2 && process.env.PLIVO_AUTH_TOKEN_2) ? new plivo.Client(process.env.PLIVO_AUTH_ID_2, process.env.PLIVO_AUTH_TOKEN_2) : null;
const payrollClient = (process.env.PLIVO_PAYROLL_AUTH_ID && process.env.PLIVO_PAYROLL_AUTH_TOKEN) ? new plivo.Client(process.env.PLIVO_PAYROLL_AUTH_ID, process.env.PLIVO_PAYROLL_AUTH_TOKEN) : null;

function getClient(fromNumber)
{
    if(payrollNumbers.includes(fromNumber))
    {
        return payrollClient || client1 || client2;
    }

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
                hangupUrl: finalAnswerUrl,
                hangupMethod: "POST",
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
    const clientsToTry = [];

    if(fromNumber)
    {
        // Route to the correct client based on which number made the call
        const preferred = getClient(fromNumber);
        if(preferred)
        {
            clientsToTry.push(preferred);
        }

        // Add other clients as fallback (but NOT blindly adding payrollClient for screening calls)
        if(client1 && !clientsToTry.includes(client1))
        {
            clientsToTry.push(client1);
        }

        if(client2 && !clientsToTry.includes(client2))
        {
            clientsToTry.push(client2);
        }

        // Only add payroll client as fallback if the fromNumber is a payroll number
        if(payrollClient && !clientsToTry.includes(payrollClient) && payrollNumbers.includes(fromNumber))
        {
            clientsToTry.push(payrollClient);
        }
    }
    else
    {
        // No fromNumber — try screening clients first, then payroll
        if(client1) clientsToTry.push(client1);
        if(client2 && !clientsToTry.includes(client2)) clientsToTry.push(client2);
        if(payrollClient && !clientsToTry.includes(payrollClient)) clientsToTry.push(payrollClient);
    }

    let lastError = null;

    for(const client of clientsToTry)
    {
        try
        {
            await client.calls.hangup(callUUID);
            return true;
        }
        catch(error)
        {
            lastError = error;
        }
    }

    throw new Error(`Failed to hangup call ${callUUID}: ${lastError?.message || lastError?.toString()}`);
}

module.exports = {
    initiateCall,
    getAvailableNumbers,
    hangupCall
};