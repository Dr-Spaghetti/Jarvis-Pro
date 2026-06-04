// Local, free embeddings via Ollama (no API key, no per-use cost). Used by the
// brain's semantic search. Everything degrades to null when Ollama isn't running
// or the model isn't pulled, so callers fall back to lexical search.

const getOllamaHost = (): string => process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";

export const getEmbedModel = (): string =>
  process.env.OLLAMA_EMBED_MODEL?.trim() || "nomic-embed-text";

/**
 * Embed a single text via Ollama's /api/embeddings. Returns a numeric vector,
 * or null if Ollama is unreachable, the model is missing, or the response is
 * malformed. Never throws.
 */
export const embedViaOllama = async (
  text: string,
  signal?: AbortSignal,
): Promise<number[] | null> => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    const response = await fetch(`${getOllamaHost()}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getEmbedModel(), prompt: trimmed }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { embedding?: unknown };
    if (!Array.isArray(data.embedding)) return null;
    const vector = data.embedding.filter((value): value is number => typeof value === "number");
    return vector.length > 0 ? vector : null;
  } catch {
    return null;
  }
};

/** Cosine similarity of two equal-length vectors. Returns 0 for bad input. */
export const cosineSimilarity = (a: readonly number[], b: readonly number[]): number => {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
