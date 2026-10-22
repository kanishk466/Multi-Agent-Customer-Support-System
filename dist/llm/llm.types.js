"use strict";
/** Minimal chat-completion contract shared by every provider. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokens = estimateTokens;
exports.fallbackUsage = fallbackUsage;
exports.callSignal = callSignal;
/** Cheap token estimate when the provider does not report usage. */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
function fallbackUsage(prompt, completion) {
    return {
        inputTokens: estimateTokens(prompt),
        outputTokens: estimateTokens(completion),
    };
}
/** Combines an upstream abort signal with our own timeout. */
function callSignal(outer, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return outer ? AbortSignal.any([outer, timeout]) : timeout;
}
//# sourceMappingURL=llm.types.js.map