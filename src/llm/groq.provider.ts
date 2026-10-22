import { env } from '../config/env';
import { logger } from '../common/logger';
import {
  type LlmMessage,
  type LlmProvider,
  type LlmResult,
  callSignal,
  fallbackUsage,
} from './llm.types';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Groq chat provider (OpenAI-compatible REST, free tier, very fast).
 * This is the recommended provider while learning.
 */
export class GroqProvider implements LlmProvider {
  readonly name = 'groq';

  available(): boolean {
    return env.hasGroq;
  }

  async chat(messages: LlmMessage[], opts?: { signal?: AbortSignal; json?: boolean }): Promise<LlmResult> {
    const model = env.GROQ_MODEL;

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1024,
        // Structured output for the router - forces valid JSON back.
        ...(opts?.json ? { response_format: { type: 'json_object' } } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: callSignal(opts?.signal, env.LLM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`Groq ${response.status}: ${detail.slice(0, 200)}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = (json.choices?.[0]?.message?.content ?? '').trim();
    const prompt = messages.map((m) => m.content).join('\n');
    const usage = json.usage?.prompt_tokens
      ? {
          inputTokens: json.usage.prompt_tokens ?? 0,
          outputTokens: json.usage.completion_tokens ?? 0,
        }
      : fallbackUsage(prompt, text);

    logger.debug(`groq ok (${usage.inputTokens}in/${usage.outputTokens}out)`);
    return { text, provider: this.name, model, usage };
  }
}
