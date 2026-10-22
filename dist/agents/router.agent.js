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
exports.RouterAgent = void 0;
exports.offlineClassify = offlineClassify;
const common_1 = require("@nestjs/common");
const llm_service_1 = require("../llm/llm.service");
const logger_1 = require("../common/logger");
const agent_types_1 = require("./agent.types");
const prompts_1 = require("./prompts");
/**
 * Offline classification, used only when no LLM key is configured.
 *
 * This is deliberately a blunt keyword matcher. It exists so a zero-config
 * clone still demonstrates *routing* rather than sending every message to
 * handoff - but with a real LLM it is never consulted, and a keyword
 * matcher is exactly the thing the LLM replaces.
 */
const KEYWORDS = {
    tech: ['login', 'log in', 'password', 'reset', 'error', 'bug', 'slow', 'api', 'export', '2fa', 'cache', 'crash', 'loading', 'fail'],
    billing: ['refund', 'invoice', 'payment', 'charge', 'billing', 'discount', 'gst', 'vat', 'tax', 'prorate', 'receipt'],
    sales: ['pricing', 'price', 'plan', 'trial', 'demo', 'migrate', 'migration', 'security', 'soc 2', 'gdpr', 'enterprise'],
    general: ['hi', 'hello', 'hey', 'thanks', 'thank you', 'namaste', 'ok'],
};
const HANDOFF_KEYWORDS = ['human', 'person', 'real person', 'agent se baat', 'call me', 'speak to someone'];
let RouterAgent = class RouterAgent {
    llm;
    constructor(llm) {
        this.llm = llm;
    }
    async route(userMessage, history = []) {
        if (this.llm.mode === 'offline') {
            return offlineClassify(userMessage);
        }
        try {
            const transcript = history
                .map((entry) => `${entry.role}: ${entry.content}`)
                .join('\n')
                .slice(-600);
            const { data } = await this.llm.chatJson([
                { role: 'system', content: prompts_1.ROUTER_PROMPT },
                ...(transcript
                    ? [{ role: 'user', content: `Conversation so far:\n${transcript}` }]
                    : []),
                { role: 'user', content: `Customer message:\n${userMessage}` },
            ]);
            return normalise(data);
        }
        catch (err) {
            // Routing must never be the thing that breaks the chat.
            logger_1.logger.warn(`Router failed, falling back to keyword routing: ${err.message}`);
            return offlineClassify(userMessage);
        }
    }
};
exports.RouterAgent = RouterAgent;
exports.RouterAgent = RouterAgent = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [llm_service_1.LlmService])
], RouterAgent);
/** Clamps and validates whatever the LLM produced into a safe decision. */
function normalise(raw) {
    const intent = agent_types_1.INTENTS.includes(raw.intent) ? raw.intent : 'general';
    const confidence = typeof raw.confidence === 'number' ? Math.min(Math.max(raw.confidence, 0), 1) : 0;
    return {
        intent,
        confidence,
        reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : 'no reason given',
    };
}
function offlineClassify(message) {
    const text = message.toLowerCase();
    if (HANDOFF_KEYWORDS.some((keyword) => text.includes(keyword))) {
        return { intent: 'handoff', confidence: 0.95, reason: 'offline: asked for a human' };
    }
    // Score every intent by how many of its keywords appear, then pick the
    // best. Ties go to tech/billing/sales over general.
    const scores = Object.keys(KEYWORDS).map((intent) => ({
        intent,
        score: KEYWORDS[intent].filter((keyword) => text.includes(keyword)).length,
    }));
    const best = scores.sort((a, b) => b.score - a.score)[0];
    if (best.score === 0) {
        return { intent: 'general', confidence: 0.45, reason: 'offline: no keyword matched' };
    }
    return {
        intent: best.intent,
        confidence: best.intent === 'general' ? 0.6 : 0.85,
        reason: `offline: matched ${best.score} ${best.intent} keyword(s)`,
    };
}
//# sourceMappingURL=router.agent.js.map