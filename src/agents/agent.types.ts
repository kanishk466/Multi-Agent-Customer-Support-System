import { Annotation } from '@langchain/langgraph';
import type { LlmMessage } from '../llm/llm.types';
import type { RetrievedContext } from '../knowledge/rag.service';

/** Intents the router can choose. Adding an agent = add a string here + a node. */
export const INTENTS = ['tech', 'billing', 'sales', 'general', 'handoff'] as const;
export type Intent = (typeof INTENTS)[number];

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

export interface RouteDecision {
  intent: Intent;
  confidence: number;
  reason: string;
}

/**
 * LangGraph v1 needs an explicit reducer before a channel accepts updates -
 * `Annotation<T>({ default })` alone is not enough.
 *
 * `overwrite()` is the reducer used for every plain value here: the last
 * node to write wins. `history` is replaced wholesale rather than appended
 * because it is loaded from PostgreSQL on each turn, not accumulated.
 */
function overwrite<T>(fallback: T) {
  return { reducer: (_left: T, right: T) => right, default: () => fallback };
}

/**
 * The shared blackboard. Every agent reads from it and writes its own slice.
 */
export const SupportState = Annotation.Root({
  sessionId: Annotation<string>(),
  userMessage: Annotation<string>(),
  history: Annotation<LlmMessage[]>(overwrite<LlmMessage[]>([])),

  /* Router output */
  intent: Annotation<Intent>(overwrite<Intent>('general')),
  confidence: Annotation<number>(overwrite<number>(0)),
  routeReason: Annotation<string>(overwrite<string>('')),

  /* Specialist output */
  agent: Annotation<string | null>(overwrite<string | null>(null)),
  answer: Annotation<string>(overwrite<string>('')),
  sources: Annotation<RetrievedContext[]>(overwrite<RetrievedContext[]>([])),

  /* Escalation */
  needsHuman: Annotation<boolean>(overwrite<boolean>(false)),
  ticketId: Annotation<number | null>(overwrite<number | null>(null)),
});

export type SupportStateType = typeof SupportState.State;
export type SupportStateUpdate = typeof SupportState.Update;
