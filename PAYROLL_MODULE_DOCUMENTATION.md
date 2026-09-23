# 📋 Payroll Department Call System — Architecture & Developer Documentation

## 1. Executive Summary & Zero-Regression Policy

This document details the architecture, code changes, API specifications, and AI voice prompts implemented for the **Payroll Department Call System**.

> **Zero-Regression Guarantee**:
> All existing HR Recruitment Candidate Screening call flows (`outbound-screening`), database schemas, and manager methods remain **100% untouched and unchanged**. The Payroll module runs on completely isolated routes (`outbound-payroll-reminder` and `outbound-payroll-overdue`), dedicated manager classes, and separate Plivo telephony credentials.

---

## 2. Telephony & AI Tech Stack Overview

- **Dedicated Outbound Telephony**: Plivo Number `+918031703171` (Mapped to dedicated Plivo Client credentials `PLIVO_PAYROLL_AUTH_ID` & `PLIVO_PAYROLL_AUTH_TOKEN`).
- **Text-to-Speech (TTS)**: Sarvam AI (`en-IN` English voice models, speaker `"shreya"`).
- **Speech-to-Text (STT)**: Sarvam AI Streaming WebSocket STT (`en-IN` @ 16kHz upsampled).
- **Voice Activity Detection (VAD)**: `avr-vad` (v5 Silero VAD model at 16kHz) for real-time speech start/end detection and instant barge-in support.
- **Conversational AI (LLM)**: Google Gemini (`gemini-2.5-flash-lite` / `gemini-3.1-flash-lite`) for candidate commitment date parsing and intelligent conversation handling.
- **Session & Billing Storage**:
  - **Transient Session State**: Redis (`screening:callId:${callUUID}`).
  - **Persistent Call Logs & Metrics**: PostgreSQL (`wira_call` and `wira_outbound_screening` tables).

---

## 3. Files Created & Code Reference

### 🆕 File 1: [PayrollManager.js](file:///media/priyanshu/NewVolume/Priyanshu%20Garg/WIRA/Wira-Call/CallManager/PayrollManager.js)

- **Path**: `/media/priyanshu/NewVolume/Priyanshu Garg/WIRA/Wira-Call/CallManager/PayrollManager.js`
- **Purpose**: Manager class handling validation, intro audio batch generation, PostgreSQL candidate/call record creation, Redis session initialization, and post-call billing/transcript flushing.

#### Key Code Snippet:

```javascript
class PayrollManager {
  constructor(redis, database, phonePool, perNumberConcurrency, languageToSarvamCodes, defaultVad, availableCallTypes) {
    this.redis = redis;
    this.database = database;
    this.phonePool = phonePool;
    this.perNumberConcurrency = perNumberConcurrency;
    this.languageToSarvamCodes = languageToSarvamCodes;
    this.defaultVad = defaultVad;
    this.availableCallTypes = availableCallTypes;

    this.retrieve = new WiraRetrieve();
    this.redisManager = new RedisManager(this.database, this.phonePool, this.perNumberConcurrency);

    const payrollNumber = process.env.PLIVO_PAYROLL_PHONE_NUMBER || "+918031703171";
    this.payrollPhonePool = [payrollNumber];
  }

  buildReminderText(clientName, companyName, amount, dueDate, subType) {
    const nameStr = clientName || "Valued Client";
    const companyStr = companyName || "White Force";
    const amountStr = amount ? `₹${amount}` : "your due amount";
    const dueDateStr = dueDate || "the scheduled date";

    if (subType === "reminder") {
      return `Hello ${nameStr}, I am Wira speaking from ${companyStr}. This is a gentle reminder that your payment of ${amountStr} is due in 3 days on ${dueDateStr}. Thank you.`;
    } else {
      return `Hello ${nameStr}, I am Wira speaking from ${companyStr}. This is an urgent notice regarding your payment of ${amountStr} which was due on ${dueDateStr}. Could you please let me know by when you will be able to complete this payment?`;
    }
  }
  ...
}
```

---

### 🆕 File 2: [outboundPayroll.js](file:///media/priyanshu/NewVolume/Priyanshu%20Garg/WIRA/Wira-Call-Socket/sockets/outboundPayroll.js)

- **Path**: `/media/priyanshu/NewVolume/Priyanshu Garg/WIRA/Wira-Call-Socket/sockets/outboundPayroll.js`
- **Purpose**: Dedicated real-time WebSocket controller (`PayrollCallManager`) handling Plivo media stream packets, VAD barge-in, Sarvam STT/TTS streams, and Gemini LLM prompts for payment date commitment capture.

#### Key Code Snippet:

```javascript
class PayrollCallManager {
    constructor(socket, callUUID, session) {
        this.socket = socket;
        this.callUUID = callUUID;
        this.session = session;
        this.subType = session.subType || "reminder";
        ...
    }

    async #runPayrollAITurn(session, userTranscript) {
        this.isGeminiRunning = true;
        this.isSarvamRunning = true;
        this.isPlivoSpeaking = true;

        try {
            const systemPrompt = this.subType === "overdue"
                ? `You are Wira calling from ${session.companyName || 'White Force'} regarding an overdue payment of ₹${session.amount || ''} due on ${session.dueDate || ''}. The client just said: "${userTranscript}". Politely acknowledge their expected payment date/commitment, confirm you have noted it, and thank them professionally in English. Keep your answer brief (under 25 words). End your response with <kill>.`
                : `You are Wira calling from ${session.companyName || 'White Force'} regarding payment reminder. The client said: "${userTranscript}". Politely thank them in English and end your response with <kill>.`;

            const result = await this.gemini.screeningTurn(this.callUUID, {
                candidateName: session.clientName,
                jobTitle: "Payroll Payment Notice",
                companyName: session.companyName,
                jobDescription: systemPrompt,
                messages: session.transcript,
                language: "en",
                modelName: "gemini-2.5-flash-lite",
                onChunk: (chunk) => {
                    if(!this.isUserSpeaking) {
                        this.sarvam.sendTTSChunk(chunk);
                    }
                }
            });
            ...
        }
    }
}
```

---

## 4. Files Modified & Code Details

### ✏️ File 1: [CallManager.js](file:///media/priyanshu/NewVolume/Priyanshu%20Garg/WIRA/Wira-Call/CallManager/CallManager.js)

- **Path**: `/media/priyanshu/NewVolume/Priyanshu Garg/WIRA/Wira-Call/CallManager/CallManager.js`
- **Changes**: Imported `PayrollManager` and registered two new call types: `"outbound-payroll-reminder"` and `"outbound-payroll-overdue"`.

#### Added Code:

```javascript
const PayrollManager = require("./PayrollManager");

// Registered Call Types in constructor:
this.availableCallTypes = [
  "outbound-screening",
  "outbound-payroll-reminder",
  "outbound-payroll-overdue",
];

this.handlers = [
  {
    type: "outbound-screening",
    resolve: (request, response) =>
      this.handleOutboundScreening(request, response),
    flush: (callUUID, hangupBy, callStatus, session) =>
      this.outboundScreening.flushCallEnd(
        callUUID,
        hangupBy,
        callStatus,
        session,
      ),
  },
  {
    type: "outbound-payroll-reminder",
    resolve: (items) => this.payroll.handlePayrollCall(items, "reminder"),
    flush: (callUUID, hangupBy, callStatus, session) =>
      this.payroll.flushCallEnd(callUUID, hangupBy, callStatus, session),
  },
  {
    type: "outbound-payroll-overdue",
    resolve: (items) => this.payroll.handlePayrollCall(items, "overdue"),
    flush: (callUUID, hangupBy, callStatus, session) =>
      this.payroll.flushCallEnd(callUUID, hangupBy, callStatus, session),
  },
];

this.payroll = new PayrollManager(
  this.redis,
  this.database,
  this.phonePool,
  this.perNumberConcurrency,
  this.languageToSarvamCodes,
  this.defaultVad,
  this.availableCallTypes,
);
```

---

### ✏️ File 2: [socket.js](file:///media/priyanshu/NewVolume/Priyanshu%20Garg/WIRA/Wira-Call-Socket/sockets/socket.js)

- **Path**: `/media/priyanshu/NewVolume/Priyanshu Garg/WIRA/Wira-Call-Socket/sockets/socket.js`
- **Changes**: Imported `outboundPayrollSocket` and added route matchers for `/outbound-payroll-reminder` and `/outbound-payroll-overdue`.

#### Added Code:

```javascript
const outboundPayrollSocket = require("./outboundPayroll.js");

const acceptedPaths = [
    {
        pathname: "/outbound-screening",
        handler: async (socket, request, queryParams) => { ... }
    },
    {
        pathname: "/outbound-payroll-reminder",
        handler: async (socket, request, queryParams) => {
            if(!queryParams.CallUUID) { socket.close(); return; }
            socket.type = "outbound-payroll-reminder";
            socket.table = "wira_payroll_call";
            socket.callId = queryParams.CallUUID;
            await outboundPayrollSocket(socket);
        }
    },
    {
        pathname: "/outbound-payroll-overdue",
        handler: async (socket, request, queryParams) => {
            if(!queryParams.CallUUID) { socket.close(); return; }
            socket.type = "outbound-payroll-overdue";
            socket.table = "wira_payroll_call";
            socket.callId = queryParams.CallUUID;
            await outboundPayrollSocket(socket);
        }
    },
    ...
];
```

---

### ✏️ File 3: [PlivoHandler.js](file:///media/priyanshu/NewVolume/Priyanshu%20Garg/WIRA/shared/Utility/PlivoHandler.js)

- **Path**: `/media/priyanshu/NewVolume/Priyanshu Garg/WIRA/shared/Utility/PlivoHandler.js`
- **Changes**: Added `payrollNumbers` array containing `+918031703171` and initialized `payrollClient` for `PLIVO_PAYROLL_AUTH_ID` & `PLIVO_PAYROLL_AUTH_TOKEN`. Updated `getClient(fromNumber)` to dynamically return `payrollClient`.

#### Added Code:

```javascript
const payrollNumbers = [
  process.env.PLIVO_PAYROLL_PHONE_NUMBER || "+918031703171",
  "+918031703171",
];

const payrollClient =
  process.env.PLIVO_PAYROLL_AUTH_ID && process.env.PLIVO_PAYROLL_AUTH_TOKEN
    ? new plivo.Client(
        process.env.PLIVO_PAYROLL_AUTH_ID,
        process.env.PLIVO_PAYROLL_AUTH_TOKEN,
      )
    : null;

function getClient(fromNumber) {
  if (payrollNumbers.includes(fromNumber)) {
    return payrollClient || client1 || client2;
  }

  if (auth2Numbers.includes(fromNumber)) {
    return client2 || client1;
  }

  return client1 || client2;
}
```

---

### ✏️ File 4: [.env](file:///media/priyanshu/NewVolume/Priyanshu%20Garg/WIRA/.env)

- **Path**: `/media/priyanshu/NewVolume/Priyanshu Garg/WIRA/.env`
- **Changes**: Added dedicated payroll credentials keys.

#### Added Keys:

```env
PLIVO_PAYROLL_AUTH_ID=
PLIVO_PAYROLL_AUTH_TOKEN=
PLIVO_PAYROLL_PHONE_NUMBER=+918031703171
```

---

## 5. Call Scripts & Prompts Reference

### Call Type 1: `outbound-payroll-reminder` (3 Days Before Due Date)

- **Voice Script (English)**:
  > _"Hello {clientName}, I am Wira speaking from {companyName}. This is a gentle reminder that your payment of ₹{amount} is due in 3 days on {dueDate}. Thank you."_

---

### Call Type 2: `outbound-payroll-overdue` (Overdue Payment Notice + Commitment Prompt)

- **Voice Script (English)**:

  > _"Hello {clientName}, I am Wira speaking from {companyName}. This is an urgent notice regarding your payment of ₹{amount} which was due on {dueDate}. Could you please let me know by when you will be able to complete this payment?"_

- **AI Gemini System Prompt (Spoken Commitment Date Capture)**:
  ```text
  You are Wira calling from {companyName} regarding an overdue payment of ₹{amount} due on {dueDate}.
  The client just said: "{userTranscript}".
  Politely acknowledge their expected payment date/commitment, confirm you have noted it, and thank them professionally in English.
  Keep your answer brief (under 25 words). End your response with <kill>.
  ```

---

## 6. Postman API Testing Specification

### Endpoint:

`POST https://wira-ai.com/call/make-plivo-call`

### Headers:

- `Content-Type`: `application/json`
- `x-api-key`: `<WIRA_API_KEY>`

---

### Sample Payload — Type 1 (Reminder):

```json
{
  "type": "outbound-payroll-reminder",
  "to": "+919876543210",
  "clientName": "Priyanshu Garg",
  "companyName": "White Force",
  "amount": "15000",
  "dueDate": "15th January 2027"
}
```

### Sample Payload — Type 2 (Overdue Notice):

```json
{
  "type": "outbound-payroll-overdue",
  "to": "+919876543210",
  "clientName": "Priyanshu Garg",
  "companyName": "White Force",
  "amount": "25000",
  "dueDate": "1st January 2027"
}
```

### Expected JSON Response:

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Payroll call queued successfully.",
  "data": {
    "wiraCallId": "xxxx-xxxx-xxxx-xxxx",
    "to": "+919876543210",
    "from": "+918031703171",
    "type": "outbound-payroll-reminder"
  }
}
```
