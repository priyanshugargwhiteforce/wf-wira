# Project Architectural & Coding Guidelines

## 1. Zero Regression & Code Preservation Rule
- NEVER alter or break existing working files, database schemas, routes, or manager methods.
- All new capabilities must be additive, modular, and fully backward-compatible.

## 2. Code Formatting & Syntax Conventions
- CommonJS module format (`require` / `module.exports`).
- Object-Oriented ES6 Class design pattern for Managers (`*Manager.js`).
- New-line brace formatting `{` for classes, functions, and multi-line configuration blocks.
- Private class methods/fields using native ES `#methodName()` syntax.
- Parameter passing via dependency injection in class constructors (`redis`, `database`, `phonePool`, etc.).

## 3. Standardized API & Function Return Format
All manager methods and route handlers MUST return structured JSON objects:
```javascript
{
    statusCode: 200, // 200, 400, 404, 500, 502, 503
    success: true,   // true or false
    message: "Descriptive message string",
    data: payloadData || null
}
```

## 4. Error Handling & Logging
- Every async function MUST be wrapped in a `try...catch` block.
- Standardized emoji-prefixed console logging:
  - `🗣️ [VAD]`: Voice Activity Detection events
  - `🎙️ [AI]`: LLM / Gemini turns
  - `💰 [Plivo]`: Cost & billing updates
  - `❌ [Error]`: Errors and exceptions
  - `✅ [Success]`: Successful step completions
  - `▶️ [Stream]`: Telephony media stream events

## 5. Architectural State Strategy (Redis + PostgreSQL)
- **Transient State** (live call sessions, active socket buffers, cost accumulators, phone concurrency): Stored in **Redis**.
- **Persistent State** (historical call logs, transcripts, screening QA pairs, financial cost summaries, candidate profiles): Stored in **PostgreSQL** via `WiraDatabase`.
