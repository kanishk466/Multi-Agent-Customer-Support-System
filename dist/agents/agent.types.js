"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportState = exports.INTENTS = void 0;
exports.isIntent = isIntent;
const langgraph_1 = require("@langchain/langgraph");
/** Intents the router can choose. Adding an agent = add a string here + a node. */
exports.INTENTS = ['tech', 'billing', 'sales', 'general', 'handoff'];
function isIntent(value) {
    return exports.INTENTS.includes(value);
}
/**
 * LangGraph v1 needs an explicit reducer before a channel accepts updates -
 * `Annotation<T>({ default })` alone is not enough.
 *
 * `overwrite()` is the reducer used for every plain value here: the last
 * node to write wins. `history` is replaced wholesale rather than appended
 * because it is loaded from PostgreSQL on each turn, not accumulated.
 */
function overwrite(fallback) {
    return { reducer: (_left, right) => right, default: () => fallback };
}
/**
 * The shared blackboard. Every agent reads from it and writes its own slice.
 */
exports.SupportState = langgraph_1.Annotation.Root({
    sessionId: (0, langgraph_1.Annotation)(),
    userMessage: (0, langgraph_1.Annotation)(),
    history: (0, langgraph_1.Annotation)(overwrite([])),
    /* Router output */
    intent: (0, langgraph_1.Annotation)(overwrite('general')),
    confidence: (0, langgraph_1.Annotation)(overwrite(0)),
    routeReason: (0, langgraph_1.Annotation)(overwrite('')),
    /* Specialist output */
    agent: (0, langgraph_1.Annotation)(overwrite(null)),
    answer: (0, langgraph_1.Annotation)(overwrite('')),
    sources: (0, langgraph_1.Annotation)(overwrite([])),
    /* Escalation */
    needsHuman: (0, langgraph_1.Annotation)(overwrite(false)),
    ticketId: (0, langgraph_1.Annotation)(overwrite(null)),
});
//# sourceMappingURL=agent.types.js.map