"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
const env_1 = require("../config/env");
const logger_1 = require("../common/logger");
const llm_types_1 = require("./llm.types");
const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
/**
 * Gemini chat provider (free tier via AI Studio).
 * Used as fallback when Groq rate-limits (429) or errors.
 */
class GeminiProvider {
    name = 'gemini';
    available() {
        return env_1.env.hasGemini;
    }
    async chat(messages, opts) {
        const model = env_1.env.GEMINI_MODEL;
        // Gemini has no separate "system" role - the first system message becomes
        // the systemInstruction, the rest become a user/model turn list.
        const systemMessages = messages.filter((m) => m.role === 'system');
        const turns = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const response = await fetch(`${ENDPOINT(model)}?key=${env_1.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...(systemMessages.length
                    ? { systemInstruction: { parts: [{ text: systemMessages.map((m) => m.content).join('\n\n') }] } }
                    : {}),
                contents: turns,
                generationConfig: {
                    temperature: 0.2,
                    // Gemini 3.x spends output tokens on thinking first, so a tight
                    // budget yields an empty string. This is the fallback path, so
                    // give it room rather than trading quality for a few tokens.
                    maxOutputTokens: 4096,
                    ...(opts?.json ? { responseMimeType: 'application/json' } : {}),
                },
            }),
            signal: (0, llm_types_1.callSignal)(opts?.signal, env_1.env.LLM_TIMEOUT_MS),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            const error = new Error(`Gemini ${response.status}: ${detail.slice(0, 200)}`);
            error.status = response.status;
            throw error;
        }
        const json = (await response.json());
        const text = (json.candidates?.[0]?.content?.parts ?? [])
            .map((part) => part.text ?? '')
            .join('')
            .trim();
        const prompt = messages.map((m) => m.content).join('\n');
        const usage = json.usageMetadata?.promptTokenCount
            ? {
                inputTokens: json.usageMetadata.promptTokenCount ?? 0,
                outputTokens: json.usageMetadata.candidatesTokenCount ?? 0,
            }
            : (0, llm_types_1.fallbackUsage)(prompt, text);
        logger_1.logger.debug(`gemini ok (${usage.inputTokens}in/${usage.outputTokens}out)`);
        return { text, provider: this.name, model, usage };
    }
}
exports.GeminiProvider = GeminiProvider;
//# sourceMappingURL=gemini.provider.js.map