"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroqProvider = void 0;
const env_1 = require("../config/env");
const logger_1 = require("../common/logger");
const llm_types_1 = require("./llm.types");
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
/**
 * Groq chat provider (OpenAI-compatible REST, free tier, very fast).
 * This is the recommended provider while learning.
 */
class GroqProvider {
    name = 'groq';
    available() {
        return env_1.env.hasGroq;
    }
    async chat(messages, opts) {
        const model = env_1.env.GROQ_MODEL;
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env_1.env.GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model,
                temperature: 0.2,
                max_tokens: 1024,
                // Structured output for the router - forces valid JSON back.
                ...(opts?.json ? { response_format: { type: 'json_object' } } : {}),
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
            }),
            signal: (0, llm_types_1.callSignal)(opts?.signal, env_1.env.LLM_TIMEOUT_MS),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            const error = new Error(`Groq ${response.status}: ${detail.slice(0, 200)}`);
            error.status = response.status;
            throw error;
        }
        const json = (await response.json());
        const text = (json.choices?.[0]?.message?.content ?? '').trim();
        const prompt = messages.map((m) => m.content).join('\n');
        const usage = json.usage?.prompt_tokens
            ? {
                inputTokens: json.usage.prompt_tokens ?? 0,
                outputTokens: json.usage.completion_tokens ?? 0,
            }
            : (0, llm_types_1.fallbackUsage)(prompt, text);
        logger_1.logger.debug(`groq ok (${usage.inputTokens}in/${usage.outputTokens}out)`);
        return { text, provider: this.name, model, usage };
    }
}
exports.GroqProvider = GroqProvider;
//# sourceMappingURL=groq.provider.js.map