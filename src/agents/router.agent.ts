import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { logger } from '../common/logger';
import { INTENTS, type Intent, type RouteDecision } from './agent.types';
import { ROUTER_PROMPT } from './prompts';

type RouteHistory = Array<{ role: 'user' | 'assistant'; content: string }>;

/**
 * Offline classification, used only when no LLM key is configured.
 *
 * This is deliberately a blunt keyword matcher. It exists so a zero-config
 * clone still demonstrates *routing* rather than sending every message to
 * handoff - but with a real LLM it is never consulted, and a keyword
 * matcher is exactly the thing the LLM replaces.
 */
const KEYWORDS: Record<Exclude<Intent, 'handoff'>, string[]> = {
  tech: ['login', 'log in', 'password', 'reset', 'error', 'bug', 'slow', 'api', 'export', '2fa', 'cache', 'crash', 'loading', 'fail'],
  billing: ['refund', 'invoice', 'payment', 'charge', 'billing', 'discount', 'gst', 'vat', 'tax', 'prorate', 'receipt'],
  sales: ['pricing', 'price', 'plan', 'trial', 'demo', 'migrate', 'migration', 'security', 'soc 2', 'gdpr', 'enterprise'],
  general: ['hi', 'hello', 'hey', 'thanks', 'thank you', 'namaste', 'ok'],
};

const HANDOFF_KEYWORDS = ['human', 'person', 'real person', 'agent se baat', 'call me', 'speak to someone'];

export interface OfflineRoute extends RouteDecision {}

@Injectable()
export class RouterAgent {
  constructor(private readonly llm: LlmService) {}

  async route(userMessage: string, history: RouteHistory = []): Promise<RouteDecision> {
    if (this.llm.mode === 'offline') {
      return offlineClassify(userMessage);
    }

    try {
      const transcript = history
        .map((entry) => `${entry.role}: ${entry.content}`)
        .join('\n')
        .slice(-600);

      const { data } = await this.llm.chatJson<Record<string, unknown>>([
        { role: 'system', content: ROUTER_PROMPT },
        ...(transcript
          ? [{ role: 'user' as const, content: `Conversation so far:\n${transcript}` }]
          : []),
        { role: 'user', content: `Customer message:\n${userMessage}` },
      ]);

      return normalise(data);
    } catch (err) {
      // Routing must never be the thing that breaks the chat.
      logger.warn(`Router failed, falling back to keyword routing: ${(err as Error).message}`);
      return offlineClassify(userMessage);
    }
  }
}

/** Clamps and validates whatever the LLM produced into a safe decision. */
function normalise(raw: { intent?: unknown; confidence?: unknown; reason?: unknown }): RouteDecision {
  const intent: Intent = INTENTS.includes(raw.intent as Intent) ? (raw.intent as Intent) : 'general';
  const confidence =
    typeof raw.confidence === 'number' ? Math.min(Math.max(raw.confidence, 0), 1) : 0;

  return {
    intent,
    confidence,
    reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : 'no reason given',
  };
}

export function offlineClassify(message: string): RouteDecision {
  const text = message.toLowerCase();

  if (HANDOFF_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return { intent: 'handoff', confidence: 0.95, reason: 'offline: asked for a human' };
  }

  // Score every intent by how many of its keywords appear, then pick the
  // best. Ties go to tech/billing/sales over general.
  const scores = (Object.keys(KEYWORDS) as Array<Exclude<Intent, 'handoff'>>).map((intent) => ({
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
