"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingsService = void 0;
exports.l2 = l2;
exports.cosineSimilarity = cosineSimilarity;
const common_1 = require("@nestjs/common");
const env_1 = require("../config/env");
/**
 * Embeddings = "text -> numbers".
 *
 * Two modes:
 *   cloud  - Gemini embedding API (free, needs GEMINI_API_KEY)
 *   local  - deterministic character-n-gram hashing. No API key, no network.
 *
 * The local mode exists so the whole RAG pipeline can be learned and
 * demoed offline. Its relevance quality is much lower than a real embedding
 * model - swap to Gemini before judging whether RAG "works".
 */
let EmbeddingsService = class EmbeddingsService {
    get mode() {
        return env_1.env.useCloudEmbeddings ? 'cloud' : 'local';
    }
    get dims() {
        return env_1.env.EMBEDDING_DIMS;
    }
    async embed(texts) {
        if (texts.length === 0)
            return [];
        return this.mode === 'cloud' ? this.embedGemini(texts) : texts.map((t) => this.embedLocal(t));
    }
    async embedQuery(text) {
        return (await this.embed([text]))[0];
    }
    /* ────────────────────────── Gemini ────────────────────────── */
    async embedGemini(texts) {
        const endpoint = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env_1.env.GEMINI_API_KEY}`;
        // embedContent is one text per call. The batch endpoint would be fewer
        // round-trips, but it is not advertised for every embedding model, so
        // this sticks to the single-text call that all of them support and
        // simply runs a few in parallel.
        const embedOne = async (text) => {
            const response = await fetch(endpoint(env_1.env.EMBEDDING_MODEL), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `models/${env_1.env.EMBEDDING_MODEL}`,
                    content: { parts: [{ text: text.slice(0, 2048) }] },
                    outputDimensionality: env_1.env.EMBEDDING_DIMS,
                }),
                signal: AbortSignal.timeout(30_000),
            });
            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                throw new Error(`Gemini embeddings ${response.status}: ${detail.slice(0, 200)}`);
            }
            const json = (await response.json());
            return l2(json.embedding?.values ?? []);
        };
        const results = new Array(texts.length);
        const CONCURRENCY = 5;
        for (let offset = 0; offset < texts.length; offset += CONCURRENCY) {
            const batch = texts.slice(offset, offset + CONCURRENCY);
            const embedded = await Promise.all(batch.map(embedOne));
            embedded.forEach((value, index) => {
                results[offset + index] = value;
            });
        }
        return results;
    }
    /* ─────────────────────────── Local ─────────────────────────── */
    /**
     * Feature hashing over words and character trigrams.
     *
     * Weights matter more than the features themselves:
     *   bigrams  1.5  - "reset password" matching beats isolated words
     *   unigrams 1.0  - exact word overlap
     *   trigrams 0.25 - typo tolerance, but kept small so a long chunk's
     *                   trigram mass does not drown out its actual words
     *
     * Deterministic, so the same text always produces the same vector - that
     * is what makes the offline demo reproducible.
     */
    embedLocal(text) {
        const vector = new Array(env_1.env.EMBEDDING_DIMS).fill(0);
        const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
        const tokens = normalized.split(' ').filter(Boolean);
        for (const token of tokens)
            this.addFeature(vector, `w:${token}`, 1);
        for (let i = 0; i < tokens.length - 1; i++) {
            this.addFeature(vector, `b:${tokens[i]}_${tokens[i + 1]}`, 1.5);
        }
        for (let i = 0; i <= normalized.length - 3; i++) {
            this.addFeature(vector, normalized.slice(i, i + 3), 0.25);
        }
        return l2(vector);
    }
    addFeature(vector, feature, weight) {
        const { index, sign } = hashFeature(feature);
        vector[index] += sign * weight;
    }
};
exports.EmbeddingsService = EmbeddingsService;
exports.EmbeddingsService = EmbeddingsService = __decorate([
    (0, common_1.Injectable)()
], EmbeddingsService);
/* ─────────────────────────── Helpers ─────────────────────────── */
function hashFeature(feature) {
    // FNV-1a - stable across runs and Node versions (unlike Math.random seeds).
    let hash = 0x811c9dc5;
    for (let i = 0; i < feature.length; i++) {
        hash ^= feature.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    const unsigned = hash >>> 0;
    return { index: unsigned % env_1.env.EMBEDDING_DIMS, sign: unsigned & 1 ? 1 : -1 };
}
function l2(vector) {
    let sum = 0;
    for (const value of vector)
        sum += value * value;
    const norm = Math.sqrt(sum);
    if (norm === 0)
        return vector;
    return vector.map((value) => value / norm);
}
function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
//# sourceMappingURL=embeddings.service.js.map