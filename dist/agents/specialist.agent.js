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
exports.GeneralAgent = exports.SalesAgent = exports.BillingAgent = exports.TechAgent = exports.SpecialistAgent = void 0;
const common_1 = require("@nestjs/common");
const rag_service_1 = require("../knowledge/rag.service");
const prompts_1 = require("./prompts");
/**
 * Specialist Agent - the "kaam karta hai" step.
 *
 * One shared implementation, three thin subclasses. The only difference
 * between a tech, billing and sales agent is the system prompt and which
 * slice of the knowledge base it is allowed to search.
 *
 * Adding a new specialist is three lines:
 *   1. add the intent to INTENTS
 *   2. add a prompt to SPECIALIST_PROMPTS
 *   3. subclass here and register it in AgentsModule
 */
let SpecialistAgent = class SpecialistAgent {
    intent;
    rag;
    constructor(intent, rag) {
        this.intent = intent;
        this.rag = rag;
    }
    get name() {
        return `${this.intent}-agent`;
    }
    /** RAG over this agent's category, then an LLM answer grounded in the hits. */
    async handle(params) {
        return this.rag.answer({
            query: params.userMessage,
            history: params.history,
            // Narrowing the search to one category stops the billing agent from
            // answering with a sales policy that happens to be similar.
            category: this.intent === 'general' ? undefined : this.intent,
            systemPrompt: prompts_1.SPECIALIST_PROMPTS[this.intent],
        });
    }
};
exports.SpecialistAgent = SpecialistAgent;
exports.SpecialistAgent = SpecialistAgent = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [String, rag_service_1.RagService])
], SpecialistAgent);
let TechAgent = class TechAgent extends SpecialistAgent {
    constructor(rag) {
        super('tech', rag);
    }
};
exports.TechAgent = TechAgent;
exports.TechAgent = TechAgent = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [rag_service_1.RagService])
], TechAgent);
let BillingAgent = class BillingAgent extends SpecialistAgent {
    constructor(rag) {
        super('billing', rag);
    }
};
exports.BillingAgent = BillingAgent;
exports.BillingAgent = BillingAgent = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [rag_service_1.RagService])
], BillingAgent);
let SalesAgent = class SalesAgent extends SpecialistAgent {
    constructor(rag) {
        super('sales', rag);
    }
};
exports.SalesAgent = SalesAgent;
exports.SalesAgent = SalesAgent = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [rag_service_1.RagService])
], SalesAgent);
let GeneralAgent = class GeneralAgent extends SpecialistAgent {
    constructor(rag) {
        super('general', rag);
    }
};
exports.GeneralAgent = GeneralAgent;
exports.GeneralAgent = GeneralAgent = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [rag_service_1.RagService])
], GeneralAgent);
//# sourceMappingURL=specialist.agent.js.map