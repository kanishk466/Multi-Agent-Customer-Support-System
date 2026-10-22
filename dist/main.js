"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const env_1 = require("./config/env");
const logger_1 = require("./common/logger");
const redis_1 = require("./config/redis");
const postgres_1 = require("./config/postgres");
const app_module_1 = require("./app.module");
async function bootstrap() {
    // Infra first, so the graph is not asked to run against a half-connected
    // store. Both are optional - each falls back to an in-memory version.
    await Promise.all([(0, redis_1.initRedis)(), (0, postgres_1.initDatabase)()]);
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({ origin: '*' });
    await app.listen(env_1.env.PORT);
    logger_1.logger.info(`Multi-agent support server on http://localhost:${env_1.env.PORT}`);
    logger_1.logger.info(`Modes: llm=${env_1.env.useLlm ? 'cloud' : 'offline'} ` +
        `embeddings=${env_1.env.useCloudEmbeddings ? 'cloud' : 'local'} ` +
        `groq=${env_1.env.hasGroq} gemini=${env_1.env.hasGemini}`);
}
bootstrap().catch((err) => {
    logger_1.logger.error(`Failed to start: ${err.stack ?? err}`);
    process.exit(1);
});
//# sourceMappingURL=main.js.map