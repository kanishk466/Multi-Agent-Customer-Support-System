import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../llm/llm.module';
import { SessionService } from '../sessions/session.service';
import { HistoryService } from '../history/history.service';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [LlmModule, KnowledgeModule, AgentsModule],
  providers: [ChatGateway, SessionService, HistoryService],
})
export class ChatModule {}
