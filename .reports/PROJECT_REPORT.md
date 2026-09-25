# 🏗️ WIRA Platform — Complete Project Report
> **Generated**: 2026-09-25 | **Status**: Living Document — Updated by Agent after every change session
> **Scope**: Full architecture analysis covering all microservices, modules, and subsystems

---

## 📋 Table of Contents
1. [Project Overview](#1-project-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Microservices & Ports](#3-microservices--ports)
4. [Technology Stack](#4-technology-stack)
5. [Call Screening Module — Deep Dive](#5-call-screening-module--deep-dive)
6. [Payroll Call Module — Deep Dive](#6-payroll-call-module--deep-dive)
7. [Wira-Chatbot / AI Assistant Module](#7-wira-chatbot--ai-assistant-module)
8. [Shared Layer](#8-shared-layer)
9. [Database Architecture](#9-database-architecture)
10. [Redis State Strategy](#10-redis-state-strategy)
11. [API Endpoints Reference](#11-api-endpoints-reference)
12. [File-by-File Reference](#12-file-by-file-reference)

---

## 1. Project Overview

**WIRA** (White Force Intelligent Recruitment Assistant) is a Node.js monorepo comprising multiple microservices that power:
- **AI-driven outbound phone screening** of job candidates (Hindi/English + 10 Indian languages)
- **Payroll reminder/overdue call automation** to clients via AI voice
- **Wira AI Chatbot** — a massive Socket.IO-based assistant used by HR teams
- **Tender management**, **resume parsing**, **WhatsApp integration** (in auxiliary modules)

The system is deployed via **PM2** on a Linux server, with **Nginx** reverse-proxying at `wira-ai.com`.

---

## 2. Monorepo Structure

```
WIRA/                                  <- Root workspace (npm workspaces)
├── ecosystem.config.js                <- PM2 process definitions (3 processes)
├── package.json                       <- Root dependencies + workspace config
├── .env                               <- Shared secrets (Plivo, Sarvam, Gemini, DB keys)
├── PAYROLL_MODULE_DOCUMENTATION.md    <- Payroll module doc (historical)
│
├── shared/                            <- @wira/shared — cross-service utilities
│   ├── AI/
│   │   ├── executeAI.js               <- Multi-provider AI (Groq/Gemini/Ollama) engine
│   │   └── screening/
│   │       ├── AI.js                  <- Screening-specific AI functions
│   │       └── prompts.js             <- Screening + payroll LLM prompts (74KB)
│   ├── Utility/
│   │   ├── PlivoHandler.js            <- Plivo client wrapper (multi-account)
│   │   ├── sarvamHandler.js           <- Sarvam AI STT/TTS WebSocket wrapper
│   │   ├── textToSpeech.js            <- TTS utility
│   │   ├── embedding.js               <- Text embedding utility
│   │   └── extractText.js             <- PDF/doc text extraction
│   ├── database/
│   │   ├── WiraDB.js                  <- Full PostgreSQL DB layer (209KB!)
│   │   ├── pgDb.js                    <- pg Pool config
│   │   ├── pgFunctions.js             <- Generic CRUD helpers
│   │   └── relevantSearchDb.js        <- Vector similarity search queries
│   ├── config/
│   │   └── redisConfig.js             <- Shared ioredis singleton
│   └── prompts.js                     <- Global prompt library (339KB)
│
├── Wira-Call/                         <- Port 5001 — Call Queue & Orchestration
│   ├── index.js
│   ├── CallManager/
│   │   ├── CallManager.js             <- Root orchestrator (dispatches by call type)
│   │   ├── OutboundScreeningManager.js<- Candidate screening call lifecycle
│   │   ├── PayrollManager.js          <- Payroll call lifecycle manager
│   │   ├── PayrollQueueManager.js     <- Dedicated BullMQ worker for payroll queue
│   │   ├── QueueManager.js            <- BullMQ workers: screening-questions + call-queue
│   │   ├── RedisManager.js            <- Number allocation (Lua scripts) + question queue logic
│   │   └── InboundManager.js          <- Inbound call stub (minimal, WIP)
│   ├── database/
│   │   └── realTimeCallViewerDB.js    <- DB helpers for monitoring routes
│   ├── routes/
│   │   ├── outboundRoute.js           <- POST /make-plivo-call, /plivo-answer, /plivo-recording
│   │   ├── monitoringRoute.js         <- GET /conversation-candidates etc.
│   │   └── inboundRoute.js
│   ├── scripts/
│   │   └── emptyCallQueue.js          <- Utility: drain BullMQ queues
│   └── sockets/
│       └── socket.js
│
├── Wira-Call-Socket/                  <- Port 5002 — Raw WebSocket Audio Pipeline
│   ├── index.js
│   ├── CallManager/
│   │   ├── GeminiManager.js           <- Gemini LLM turn (streaming, tag parsing, caching)
│   │   ├── PlivoManager.js            <- Plivo audio/billing/hangup over WebSocket
│   │   ├── SarvamManager.js           <- Sarvam STT+TTS WebSocket streams + audio codec
│   │   ├── VoiceActivityManager.js    <- avr-vad v5 real-time VAD (barge-in detection)
│   │   ├── RedisManager.js            <- Session R/W + per-call cost bucket tracking
│   │   ├── DatabaseManager.js         <- DB operations during live call
│   │   └── main.js
│   ├── CallManager2/                  <- Experimental/WIP alternative manager set
│   ├── sockets/
│   │   ├── socket.js                  <- WebSocket router (upgrades to appropriate handler)
│   │   ├── outboundScreening.js       <- Screening call real-time controller (15KB)
│   │   ├── outboundPayroll.js         <- Payroll call real-time controller (16.8KB)
│   │   └── inboundCall.js             <- Inbound call stub
│   └── routes/
│       └── upgradeRoute.js
│
├── Wira-Chatbot/                      <- Port 5000 — AI Chatbot / HR Assistant
│   ├── index.js
│   ├── WiraManager/
│   │   ├── WiraManager.js             <- Master orchestrator (179KB!)
│   │   ├── WiraDatabase.js            <- DB layer for chatbot (73KB)
│   │   ├── WiraRetrieve.js            <- Data retrieval methods (44KB)
│   │   ├── WiraPerform.js             <- Action execution layer (28KB)
│   │   ├── WiraPrompts.js             <- Dynamic LLM prompt construction (57KB)
│   │   ├── WiraGemini.js              <- Gemini LLM wrapper for chatbot
│   │   ├── WiraQueue.js               <- Background job management
│   │   ├── WiraSession.js             <- Session CRUD
│   │   ├── WiraSocket.js              <- Socket.IO event handlers
│   │   ├── WiraNotification.js        <- Push notifications (FCM)
│   │   ├── WiraUtility.js             <- Parsing/formatting utilities
│   │   ├── WiraValidation.js          <- Input validators
│   │   └── WiraWhatsapp.js            <- WhatsApp messaging bridge
│   ├── routes/
│   │   └── WiraRoute.js               <- REST API routes (16KB)
│   └── sockets/
│       └── socket.js
│
├── Wira-AI/                           <- Auxiliary — PDF/resume AI processing
├── Wira-Tender/                       <- Tender management module
└── Wira-WhatsApp/                     <- Empty (WhatsApp integration stub)
```

---

## 3. Microservices & Ports

| PM2 Name | Port | Entry Point | Role |
|----------|------|-------------|------|
| `Wira_Server` | 5000 | `Wira-Chatbot/index.js` | AI Chatbot, HR management, REST APIs |
| `Wira_Call_Server` | 5001 | `Wira-Call/index.js` | Call queue orchestration, Plivo webhooks |
| `Wira_Call_Socket_Server` | 5002 | `Wira-Call-Socket/index.js` | Real-time audio pipeline over WebSocket |

**Public URL**: `https://wira-ai.com` (Nginx reverse proxy)
- `/call/*` → Port 5001
- `/call-socket/*` → Port 5002 (WS upgrade)
- `/*` → Port 5000

---

## 4. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Node.js (CommonJS) | All services |
| Web Framework | Express v5 | HTTP servers |
| Real-time | WebSocket (`ws` library) | Audio streaming |
| Queue | BullMQ v5 | Async job queues (Redis-backed) |
| Session Store | Redis (ioredis) | Transient call state + cost tracking |
| Primary DB | PostgreSQL (`pg`) | Persistent records, candidates, calls |
| LLM | Google Gemini (2.5-flash-lite) | Conversational AI turns |
| STT | Sarvam AI (WebSocket stream) | Speech-to-Text (12 Indian languages) |
| TTS | Sarvam AI (WebSocket stream) | Text-to-Speech (various speakers) |
| VAD | `avr-vad` v5 (Silero model) | Voice Activity Detection + barge-in |
| Telephony | Plivo | Outbound/Inbound phone calls |
| Process Mgr | PM2 | Service lifecycle management |
| AI Extras | Groq, Ollama | Additional LLM providers |

---

## 5. Call Screening Module — Deep Dive

### 5.1 Overview
The Call Screening module makes **AI-powered outbound phone calls** to job candidates to conduct preliminary screening interviews. Supports **11 Indian languages** with dynamic language switching mid-call.

### 5.2 Call Type
- **Type string**: `outbound-screening`
- **Plivo Phone Pool**: `["+918031903192", "+918031320770"]`
- **Max Concurrency per number**: 9 (total 18 simultaneous calls)

### 5.3 Complete Data Flow

```
API Request -> outboundRoute.js (POST /make-plivo-call)
    |
    v
CallManager.handleOutboundCall()
    | routes by type
    v
OutboundScreeningManager.validateOutboundBody()
    | parallel
    |-- handleJobDescription()      <- fetch job from DB if jobId provided
    |-- handleIntroAudio()          <- batch TTS pre-generation via Sarvam AI
    v
createBodyPayload()                 <- enrich with candidate data
    v
handleDatabaseAndRedisSave()
    |-- database.candidateFindOrCreate()    <- PostgreSQL
    |-- database.createCallWithScreening()  <- PostgreSQL (wira_call + wira_outbound_screening)
    |-- redis.set("screening:callId:{wiraCallId}", session, EX TTL)
    v
RedisManager.processJobScreeningQueue()
    |-- CASE 1: Same jobDesc already processing -> add phone to pending list
    |-- CASE 2: Questions already generated -> pushToCallQueue() directly
    |-- CASE 3: New jobDesc -> push to QueueManager.questionsQueue
    v
QueueManager (BullMQ Workers)
    |-- [screening-questions-queue] Worker (concurrency: 1)
    |       |-- AI.generateScreeningQuestions() -> Gemini LLM
    |       |-- For each pending phone -> pushToCallQueue()
    |-- [call-queue] Worker (concurrency: 30, rate: 2/1500ms)
            |-- RedisManager.allocateNumber() — Lua atomic on "numbers-config"
            |-- plivo.initiateCall(to, from, type)
            |-- Update Redis: screening:callId:{plivoCallId} = session

== PLIVO WEBHOOK ==
Plivo answers -> GET /plivo-answer
    |
    v
CallManager.handlePlivoAnswerGet()
    |-- Redis lookup -> determine routeName from session.type
    |-- Returns XML: <Record> + <Stream> -> wss://wira-ai.com/call-socket/{routeName}
    v
== WEBSOCKET AUDIO PIPELINE (Port 5002) ==
socket.js handles WS upgrade -> routes to outboundScreeningSocket()
    v
outboundScreening.js -> ScreeningCallManager
    |-- VoiceActivityManager.init()       <- avr-vad real-time VAD
    |-- SarvamManager.initSTT()           <- Sarvam streaming STT
    |-- GeminiManager.screeningTurn()     <- LLM with context caching
    |-- SarvamManager.streamTTS()         <- Sarvam TTS streaming
    |-- PlivoManager.sendAudio()          <- mulaw audio back to Plivo
    |-- RedisManager.startCostTracking()  <- Per-minute cost buckets

== CALL END ==
POST /plivo-answer (hangup webhook)
    |
    v
CallManager.handlePlivoAnswerPost()
    v
OutboundScreeningManager.flushCallEnd()
    |-- Aggregate cost buckets (Sarvam TTS + STT + Plivo + Gemini)
    |-- AI.analyzeConversation() -> post-call QA analysis
    |-- database.persistCallEnd() -> save to PostgreSQL
```

### 5.4 Key Classes & Responsibilities

| Class | File | Responsibility |
|-------|------|----------------|
| `CallManager` | `Wira-Call/CallManager/CallManager.js` | Root dispatcher — routes by call type, handles Plivo webhooks |
| `OutboundScreeningManager` | `Wira-Call/CallManager/OutboundScreeningManager.js` | Full screening call lifecycle |
| `QueueManager` | `Wira-Call/CallManager/QueueManager.js` | BullMQ: `screening-questions-queue` + `call-queue` workers |
| `RedisManager` | `Wira-Call/CallManager/RedisManager.js` | Lua-based number allocation + deduplication + question queue |
| `ScreeningCallManager` | `Wira-Call-Socket/sockets/outboundScreening.js` | Live call orchestrator (VAD -> STT -> LLM -> TTS) |
| `GeminiManager` | `Wira-Call-Socket/CallManager/GeminiManager.js` | Gemini turn (streaming, tag parsing, context caching, cost) |
| `SarvamManager` | `Wira-Call-Socket/CallManager/SarvamManager.js` | Sarvam STT+TTS WebSocket streams + audio conversion |
| `VoiceActivityManager` | `Wira-Call-Socket/CallManager/VoiceActivityManager.js` | avr-vad v5 barge-in detection, idle timers, max-call timer |
| `PlivoManager` | `Wira-Call-Socket/CallManager/PlivoManager.js` | Audio send/mark/clear over WS + per-second billing |
| `RedisManager (Socket)` | `Wira-Call-Socket/CallManager/RedisManager.js` | Session CRUD + cost bucket tracking (per 60s interval) |

### 5.5 BullMQ Queues

| Queue Name | Concurrency | Rate Limiter | Attempts | Purpose |
|-----------|------------|-------------|---------|---------|
| `screening-questions-queue` | 1 | None | 2 | AI question generation (serial, deduped by MD5 jobDesc hash) |
| `call-queue` | 30 | 2 per 1500ms | 999 (fixed 3s backoff) | Actual Plivo call initiation |

### 5.6 Number Allocation (Lua Script — Atomic)
- **Redis Key**: `numbers-config`
- **Strategy**: Prefer requested number if under capacity; else pick number with fewest active calls (load balancing)
- **Phone pool**: `["+918031903192", "+918031320770"]`
- **Per-number cap**: 9 concurrent calls
- Atomically updated via Redis `EVAL` — race-condition safe

### 5.7 Language Support (11 languages)
Hindi, English, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu

**Dynamic Language Switching**: Gemini emits `<switch_to_hindi>` etc. tags -> `GeminiManager.#processTag()` -> `SarvamManager.switchLanguage()` opens new STT socket.

### 5.8 Cost Tracking (INR)
All costs tracked per call in Redis, bucketed every 60 seconds:
- **Sarvam TTS**: Rs.3 per 1000 characters
- **Sarvam STT**: Rs.30 per 3600 seconds
- **Plivo**: Rs.0.6 per 60 seconds
- **Gemini**: Dynamic — USD rates converted to INR (live exchange rate fetched from exchangerate-api.com)

---

## 6. Payroll Call Module — Deep Dive

### 6.1 Overview
The Payroll Call module makes **automated AI voice calls** to clients for:
1. **Payment Reminder** (`outbound-payroll-reminder`): 3 days before due date
2. **Overdue Notice** (`outbound-payroll-overdue`): After due date — captures commitment date via AI

### 6.2 Isolation Design (Zero-Regression)
| Resource | Screening | Payroll | Isolated? |
|---------|-----------|---------|-----------|
| Plivo phone | `+918031903192`, `+918031320770` | `+918031703171` | YES |
| Plivo credentials | `PLIVO_AUTH_ID/TOKEN` | `PLIVO_PAYROLL_AUTH_ID/TOKEN` | YES |
| BullMQ queue | `call-queue` | `payroll-call-queue` | YES |
| Redis phone key | `numbers-config` | `payroll-numbers-config` | YES |
| Question generation | Yes (screening-questions-queue) | No (skipped entirely) | YES |
| Language | 11 languages | English only (en-IN) | YES |

### 6.3 Call Data Flow

```
POST /make-plivo-call { type: "outbound-payroll-reminder" | "outbound-payroll-overdue" }
    |
    v
CallManager.handleOutboundCall() -> handler.resolve(items)
    |
    v
PayrollManager.handlePayrollCall(items, subType)
    |
    v
PayrollManager.validatePayrollBody()
    |
    v
PayrollManager.createBodyPayload()
    |-- buildReminderText(clientName, companyName, amount, dueDate, subType)
    |       reminder: "Hello {name}, I am Wira... payment Rs.{amount} due in 3 days on {dueDate}."
    |       overdue:  "Hello {name}, I am Wira... urgent... Rs.{amount} due on {dueDate}. When can you pay?"
    |-- handleIntroAudio() -> Sarvam TTS pre-generation (en-IN, speaker="shreya")
    v
PayrollManager.handleDatabaseAndRedisSave()
    |-- database.candidateFindOrCreate()          <- PostgreSQL wira_candidates
    |-- database.createCallWithScreening()         <- PostgreSQL wira_call + wira_outbound_screening
    |-- redis.set("screening:callId:{wiraCallId}", session, EX 3600)
    |-- payrollQueueManager.pushToQueue(phone, wiraCallId, priority)
    v
PayrollQueueManager (BullMQ Worker — "payroll-call-queue", concurrency: 10)
    |-- #allocateNumber() — Lua script on "payroll-numbers-config"
    |-- plivo.initiateCall(to, fromPayrollNumber, type)
    |-- Update Redis: screening:callId:{plivoCallId} = session

== WEBSOCKET AUDIO PIPELINE (Port 5002) ==
socket.js routes /outbound-payroll-reminder or /outbound-payroll-overdue
    |
    v
outboundPayroll.js -> PayrollCallManager
    (same audio stack as Screening: VAD + Sarvam STT/TTS + Gemini)
    Gemini system prompt differs:
        reminder: "Thank client and end call with <kill>"
        overdue:  "Acknowledge commitment date, note it, thank client, end with <kill>"

== CALL END ==
PayrollManager.flushCallEnd()
    |-- Aggregate costs from Redis buckets
    |-- AI.analyzeConversation() if call completed with transcript
    |-- database.persistCallEnd() -> PostgreSQL
    |-- redis.del("screening:callId:{callUUID}")
    |-- redis.del("cost:callId:{callUUID}")
    |-- payrollQueueManager.deallocateNumber(fromPhone)
```

### 6.4 Key Classes & Responsibilities

| Class | File | Responsibility |
|-------|------|----------------|
| `PayrollManager` | `Wira-Call/CallManager/PayrollManager.js` | Full payroll call lifecycle — validate, audio gen, DB save, queue push, call-end flush |
| `PayrollQueueManager` | `Wira-Call/CallManager/PayrollQueueManager.js` | Dedicated BullMQ `payroll-call-queue` worker + Lua number allocation on `payroll-numbers-config` |
| `PayrollCallManager` | `Wira-Call-Socket/sockets/outboundPayroll.js` | Live payroll call orchestrator (VAD/STT/TTS/Gemini identical stack to screening) |

### 6.5 Payroll API Request Format

```json
POST /call/make-plivo-call
Headers: { "x-api-key": "<WIRA_API_KEY>" }

Reminder Payload:
{
  "type": "outbound-payroll-reminder",
  "to": "+919876543210",
  "clientName": "Priyanshu Garg",
  "companyName": "White Force",
  "amount": "15000",
  "dueDate": "15th January 2027"
}

Overdue Payload:
{
  "type": "outbound-payroll-overdue",
  "to": "+919876543210",
  "clientName": "Priyanshu Garg",
  "companyName": "White Force",
  "amount": "25000",
  "dueDate": "1st January 2027"
}

Expected Response:
{
  "statusCode": 200, "success": true,
  "message": "Payroll call queued successfully.",
  "data": { "wiraCallId": "uuid", "to": "+91...", "from": "+918031703171", "type": "..." }
}
```

---

## 7. Wira-Chatbot / AI Assistant Module

**Port**: 5000 | **Entry**: `Wira-Chatbot/index.js`

The largest and most complex module. Powers the HR-facing AI assistant used via web/app.

| File | Size | Purpose |
|------|------|---------|
| `WiraManager.js` | 179KB | Master orchestrator — all business logic routing |
| `WiraDatabase.js` | 73KB | Full PostgreSQL CRUD (all tables) |
| `WiraRetrieve.js` | 44KB | Data retrieval (candidates, jobs, calls, tenders) |
| `WiraPerform.js` | 28KB | Action execution (schedule calls, update records) |
| `WiraPrompts.js` | 57KB | Dynamic LLM prompt construction |
| `WiraGemini.js` | 12KB | Gemini integration for chatbot context |
| `WiraQueue.js` | 9KB | Background job management |
| `WiraSocket.js` | 3.4KB | Socket.IO event handling |
| `WiraSession.js` | 6.7KB | Session CRUD |
| `WiraUtility.js` | 13KB | Parsing/formatting utilities |
| `WiraWhatsapp.js` | 4KB | WhatsApp message dispatch |
| `WiraNotification.js` | 4.4KB | Push notifications via FCM |
| `WiraValidation.js` | 2.5KB | Input validators |

---

## 8. Shared Layer (`@wira/shared`)

### `shared/AI/screening/AI.js` (39KB)
Core AI functions used by both screening and payroll:
- `AI.generateScreeningQuestions(payload)` — Gemini: generate interview Qs from jobDesc
- `AI.screeningCall2(options)` — Main screening LLM turn (streaming, context caching)
- `AI.analyzeConversation(transcript, jobDesc)` — Post-call QA analysis
- `AI.deleteContextCache(cacheId)` — Gemini context cache cleanup

### `shared/Utility/PlivoHandler.js` (4KB)
Multi-account Plivo manager:
- `client1`, `client2` — Screening credentials
- `payrollClient` — Payroll credentials (`PLIVO_PAYROLL_AUTH_ID` / `PLIVO_PAYROLL_AUTH_TOKEN`)
- `getClient(fromNumber)` — auto-routes to correct Plivo account by phone number
- `plivo.initiateCall(to, from, type)` — make outbound call
- `plivo.hangupCall(callUUID, fromNumber)` — hangup call

### `shared/Utility/sarvamHandler.js` (9.5KB)
- `sarvam.sarvamSTTStream(options)` — WebSocket streaming STT connection
- `sarvam.sarvamTTSStream(options)` — WebSocket streaming TTS connection
- Handles WebSocket lifecycle: connect, send, flush, close, abort

### `shared/database/WiraDB.js` (209KB)
Monolithic PostgreSQL layer — ALL DB queries across all modules in one file.

---

## 9. Database Architecture

**Primary DB**: PostgreSQL

### Key Tables (Call System)

| Table | Purpose |
|-------|---------|
| `wira_candidates` | Candidate profiles (phone, email, name, data JSON) |
| `wira_call` | Master call records (callId, status, type, duration, recording) |
| `wira_outbound_screening` | Screening-specific data (questions, QA, transcript, costs, analysis) |
| `wira_outbound_screening_cost_buckets` | Per-minute cost breakdown per call |

> **Note**: Payroll calls reuse `wira_call` + `wira_outbound_screening` tables. No separate payroll tables exist. Payroll context is stored in `jobTitle` / `jobDescription` fields.

### Key WiraDatabase Methods
- `candidateFindOrCreate(phone, email, candidateId, name, candidateData)` — upsert candidate
- `createCallWithScreening(options)` — atomic insert into wira_call + wira_outbound_screening
- `persistCallEnd(options)` — save transcript, cost summary, duration, analysis result
- `saveRecordingUrl(callUUID, recordingUrl)` — store Plivo recording link
- `getOrBuildAudioBatch(textsWithLanguages, ttsSpeaker)` — batch TTS with caching

---

## 10. Redis State Strategy

| Key Pattern | TTL | Content |
|-------------|-----|---------|
| `screening:callId:{wiraCallId}` | 1hr (or 24hr if after 8PM IST) | Full call session JSON |
| `screening:callId:{plivoCallId}` | 1hr | Same session (after Plivo call initiated) |
| `cost:callId:{callUUID}` | 24hr | Cost buckets (TTS/STT/Plivo/Gemini) per 60s interval |
| `screeningQuestions:{YYYY-MM-DD}` | Until 10PM IST | Question dedup queue (keyed by jobDesc MD5 hash) |
| `numbers-config` | Permanent (no TTL) | Screening phone pool concurrency state |
| `payroll-numbers-config` | Permanent (no TTL) | Payroll phone pool concurrency state |

---

## 11. API Endpoints Reference

### Wira-Call (Port 5001)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| POST | `/make-plivo-call` | `x-api-key` | Queue single outbound call |
| POST | `/make-plivo-call-batch` | `x-api-key` | Queue batch outbound calls |
| GET | `/plivo-answer` | Plivo webhook | Returns XML for call answer |
| POST | `/plivo-answer` | Plivo webhook | Call hangup — triggers flush |
| POST | `/plivo-recording` | Plivo webhook | Stores recording URL |
| GET | `/conversation-candidates` | `x-api-key` | List candidates with filters |
| GET | `/conversation-candidates/:id/conversation-calls` | `x-api-key` | Calls for candidate |
| GET | `/conversation-calls/:callId/full` | `x-api-key` | Full call detail |
| GET | `/candidates-with-calls` | `x-api-key` | Paginated candidates + call stats |

### Wira-Call-Socket (Port 5002)

| Protocol | Path | Description |
|----------|------|-------------|
| WebSocket | `/outbound-screening?CallUUID=x` | Screening call audio pipeline |
| WebSocket | `/outbound-payroll-reminder?CallUUID=x` | Payroll reminder audio pipeline |
| WebSocket | `/outbound-payroll-overdue?CallUUID=x` | Payroll overdue audio pipeline |

---

## 12. File-by-File Reference

### Wira-Call Module

| File | Size | Key Methods / Notes |
|------|------|---------------------|
| `index.js` | 2KB | Express bootstrap, port 5001 |
| `CallManager/CallManager.js` | 15KB | `handleOutboundCall()`, `handlePlivoAnswerGet()`, `handlePlivoAnswerPost()`, `handlePlivoRecording()`, `fetchCallHandler()` |
| `CallManager/OutboundScreeningManager.js` | 23KB | `validateOutboundBody()`, `createBodyPayload()`, `handleDatabaseAndRedisSave()`, `flushCallEnd()`, `handleJobDescription()`, `handleIntroAudio()` |
| `CallManager/PayrollManager.js` | 17KB | `handlePayrollCall()`, `validatePayrollBody()`, `createBodyPayload()`, `handleDatabaseAndRedisSave()`, `flushCallEnd()`, `buildReminderText()` |
| `CallManager/PayrollQueueManager.js` | 16KB | `initWorker()`, `pushToQueue()`, `deallocateNumber()`, `#allocateNumber()` Lua, `#deallocateNumber()` Lua |
| `CallManager/QueueManager.js` | 11KB | `initWorker()`, `pushToQuestionsQueue()`, `pushToCallQueue()` — BullMQ workers |
| `CallManager/RedisManager.js` | 14KB | `allocateNumber()`, `deallocateNumber()`, `processJobScreeningQueue()` — Lua + dedup |
| `CallManager/InboundManager.js` | 1.9KB | `buildSession()` stub — WIP |
| `routes/outboundRoute.js` | 1.4KB | POST/GET routes, API key guard |
| `routes/monitoringRoute.js` | 10.7KB | Monitoring/reporting endpoints |
| `routes/inboundRoute.js` | 0.6KB | Inbound webhook routes |
| `database/realTimeCallViewerDB.js` | 12.5KB | DB helpers for monitoring endpoints |
| `scripts/emptyCallQueue.js` | 0.8KB | Drain BullMQ queues utility |

### Wira-Call-Socket Module

| File | Size | Key Methods / Notes |
|------|------|---------------------|
| `index.js` | 1.5KB | Express + raw WS server, port 5002 |
| `sockets/socket.js` | 4KB | WS upgrade router, path matching to handlers |
| `sockets/outboundScreening.js` | 15KB | `ScreeningCallManager` — live call VAD+STT+LLM+TTS controller |
| `sockets/outboundPayroll.js` | 16.8KB | `PayrollCallManager` — live payroll call pipeline |
| `sockets/inboundCall.js` | 1.6KB | Inbound call stub |
| `CallManager/GeminiManager.js` | 6.2KB | `screeningTurn()`, `abort()`, `deleteCache()`, `destroy()`, cost calculation |
| `CallManager/PlivoManager.js` | 5.9KB | `sendAudio()`, `sendMark()`, `clearAudio()`, `startBilling()`, `stopBilling()`, `hangupCall()`, `downsampleForPlivo()` |
| `CallManager/SarvamManager.js` | 22KB | `initSTT()`, `sendAudio()`, `streamTTS()`, `switchLanguage()`, `openTTSStream()`, `sendTTSChunk()`, `flushTTSStream()`, `flushSTTCost()` |
| `CallManager/VoiceActivityManager.js` | 8KB | `init()`, `process()`, `startIdleTimers()`, `clearIdleTimers()`, `startMaxCallTimer()`, `destroy()` |
| `CallManager/RedisManager.js` | 9.7KB | `getSession()`, `saveSession()`, `getIntroAudioAndInit()`, `startCostTracking()`, `stopCostTracking()`, `recordSarvamTTS()`, `recordSarvamSTT()`, `recordPlivo()`, `recordGemini()` |
| `CallManager/DatabaseManager.js` | 8.7KB | DB operations during live call |
| `routes/upgradeRoute.js` | 1.2KB | WS upgrade helper route |

---

*This report is the ground truth for the WIRA project.*
*See [CHANGES_REPORT.md](./CHANGES_REPORT.md) for a chronological log of all code changes.*
