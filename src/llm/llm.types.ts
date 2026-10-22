/** Minimal chat-completion contract shared by every provider. */

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: string;
  available(): boolean;
  chat(messages: LlmMessage[], opts?: { signal?: AbortSignal; json?: boolean }): Promise<LlmResult>;
}

/** Cheap token estimate when the provider does not report usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function fallbackUsage(prompt: string, completion: string): LlmUsage {
  return {
    inputTokens: estimateTokens(prompt),
    outputTokens: estimateTokens(completion),
  };
}

/** Combines an upstream abort signal with our own timeout. */
export function callSignal(outer: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}
