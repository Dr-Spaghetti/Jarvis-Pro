export type JarvisVoiceIntent =
  | {
      type: "navigate";
      target:
        | "agents"
        | "deck"
        | "activity"
        | "code-intel"
        | "monitor"
        | "conversations"
        | "prompts"
        | "settings"
        | "jarvis";
    }
  | { type: "brain-search"; query: string }
  | { type: "brain-capture"; text: string }
  | { type: "create-terminal"; workspaceMode: "shared" | "worktree" }
  | { type: "ask"; question: string }
  | { type: "unknown"; text: string };

export type JarvisVoiceIntentResolution = {
  transcript: string;
  commandText: string;
  intent: JarvisVoiceIntent;
};

const WAKE_PHRASES = ["yo jarvis", "heyo jarvis", "hey jarvis", "okay jarvis", "jarvis"];

export const getJarvisWakePhrases = (): string[] => [...WAKE_PHRASES];

const normalizeSpeech = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const stripJarvisWakePhrase = (transcript: string): string => {
  const normalized = normalizeSpeech(transcript);
  for (const phrase of WAKE_PHRASES) {
    if (normalized === phrase) {
      return "";
    }
    if (normalized.startsWith(`${phrase} `)) {
      return normalized.slice(phrase.length).trim();
    }
  }
  return normalized;
};

const stripLeadingCommandWords = (value: string): string =>
  value
    .replace(/^(please\s+)?(can you|could you|would you)\s+/i, "")
    .replace(/^(please\s+)?(do|run|start|open|show|search|capture|remember)\s+/i, "")
    .trim();

// Explicit "talk to Jarvis" openers that should route to the Ask-Jarvis brain
// even if the rest of the sentence happens to contain a navigation keyword.
const ASK_PREFIXES = ["ask jarvis", "ask", "tell me about", "tell me", "explain"] as const;

// Question-shaped openers. If a sentence starts like a question we answer it
// rather than trying to match it against a command.
const QUESTION_OPENER =
  /^(what|whats|how|why|who|when|where|which|whose|is|are|am|can|could|would|should|do|does|did|will|may|might)\b/;

// A trailing address ("...today jarvis") survives the leading wake-phrase strip;
// remove it so it doesn't pollute the question sent to the brain.
const stripTrailingAddress = (value: string): string => value.replace(/\s+jarvis$/i, "").trim();

const afterAnyPrefix = (value: string, prefixes: readonly string[]): string | null => {
  for (const prefix of prefixes) {
    if (value === prefix) {
      return "";
    }
    if (value.startsWith(`${prefix} `)) {
      return value.slice(prefix.length).trim();
    }
  }
  return null;
};

export const resolveJarvisVoiceIntent = (transcript: string): JarvisVoiceIntentResolution => {
  const commandText = stripJarvisWakePhrase(transcript);
  const command = normalizeSpeech(commandText);

  const searchQuery = afterAnyPrefix(command, [
    "search my brain for",
    "search brain for",
    "find in my brain",
    "find brain notes about",
    "look up in my brain",
  ]);
  if (searchQuery !== null && searchQuery.length > 0) {
    return { transcript, commandText, intent: { type: "brain-search", query: searchQuery } };
  }

  const captureText = afterAnyPrefix(command, [
    "capture this",
    "quick capture",
    "remember this",
    "add to my brain",
    "save to my brain",
  ]);
  if (captureText !== null && captureText.length > 0) {
    return { transcript, commandText, intent: { type: "brain-capture", text: captureText } };
  }

  if (/\b(worktree|isolated)\b.*\b(agent|terminal|session)\b/.test(command)) {
    return {
      transcript,
      commandText,
      intent: { type: "create-terminal", workspaceMode: "worktree" },
    };
  }

  if (
    /\b(new|create|start|launch|spin up)\b.*\b(agent|terminal|session|tentacle)\b/.test(command)
  ) {
    return {
      transcript,
      commandText,
      intent: { type: "create-terminal", workspaceMode: "shared" },
    };
  }

  // Conversational questions go to the Ask-Jarvis brain. Checked BEFORE the
  // navigation keyword matches so "what's on my deck" is answered rather than
  // silently flipping to the Deck page.
  const explicitAsk = afterAnyPrefix(command, ASK_PREFIXES);
  if (explicitAsk !== null && explicitAsk.length > 0) {
    return {
      transcript,
      commandText,
      intent: { type: "ask", question: stripTrailingAddress(explicitAsk) },
    };
  }
  if (QUESTION_OPENER.test(command)) {
    return {
      transcript,
      commandText,
      intent: { type: "ask", question: stripTrailingAddress(command) },
    };
  }

  if (/\b(deck|skills?|skill library)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "deck" } };
  }
  if (/\b(agent|agents|canvas)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "agents" } };
  }
  if (/\b(activity|usage|telemetry)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "activity" } };
  }
  if (/\b(code intel|code intelligence|code map)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "code-intel" } };
  }
  if (/\b(monitor|x scanner|twitter)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "monitor" } };
  }
  if (/\b(conversation|conversations|chat history|transcripts?)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "conversations" } };
  }
  if (/\b(prompt|prompts|prompt library)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "prompts" } };
  }
  if (/\b(settings?|configuration|config)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "settings" } };
  }
  // Require an explicit "home"/"command center" phrase — a bare "jarvis" must
  // not match here, or every sentence that ends with the wake word ("...today
  // jarvis") would wrongly navigate home instead of being answered.
  if (/\b(go home|home screen|command center|jarvis home|go to jarvis)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "jarvis" } };
  }

  // Anything left that still carries words is treated as a question for the
  // brain — Jarvis answers by default rather than shrugging. Empty input
  // (just the wake word) stays "unknown".
  const leftover = stripTrailingAddress(stripLeadingCommandWords(commandText));
  if (leftover.length > 0) {
    return { transcript, commandText, intent: { type: "ask", question: leftover } };
  }

  return {
    transcript,
    commandText,
    intent: { type: "unknown", text: "" },
  };
};
