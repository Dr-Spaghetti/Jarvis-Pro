import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { agenticAsk } from "../agenticAsk";
import { classifyBrainQuestion } from "../classifyBrainQuestion";
import { chatViaOllama, getChatModel, isOllamaRunning, listOllamaChatModels } from "../ollamaChat";
import { cosineSimilarity, embedViaOllama } from "../ollamaEmbed";
import { orchestrateTask } from "../orchestrateRoutes";
import type { ApiRouteHandler } from "../routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { initDb, insertTurn, searchLearnings, searchTurns } from "../db";
import {
  type ConversationTurn,
  appendConversationTurn,
  readConversationTurns,
} from "./conversation";
import { extractLearning } from "./autoLearn";
import { readMemoryFacts } from "./memory";
import { lexicalSearchNotes, loadSemanticIndex } from "./search";
import { asRecord, deriveTitle, oneLine, resolveVaultDir, stripFrontmatter } from "./vault";

// ── AI provider helpers ──────────────────────────────────────────────────────

const getAnthropicApiKey = (): string | null => {
  const v = process.env.ANTHROPIC_API_KEY?.trim();
  return v && v.length > 0 ? v : null;
};

const getPerplexityApiKey = (): string | null => {
  const v = process.env.PERPLEXITY_API_KEY?.trim();
  return v && v.length > 0 ? v : null;
};

const stripToolMarkup = (text: string): string =>
  text
    .replace(/<function_calls>[\s\S]*?<\/antml:function_calls>/g, "")
    .replace(/<invoke[^>]*>[\s\S]*?<\/antml:invoke>/g, "")
    .replace(/<parameter[^>]*>[\s\S]*?<\/antml:parameter>/g, "")
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "")
    .replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/g, "")
    .replace(/<parameter[^>]*>[\s\S]*?<\/parameter>/g, "")
    .trim();

const LIVE_QUESTION_PATTERNS = [
  /\b(today|tonight|this week|this month|this year|right now|at the moment)\b/i,
  /\b(current|currently|latest|recent|as of)\b/i,
  /\b(news|headline|weather|forecast|temperature)\b/i,
  /\b(score|scores|won|championship|standings|ranking|playoffs?)\b/i,
  /\b(stock|price|market|crypto|bitcoin)\b/i,
  /\b(who (is|are|won|leads?|holds?|were|was|played|scored|started|coached))\b/i,
  /\b(what (is|are) (the |a )?current)\b/i,
  /\b(election|vote|poll results)\b/i,
  /\b(this season|last night|yesterday)\b/i,
  /\b(player|players|roster|star player|stats|statistics|box score|performance)\b/i,
  /\b(basketball|football|baseball|soccer|hockey|tennis|golf|lacrosse|volleyball)\b/i,
  /\b(semifinal|semi-final|quarter.?final|bracket|tournament|game|match|playoff|division)\b/i,
  /\b(team|coach|season|league|conference|recap|summary|highlight)\b/i,
  /\b(tell me about|what can you tell|who (were|was) the|give me a summary|summarize)\b/i,
  /\b(article|articles|newspaper|journal|press coverage|reported)\b/i,
];

const isLiveQuestion = (question: string): boolean =>
  LIVE_QUESTION_PATTERNS.some((p) => p.test(question));

const isDeepResearchRequest = (question: string): boolean =>
  /deep\s*research|research\s*(this\s*)?(deeply|thoroughly)|thoroughly\s*research/i.test(question);

type PerplexityCitation = { title: string; url: string };
type PerplexityResult = { answer: string; citations: PerplexityCitation[] };

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response | null> => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch {
    return null;
  }
};

const askViaPerplexity = async (
  question: string,
  deep: boolean,
): Promise<PerplexityResult | null> => {
  const apiKey = getPerplexityApiKey();
  if (!apiKey) return null;
  const model = deep ? "sonar-pro" : "sonar";
  const res = await fetchWithTimeout(
    "https://api.perplexity.ai/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are Jarvis, a sharp personal AI. Answer concisely in 1-3 sentences. Never use bullet points or headers unless asked.",
          },
          { role: "user", content: question },
        ],
        max_tokens: 512,
      }),
    },
    18000,
  );
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return null;
  const citations: PerplexityCitation[] = (data?.citations ?? [])
    .slice(0, 5)
    .map((url, i) => ({ title: `Source ${i + 1}`, url }));
  return { answer: stripToolMarkup(content), citations };
};

const CLAUDE_VOICE_MODEL = "claude-haiku-4-5-20251001";
const CLAUDE_SONNET_MODEL = "claude-sonnet-4-6";
const CLAUDE_MODEL_IDS = [
  "claude-fable-5",
  "claude-opus-4-8",
  CLAUDE_SONNET_MODEL,
  CLAUDE_VOICE_MODEL,
] as const;

type AnthrContent = { type: "text"; text: string };
type AnthrMessage = { role: "user" | "assistant"; content: string };
type AnthrResponse = { stop_reason: string; content: AnthrContent[] };

const JARVIS_VOICE_SYSTEM =
  "You are Jarvis, Nick's sharp personal AI. Be concise and conversational — like a " +
  "knowledgeable friend, not a formal assistant. One or two sentences for voice answers; " +
  "never use bullet points or headers. " +
  "Treat any preference, correction, or instruction in the saved memories as a standing rule " +
  "from Nick (how to address him, format, what to avoid) and follow it exactly. " +
  "IMPORTANT: Your responses ARE spoken aloud via ElevenLabs text-to-speech automatically in Nick's browser. " +
  "You have full voice capabilities. When Nick asks you to 'read it back', 'say it again', or 'read the answer', " +
  "just answer normally — your reply will be spoken. Never tell him you lack audio capabilities.";

type ClaudeResult =
  | { ok: true; answer: string }
  | { ok: false; status: number; hint: string }
  | null;

const askViaClaude = async (
  question: string,
  context: string,
  history: ConversationTurn[] = [],
  model?: string,
): Promise<ClaudeResult> => {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) return { ok: false, status: 0, hint: "ANTHROPIC_API_KEY is not set in .env" };

  const messages: AnthrMessage[] = [];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: `${context}\n\nQuestion: ${question}` });

  const fetchRes = await fetchWithTimeout(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model ?? CLAUDE_SONNET_MODEL,
        max_tokens: 512,
        system: JARVIS_VOICE_SYSTEM,
        messages,
      }),
    },
    10000,
  );

  if (!fetchRes) return null;
  if (!fetchRes.ok) {
    const hint =
      fetchRes.status === 401
        ? "Invalid or expired ANTHROPIC_API_KEY — check .env"
        : fetchRes.status === 403
          ? "API key lacks permission for this model"
          : fetchRes.status === 429
            ? "Anthropic rate limit hit — try again in a moment"
            : fetchRes.status === 404
              ? `Model "${model ?? CLAUDE_SONNET_MODEL}" not found — check model ID`
              : `Anthropic API returned HTTP ${fetchRes.status}`;
    return { ok: false, status: fetchRes.status, hint };
  }
  const response = (await fetchRes.json().catch(() => null)) as AnthrResponse | null;
  const textBlock = response?.content?.find((b) => b.type === "text");
  return textBlock?.type === "text"
    ? { ok: true, answer: stripToolMarkup(textBlock.text) }
    : { ok: false, status: 200, hint: "Empty response from Claude API" };
};

// Read-only retrieval for context: semantic (using the existing index) when
// embeddings are available, else lexical. Does not rebuild the index.
const retrieveContext = async (
  vaultDir: string,
  query: string,
  limit: number,
): Promise<Array<{ rel: string; title: string; body: string }>> => {
  let paths: string[] = [];
  const queryVector = await embedViaOllama(query);
  if (queryVector) {
    const index = loadSemanticIndex(vaultDir);
    const entries = Object.entries(index);
    if (entries.length > 0) {
      paths = entries
        .map(([rel, entry]) => ({ rel, score: cosineSimilarity(queryVector, entry.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((ranked) => ranked.rel);
    }
  }
  if (paths.length === 0) {
    paths = lexicalSearchNotes(vaultDir, query, limit).map((note) => note.path);
  }
  const { readFileSync } = await import("node:fs");
  const out: Array<{ rel: string; title: string; body: string }> = [];
  for (const rel of paths) {
    try {
      const content = readFileSync(join(vaultDir, rel), "utf8");
      out.push({
        rel,
        title: deriveTitle(content, rel),
        body: stripFrontmatter(content).slice(0, 1200),
      });
    } catch {
      // skip
    }
  }
  return out;
};

const ASK_SYSTEM_PROMPT =
  "You are Jarvis, Nick's personal AI assistant. Answer his QUESTION helpfully, " +
  "directly, and concisely — no fluff.\n" +
  "- For general questions (facts, how-tos, explanations, advice, casual chat), just " +
  "answer from your own knowledge like a capable assistant would.\n" +
  "- The MEMORY and CONTEXT below are Nick's own notes and saved facts. Use them when " +
  "they're relevant to the question, and when you rely on a note, cite its title in " +
  "brackets like [Note Title].\n" +
  "- IMPORTANT: if a MEMORY entry is a preference, correction, or instruction (e.g. " +
  "'always…', 'never…', 'I prefer…', 'call me…'), treat it as a standing rule from Nick " +
  "and follow it in every answer.\n" +
  "- Do NOT fabricate specifics about Nick, his clients, projects, numbers, or anything " +
  "personal. If he asks about his own information and it isn't in the MEMORY/CONTEXT, " +
  "say you don't have it noted yet and suggest he capture it.\n" +
  "Never refuse a general question just because it isn't in his notes.";

// ── Route handlers ───────────────────────────────────────────────────────────

export const handleBrainModelsRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/brain/models") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const [models, ollamaRunning] = await Promise.all([listOllamaChatModels(), isOllamaRunning()]);
  const claudeModels = getAnthropicApiKey() ? [...CLAUDE_MODEL_IDS] : [];
  writeJson(
    response,
    200,
    { models, default: getChatModel(), claudeModels, ollamaRunning },
    corsOrigin,
  );
  return true;
};

let claudeUnavailableUntil = 0;

export const handleBrainAskRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime, projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/brain/ask") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = asRecord(body.payload);
  const question = typeof payload.question === "string" ? oneLine(payload.question) : "";
  if (question.length === 0) {
    writeJson(response, 400, { error: "question (non-empty string) is required" }, corsOrigin);
    return true;
  }
  const model =
    typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : undefined;
  const clipboardContext =
    typeof payload.clipboardContext === "string" && payload.clipboardContext.trim()
      ? payload.clipboardContext.trim().slice(0, 800)
      : null;

  // Initialize persistent memory store (idempotent)
  initDb(join(projectStateDir, "state"));

  const vaultDir = resolveVaultDir();
  const notes = vaultDir ? await retrieveContext(vaultDir, question, 6) : [];
  const facts = vaultDir ? readMemoryFacts(vaultDir, 20) : [];
  const history = vaultDir ? readConversationTurns(vaultDir, 6) : [];
  const sources = notes.map((note) => ({ title: note.title, path: note.rel }));

  const memoryBlock = facts.length > 0 ? facts.map((f) => `- ${f}`).join("\n") : "(none)";
  const contextBlock =
    notes.length > 0
      ? notes.map((n) => `### ${n.title} (${n.rel})\n${n.body}`).join("\n\n")
      : "(no matching notes)";

  const claudeContext = `My saved memories:\n${memoryBlock}\n\nRelevant vault notes:\n${contextBlock}`;

  // Unique ID for this Q&A pair — used to group turns and attribute learnings
  const sessionId = randomUUID();

  // Records both sides of a turn to the persistent store and fires background learning extraction
  const recordTurn = (q: string, a: string): void => {
    const now = Date.now();
    insertTurn({ id: randomUUID(), sessionId, role: "user", content: q, timestamp: now });
    insertTurn({ id: randomUUID(), sessionId, role: "assistant", content: a, timestamp: now + 1 });
    extractLearning(q, a, sessionId).catch(() => {});
  };

  const isExplicitOllama = model !== undefined && !model.startsWith("claude-");
  if (!isExplicitOllama) {
    const classification = classifyBrainQuestion(question);

    if (classification.type === "orchestrate") {
      const result = await orchestrateTask(question, runtime);
      if (result.ok) {
        if (vaultDir) appendConversationTurn(vaultDir, question, result.summary);
        recordTurn(question, result.summary);
        writeJson(
          response,
          200,
          { available: true, answer: result.summary, sources, via: "orchestrate" },
          corsOrigin,
        );
      } else {
        writeJson(
          response,
          200,
          { available: false, reason: "orchestrate-failed", hint: result.error, sources },
          corsOrigin,
        );
      }
      return true;
    }

    if (classification.type === "agentic") {
      const result = await agenticAsk(question, claudeContext, classification.connectors);
      if (result.ok) {
        if (vaultDir) appendConversationTurn(vaultDir, question, result.answer);
        recordTurn(question, result.answer);
        writeJson(
          response,
          200,
          { available: true, answer: result.answer, sources, via: result.via },
          corsOrigin,
        );
        return true;
      }
      writeJson(
        response,
        200,
        { available: false, reason: "agentic-failed", hint: result.hint, sources },
        corsOrigin,
      );
      return true;
    }
  }

  if (isExplicitOllama) {
    const warnClassification = classifyBrainQuestion(question);
    if (warnClassification.type === "agentic") {
      const connectorLabels = warnClassification.connectors
        .map((c) => (c === "localfalcon" ? "Local Falcon" : "Apollo"))
        .join(" / ");
      writeJson(
        response,
        200,
        {
          available: false,
          reason: "agentic-skipped",
          hint: `"${model}" is a local model and cannot fetch live data. Switch the Answer model to Auto to let ${connectorLabels} answer this question.`,
          sources,
        },
        corsOrigin,
      );
      return true;
    }
  }

  // Build recall — runs only after orchestrate/agentic early exits so we don't pay for paths that can't use it
  const recallTurns = searchTurns(question, 5); // both roles: questions AND answers are relevant
  const recallLearnings = vaultDir ? [] : searchLearnings(question, 3); // vault already injects Memory.md via memoryBlock
  let recallBlock = "";
  if (recallTurns.length > 0) {
    recallBlock +=
      "\n\nPast conversations on this topic:\n" +
      recallTurns
        .map(
          (t) =>
            `- [${t.role === "user" ? "You asked" : "Jarvis answered"}, ${new Date(t.timestamp).toLocaleDateString()}] "${t.content.slice(0, 200)}"`,
        )
        .join("\n");
  }
  if (recallLearnings.length > 0) {
    recallBlock +=
      "\n\nLearned facts about Nick:\n" + recallLearnings.map((l) => `- ${l.content}`).join("\n");
  }
  if (clipboardContext) {
    recallBlock += `\n\nNick just copied this to his clipboard:\n${clipboardContext}`;
  }
  const claudeContextWithRecall = `${claudeContext}${recallBlock}`;

  if (!isExplicitOllama && isLiveQuestion(question)) {
    const deep = isDeepResearchRequest(question);
    const perp = await askViaPerplexity(question, deep);
    if (perp) {
      if (vaultDir) appendConversationTurn(vaultDir, question, perp.answer);
      recordTurn(question, perp.answer);
      writeJson(
        response,
        200,
        {
          available: true,
          answer: perp.answer,
          sources,
          citations: perp.citations,
          via: deep ? "perplexity-sonar-pro" : "perplexity-sonar",
        },
        corsOrigin,
      );
      return true;
    }
  }

  if (model?.startsWith("claude-")) {
    const result = await askViaClaude(question, claudeContextWithRecall, history, model);
    if (result?.ok) {
      if (vaultDir) appendConversationTurn(vaultDir, question, result.answer);
      recordTurn(question, result.answer);
      writeJson(response, 200, { available: true, answer: result.answer, sources }, corsOrigin);
      return true;
    }
    const claudeReason =
      result && !result.ok && result.status === 0 ? "no-chat-model" : "claude-error";
    writeJson(
      response,
      200,
      {
        available: false,
        reason: claudeReason,
        hint: result?.hint ?? "Claude API is unavailable. Check ANTHROPIC_API_KEY in .env.",
        sources,
      },
      corsOrigin,
    );
    return true;
  }

  if (!model) {
    if (Date.now() >= claudeUnavailableUntil) {
      const claudeResult = await askViaClaude(question, claudeContextWithRecall, history);
      if (claudeResult?.ok) {
        claudeUnavailableUntil = 0;
        if (vaultDir) appendConversationTurn(vaultDir, question, claudeResult.answer);
        recordTurn(question, claudeResult.answer);
        writeJson(
          response,
          200,
          { available: true, answer: claudeResult.answer, sources },
          corsOrigin,
        );
        return true;
      }
      if (claudeResult && !claudeResult.ok) {
        const s = claudeResult.status;
        if (s === 429 || s === 529) {
          claudeUnavailableUntil = Date.now() + 60_000;
        } else if (s === 401 || s === 403 || s === 402) {
          claudeUnavailableUntil = Date.now() + 300_000;
        }
      }
    }
    const perpResult = await askViaPerplexity(question, false);
    if (perpResult) {
      if (vaultDir) appendConversationTurn(vaultDir, question, perpResult.answer);
      recordTurn(question, perpResult.answer);
      writeJson(
        response,
        200,
        {
          available: true,
          answer: perpResult.answer,
          sources,
          citations: perpResult.citations,
          via: "perplexity-sonar",
        },
        corsOrigin,
      );
      return true;
    }
    if (!vaultDir) {
      writeJson(
        response,
        400,
        {
          available: false,
          error: "No AI provider could answer.",
          hint: "Check ANTHROPIC_API_KEY and PERPLEXITY_API_KEY in .env, or set OBSIDIAN_VAULT_PATH and run Ollama.",
        },
        corsOrigin,
      );
      return true;
    }
  }

  const historyBlock =
    history.length > 0
      ? history.map((t) => `You: ${t.question}\nJarvis: ${t.answer}`).join("\n\n")
      : "(none)";
  const prompt = `RECENT CONVERSATION:\n${historyBlock}\n\nMEMORY:\n${memoryBlock}\n\nCONTEXT:\n${contextBlock}${recallBlock}\n\nQUESTION: ${question}`;
  const ollamaAnswer = await chatViaOllama(prompt, {
    system: ASK_SYSTEM_PROMPT,
    signal: AbortSignal.timeout(60000),
    ...(model ? { model } : {}),
  });
  if (!ollamaAnswer) {
    writeJson(
      response,
      200,
      {
        available: false,
        reason: "no-chat-model",
        hint: model
          ? `The local model '${model}' did not respond. Check that Ollama is running and the model is pulled: \`ollama pull ${model}\`.`
          : "No AI provider could answer. Check ANTHROPIC_API_KEY / PERPLEXITY_API_KEY in .env, or pull an Ollama model: `ollama pull qwen2.5:7b`.",
        sources,
      },
      corsOrigin,
    );
    return true;
  }
  if (vaultDir) appendConversationTurn(vaultDir, question, ollamaAnswer);
  recordTurn(question, ollamaAnswer);
  writeJson(response, 200, { available: true, answer: ollamaAnswer, sources }, corsOrigin);
  return true;
};
