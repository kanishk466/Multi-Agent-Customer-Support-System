"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentsModule = void 0;
const common_1 = require("@nestjs/common");
const knowledge_module_1 = require("../knowledge/knowledge.module");
const llm_module_1 = require("../llm/llm.module");
const ticket_service_1 = require("../tickets/ticket.service");
const router_agent_1 = require("./router.agent");
const specialist_agent_1 = require("./specialist.agent");
const graph_service_1 = require("./graph.service");
/**
 * The orchestration layer. LangGraph does not need NestJS, but wrapping the
 * graph in an injectable keeps the WebSocket gateway thin and testable.
 *
 * LlmModule is imported directly because RouterAgent injects LlmService -
 * KnowledgeModule exports RagService, not the LLM.
 */
let AgentsModule = class AgentsModule {
};
exports.AgentsModule = AgentsModule;
exports.AgentsModule = AgentsModule = __decorate([
    (0, common_1.Module)({
        imports: [llm_module_1.LlmModule, knowledge_module_1.KnowledgeModule],
        providers: [
            router_agent_1.RouterAgent,
            specialist_agent_1.TechAgent,
            specialist_agent_1.BillingAgent,
            specialist_agent_1.SalesAgent,
            specialist_agent_1.GeneralAgent,
            ticket_service_1.TicketService,
            graph_service_1.GraphService,
        ],
        exports: [graph_service_1.GraphService, ticket_service_1.TicketService],
    })
], AgentsModule);
//# sourceMappingURL=agents.module.js.map