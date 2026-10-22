import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { logger } from '../common/logger';
import { GroqProvider } from './groq.provider';
import { GeminiProvider } from './gemini.provider';
import {
  type LlmMessage,
  type LlmProvider,
  type LlmResult,
  estimateTokens,
} from './llm.types';

/** Answer returned when no LLM key is configured - keeps the demo alive. */
const OFFLINE_REPLY =
  '(offline demo mode) Main abhi LLM ke bina chal raha hoon. ' +
  'GROQ_API_KEY ya GEMINI_API_KEY set karte hi real jawab aayega.';

/**
 * The "brain". Tries Groq first (fast, free), falls back to Gemini when
 * Groq rate-limits or errors - free tiers throttle aggressively, so a
 * second provider saves a lot of debugging frustration.
 */
@Injectable()
export class LlmService {
  private readonly providers: LlmProvider[];

  constructor() {
    // Order matters: primary first.
    this.providers = [new GroqProvider(), new GeminiProvider()];
  }

  get mode(): 'cloud' | 'offline' {
    return env.useLlm ? 'cloud' : 'offline';
  }

  availableProviders(): string[] {
    return this.providers.filter((p) => p.available()).map((p) => p.name);
  }

  /** Plain chat completion. Tries each provider in order. */
  async chat(
    messages: LlmMessage[],
    opts?: { signal?: AbortSignal; json?: boolean },
  ): Promise<LlmResult> {
    if (!env.useLlm) {
      const prompt = messages.map((m) => m.content).join('\n');
      return {
        text: OFFLINE_REPLY,
        provider: 'offline',
        model: 'none',
        usage: { inputTokens: estimateTokens(prompt), outputTokens: estimateTokens(OFFLINE_REPLY) },
      };
    }

    const errors: string[] = [];
    for (const provider of this.providers) {
      if (!provider.available()) continue;
      try {
        const result = await provider.chat(messages, opts);
        // A thinking model that exhausts its token budget returns 200 with
        // an empty string. Returning that would silently produce an empty
        // chat reply, so treat it like a failure and try the next provider.
        if (result.text.trim()) return result;
        throw new Error('empty completion');
      } catch (err) {
        const message = (err as Error).message;
        errors.push(`${provider.name}: ${message}`);
        logger.warn(`LLM ${provider.name} failed, trying next provider - ${message}`);
      }
    }

    throw new Error(`All LLM providers failed - ${errors.join(' | ')}`);
  }

  /**
   * Chat completion that must return JSON. Asks for JSON, then repairs the
   * usual failure modes (markdown fences, trailing text) before parsing.
   */
  async chatJson<T>(
    messages: LlmMessage[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ data: T; result: LlmResult }> {
    const result = await this.chat(messages, { ...opts, json: true });
    return { data: parseJson<T>(result.text), result };
  }
}

/**
 * Parses JSON out of an LLM reply, tolerating ```json fences and leading
 * prose. Falls back to `{}` so a malformed reply never crashes the graph.
 */
export function parseJson<T>(text: string): T {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Fall back to the first {...} block in the reply.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        /* fall through */
      }
    }
    logger.warn(`Could not parse JSON from LLM reply: ${text.slice(0, 120)}`);
    return {} as T;
  }
}
