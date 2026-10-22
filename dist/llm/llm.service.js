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
exports.LlmService = void 0;
exports.parseJson = parseJson;
const common_1 = require("@nestjs/common");
const env_1 = require("../config/env");
const logger_1 = require("../common/logger");
const groq_provider_1 = require("./groq.provider");
const gemini_provider_1 = require("./gemini.provider");
const llm_types_1 = require("./llm.types");
/** Answer returned when no LLM key is configured - keeps the demo alive. */
const OFFLINE_REPLY = '(offline demo mode) Main abhi LLM ke bina chal raha hoon. ' +
    'GROQ_API_KEY ya GEMINI_API_KEY set karte hi real jawab aayega.';
/**
 * The "brain". Tries Groq first (fast, free), falls back to Gemini when
 * Groq rate-limits or errors - free tiers throttle aggressively, so a
 * second provider saves a lot of debugging frustration.
 */
let LlmService = class LlmService {
    providers;
    constructor() {
        // Order matters: primary first.
        this.providers = [new groq_provider_1.GroqProvider(), new gemini_provider_1.GeminiProvider()];
    }
    get mode() {
        return env_1.env.useLlm ? 'cloud' : 'offline';
    }
    availableProviders() {
        return this.providers.filter((p) => p.available()).map((p) => p.name);
    }
    /** Plain chat completion. Tries each provider in order. */
    async chat(messages, opts) {
        if (!env_1.env.useLlm) {
            const prompt = messages.map((m) => m.content).join('\n');
            return {
                text: OFFLINE_REPLY,
                provider: 'offline',
                model: 'none',
                usage: { inputTokens: (0, llm_types_1.estimateTokens)(prompt), outputTokens: (0, llm_types_1.estimateTokens)(OFFLINE_REPLY) },
            };
        }
        const errors = [];
        for (const provider of this.providers) {
            if (!provider.available())
                continue;
            try {
                const result = await provider.chat(messages, opts);
                // A thinking model that exhausts its token budget returns 200 with
                // an empty string. Returning that would silently produce an empty
                // chat reply, so treat it like a failure and try the next provider.
                if (result.text.trim())
                    return result;
                throw new Error('empty completion');
            }
            catch (err) {
                const message = err.message;
                errors.push(`${provider.name}: ${message}`);
                logger_1.logger.warn(`LLM ${provider.name} failed, trying next provider - ${message}`);
            }
        }
        throw new Error(`All LLM providers failed - ${errors.join(' | ')}`);
    }
    /**
     * Chat completion that must return JSON. Asks for JSON, then repairs the
     * usual failure modes (markdown fences, trailing text) before parsing.
     */
    async chatJson(messages, opts) {
        const result = await this.chat(messages, { ...opts, json: true });
        return { data: parseJson(result.text), result };
    }
};
exports.LlmService = LlmService;
exports.LlmService = LlmService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], LlmService);
/**
 * Parses JSON out of an LLM reply, tolerating ```json fences and leading
 * prose. Falls back to `{}` so a malformed reply never crashes the graph.
 */
function parseJson(text) {
    const stripped = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
    try {
        return JSON.parse(stripped);
    }
    catch {
        // Fall back to the first {...} block in the reply.
        const match = stripped.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            }
            catch {
                /* fall through */
            }
        }
        logger_1.logger.warn(`Could not parse JSON from LLM reply: ${text.slice(0, 120)}`);
        return {};
    }
}
//# sourceMappingURL=llm.service.js.map