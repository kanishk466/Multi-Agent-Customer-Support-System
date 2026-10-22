import { env } from '../config/env';
import { logger } from '../common/logger';
import {
  type LlmMessage,
  type LlmProvider,
  type LlmResult,
  callSignal,
  fallbackUsage,
} from './llm.types';

const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * Gemini chat provider (free tier via AI Studio).
 * Used as fallback when Groq rate-limits (429) or errors.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  available(): boolean {
    return env.hasGemini;
  }

  async chat(messages: LlmMessage[], opts?: { signal?: AbortSignal; json?: boolean }): Promise<LlmResult> {
    const model = env.GEMINI_MODEL;

    // Gemini has no separate "system" role - the first system message becomes
    // the systemInstruction, the rest become a user/model turn list.
    const systemMessages = messages.filter((m) => m.role === 'system');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const response = await fetch(`${ENDPOINT(model)}?key=${env.GEMINI_API_KEY}`, {
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
      signal: callSignal(opts?.signal, env.LLM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`Gemini ${response.status}: ${detail.slice(0, 200)}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    const json = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

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
      : fallbackUsage(prompt, text);

    logger.debug(`gemini ok (${usage.inputTokens}in/${usage.outputTokens}out)`);
    return { text, provider: this.name, model, usage };
  }
}
