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
  if (/\b(home|jarvis|command center)\b/.test(command)) {
    return { transcript, commandText, intent: { type: "navigate", target: "jarvis" } };
  }

  return {
    transcript,
    commandText,
    intent: { type: "unknown", text: stripLeadingCommandWords(commandText) },
  };
};
