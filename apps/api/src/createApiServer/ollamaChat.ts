// Local, free chat completions via Ollama (no API key, no per-use cost). Used by
// the brain's "Ask Jarvis" RAG answerer. Returns null when Ollama is unreachable
// or the model isn't pulled, so callers can degrade gracefully. Never throws.

const getOllamaHost = (): string => process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";

export const getChatModel = (): string => process.env.OLLAMA_CHAT_MODEL?.trim() || "qwen2.5:7b";

// List the locally-installed Ollama chat models (excludes embedding-only models
// like nomic-embed-text). Returns [] if Ollama is unreachable. Never throws.
export const listOllamaChatModels = async (signal?: AbortSignal): Promise<string[]> => {
  try {
    const response = await fetch(`${getOllamaHost()}/api/tags`, signal ? { signal } : {});
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: { name?: unknown }[] };
    const names = (data.models ?? [])
      .map((model) => (typeof model.name === "string" ? model.name : null))
      .filter((name): name is string => name !== null && !/embed/i.test(name));
    return names;
  } catch {
    return [];
  }
};

export const chatViaOllama = async (
  prompt: string,
  options: { system?: string; signal?: AbortSignal; model?: string } = {},
): Promise<string | null> => {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return null;
  try {
    const response = await fetch(`${getOllamaHost()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model?.trim() || getChatModel(),
        stream: false,
        messages: [
          ...(options.system ? [{ role: "system", content: options.system }] : []),
          { role: "user", content: trimmed },
        ],
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { message?: { content?: unknown } };
    const content = data.message?.content;
    return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
  } catch {
    return null;
  }
};
