"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphService = void 0;
const common_1 = require("@nestjs/common");
const langgraph_1 = require("@langchain/langgraph");
const env_1 = require("../config/env");
const logger_1 = require("../common/logger");
const ticket_service_1 = require("../tickets/ticket.service");
const router_agent_1 = require("./router.agent");
const specialist_agent_1 = require("./specialist.agent");
const agent_types_1 = require("./agent.types");
/** Handoff message. Static, so escalation works with or without an LLM. */
const HANDOFF_MESSAGE = 'Main aapko ek human specialist ke paas forward kar raha hoon. ' +
    'Aapke message ka gist save kar diya gaya hai - koi dobara detail dohrane nahi padegi.';
/**
 * LangGraph = the flowchart.
 *
 *      START
 *        │
 *        ▼
 *     router ──"billing"──► billing ──► END
 *        │
 *        ├──"tech"────────► tech ─────► END
 *        │
 *        └──low confidence► handoff ──► END
 *
 * Nodes are plain async functions that read shared state and return a
 * partial update. A conditional edge is just an if-else that returns the
 * next node name.
 */
let GraphService = class GraphService {
    router;
    tickets;
    graph;
    constructor(router, tech, billing, sales, general, tickets) {
        this.router = router;
        this.tickets = tickets;
        const specialists = {
            tech,
            billing,
            sales,
            general,
        };
        this.graph = new langgraph_1.StateGraph(agent_types_1.SupportState)
            .addNode('router', (state) => this.runRouter(state))
            .addNode('tech', (state) => this.runSpecialist(specialists.tech, state))
            .addNode('billing', (state) => this.runSpecialist(specialists.billing, state))
            .addNode('sales', (state) => this.runSpecialist(specialists.sales, state))
            .addNode('general', (state) => this.runSpecialist(specialists.general, state))
            .addNode('handoff', (state) => this.runHandoff(state))
            .addEdge(langgraph_1.START, 'router')
            .addConditionalEdges('router', routeAfterRouter, [
            'tech',
            'billing',
            'sales',
            'general',
            'handoff',
        ])
            .addEdge('tech', langgraph_1.END)
            .addEdge('billing', langgraph_1.END)
            .addEdge('sales', langgraph_1.END)
            .addEdge('general', langgraph_1.END)
            .addEdge('handoff', langgraph_1.END)
            // compile() returns a deeply generic type; the structural alias above
            // is what the rest of the app actually needs from it.
            .compile({ checkpointer: new langgraph_1.MemorySaver() });
    }
    /** Runs one message through the whole graph and returns the final state. */
    async handle(input) {
        const result = await this.graph.invoke({
            sessionId: input.sessionId,
            userMessage: input.userMessage,
            history: input.history,
        }, 
        // thread_id ties the checkpointer to one conversation.
        { configurable: { thread_id: input.sessionId } });
        logger_1.logger.info(`graph done intent=${result.intent} confidence=${result.confidence.toFixed(2)} ` +
            `agent=${result.agent ?? '-'} handoff=${result.needsHuman}`);
        return result;
    }
    /* ─────────────────────────── Nodes ─────────────────────────── */
    async runRouter(state) {
        const decision = await this.router.route(state.userMessage, toTranscript(state.history));
        logger_1.logger.info(`router -> ${decision.intent} (${decision.confidence}) - ${decision.reason}`);
        return {
            intent: decision.intent,
            confidence: decision.confidence,
            routeReason: decision.reason,
        };
    }
    async runSpecialist(agent, state) {
        const result = await agent.handle({
            userMessage: state.userMessage,
            history: toTranscript(state.history),
        });
        logger_1.logger.info(`${agent.name} answered with ${result.sources.length} sources`);
        return { agent: agent.name, answer: result.answer, sources: result.sources };
    }
    async runHandoff(state) {
        const ticket = await this.tickets.markEscalated(state.sessionId, `Router: ${state.routeReason} (confidence ${state.confidence.toFixed(2)}) | ${state.userMessage}`);
        return {
            agent: 'handoff-agent',
            answer: HANDOFF_MESSAGE,
            sources: [],
            needsHuman: true,
            ticketId: ticket.id,
        };
    }
};
exports.GraphService = GraphService;
exports.GraphService = GraphService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [router_agent_1.RouterAgent,
        specialist_agent_1.TechAgent,
        specialist_agent_1.BillingAgent,
        specialist_agent_1.SalesAgent,
        specialist_agent_1.GeneralAgent,
        ticket_service_1.TicketService])
], GraphService);
/**
 * The state's history may contain system messages. Those belong to each
 * specialist's own prompt, so they are stripped before the transcript is
 * handed to the router or an agent.
 */
function toTranscript(history) {
    return history
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content }));
}
/**
 * The conditional edge. This single function IS the routing concept:
 * read shared state, pick the next node.
 */
function routeAfterRouter(state) {
    if (state.needsHuman)
        return 'handoff';
    if (state.intent === 'handoff')
        return 'handoff';
    if (state.confidence < env_1.env.HANDOFF_THRESHOLD)
        return 'handoff';
    return state.intent;
}
//# sourceMappingURL=graph.service.js.map