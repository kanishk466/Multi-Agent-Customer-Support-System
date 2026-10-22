# Multi-Agent Customer Support System

Ek live chat support system jisme ek **Router Agent** customer ka message
classify karta hai, aur ek **specialist agent** (tech / billing / sales) RAG
ke zariye company docs se jawab deta hai.

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

**5 components, aur har ek optional hai** - bina kisi API key ya database ke
bhi server chalta hai (offline demo mode), taaki pehle flow samajh ho, phir
infrastructure lage.

---

## Quick Start

```bash
npm install
cp .env.example .env          # keys optional hain
npm run doctor                # har service individually check karo
npm run dev
```

Browser mein <http://localhost:3100> kholo - ek chat UI khulega jo directly
server se judta hai. Port `.env` mein `PORT` se badal sakte ho.

### 0. `npm run doctor` - pehle yeh chalao

Har external dependency ko alag alag check karta hai, credentials print
kiye bina, aur har failure par ek actionable hint deta hai:

```
[PASS] .env           GROQ_API_KEY=gsk_...  GEMINI_API_KEY=AQ.A...  ...
[PASS] Groq LLM       qwen/qwen3.8-27b -> "OK" (260ms)
[PASS] Gemini LLM     gemini-3.8-flash -> "OK" (4438ms)
[PASS] Embeddings     gemini-embedding-2 -> 768 dims (expected 768)
[PASS] Qdrant         ... "support_knowledge" = 19 points; upsert/query/delete OK
[PASS] PostgreSQL     connected to "neondb"; messages=18 tickets=2
[PASS] Redis          PING -> PONG (216ms)
```

Qdrant check sirf read nahi karta - **upsert/query/delete ka full round-trip**
bhi chalata hai, kyunki invalid point IDs aur missing payload indexes sirf
write par hi pakde jaate hain. Postgres check batata hai ki `messages` /
`tickets` mein data bhi pada hai ya nahi.

> **Model names go stale.** Groq aur Gemini apne models bina warning ke
> hata dete hain. Agar `doctor` par 404 aaye toh model name galat hai - asli
> list `GET https://api.groq.com/openai/v1/models` aur
> `https://generativelanguage.googleapis.com/v1beta/models?key=...` se
> milti hai.

### 1. LLM key lagao (sabse pehle yahi)

`.env` mein se **ek** key bharo:

| Provider | Free tier | Link |
|---|---|---|
| **Groq** (recommended) | 30 req/min, bahut fast | <https://console.groq.com/keys> |
| Google Gemini | 15 req/min | <https://aistudio.google.com/apikey> |

Dono bharoge toh Groq primary aur Gemini fallback ban jaata hai - free tiers
pe 429 (rate limit) aana normal hai, do provider hone se debugging aasan
hoti hai.

### 2. Infra (optional, Docker)

```bash
docker compose up -d
```

| Container | Port | Fallback agar band ho |
|---|---|---|
| `qdrant` | 6333 | in-memory cosine store |
| `postgres` | 5432 | in-memory array |
| `redis` | 6379 | in-memory Map |

Qdrant chalu ho toh `npm run seed` se docs index kar sakte ho.

### 3. RAG ke liye embeddings

`GEMINI_API_KEY` ho toh **Gemini embeddings** use hote hain (real semantic
search). Bina key ke ek **local hash embedding** chalta hai - poori pipeline
waise hi chalti hai, bas relevance quality low hoti hai. Yeh jaan boojh kar
hai taaki RAG zero-config pe bhi demo ho sake.

> Agar RAG "kaam nahi kar raha" lag raha ho, toh sabse pehle check karo ke
> embeddings cloud pe hain ya local hash pe.

---

## Demo Karne Ke Liye 4 Conversations

Chat UI mein yeh try karo (ya `npm run smoke`):

```
"Refund chahiye, 10 din pehle subscribe kiya tha"
   → router: billing (0.9+) → billing agent → 30 din wali policy cite karega

"Login nahi ho raha, password reset email bhi nahi aaya"
   → router: tech → tech agent → numbered steps dega

"Team plan ka pricing kya hai?"
   → router: sales → sales agent → 19 / 49 dollar wala plan

"kya policy hai iska naam kya hai aaj mausam kaisa hai"
   → confidence < 0.55 → handoff agent → ticket create hoga
```

UI mein har reply ke neeche **agent, intent, confidence, reason aur sources**
dikhte hain - yahi wo cheez hai jo multi-agent system ko debuggable banati
hai.

---

## Project Structure

```
src/
├── main.ts                     # bootstrap: Redis + PG init, phir Nest
├── app.module.ts               # ServeStatic (demo UI) + ChatModule
│
├── config/
│   ├── env.ts                  # zod-validated env, optional keys = undefined
│   ├── redis.ts                # lazy connect, warn karke chalta hai
│   ├── postgres.ts             # pool + idempotent schema (messages, tickets)
│   └── qdrant.ts               # connectivity check on boot
│
├── chat/
│   ├── chat.gateway.ts         # Socket.IO - events, validation, emit
│   └── chat.module.ts
│
├── agents/                     # ← LangGraph orchestration
│   ├── agent.types.ts          # SupportState (shared blackboard)
│   ├── prompts.ts              # router + har specialist ka system prompt
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
├── sessions/session.service.ts # Redis: kaunsa agent active hai (TTL 30 min)
├── history/history.service.ts  # Postgres: permanent chat history
└── tickets/ticket.service.ts   # handoff tickets

knowledge/                      # RAG ka source - apni files daalo
├── billing-policy.md
├── tech-troubleshooting.md
└── sales-faq.md
```

---

## Ek Message Ka Poora Safar

```
User: "login nahi ho raha"
  │
  ▼ ① chat.gateway.ts - Socket.IO event receive + validate
  │
  ▼ ② session.service.ts - Redis mein session check (naya toh banao)
  │
  ▼ ③ history.service.ts - Postgres se pichli messages lo (context)
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
  ▼ ⑤ history.service.ts - dono messages Postgres mein save
  │
  ▼ ⑥ session.service.ts - currentAgent: "tech" update (TTL refresh)
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

## Naya Specialist Agent Kaise Add Kare

Teen changes - yahi LangGraph ka poora faayda hai:

**1.** `src/agents/agent.types.ts` mein intent add karo:
```ts
export const INTENTS = ['tech', 'billing', 'sales', 'general', 'handoff'] as const;
//                                          + 'legal' yahan
```

**2.** `src/agents/prompts.ts` mein prompt likho:
```ts
export const SPECIALIST_PROMPTS: Record<Intent, string> = {
  // ...
  legal: [BASE_RULES, 'You are the LEGAL specialist.', '...'].join('\n'),
};
```

**3.** `src/agents/specialist.agent.ts` mein subclass + graph mein node:
```ts
@Injectable()
export class LegalAgent extends SpecialistAgent {
  constructor(rag: RagService) { super('legal', rag); }
}
```
Phir `graph.service.ts` mein `.addNode('legal', ...)` aur
`addConditionalEdges` ke array mein `'legal'` add kar do.

Aur haan - `knowledge/` mein ek `legal-*.md` file daal do warna us agent ke
paas search karne ko kuch nahi hoga.

---

## Scripts

```bash
npm run doctor       # har dependency ko individually verify karo
npm run dev         # nest start --watch - tsc se compile, hot reload
npm run build       # nest build -> dist/
npm start           # production: node dist/main.js
npm run typecheck   # tsc --noEmit
npm run seed        # knowledge/ ko re-index karo (boot store khaali ho tab hi khud karta hai)
npm run smoke       # running server ke against 4 intents test karo
```

### ⚠️ `npm run dev` mein `tsx` kyun nahi hai

NestJS ka DI `emitDecoratorMetadata` par depend karta hai, aur **esbuild
(isco `tsx` use karta hai) woh metadata emit nahi karta**. Result: Nest ko
constructor params ke bajaye `undefined` milte hain aur aapko yeh error
aata hai:

```
TypeError: Cannot read properties of undefined (reading 'getOrCreate')
```

Ya seedha:

```
Nest can't resolve dependencies of the RouterAgent (?).
```

`tsc` (jo `nest build` / `nest start` use karta hai) metadata sahi emit
karta hai, isliye yahan `tsx` sirf `npm run seed` mein hai - jahan DI ki
zaroorat hi nahi hai.

---

## Learning Roadmap (is codebase ke against)

| Week | Kya seekhna hai | Kahan dekhna hai |
|---|---|---|
| 1 | Socket.IO, events, connection | `chat.gateway.ts` |
| 2 | LLM API, system prompt, provider fallback | `src/llm/` |
| 3 | Embeddings, chunking, similarity search | `src/knowledge/` |
| 4 | State graph, nodes, conditional edges | `src/agents/graph.service.ts` |
| 5 | Redis TTL, Postgres schema, handoff tickets | `sessions/`, `history/`, `tickets/` |
| 6 | Edge cases, README, demo | `scripts/smoke-test.js` |

### Abhi SKIP karo (Phase 2)

Auth/JWT · rate limiting · streaming responses · re-ranking · load
balancing · Kubernetes · analytics dashboard · monitoring stack.

> Rule of thumb: agar feature ke bina demo chal jaata hai, toh woh Phase 2
> mein jaata hai.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `npm run doctor` se 404 | Model name deprecated hai - `GROQ_MODEL` / `GEMINI_MODEL` / `EMBEDDING_MODEL` badlo |
| Chat box type karta nahi, console mein `io is not defined` | socket.io client load nahi hua. `/socket.io/socket.io.js` reachable hai? (CDN hata diya gaya hai, ab server khud serve karta hai) |
| Reply hamesha "offline demo mode" bolta hai | `.env` mein LLM key khaali hai, server restart karo |
| `429` error | Groq rate limit - Gemini key daalo, fallback khud lega |
| `EADDRINUSE :::3000` | Port pe koi aur chal raha hai - `.env` mein `PORT` badlo (default 3100) |
| `Cannot read properties of undefined` ya `can't resolve dependencies` | `tsx` se chala rahe ho - `npm run dev` use karo (upar note dekho) |
| Nayi file `knowledge/` mein dali par search mein nahi aayi | Boot sirf tab ingest karta hai jab store khaali ho - `npm run seed` chalao |
| Sources hamesha `0` | Embeddings local hash pe hain (Gemini key nahi). `RAG_MIN_SCORE_LOCAL` 0.08 se neeche karke try karo |
| Sab kuch handoff ja raha hai | Router confidence `HANDOFF_THRESHOLD` (0.55) se neeche hai - message ko specific likho |
| Qdrant 403 `forbidden` | Header `api-key` chahiye, `apikey` nahi - sirf custom scripts mein hoti hai, official client sahi hai |
