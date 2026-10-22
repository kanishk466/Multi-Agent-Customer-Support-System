# Multi-Agent Customer Support System

A live chat support system where a **Router Agent** classifies the customer's message, and a **specialist agent** (tech / billing / sales) answers using RAG from company docs.

```
  👤 User  ──Socket.IO──►  NestJS Server
                              │
                              ├─ WebSocket Gateway
                              │
                              ├─ LangGraph
                              │    └─ Router ──► Tech Agent
                              │                 Billing Agent
                              │                 Sales Agent
                              │                 Handoff (ticket)
                              │
                              └─ RAG Service
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
                  Redis          PostgreSQL        Qdrant
               (session)        (history)       (knowledge)
                                     +
                              Groq / Gemini API (free tier)
```

**5 components, each one optional** — the server runs even without any API key or database (offline demo mode), so you can understand the flow first, then add infrastructure later.

---

## Quick Start

```bash
npm install
cp .env.example .env          # keys are optional
npm run doctor                # check each service individually
npm run dev
```

Open <http://localhost:3100> in your browser — a chat UI will open that connects directly to the server. You can change the port via `PORT` in `.env`.

### 0. `npm run doctor` — run this first

Checks every external dependency individually, without printing credentials, and gives an actionable hint for each failure:

```
[PASS] .env           GROQ_API_KEY=gsk_...  GEMINI_API_KEY=AQ.A...  ...
[PASS] Groq LLM       qwen/qwen3.8-27b -> "OK" (260ms)
[PASS] Gemini LLM     gemini-3.8-flash -> "OK" (4438ms)
[PASS] Embeddings     gemini-embedding-2 -> 768 dims (expected 768)
[PASS] Qdrant         ... "support_knowledge" = 19 points; upsert/query/delete OK
[PASS] PostgreSQL     connected to "neondb"; messages=18 tickets=2
[PASS] Redis          PING -> PONG (216ms)
```

The Qdrant check doesn't just read — it runs a **full upsert/query/delete round-trip**, because invalid point IDs and missing payload indexes are only caught on writes. The Postgres check tells you whether `messages` / `tickets` actually contain data or not.

> **Model names go stale.** Groq and Gemini remove models without warning. If `doctor` returns a 404, the model name is wrong — the actual list is available at `GET https://api.groq.com/openai/v1/models` and `https://generativelanguage.googleapis.com/v1beta/models?key=...`.

### 1. Add an LLM key (do this first)

Fill in **one** key in `.env`:

| Provider | Free tier | Link |
|---|---|---|
| **Groq** (recommended) | 30 req/min, very fast | <https://console.groq.com/keys> |
| Google Gemini | 15 req/min | <https://aistudio.google.com/apikey> |

If you fill in both, Groq becomes the primary and Gemini the fallback — on free tiers, 429 (rate limit) errors are normal, and having two providers makes debugging easier.

### 2. Infra (optional, Docker)

```bash
docker compose up -d
```

| Container | Port | Fallback when down |
|---|---|---|
| `qdrant` | 6333 | in-memory cosine store |
| `postgres` | 5432 | in-memory array |
| `redis` | 6379 | in-memory Map |

When Qdrant is running, you can index docs with `npm run seed`.

### 3. Embeddings for RAG

If `GEMINI_API_KEY` is set, **Gemini embeddings** are used (real semantic search). Without a key, a **local hash embedding** runs instead — the entire pipeline works the same way, but relevance quality is low. This is intentional so that RAG can demo with zero config.

> If RAG "doesn't seem to be working," the first thing to check is whether embeddings are running on the cloud or on the local hash.

---

## 4 Demo Conversations

Try these in the chat UI (or run `npm run smoke`):

```
"I need a refund, I subscribed 10 days ago"
   → router: billing (0.9+) → billing agent → will cite the 30-day policy

"Can't log in, password reset email never arrived"
   → router: tech → tech agent → will provide numbered steps

"What's the pricing for the team plan?"
   → router: sales → sales agent → $19 / $49 plan details

"what is the policy what is its name how is the weather today"
   → confidence < 0.55 → handoff agent → a ticket will be created
```

Below every reply in the UI, **agent, intent, confidence, reason, and sources** are displayed — this is exactly what makes a multi-agent system debuggable.

---

## Project Structure

```
src/
├── main.ts                     # bootstrap: Redis + PG init, then Nest
├── app.module.ts               # ServeStatic (demo UI) + ChatModule
│
├── config/
│   ├── env.ts                  # zod-validated env, optional keys = undefined
│   ├── redis.ts                # lazy connect, warns and continues
│   ├── postgres.ts             # pool + idempotent schema (messages, tickets)
│   └── qdrant.ts               # connectivity check on boot
│
├── chat/
│   ├── chat.gateway.ts         # Socket.IO - events, validation, emit
│   └── chat.module.ts
│
├── agents/                     # ← LangGraph orchestration
│   ├── agent.types.ts          # SupportState (shared blackboard)
│   ├── prompts.ts              # router + each specialist's system prompt
│   ├── router.agent.ts         # 1 LLM call → { intent, confidence, reason }
│   ├── specialist.agent.ts     # shared impl + Tech/Billing/Sales/General
│   ├── graph.service.ts        # StateGraph: nodes + conditional edges
│   └── agents.module.ts
│
├── knowledge/                  # ← RAG
│   ├── embeddings.service.ts   # Gemini cloud / local hash fallback
│   ├── vector.service.ts       # Qdrant / in-memory cosine
│   ├── rag.service.ts          # ingest + retrieve + grounded answer
│   └── knowledge.module.ts
│
├── llm/
│   ├── llm.service.ts          # provider chain (Groq → Gemini) + JSON repair
│   ├── groq.provider.ts
│   ├── gemini.provider.ts
│   └── llm.types.ts
│
├── sessions/session.service.ts # Redis: which agent is active (TTL 30 min)
├── history/history.service.ts  # Postgres: permanent chat history
└── tickets/ticket.service.ts   # handoff tickets

knowledge/                      # RAG source — add your own files here
├── billing-policy.md
├── tech-troubleshooting.md
└── sales-faq.md
```

---

## The Full Journey of a Single Message

```
User: "can't log in"
  │
  ▼ ① chat.gateway.ts - Socket.IO event received + validated
  │
  ▼ ② session.service.ts - check session in Redis (create if new)
  │
  ▼ ③ history.service.ts - fetch previous messages from Postgres (context)
  │
  ▼ ④ graph.service.ts - LangGraph invoke (thread_id = sessionId)
  │     │
  │     ▼ router node:  LLM call → { intent: "tech", confidence: 0.94 }
  │     │
  │     ▼ conditional edge: confidence ≥ 0.55? → "tech" node
  │     │
  │     ▼ tech agent: RAG retrieve(category: "tech")
  │     │             Qdrant → 4 similar chunks
  │     │             LLM call → grounded answer + sources
  │     │
  │     ▼ END
  │
  ▼ ⑤ history.service.ts - save both messages to Postgres
  │
  ▼ ⑥ session.service.ts - currentAgent: "tech" updated (TTL refreshed)
  │
  ▼ ⑦ chat.gateway.ts - client.emit('chat:reply', {...})
  │
User: "Try clearing your browser cache first..."
```

---

## WebSocket Events

| Direction | Event | Payload |
|---|---|---|
| client → server | `chat:send` | `{ content, sessionId? }` |
| client → server | `chat:reset` | `{ sessionId? }` |
| client → server | `chat:history` | `{ sessionId? }` |
| client → server | `knowledge:reindex` | `{}` |
| server → client | `session` | `{ sessionId, modes }` |
| server → client | `agent:typing` | `{ typing: boolean }` |
| server → client | `chat:reply` | `{ content, agent, intent, confidence, sources, needsHuman, ticketId }` |
| server → client | `error` | `{ message }` |

---

## How to Add a New Specialist Agent

Three changes — this is the entire advantage of LangGraph:

**1.** Add the intent in `src/agents/agent.types.ts`:
```ts
export const INTENTS = ['tech', 'billing', 'sales', 'general', 'handoff'] as const;
//                                          + 'legal' here
```

**2.** Write the prompt in `src/agents/prompts.ts`:
```ts
export const SPECIALIST_PROMPTS: Record<Intent, string> = {
  // ...
  legal: [BASE_RULES, 'You are the LEGAL specialist.', '...'].join('\n'),
};
```

**3.** Subclass in `src/agents/specialist.agent.ts` + add the node to the graph:
```ts
@Injectable()
export class LegalAgent extends SpecialistAgent {
  constructor(rag: RagService) { super('legal', rag); }
}
```
Then add `.addNode('legal', ...)` in `graph.service.ts` and add `'legal'` to the `addConditionalEdges` array.

And yes — add a `legal-*.md` file in `knowledge/`, otherwise that agent will have nothing to search.

---

## Scripts

```bash
npm run doctor       # verify each dependency individually
npm run dev          # nest start --watch - compiles with tsc, hot reload
npm run build        # nest build -> dist/
npm start            # production: node dist/main.js
npm run typecheck    # tsc --noEmit
npm run seed         # re-index knowledge/ (auto-runs on boot only if store is empty)
npm run smoke        # test 4 intents against a running server
```

### ⚠️ Why `tsx` is not used in `npm run dev`

NestJS DI depends on `emitDecoratorMetadata`, and **esbuild (which `tsx` uses internally) does not emit that metadata**. Result: Nest receives `undefined` instead of constructor params, and you get this error:

```
TypeError: Cannot read properties of undefined (reading 'getOrCreate')
```

Or directly:

```
Nest can't resolve dependencies of the RouterAgent (?).
```

`tsc` (which `nest build` / `nest start` uses) emits metadata correctly, so `tsx` is only used in `npm run seed` — where DI is not needed at all.

---

## Learning Roadmap (against this codebase)

| Week | What to learn | Where to look |
|---|---|---|
| 1 | Socket.IO, events, connections | `chat.gateway.ts` |
| 2 | LLM API, system prompts, provider fallback | `src/llm/` |
| 3 | Embeddings, chunking, similarity search | `src/knowledge/` |
| 4 | State graph, nodes, conditional edges | `src/agents/graph.service.ts` |
| 5 | Redis TTL, Postgres schema, handoff tickets | `sessions/`, `history/`, `tickets/` |
| 6 | Edge cases, README, demo | `scripts/smoke-test.js` |

### SKIP for now (Phase 2)

Auth/JWT · rate limiting · streaming responses · re-ranking · load balancing · Kubernetes · analytics dashboard · monitoring stack.

> Rule of thumb: if the demo works without a feature, it goes into Phase 2.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| 404 from `npm run doctor` | Model name is deprecated — change `GROQ_MODEL` / `GEMINI_MODEL` / `EMBEDDING_MODEL` |
| Chat box doesn't type, console shows `io is not defined` | socket.io client didn't load. Is `/socket.io/socket.io.js` reachable? (CDN has been removed, the server now serves it itself) |
| Reply always says "offline demo mode" | LLM key is empty in `.env`, restart the server |
| `429` error | Groq rate limit — add a Gemini key, fallback will kick in automatically |
| `EADDRINUSE :::3000` | Something else is running on that port — change `PORT` in `.env` (default 3100) |
| `Cannot read properties of undefined` or `can't resolve dependencies` | You're running with `tsx` — use `npm run dev` instead (see note above) |
| New file added to `knowledge/` but not showing up in search | Boot only ingests when the store is empty — run `npm run seed` |
| Sources always `0` | Embeddings are on local hash (no Gemini key). Try lowering `RAG_MIN_SCORE_LOCAL` below 0.08 |
| Everything goes to handoff | Router confidence is below `HANDOFF_THRESHOLD` (0.55) — write a more specific message |
| Qdrant 403 `forbidden` | The header must be `api-key`, not `apikey` — this only happens in custom scripts; the official client handles it correctly |
