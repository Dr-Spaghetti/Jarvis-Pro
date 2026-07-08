import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../../runtime/apiClient";
import {
  buildBrainConversationUrl,
  buildBrainDigestUrl,
  buildBrainJournalUrl,
  buildBrainMemoryUrl,
  buildBrainModelsUrl,
  buildBrainRecentUrl,
  buildDeckSkillsUrl,
  buildDeckTentaclesUrl,
  buildWorkflowRunsRecentUrl,
} from "../../runtime/runtimeEndpoints";
import type { BrainNote, ConversationTurn, JournalEntry, RecentWorkflowRun } from "./types";
import { asNotes } from "./utils";

export const useJarvisData = () => {
  const [recent, setRecent] = useState<BrainNote[]>([]);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentWorkflowRun[]>([]);
  const [memoryItems, setMemoryItems] = useState<string[]>([]);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [skillCount, setSkillCount] = useState<number | null>(null);
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null);
  const [configured, setConfigured] = useState(true);
  const [chatModels, setChatModels] = useState<string[]>([]);
  const [claudeModels, setClaudeModels] = useState<string[]>([]);
  const [chatModel, setChatModel] = useState<string>(() => {
    try {
      return window.localStorage.getItem("jarvis.chatModel") || "claude-sonnet-4-6";
    } catch {
      return "claude-sonnet-4-6";
    }
  });

  const loadRecent = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainRecentUrl(12), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { configured?: boolean };
      setConfigured(data.configured !== false);
      setRecent(asNotes(data));
    } catch {
      /* ignore */
    }
  }, []);

  const loadConversation = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainConversationUrl(50), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { turns?: ConversationTurn[] };
      if (Array.isArray(data.turns)) setConversation(data.turns);
    } catch {
      /* ignore */
    }
  }, []);

  const loadMemory = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainMemoryUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: unknown };
      if (Array.isArray(data.items)) {
        const items = data.items.filter((x): x is string => typeof x === "string");
        setMemoryItems(items);
        setMemoryCount(items.length);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadJournal = useCallback(async () => {
    try {
      const res = await apiFetch(buildBrainJournalUrl(6), {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { entries?: unknown };
        if (Array.isArray(data.entries)) setJournal(data.entries as JournalEntry[]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadRecentRuns = useCallback(async () => {
    try {
      const res = await apiFetch(buildWorkflowRunsRecentUrl(), {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { runs?: unknown };
        if (Array.isArray(data.runs)) setRecentRuns(data.runs as RecentWorkflowRun[]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Initial data load.
  useEffect(() => {
    void loadRecent();
    void loadConversation();

    (async () => {
      try {
        const res = await apiFetch(buildDeckSkillsUrl(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          if (Array.isArray(data)) setSkillCount(data.length);
        }
      } catch {
        /* ignore */
      }

      try {
        const res = await apiFetch(buildDeckTentaclesUrl(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          if (Array.isArray(data)) setAgentCount(data.length);
        }
      } catch {
        /* ignore */
      }

      void loadJournal();
      void loadMemory();
      void loadRecentRuns();

      try {
        const res = await apiFetch(buildBrainDigestUrl(), {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { tasks?: { openCount?: unknown } };
          if (typeof data.tasks?.openCount === "number") setOpenTaskCount(data.tasks.openCount);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [loadRecent, loadConversation, loadMemory, loadJournal, loadRecentRuns]);

  // Load model list; validate saved chatModel against the list.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(buildBrainModelsUrl(), {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { models?: string[]; claudeModels?: string[] };
        if (Array.isArray(data.models)) setChatModels(data.models);
        if (Array.isArray(data.claudeModels)) setClaudeModels(data.claudeModels);
        const allValid = [...(data.claudeModels ?? []), ...(data.models ?? [])];
        setChatModel((prev) => {
          if (prev && !allValid.includes(prev)) {
            try {
              window.localStorage.removeItem("jarvis.chatModel");
            } catch {
              /* ignore */
            }
            return "";
          }
          return prev;
        });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Sync voice + model settings written by the Settings tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "jarvis.chatModel" && e.newValue !== null) setChatModel(e.newValue);
      if (e.key === "jarvis.lastJournalEntry") void loadJournal();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadJournal]);

  return {
    recent,
    conversation,
    setConversation,
    journal,
    recentRuns,
    memoryItems,
    memoryCount,
    skillCount,
    agentCount,
    openTaskCount,
    configured,
    chatModels,
    claudeModels,
    chatModel,
    setChatModel,
    loadRecent,
    loadConversation,
    loadMemory,
    loadJournal,
    loadRecentRuns,
  };
};
