"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initQdrant = initQdrant;
exports.qdrant = qdrant;
exports.qdrantAvailable = qdrantAvailable;
const js_client_rest_1 = require("@qdrant/js-client-rest");
const env_1 = require("./env");
const logger_1 = require("../common/logger");
/**
 * Qdrant = "knowledge" (company docs as vectors).
 *
 * Optional: without a reachable Qdrant the RAG layer falls back to an
 * in-memory cosine store seeded from the same markdown files.
 */
let client = null;
let available = false;
async function initQdrant() {
    client = new js_client_rest_1.QdrantClient({
        url: env_1.env.QDRANT_URL,
        apiKey: env_1.env.QDRANT_API_KEY,
        checkCompatibility: false,
    });
    try {
        // getVersion() is not exposed by this client version - listing
        // collections is the cheapest authenticated round-trip available.
        await client.getCollections();
        available = true;
        logger_1.logger.info(`Qdrant connected (${env_1.env.QDRANT_URL})`);
        return client;
    }
    catch (err) {
        logger_1.logger.warn(`Qdrant unavailable (${err.message}) - vector store: in-memory`);
        available = false;
        client = null;
        return null;
    }
}
function qdrant() {
    if (!available || !client) {
        throw new Error('Qdrant is not connected');
    }
    return client;
}
function qdrantAvailable() {
    return available && client !== null;
}
//# sourceMappingURL=qdrant.js.map