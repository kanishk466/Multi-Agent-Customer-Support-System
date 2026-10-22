import { Injectable } from '@nestjs/common';
import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { env } from '../config/env';
import { logger } from '../common/logger';
import type { LlmMessage } from '../llm/llm.types';
import { TicketService } from '../tickets/ticket.service';
import { RouterAgent } from './router.agent';
import {
  BillingAgent,
  GeneralAgent,
  SalesAgent,
  SpecialistAgent,
  TechAgent,
} from './specialist.agent';
import {
  SupportState,
  type Intent,
  type SupportStateType,
  type SupportStateUpdate,
} from './agent.types';

/** Handoff message. Static, so escalation works with or without an LLM. */
const HANDOFF_MESSAGE =
  'Main aapko ek human specialist ke paas forward kar raha hoon. ' +
  'Aapke message ka gist save kar diya gaya hai - koi dobara detail dohrane nahi padegi.';

/**
 * LangGraph = the flowchart.
 *
 *      START
 *        │
 *        ▼
 *     router ──"billing"──► billing ──► END
 *        │
 *        ├──"tech"────────► tech ─────► END
 *        │
 *        └──low confidence► handoff ──► END
 *
 * Nodes are plain async functions that read shared state and return a
 * partial update. A conditional edge is just an if-else that returns the
 * next node name.
 */
@Injectable()
export class GraphService {
  private readonly graph: CompiledGraph;

  constructor(
    private readonly router: RouterAgent,
    tech: TechAgent,
    billing: BillingAgent,
    sales: SalesAgent,
    general: GeneralAgent,
    private readonly tickets: TicketService,
  ) {
    const specialists: Record<Exclude<Intent, 'handoff'>, SpecialistAgent> = {
      tech,
      billing,
      sales,
      general,
    };

    this.graph = new StateGraph(SupportState)
      .addNode('router', (state) => this.runRouter(state))
      .addNode('tech', (state) => this.runSpecialist(specialists.tech, state))
      .addNode('billing', (state) => this.runSpecialist(specialists.billing, state))
      .addNode('sales', (state) => this.runSpecialist(specialists.sales, state))
      .addNode('general', (state) => this.runSpecialist(specialists.general, state))
      .addNode('handoff', (state) => this.runHandoff(state))
      .addEdge(START, 'router')
      .addConditionalEdges('router', routeAfterRouter, [
        'tech',
        'billing',
        'sales',
        'general',
        'handoff',
      ])
      .addEdge('tech', END)
      .addEdge('billing', END)
      .addEdge('sales', END)
      .addEdge('general', END)
      .addEdge('handoff', END)
      // compile() returns a deeply generic type; the structural alias above
      // is what the rest of the app actually needs from it.
      .compile({ checkpointer: new MemorySaver() }) as unknown as CompiledGraph;
  }

  /** Runs one message through the whole graph and returns the final state. */
  async handle(input: {
    sessionId: string;
    userMessage: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<SupportStateType> {
    const result = await this.graph.invoke(
      {
        sessionId: input.sessionId,
        userMessage: input.userMessage,
        history: input.history,
      },
      // thread_id ties the checkpointer to one conversation.
      { configurable: { thread_id: input.sessionId } },
    );

    logger.info(
      `graph done intent=${result.intent} confidence=${result.confidence.toFixed(2)} ` +
        `agent=${result.agent ?? '-'} handoff=${result.needsHuman}`,
    );
    return result;
  }

  /* ─────────────────────────── Nodes ─────────────────────────── */

  private async runRouter(state: SupportStateType): Promise<SupportStateUpdate> {
    const decision = await this.router.route(state.userMessage, toTranscript(state.history));

    logger.info(`router -> ${decision.intent} (${decision.confidence}) - ${decision.reason}`);
    return {
      intent: decision.intent,
      confidence: decision.confidence,
      routeReason: decision.reason,
    };
  }

  private async runSpecialist(
    agent: SpecialistAgent,
    state: SupportStateType,
  ): Promise<SupportStateUpdate> {
    const result = await agent.handle({
      userMessage: state.userMessage,
      history: toTranscript(state.history),
    });

    logger.info(`${agent.name} answered with ${result.sources.length} sources`);
    return { agent: agent.name, answer: result.answer, sources: result.sources };
  }

  private async runHandoff(state: SupportStateType): Promise<SupportStateUpdate> {
    const ticket = await this.tickets.markEscalated(
      state.sessionId,
      `Router: ${state.routeReason} (confidence ${state.confidence.toFixed(2)}) | ${state.userMessage}`,
    );

    return {
      agent: 'handoff-agent',
      answer: HANDOFF_MESSAGE,
      sources: [],
      needsHuman: true,
      ticketId: ticket.id,
    };
  }
}

type CompiledGraph = {
  invoke(
    input: {
      sessionId: string;
      userMessage: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
    options: { configurable: { thread_id: string } },
  ): Promise<SupportStateType>;
};

/**
 * The state's history may contain system messages. Those belong to each
 * specialist's own prompt, so they are stripped before the transcript is
 * handed to the router or an agent.
 */
function toTranscript(history: LlmMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));
}

/**
 * The conditional edge. This single function IS the routing concept:
 * read shared state, pick the next node.
 */
function routeAfterRouter(state: SupportStateType): string {
  if (state.needsHuman) return 'handoff';
  if (state.intent === 'handoff') return 'handoff';
  if (state.confidence < env.HANDOFF_THRESHOLD) return 'handoff';
  return state.intent;
}
