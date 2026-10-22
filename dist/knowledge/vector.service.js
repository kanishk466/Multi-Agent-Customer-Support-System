"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectorService = void 0;
exports.toPointId = toPointId;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const env_1 = require("../config/env");
const logger_1 = require("../common/logger");
const qdrant_1 = require("../config/qdrant");
const embeddings_service_1 = require("./embeddings.service");
/**
 * Vector store abstraction.
 *
 * Qdrant when it is reachable, an in-memory cosine store otherwise. Both
 * implement the same interface, so RAG code never branches on availability.
 */
let VectorService = class VectorService {
    memory = new Map();
    store = 'memory';
    async onModuleInit() {
        await (0, qdrant_1.initQdrant)();
        if ((0, qdrant_1.qdrantAvailable)()) {
            this.store = 'qdrant';
            await this.ensureCollection();
        }
        else {
            logger_1.logger.warn('Vector store: in-memory (RAG still works, data lost on restart)');
        }
    }
    get mode() {
        return this.store;
    }
    async upsert(records) {
        if (records.length === 0)
            return;
        if (this.store === 'qdrant') {
            const client = (0, qdrant_1.qdrant)();
            const batchSize = 100;
            for (let i = 0; i < records.length; i += batchSize) {
                await client.upsert(env_1.env.QDRANT_COLLECTION, {
                    wait: true,
                    points: records.slice(i, i + batchSize).map((record) => ({
                        // Qdrant only accepts an unsigned integer or a UUID as a point
                        // id - a readable string like "billing-policy-0-0" is a 400.
                        // The readable id stays in the payload for debugging.
                        id: toPointId(record.id),
                        vector: record.values,
                        payload: record.metadata,
                    })),
                });
            }
            return;
        }
        for (const record of records)
            this.memory.set(record.id, record);
    }
    async query(vector, topK, category) {
        if (this.store === 'qdrant') {
            const client = (0, qdrant_1.qdrant)();
            // v1.19 replaced the legacy `search` call with the universal `query`
            // API - `{ nearest: vector }` is the plain vector-search form of it.
            const hits = await client.query(env_1.env.QDRANT_COLLECTION, {
                query: { nearest: vector },
                limit: topK,
                with_payload: true,
                ...(category
                    ? { filter: { must: [{ key: 'category', match: { value: category } }] } }
                    : {}),
            });
            return hits.points.map((point) => ({
                score: point.score ?? 0,
                metadata: point.payload,
            }));
        }
        const scored = [];
        for (const record of this.memory.values()) {
            if (category && record.metadata.category !== category)
                continue;
            scored.push({ score: (0, embeddings_service_1.cosineSimilarity)(vector, record.values), metadata: record.metadata });
        }
        return scored.sort((a, b) => b.score - a.score).slice(0, topK);
    }
    /** Removes every chunk belonging to a document (used before re-ingesting). */
    async deleteByDocument(documentId) {
        if (this.store === 'qdrant') {
            await (0, qdrant_1.qdrant)().delete(env_1.env.QDRANT_COLLECTION, {
                filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
            });
            return;
        }
        for (const [id, record] of this.memory) {
            if (record.metadata.documentId === documentId)
                this.memory.delete(id);
        }
    }
    async count() {
        if (this.store === 'qdrant') {
            const result = await (0, qdrant_1.qdrant)().count(env_1.env.QDRANT_COLLECTION, { exact: true });
            return result.count ?? 0;
        }
        return this.memory.size;
    }
    /**
     * Creates the collection and the two payload indexes that filtering needs.
     *
     * Qdrant refuses any filter on an unindexed payload key with
     * "Index required but not found" - so `category` filtering and
     * `deleteByDocument` both fail without these.
     */
    async ensureCollection() {
        const client = (0, qdrant_1.qdrant)();
        const exists = (await client.getCollections()).collections.some((collection) => collection.name === env_1.env.QDRANT_COLLECTION);
        if (!exists) {
            await client.createCollection(env_1.env.QDRANT_COLLECTION, {
                vectors: { size: env_1.env.EMBEDDING_DIMS, distance: 'Cosine' },
            });
            logger_1.logger.info(`Qdrant collection "${env_1.env.QDRANT_COLLECTION}" created (${env_1.env.EMBEDDING_DIMS} dims)`);
        }
        for (const field of ['documentId', 'category']) {
            try {
                await client.createPayloadIndex(env_1.env.QDRANT_COLLECTION, {
                    field_name: field,
                    field_schema: 'keyword',
                });
            }
            catch (err) {
                // Already indexed (409) is the normal case on every boot after the
                // first - anything else is worth surfacing.
                if (!/exist|409/i.test(err.message))
                    throw err;
            }
        }
    }
};
exports.VectorService = VectorService;
exports.VectorService = VectorService = __decorate([
    (0, common_1.Injectable)()
], VectorService);
/**
 * Deterministic UUID for a readable chunk id.
 *
 * Deterministic rather than randomUUID() so re-ingesting the same chunk
 * overwrites its old point instead of leaving a duplicate behind.
 *
 * Build the bytes first, then slice the hex - writing `0x80 | x` with
 * toString() produces decimal ("188"), which makes a 5-character group and
 * a UUID Qdrant rejects.
 */
function toPointId(value) {
    const bytes = Buffer.from((0, crypto_1.createHash)('sha1').update(`support-kb:${value}`).digest().subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // RFC 4122 version 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = bytes.toString('hex'); // always 32 chars
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
    ].join('-');
}
//# sourceMappingURL=vector.service.js.map