import type { PrimaryNavIndex } from "../../app/constants";
import { apiFetch } from "../../runtime/apiClient";
import { buildNotificationsUrl } from "../../runtime/runtimeEndpoints";
import type { BrainNote, JarvisIntentResolution, SpeechRecognitionConstructor } from "./types";

export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

export const formatTimeAgo = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

export const asNotes = (value: unknown): BrainNote[] => {
  if (!value || typeof value !== "object") return [];
  const notes = (value as { notes?: unknown }).notes;
  if (!Array.isArray(notes)) return [];
  return notes.filter(
    (n): n is BrainNote =>
      Boolean(n) &&
      typeof (n as BrainNote).title === "string" &&
      typeof (n as BrainNote).path === "string",
  );
};

export const pushNotification = (title: string, detail?: string): void => {
  apiFetch(buildNotificationsUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "action", title, detail }),
  })
    .then(() => {
      const ts = Date.now().toString();
      try {
        window.localStorage.setItem("jarvis.lastNotificationAt", ts);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(
        new StorageEvent("storage", { key: "jarvis.lastNotificationAt", newValue: ts }),
      );
    })
    .catch(() => {});
};

export const voiceNavTargets: Record<
  Extract<JarvisIntentResolution["intent"], { type: "navigate" }>["target"],
  PrimaryNavIndex
> = {
  jarvis: 9,
  agents: 1,
  deck: 1,
  activity: 2,
  "code-intel": 5,
  monitor: 2,
  conversations: 4,
  prompts: 6,
  settings: 7,
};

export const normalizeVoiceText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
};

export const extractCommandAfterWake = (
  transcript: string,
  phrases: string[],
): string | null => {
  const normalized = normalizeVoiceText(transcript);
  for (const phrase of phrases) {
    const index = normalized.indexOf(phrase);
    if (index === -1) continue;
    return normalized.slice(index + phrase.length).trim();
  }
  return null;
};

export const hasWakePhrase = (transcript: string, phrases: string[]): boolean =>
  extractCommandAfterWake(transcript, phrases) !== null;
