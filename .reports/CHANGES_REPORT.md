# 📝 WIRA Platform — Changes Report
> **Purpose**: Track every code change session — which files changed, what changed, and why.
> **How to use**: Agent updates this file at the END of every change session with a new dated entry.
> **Format**: Each entry = Date + Session Title + Files Changed + Detailed Description

---

## How This File Works

- Each section is one **change session** (one coding task/session)
- **Date** is in IST (India Standard Time)
- **Files** listed are ONLY files that were actually modified or created
- Each change entry explains:
  - What was the **problem or requirement**
  - What **files** were changed
  - **Exactly what** changed in each file
  - What **impact** the change has

---

## Change Log

---

### [2026-09-25] — Session: Initial Payroll Module Implementation

**Summary**: Added the complete Payroll Call System as an isolated module on top of the existing Call Screening infrastructure. Zero regression guaranteed — all screening code untouched.

---

#### File 1: `Wira-Call/CallManager/PayrollManager.js` — CREATED

**Purpose**: New manager class for payroll call lifecycle.

**What was added**:
- `class PayrollManager` — handles full lifecycle of payroll outbound calls
- `constructor()` — accepts same DI params as other managers; creates dedicated `payrollPhonePool = ["+918031703171"]`; initializes `PayrollQueueManager` (does NOT create a screening RedisManager)
- `buildReminderText(clientName, companyName, amount, dueDate, subType)` — generates English intro script:
  - `reminder` subType: "Hello {name}, payment of Rs.{amount} due in 3 days on {dueDate}"
  - `overdue` subType: "Hello {name}, urgent notice — payment of Rs.{amount} was due on {dueDate}. When can you pay?"
- `handleIntroAudio(data, subType)` — batch-generates TTS audio via Sarvam AI (en-IN, "shreya" speaker)
- `validatePayrollBody(data, subType)` — validates required fields: `to`, `type`, `companyName`
- `createBodyPayload(data, subType)` — enriches items with audio, config, timestamps; hardcodes English language settings
- `handleDatabaseAndRedisSave(payload, subType)` — creates `wira_candidates` + `wira_call` + `wira_outbound_screening` DB records; sets Redis session; pushes to `payrollQueueManager.pushToQueue()`
- `handlePayrollCall(items, subType)` — entry point called by CallManager handlers
- `flushCallEnd(callUUID, hangupBy, callStatus, session)` — aggregates costs, runs AI analysis if call completed, persists to DB, cleans Redis keys, deallocates payroll phone number

**Impact**: New payroll call type fully operational from API to call end.

---

#### File 2: `Wira-Call/CallManager/PayrollQueueManager.js` — CREATED

**Purpose**: Dedicated BullMQ queue + worker for payroll calls — completely separate from screening infrastructure.

**What was added**:
- `class PayrollQueueManager` — standalone class, no dependency on screening QueueManager or RedisManager
- `constructor(redis, database)` — creates `payrollCallQueue` BullMQ Queue named `"payroll-call-queue"` with exponential backoff (3s delay, 3 attempts default)
- `initWorker()` — creates BullMQ Worker on `"payroll-call-queue"` (concurrency: 10):
  - Reads session from Redis `screening:callId:{wiraCallId}`
  - Calls `#allocateNumber()` using Lua script on `"payroll-numbers-config"` key (never touches `"numbers-config"`)
  - Initiates Plivo call via `plivo.initiateCall()`
  - Handles failures: deallocates number, updates DB status to "failed"
  - Updates Redis + DB with `plivoCallId` on success
- `pushToQueue(phone, wiraCallId, priority)` — adds job to `payroll-call-queue` with jobId `"payroll:{phone}:{wiraCallId}"` (unique per call)
- `deallocateNumber(fromPhone)` — public method called by PayrollManager.flushCallEnd()
- `#allocateNumber(numberList, concurrency, preferredNumber)` — private Lua-backed atomic allocation on `"payroll-numbers-config"`
- `#deallocateNumber(numberList, concurrency, targetNumber)` — private Lua-backed atomic deallocation on `"payroll-numbers-config"`
- `ALLOCATE_SCRIPT` + `DEALLOCATE_SCRIPT` — Lua scripts (same logic as screening RedisManager but scoped to `payroll-numbers-config`)

**Impact**: Payroll calls get their own isolated phone pool management. No interference with screening call concurrency tracking.

---

#### File 3: `Wira-Call/CallManager/CallManager.js` — MODIFIED

**What was added**:
```javascript
// Line 4: New import
const PayrollManager = require("./PayrollManager");

// Lines 84-88: Added 2 new call types to availableCallTypes
this.availableCallTypes = [
  "outbound-screening",
  "outbound-payroll-reminder",   // NEW
  "outbound-payroll-overdue",    // NEW
];

// Lines 103-114: Added 2 new handlers
{ type: "outbound-payroll-reminder",
  resolve: (items) => this.payroll.handlePayrollCall(items, "reminder"),
  flush: (callUUID, hangupBy, callStatus, session) => this.payroll.flushCallEnd(...) },
{ type: "outbound-payroll-overdue",
  resolve: (items) => this.payroll.handlePayrollCall(items, "overdue"),
  flush: (callUUID, hangupBy, callStatus, session) => this.payroll.flushCallEnd(...) },

// Lines 135-143: Instantiated PayrollManager
this.payroll = new PayrollManager(this.redis, this.database, this.phonePool, ...);
```

**What was NOT changed**: `handleOutboundScreening()`, `handlePlivoAnswerGet()`, `handlePlivoAnswerPost()`, `handlePlivoRecording()`, `handleInboundAnswer()`, `handleInboundStream()` — all untouched.

**Impact**: The routing system now dispatches payroll call types to PayrollManager.

---

#### File 4: `Wira-Call-Socket/sockets/outboundPayroll.js` — CREATED

**Purpose**: Dedicated real-time WebSocket controller (`PayrollCallManager`) for live payroll calls.

**What was added**:
- `class PayrollCallManager` — live call handler with identical audio stack as screening:
  - `VoiceActivityManager` — avr-vad barge-in
  - `SarvamManager` — STT/TTS streaming
  - `GeminiManager` — LLM turn
  - `PlivoManager` — audio/billing
  - `RedisManager` — session/cost tracking
- Payroll-specific Gemini prompt logic in `#runPayrollAITurn()`:
  - `reminder` subType: Thank client, end with `<kill>`
  - `overdue` subType: Acknowledge payment commitment date, note it, end with `<kill>`
- `promisedDate` captured in session if client mentions a date in overdue call

**Impact**: Payroll calls have a fully operational AI voice pipeline.

---

#### File 5: `Wira-Call-Socket/sockets/socket.js` — MODIFIED

**What was added**:
```javascript
// Line 5: New import
const outboundPayrollSocket = require("./outboundPayroll.js");

// Lines 28-60: Two new path entries in acceptedPaths[]
{ pathname: "/outbound-payroll-reminder", handler: async (socket, request, queryParams) => {
    socket.type = "outbound-payroll-reminder";
    socket.table = "wira_payroll_call";
    socket.callId = queryParams.CallUUID;
    await outboundPayrollSocket(socket);
}},
{ pathname: "/outbound-payroll-overdue", handler: async (socket, request, queryParams) => {
    socket.type = "outbound-payroll-overdue";
    socket.table = "wira_payroll_call";
    socket.callId = queryParams.CallUUID;
    await outboundPayrollSocket(socket);
}}
```

**What was NOT changed**: `/outbound-screening` handler — untouched.

**Impact**: WebSocket connections from Plivo for payroll call types now route to PayrollCallManager.

---

#### File 6: `shared/Utility/PlivoHandler.js` — MODIFIED

**What was added**:
- `payrollNumbers` array: `[process.env.PLIVO_PAYROLL_PHONE_NUMBER || "+918031703171", "+918031703171"]`
- `payrollClient` — new `plivo.Client(PLIVO_PAYROLL_AUTH_ID, PLIVO_PAYROLL_AUTH_TOKEN)` if env vars present
- Updated `getClient(fromNumber)` function to check `payrollNumbers` first and return `payrollClient`

**Impact**: Plivo calls from payroll number now use dedicated payroll credentials.

---

#### File 7: `.env` (root) — MODIFIED

**What was added**:
```env
PLIVO_PAYROLL_AUTH_ID=
PLIVO_PAYROLL_AUTH_TOKEN=
PLIVO_PAYROLL_PHONE_NUMBER=+918031703171
```

**Impact**: Environment now supports separate Plivo account for payroll calls.

---

**Total Files Changed in this Session**: 7
**New Files Created**: 3 (`PayrollManager.js`, `PayrollQueueManager.js`, `outboundPayroll.js`)
**Files Modified**: 4 (`CallManager.js`, `socket.js`, `PlivoHandler.js`, `.env`)
**Files NOT touched**: All screening files, database files, shared AI, QueueManager, RedisManager, etc.

---

---

### [2026-09-25] — Session: Project Analysis & Reports Created

**Summary**: Deep analysis of entire WIRA project. Created `.reports/` folder with two living documents.

**Files Created**:
- `.reports/PROJECT_REPORT.md` — Complete architecture reference (this session)
- `.reports/CHANGES_REPORT.md` — This change log (this session)

**Files Analyzed** (read-only, no code changes):
All files in `Wira-Call/`, `Wira-Call-Socket/`, `Wira-Chatbot/`, `shared/`, root config files.

---

## Template for Future Entries

When the agent makes changes, it appends a new section in this format:

```markdown
---

### [YYYY-MM-DD] — Session: <Short Title>

**Summary**: One paragraph describing what was done and why.

---

#### File 1: `<relative/path/to/file.js>` — CREATED | MODIFIED | DELETED

**What was added/changed/removed**:
- Bullet point description
- Line numbers if helpful
- Code snippet if important

**Why**: Reason for this change.

**Impact**: What this change affects at runtime.

---

**Total Files Changed in this Session**: N
**New Files Created**: N
**Files Modified**: N
**Files Deleted**: N
```

---
