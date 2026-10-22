import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/** The brain. Everything that talks to Groq/Gemini goes through here. */
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
