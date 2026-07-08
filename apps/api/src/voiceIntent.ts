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
  | { type: "remember"; text: string }
  | { type: "create-terminal"; workspaceMode: "shared" | "worktree" }
  | { type: "deploy-agent"; archetypeId: string; archetypeName: string }
  | { type: "run-skill"; skillName: string }
  | { type: "run-workflow"; workflowName: string }
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

  // Teach / correct: durable facts, preferences, and rules Jarvis should obey
  // from now on. Saved to long-term memory and injected into every answer — this
  // is the "tell it once and it sticks" learning loop. Checked before nav/ask so
  // "always answer briefly" is learned, not treated as a question.
  const rememberText = afterAnyPrefix(command, [
    "remember that",
    "remember to",
    "remember i",
    "remember my",
    "from now on",
    "for future reference",
    "for the future",
    "keep in mind",
    "note that",
    "correction",
    "always",
    "never",
    "remember",
  ]);
  if (rememberText !== null && rememberText.length > 0) {
    return { transcript, commandText, intent: { type: "remember", text: rememberText } };
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

  // "deploy [archetype]" — checked before the generic 'agent' navigation match so
  // "deploy the researcher agent" routes to the deploy-agent intent, not navigate.
  const ARCHETYPE_KEYWORDS: Record<string, [string, string]> = {
    developer: ["senior-developer", "Senior Developer"],
    dev: ["senior-developer", "Senior Developer"],
    coder: ["senior-developer", "Senior Developer"],
    programmer: ["senior-developer", "Senior Developer"],
    ceo: ["ceo-strategist", "CEO / Strategist"],
    strategist: ["ceo-strategist", "CEO / Strategist"],
    marketing: ["marketing-director", "Marketing Director"],
    marketer: ["marketing-director", "Marketing Director"],
    researcher: ["research-analyst", "Research Analyst"],
    research: ["research-analyst", "Research Analyst"],
    analyst: ["research-analyst", "Research Analyst"],
    product: ["product-manager", "Product Manager"],
    qa: ["quality-verifier", "Quality Verifier"],
    quality: ["quality-verifier", "Quality Verifier"],
    tester: ["quality-verifier", "Quality Verifier"],
    sales: ["sales-representative", "Sales Representative"],
    content: ["content-creator", "Content Creator"],
    writer: ["content-creator", "Content Creator"],
    data: ["data-analyst", "Data Analyst"],
    operations: ["operations-manager", "Operations Manager"],
    ops: ["operations-manager", "Operations Manager"],
    finance: ["financial-analyst", "Financial Analyst"],
    financial: ["financial-analyst", "Financial Analyst"],
    seo: ["seo-specialist", "SEO Specialist"],
    email: ["email-manager", "Email Manager"],
    project: ["project-manager", "Project Manager"],
    assistant: ["personal-assistant", "Personal Assistant"],
    leads: ["lead-intelligence", "Lead Intelligence"],
    lead: ["lead-intelligence", "Lead Intelligence"],
    social: ["social-media-manager", "Social Media Manager"],
    customer: ["customer-success", "Customer Success"],
    automation: ["automation-engineer", "Automation Engineer"],
    automator: ["automation-engineer", "Automation Engineer"],
  };

  const DEPLOY_VERBS = /\b(deploy|activate|unleash|bring in|call in)\b/;
  if (DEPLOY_VERBS.test(command)) {
    for (const [keyword, [archetypeId, archetypeName]] of Object.entries(ARCHETYPE_KEYWORDS)) {
      if (new RegExp(`\\b${keyword}\\b`).test(command)) {
        return {
          transcript,
          commandText,
          intent: { type: "deploy-agent", archetypeId, archetypeName },
        };
      }
    }
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

  // "run workflow [name]" / "execute workflow [name]"
  const runWorkflowExplicit = afterAnyPrefix(command, [
    "run workflow",
    "execute workflow",
    "launch workflow",
    "start workflow",
    "run the workflow",
    "execute the workflow",
  ]);
  if (runWorkflowExplicit !== null && runWorkflowExplicit.length > 0) {
    return {
      transcript,
      commandText,
      intent: { type: "run-workflow", workflowName: runWorkflowExplicit },
    };
  }

  // Explicit "run skill [name]" or "execute skill [name]" phrases.
  const runSkillExplicit = afterAnyPrefix(command, [
    "run skill",
    "execute skill",
    "launch skill",
    "start skill",
    "run the skill",
    "execute the skill",
  ]);
  if (runSkillExplicit !== null && runSkillExplicit.length > 0) {
    return {
      transcript,
      commandText,
      intent: { type: "run-skill", skillName: runSkillExplicit },
    };
  }

  // Implicit "run [name]" / "execute [name]" — "run daily brief", "execute review repair outreach".
  // Guard: don't intercept bare single-word nav targets or terminal-creation phrases.
  const runSkillMatch = command.match(
    /^(?:run|execute|launch)\s+(?:(?:my|the|a)\s+)?(.+?)(?:\s+skill)?$/,
  );
  const runSkillCandidate = runSkillMatch?.[1]?.trim();
  if (
    runSkillCandidate &&
    runSkillCandidate.length >= 3 &&
    !/\b(agent|terminal|session|tentacle)\b/.test(runSkillCandidate) &&
    !/^(deck|agents?|activity|code.intel|monitor|conversations?|prompts?|settings?|jarvis|skills?)$/.test(
      runSkillCandidate,
    )
  ) {
    return {
      transcript,
      commandText,
      intent: { type: "run-skill", skillName: runSkillCandidate },
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
