import { Injectable } from '@nestjs/common';
import { RagService, type RagAnswer } from '../knowledge/rag.service';
import type { LlmMessage } from '../llm/llm.types';
import type { Intent } from './agent.types';
import { SPECIALIST_PROMPTS } from './prompts';

/**
 * Specialist Agent - the "kaam karta hai" step.
 *
 * One shared implementation, three thin subclasses. The only difference
 * between a tech, billing and sales agent is the system prompt and which
 * slice of the knowledge base it is allowed to search.
 *
 * Adding a new specialist is three lines:
 *   1. add the intent to INTENTS
 *   2. add a prompt to SPECIALIST_PROMPTS
 *   3. subclass here and register it in AgentsModule
 */
@Injectable()
export class SpecialistAgent {
  constructor(
    protected readonly intent: Intent,
    protected readonly rag: RagService,
  ) {}

  get name(): string {
    return `${this.intent}-agent`;
  }

  /** RAG over this agent's category, then an LLM answer grounded in the hits. */
  async handle(params: {
    userMessage: string;
    history: LlmMessage[];
  }): Promise<RagAnswer> {
    return this.rag.answer({
      query: params.userMessage,
      history: params.history,
      // Narrowing the search to one category stops the billing agent from
      // answering with a sales policy that happens to be similar.
      category: this.intent === 'general' ? undefined : this.intent,
      systemPrompt: SPECIALIST_PROMPTS[this.intent],
    });
  }
}

@Injectable()
export class TechAgent extends SpecialistAgent {
  constructor(rag: RagService) {
    super('tech', rag);
  }
}

@Injectable()
export class BillingAgent extends SpecialistAgent {
  constructor(rag: RagService) {
    super('billing', rag);
  }
}

@Injectable()
export class SalesAgent extends SpecialistAgent {
  constructor(rag: RagService) {
    super('sales', rag);
  }
}

@Injectable()
export class GeneralAgent extends SpecialistAgent {
  constructor(rag: RagService) {
    super('general', rag);
  }
}
