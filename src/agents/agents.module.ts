import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../llm/llm.module';
import { TicketService } from '../tickets/ticket.service';
import { RouterAgent } from './router.agent';
import { BillingAgent, GeneralAgent, SalesAgent, TechAgent } from './specialist.agent';
import { GraphService } from './graph.service';

/**
 * The orchestration layer. LangGraph does not need NestJS, but wrapping the
 * graph in an injectable keeps the WebSocket gateway thin and testable.
 *
 * LlmModule is imported directly because RouterAgent injects LlmService -
 * KnowledgeModule exports RagService, not the LLM.
 */
@Module({
  imports: [LlmModule, KnowledgeModule],
  providers: [
    RouterAgent,
    TechAgent,
    BillingAgent,
    SalesAgent,
    GeneralAgent,
    TicketService,
    GraphService,
  ],
  exports: [GraphService, TicketService],
})
export class AgentsModule {}
