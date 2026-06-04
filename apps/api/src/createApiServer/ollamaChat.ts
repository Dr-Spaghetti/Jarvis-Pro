// Local, free chat completions via Ollama (no API key, no per-use cost). Used by
// the brain's "Ask Jarvis" RAG answerer. Returns null when Ollama is unreachable
// or the model isn't pulled, so callers can degrade gracefully. Never throws.

const getOllamaHost = (): string => process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";

export const getChatModel = (): string => process.env.OLLAMA_CHAT_MODEL?.trim() || "qwen2.5:7b";

export const chatViaOllama = async (
  prompt: string,
  options: { system?: string; signal?: AbortSignal } = {},
): Promise<string | null> => {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return null;
  try {
    const response = await fetch(`${getOllamaHost()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getChatModel(),
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
