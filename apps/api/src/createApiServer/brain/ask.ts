import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { agenticAsk } from "../agenticAsk";
import { agentEventBus } from "../agentEventBus";
import { agentRegistry } from "../agentRegistry";
import { classifyBrainQuestion } from "../classifyBrainQuestion";
import { initDb, insertTurn, searchLearnings, searchTurns } from "../db";
import { chatViaOllama, getChatModel, isOllamaRunning, listOllamaChatModels } from "../ollamaChat";
import { cosineSimilarity, embedViaOllama } from "../ollamaEmbed";
import { orchestrateTask } from "../orchestrateRoutes";
import type { ApiRouteHandler } from "../routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "../routeHelpers";
import { extractLearning } from "./autoLearn";
import {
  type ConversationTurn,
  appendConversationTurn,
  readConversationTurns,
} from "./conversation";
import { readMemorySections, selectMemorySlice } from "./memory";
import { proposeMemoryFromQuestion } from "./proposeMemory";
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

// Personal context nouns — anything that's Nick's own data rather than world knowledge
const PERSONAL_CONTEXT_NOUNS =
  /\b(project|client|business|company|vault|notes?|idea|task|file|document|data|leads?|account|email|schedule|meeting|contact|customer|code|repo|app|site|design)\b/i;

// True when the question is clearly about Nick's personal information, not general world knowledge.
// Prevents routing personal questions through Perplexity.
const isPersonalQuestion = (q: string): boolean => {
  if (/\b(my|our)\b/i.test(q) && PERSONAL_CONTEXT_NOUNS.test(q)) return true;
  if (/\bwhat (did|have|has) i\b/i.test(q)) return true;
  if (/\b(remind me|remember when)\b/i.test(q)) return true;
  if (/\byou (mentioned|said|told)\b/i.test(q)) return true;
  return false;
};

// Patterns indicating a general knowledge / factual question that benefits from web context
const WEB_ENRICHMENT_PATTERNS = [
  /\b(what|how|why|when|where|which)\b/i,
  /\bwho (is|was|are|were|invented|created|made|founded)\b/i,
  /\b(explain|describe|define|clarify|summarize)\b/i,
  /\btell me (about|more|what|how|why)\b/i,
  /\b(difference between|compare|versus|vs\.?)\b/i,
  /\bbest (way|practice|approach|tool|library|framework|method|option)\b/i,
  /\b(should i|is it possible|are there|is there (a |an |any ))\b/i,
  /\bhelp me (understand|learn|figure out|build|create|write|implement)\b/i,
];

const shouldEnrichWithWeb = (question: string): boolean => {
  if (!getPerplexityApiKey()) return false;
  if (isLiveQuestion(question)) return false;
  if (isPersonalQuestion(question)) return false;
  return WEB_ENRICHMENT_PATTERNS.some((p) => p.test(question));
};

type PerplexityCitation = { title: string; url: string };
export type PerplexityResult = { answer: string; citations: PerplexityCitation[] };

const combineSignals = (ms: number, cancelSignal?: AbortSignal): AbortSignal => {
  const timeout = AbortSignal.timeout(ms);
  if (!cancelSignal) return timeout;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  timeout.addEventListener("abort", abort, { once: true });
  cancelSignal.addEventListener("abort", abort, { once: true });
  return ctrl.signal;
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  ms: number,
  cancelSignal?: AbortSignal,
): Promise<Response | null> => {
  try {
    return await fetch(url, { ...init, signal: combineSignals(ms, cancelSignal) });
  } catch (err) {
    if (cancelSignal?.aborted && err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    return null;
  }
};

export const askViaPerplexity = async (
  question: string,
  deep: boolean,
  forEnrichment = false,
): Promise<PerplexityResult | null> => {
  const apiKey = getPerplexityApiKey();
  if (!apiKey) return null;

  // Return cached result for identical questions (skip API hit)
  if (!forEnrichment) {
    const cached = getCachedPerplexity(question);
    if (cached) return cached;
  }

  const model = "sonar";
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
            content: forEnrichment
              ? "You are a research assistant. Provide a comprehensive, accurate answer covering key facts, context, and current information. Be thorough and include relevant details."
              : "You are Jarvis, a sharp personal AI. Answer concisely in 1-3 sentences. Never use bullet points or headers unless asked.",
          },
          { role: "user", content: question },
        ],
        max_tokens: forEnrichment ? 1024 : 512,
      }),
    },
    18000,
  );
  if (!res?.ok) {
    if (res?.status === 429) perplexityUnavailableUntil = Date.now() + 60_000;
    return null;
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return null;
  const citations: PerplexityCitation[] = (data?.citations ?? [])
    .slice(0, 5)
    .map((url, i) => ({ title: `Source ${i + 1}`, url }));
  const result: PerplexityResult = { answer: stripToolMarkup(content), citations };
  if (!forEnrichment) setCachedPerplexity(question, result);
  return result;
};

const CLAUDE_VOICE_MODEL = "claude-haiku-4-5-20251001";
const CLAUDE_SONNET_MODEL = "claude-sonnet-4-6";
const CLAUDE_OPUS_MODEL = "claude-opus-4-8";
const CLAUDE_MODEL_IDS = [
  "claude-fable-5",
  CLAUDE_OPUS_MODEL,
  CLAUDE_SONNET_MODEL,
  CLAUDE_VOICE_MODEL,
] as const;

// Signals that a question needs Opus-level reasoning (complex, multi-step, analytical)
const OPUS_SIGNALS = [
  /\b(architect|architecture|design (a|an|the)|comprehensive|in[- ]depth|deep[- ]dive)\b/i,
  /\b(analyze|analysis|evaluate|evaluate|assess|audit|diagnose)\b/i,
  /\b(strategy|strategic|roadmap|long[- ]term|scalab)\b/i,
  /\b(all (possible|potential) (ways|approaches|options|routes|implications))\b/i,
  /\b(think through|reason (through|about)|walk me through|step[- ]by[- ]step)\b/i,
  /\b(build (a|an) (system|platform|pipeline|workflow|engine|framework))\b/i,
  /\b(create a (plan|roadmap|strategy|framework|spec|proposal))\b/i,
  /\b(pros and cons|trade[- ]?offs?|considerations|implications)\b/i,
  /\b(optimize|refactor|overhaul|redesign|migrate)\b/i,
  /\b(what (should|would) (i|we|you) (do|use|choose|recommend|pick))\b/i,
];

// Signals that a question is simple enough for Haiku (greetings, trivial yes/no)
const HAIKU_SIGNALS = [
  /^(hi|hey|hello|thanks|thank you|ok|okay|got it|cool|nice|great|yep|nope|sure)[!.?]?$/i,
  /^.{1,25}[?!.]?$/, // Very short questions unlikely to need heavy reasoning
];

// Auto-select the right Claude model based on question complexity.
// Haiku for trivial; Sonnet for everything else (Opus removed — too expensive for daily use).
const selectClaudeModel = (question: string): string => {
  const q = question.trim();
  if (HAIKU_SIGNALS.some((p) => p.test(q))) return CLAUDE_VOICE_MODEL;
  return CLAUDE_SONNET_MODEL;
};

// Complex questions also get sonar-pro in Perplexity (not just "deep research" phrase)
const isComplexQuestion = (question: string): boolean => OPUS_SIGNALS.some((p) => p.test(question));

type AnthrTextBlock = { type: "text"; text: string };
type AnthrToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
type AnthrToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type AnthrContentBlock = AnthrTextBlock | AnthrToolUseBlock;
type AnthrMessage =
  | { role: "user"; content: string }
  | { role: "user"; content: AnthrToolResultBlock[] }
  | { role: "assistant"; content: string }
  | { role: "assistant"; content: AnthrContentBlock[] };
type AnthrResponse = { stop_reason: string; content: AnthrContentBlock[] };

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
};

const JARVIS_VOICE_SYSTEM =
  "You are Jarvis, Nick's sharp personal AI. Be concise and conversational — like a " +
  "knowledgeable friend, not a formal assistant. One or two sentences for voice answers; " +
  "never use bullet points or headers. " +
  "Treat any preference, correction, or instruction in the saved memories as a standing rule " +
  "from Nick (how to address him, format, what to avoid) and follow it exactly. " +
  "When 'Web search (live context)' appears in the context, use it to give accurate, current answers — " +
  "synthesize it in your own words; don't quote or list sources unless Nick asks. " +
  "IMPORTANT: Your responses ARE spoken aloud via ElevenLabs text-to-speech automatically in Nick's browser. " +
  "You have full voice capabilities. When Nick asks you to 'read it back', 'say it again', or 'read the answer', " +
  "just answer normally — your reply will be spoken. Never tell him you lack audio capabilities.";

type ClaudeResult =
  | { ok: true; answer: string; toolsUsed?: string[] }
  | { ok: false; status: number; hint: string }
  | null;

// Tools Claude can call to get live or personal context.
// web_search → Perplexity sonar API  |  read_notes → vault semantic search
const JARVIS_TOOLS: AnthropicTool[] = [
  {
    name: "web_search",
    description:
      "Search the web for current information: news, prices, weather, recent events, " +
      "stock data, or any fact that may have changed since your knowledge cutoff. " +
      "Call this whenever the user needs real-time or up-to-date data.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A concise, specific search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_notes",
    description:
      "Search Nick's personal knowledge vault — his notes, projects, clients, and saved " +
      "context. Call this when the question relates to Nick's own work, ongoing projects, " +
      "clients, preferences, or anything he may have previously documented.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for in Nick's notes" },
      },
      required: ["query"],
    },
  },
];

const getClaudeErrorHint = (status: number, model: string): string => {
  if (status === 401) return "Invalid or expired ANTHROPIC_API_KEY — check .env";
  if (status === 403) return "API key lacks permission for this model";
  if (status === 429) return "Anthropic rate limit hit — try again in a moment";
  if (status === 404) return `Model "${model}" not found — check model ID`;
  return `Anthropic API returned HTTP ${status}`;
};

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

// Tool-capable variant of askViaClaude. Runs the Anthropic tool-use loop until
// Claude reaches end_turn or the 4-round cap. Tools available: web_search, read_notes.
const MAX_TOOL_ROUNDS = 4;

const askViaClaudeWithTools = async (
  question: string,
  context: string,
  history: ConversationTurn[],
  model: string,
  vaultDir: string | null,
  agentId?: string,
  cancelSignal?: AbortSignal,
): Promise<
  | { ok: true; answer: string; toolsUsed: string[] }
  | { ok: false; status: number; hint: string }
  | null
> => {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) return { ok: false, status: 0, hint: "ANTHROPIC_API_KEY is not set in .env" };

  const messages: AnthrMessage[] = [];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: `${context}\n\nQuestion: ${question}` });

  const toolsUsed: string[] = [];
  const startedAt = Date.now();

  const markDone = (state: "done" | "cancelled" | "error", errorMsg?: string) => {
    if (!agentId) return;
    agentRegistry.setState(agentId, state);
    if (state === "done") {
      agentEventBus.emit({ type: "agent_done", agentId, durationMs: Date.now() - startedAt, ts: Date.now() });
    } else if (state === "cancelled") {
      agentEventBus.emit({ type: "agent_cancelled", agentId, ts: Date.now() });
    } else {
      agentEventBus.emit({ type: "agent_error", agentId, error: errorMsg ?? "unknown", ts: Date.now() });
    }
    agentRegistry.scheduleCleanup(agentId, state === "cancelled" ? 5_000 : 30_000);
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (cancelSignal?.aborted) {
        markDone("cancelled");
        return { ok: false, status: 499, hint: "Cancelled" };
      }

      if (agentId) {
        agentRegistry.setRound(agentId, round);
        agentEventBus.emit({ type: "round_started", agentId, round, maxRounds: MAX_TOOL_ROUNDS, ts: Date.now() });
      }

      const isLastRound = round === MAX_TOOL_ROUNDS - 1;

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
            model,
            max_tokens: 1024,
            system: ASK_SYSTEM_PROMPT,
            // Drop tools on the final round so Claude is forced to produce text
            ...(isLastRound ? {} : { tools: JARVIS_TOOLS }),
            messages,
          }),
        },
        15000,
        cancelSignal,
      );

      if (!fetchRes) {
        markDone("error", "API request timed out");
        return null;
      }
      if (!fetchRes.ok) {
        markDone("error", `HTTP ${fetchRes.status}`);
        return {
          ok: false,
          status: fetchRes.status,
          hint: getClaudeErrorHint(fetchRes.status, model),
        };
      }

      const response = (await fetchRes.json().catch(() => null)) as AnthrResponse | null;
      if (!response) {
        markDone("error", "Empty API response");
        return null;
      }

      const textBlock = response.content.find((b): b is AnthrTextBlock => b.type === "text");

      // Done — return whatever text Claude produced
      if (response.stop_reason === "end_turn" || isLastRound) {
        if (textBlock) {
          markDone("done");
          return { ok: true, answer: stripToolMarkup(textBlock.text), toolsUsed };
        }
        markDone("error", "Empty response content");
        return { ok: false, status: 200, hint: "Empty response from Claude API" };
      }

      // Non-tool stop — return text if present, otherwise error
      if (response.stop_reason !== "tool_use") {
        if (textBlock) {
          markDone("done");
          return { ok: true, answer: stripToolMarkup(textBlock.text), toolsUsed };
        }
        markDone("error", `stop_reason: ${response.stop_reason}`);
        return { ok: false, status: 200, hint: `Unexpected stop_reason: ${response.stop_reason}` };
      }

      // Claude wants to call tools — push assistant turn and execute
      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter(
        (b): b is AnthrToolUseBlock => b.type === "tool_use",
      );

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block): Promise<AnthrToolResultBlock> => {
          toolsUsed.push(block.name);
          let content = "";

          if (agentId) {
            agentRegistry.setTool(agentId, block.name);
            agentEventBus.emit({ type: "tool_start", agentId, tool: block.name, round, ts: Date.now() });
          }

          const toolStartedAt = Date.now();

          // Mark as blocked if tool takes longer than 8 seconds
          let blockTimer: ReturnType<typeof setTimeout> | undefined;
          if (agentId) {
            blockTimer = setTimeout(() => {
              agentRegistry.setState(agentId!, "blocked");
            }, 8_000);
          }

          try {
            if (block.name === "web_search") {
              const query = typeof block.input.query === "string" ? block.input.query : question;
              const result = await askViaPerplexity(query, false);
              content = result
                ? result.answer +
                  (result.citations.length > 0
                    ? `\n\nSources: ${result.citations.map((c) => c.url).join(", ")}`
                    : "")
                : "Web search returned no results.";
            } else if (block.name === "read_notes") {
              const query = typeof block.input.query === "string" ? block.input.query : question;
              if (vaultDir) {
                const notes = await retrieveContext(vaultDir, query, 4);
                content =
                  notes.length > 0
                    ? notes.map((n) => `### ${n.title}\n${n.body}`).join("\n\n")
                    : "No relevant notes found.";
              } else {
                content = "No vault configured.";
              }
            } else {
              content = `Unknown tool: ${block.name}`;
            }
          } catch {
            content = `Tool '${block.name}' failed.`;
          } finally {
            if (blockTimer) clearTimeout(blockTimer);
            if (agentId) {
              const currentState = agentRegistry.get(agentId)?.state;
              if (currentState === "blocked") {
                agentRegistry.setState(agentId, "working");
              }
              agentRegistry.setTool(agentId, undefined);
              agentEventBus.emit({ type: "tool_done", agentId, tool: block.name, durationMs: Date.now() - toolStartedAt, ts: Date.now() });
            }
          }

          return { type: "tool_result", tool_use_id: block.id, content };
        }),
      );

      messages.push({ role: "user", content: toolResults });
    }

    markDone("error", "Tool loop exhausted");
    return { ok: false, status: 200, hint: "Tool loop exhausted without final answer" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      markDone("cancelled");
      return { ok: false, status: 499, hint: "Cancelled" };
    }
    markDone("error", String(err));
    throw err;
  }
};

// Read-only retrieval for context: semantic (using the existing index) when
// embeddings are available, else lexical. Does not rebuild the index.
const retrieveContext = async (
  vaultDir: string,
  query: string,
  limit: number,
): Promise<Array<{ rel: string; title: string; body: string }>> => {
  let paths: string[] = [];
  const queryVector = await embedViaOllama(query, AbortSignal.timeout(5000));
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
let perplexityUnavailableUntil = 0;

// In-memory response cache — avoids repeat API hits for identical questions.
// Key: normalized question string. TTL: 1 hour. Max size: 500 entries.
const PERPLEXITY_CACHE_TTL = 60 * 60 * 1000;
const PERPLEXITY_CACHE_MAX = 500;
type PerplexityCacheEntry = { ts: number; result: PerplexityResult };
const perplexityCache = new Map<string, PerplexityCacheEntry>();

const getCachedPerplexity = (question: string): PerplexityResult | null => {
  const key = question.trim().toLowerCase();
  const entry = perplexityCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > PERPLEXITY_CACHE_TTL) {
    perplexityCache.delete(key);
    return null;
  }
  return entry.result;
};

const setCachedPerplexity = (question: string, result: PerplexityResult): void => {
  const key = question.trim().toLowerCase();
  if (perplexityCache.size >= PERPLEXITY_CACHE_MAX) {
    const oldest = perplexityCache.keys().next().value;
    if (oldest) perplexityCache.delete(oldest);
  }
  perplexityCache.set(key, { ts: Date.now(), result });
};

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

  // Initialize persistent memory store (idempotent; skip when no state dir)
  if (projectStateDir) {
    initDb(join(projectStateDir, "state"));
  }

  const vaultDir = resolveVaultDir();
  const notes = vaultDir ? await retrieveContext(vaultDir, question, 6) : [];
  const facts = vaultDir ? selectMemorySlice(readMemorySections(vaultDir), question, 12) : [];
  const history = vaultDir ? readConversationTurns(vaultDir, 10) : [];
  const sources = notes.map((note) => ({ title: note.title, path: note.rel }));
  const proposedMemories = proposeMemoryFromQuestion(question);

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
          {
            available: true,
            answer: result.summary,
            sources,
            via: "orchestrate",
            proposedMemories,
          },
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
          {
            available: true,
            answer: result.answer,
            sources,
            via: result.via,
            proposedMemories,
          },
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
    recallBlock += `\n\nPast conversations on this topic:\n${recallTurns
      .map(
        (t) =>
          `- [${t.role === "user" ? "You asked" : "Jarvis answered"}, ${new Date(t.timestamp).toLocaleDateString()}] "${t.content.slice(0, 200)}"`,
      )
      .join("\n")}`;
  }
  if (recallLearnings.length > 0) {
    recallBlock += `\n\nLearned facts about Nick:\n${recallLearnings.map((l) => `- ${l.content}`).join("\n")}`;
  }
  if (clipboardContext) {
    recallBlock += `\n\nNick just copied this to his clipboard:\n${clipboardContext}`;
  }
  const claudeContextWithRecall = `${claudeContext}${recallBlock}`;

  // Live and general knowledge questions go directly to Perplexity (fast, web-grounded).
  // Personal questions (my projects, my tasks, etc.) always use Claude + vault instead.
  if (
    !isExplicitOllama &&
    !isPersonalQuestion(question) &&
    Date.now() >= perplexityUnavailableUntil &&
    (isLiveQuestion(question) || shouldEnrichWithWeb(question))
  ) {
    const deep = isDeepResearchRequest(question) || isComplexQuestion(question);
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
          via: "perplexity-sonar",
          proposedMemories,
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
      writeJson(
        response,
        200,
        { available: true, answer: result.answer, sources, proposedMemories },
        corsOrigin,
      );
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
      const autoModel = selectClaudeModel(question);
      // Register this invocation for live tracking; cancelSignal wires cancel from the WS
      const agentId = randomUUID();
      const cancelSignal = agentRegistry.register(agentId, question, autoModel);
      // Use tool-capable Claude in auto mode — Claude decides when to search or read notes
      const claudeResult = await askViaClaudeWithTools(
        question,
        claudeContextWithRecall,
        history,
        autoModel,
        vaultDir ?? null,
        agentId,
        cancelSignal,
      );
      if (claudeResult && !claudeResult.ok && claudeResult.status === 499) {
        writeJson(response, 200, { available: false, reason: "cancelled", hint: "Request was cancelled" }, corsOrigin);
        return true;
      }
      if (claudeResult?.ok) {
        claudeUnavailableUntil = 0;
        if (vaultDir) appendConversationTurn(vaultDir, question, claudeResult.answer);
        recordTurn(question, claudeResult.answer);
        const uniqueTools = [...new Set(claudeResult.toolsUsed)];
        const via =
          uniqueTools.length > 0 ? `claude+${uniqueTools.join("+")}` : `claude-${autoModel}`;
        writeJson(
          response,
          200,
          {
            available: true,
            answer: claudeResult.answer,
            sources,
            model: autoModel,
            via,
            proposedMemories,
          },
          corsOrigin,
        );
        return true;
      }
      if (claudeResult && !claudeResult.ok) {
        const s = claudeResult.status;
        if (s === 429 || s === 529) {
          claudeUnavailableUntil = Date.now() + 60_000;
        }
        // Auth errors (401/403/402) don't set a lockout — they fail fast on every
        // request, so no need to bypass Claude for 5 minutes on a transient error.
      }
    }
    const perpResult =
      Date.now() >= perplexityUnavailableUntil ? await askViaPerplexity(question, false) : null;
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
          proposedMemories,
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
        hint: process.env.ANTHROPIC_API_KEY?.trim()
          ? "All providers failed to respond — try again. If this persists, check ANTHROPIC_API_KEY / PERPLEXITY_API_KEY in .env."
          : model
            ? `The local model '${model}' did not respond. Check that Ollama is running: \`ollama pull ${model}\`.`
            : "No AI provider could answer. Add ANTHROPIC_API_KEY / PERPLEXITY_API_KEY to .env, or pull an Ollama model: `ollama pull qwen2.5:7b`.",
        sources,
      },
      corsOrigin,
    );
    return true;
  }
  if (vaultDir) appendConversationTurn(vaultDir, question, ollamaAnswer);
  recordTurn(question, ollamaAnswer);
  writeJson(
    response,
    200,
    { available: true, answer: ollamaAnswer, sources, proposedMemories },
    corsOrigin,
  );
  return true;
};
