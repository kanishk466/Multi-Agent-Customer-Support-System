import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { env } from './config/env';
import { logger } from './common/logger';
import { initRedis } from './config/redis';
import { initDatabase } from './config/postgres';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Infra first, so the graph is not asked to run against a half-connected
  // store. Both are optional - each falls back to an in-memory version.
  await Promise.all([initRedis(), initDatabase()]);

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });

  await app.listen(env.PORT);

  logger.info(`Multi-agent support server on http://localhost:${env.PORT}`);
  logger.info(
    `Modes: llm=${env.useLlm ? 'cloud' : 'offline'} ` +
      `embeddings=${env.useCloudEmbeddings ? 'cloud' : 'local'} ` +
      `groq=${env.hasGroq} gemini=${env.hasGemini}`,
  );
}

bootstrap().catch((err) => {
  logger.error(`Failed to start: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
