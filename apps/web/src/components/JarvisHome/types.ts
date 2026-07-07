export type BrainNote = { title: string; path: string; modified: string; snippet: string };
export type ConversationTurn = { time: string; question: string; answer: string };
export type RecentWorkflowRun = {
  id: string;
  workflowName: string;
  startedAt: string;
  completedAt: string;
  status: "ok" | "error";
  steps: { step: string; answer: string }[];
};
export type JournalEntry = {
  ts: string;
  status: "ok" | "warn" | "error";
  skill: string | null;
  action: string;
  detail: string | null;
};
export type VoiceConfig = {
  wake: { phrases: string[] };
  transcription: {
    configured: boolean;
    defaultModel: string;
    models: string[];
    whisperSupported: boolean;
  };
  tts: {
    configured: boolean;
    fallback: string;
    providers?: string[];
    recommended?: string;
  };
  brain?: { provider: string; webSearch: boolean };
};
export type JarvisIntentResolution = {
  transcript: string;
  commandText: string;
  intent:
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
    | { type: "run-skill"; skillName: string }
    | { type: "run-workflow"; workflowName: string }
    | { type: "deploy-agent"; archetypeId: string; archetypeName: string }
    | { type: "ask"; question: string }
    | { type: "unknown"; text: string };
};
export type SpeechRecognitionResultLike = {
  readonly isFinal?: boolean;
  readonly 0?: { readonly transcript?: string };
};
export type SpeechRecognitionEventLike = {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
};
export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
export type PendingVoiceIntent = {
  displayLabel: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  expiresAt: number;
};
