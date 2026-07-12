import { useCallback, useState } from "react";

import { apiFetch } from "../../runtime/apiClient";
import { buildBrainAskUrl, buildJarvisConversationTurnUrl } from "../../runtime/runtimeEndpoints";
import { stripMarkdownForSpeech } from "./utils";

type UseJarvisAskOptions = {
  chatModel: string;
  autoSpeakIfListening: (text: string) => void;
  loadConversation: () => Promise<void>;
};

export const useJarvisAsk = ({
  chatModel,
  autoSpeakIfListening,
  loadConversation,
}: UseJarvisAskOptions) => {
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<{ title: string; path: string }[]>([]);
  const [answerCitations, setAnswerCitations] = useState<{ title: string; url: string }[]>([]);
  const [answerVia, setAnswerVia] = useState<string | null>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [jarvisSessionId, setJarvisSessionId] = useState<string>(() => {
    try {
      const stored = window.localStorage.getItem("jarvis.sessionId");
      if (stored) return stored;
      const fresh = `jarvis-${Date.now()}`;
      window.localStorage.setItem("jarvis.sessionId", fresh);
      return fresh;
    } catch {
      return `jarvis-${Date.now()}`;
    }
  });

  const submitAsk = useCallback(async () => {
    const question = ask.trim();
    if (question.length === 0) return;
    setAsking(true);
    setAnswer(null);
    setAnswerSources([]);
    setAnswerCitations([]);
    setAnswerVia(null);
    setSourcesExpanded(false);
    setAskNote(null);
    const askedAt = new Date().toISOString();
    try {
      const res = await apiFetch(buildBrainAskUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatModel ? { question, model: chatModel } : { question }),
      });
      if (!res.ok) {
        setAskNote("Ask failed");
        return;
      }
      const data = (await res.json()) as {
        available?: boolean;
        answer?: string;
        hint?: string;
        via?: string;
        sources?: { title: string; path: string }[];
        citations?: { title: string; url: string }[];
      };
      if (data.available && typeof data.answer === "string") {
        const answeredAt = new Date().toISOString();
        setAnswer(data.answer);
        setAnswerSources(Array.isArray(data.sources) ? data.sources : []);
        setAnswerCitations(Array.isArray(data.citations) ? data.citations : []);
        setAnswerVia(typeof data.via === "string" ? data.via : null);
        void loadConversation();
        void apiFetch(buildJarvisConversationTurnUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: jarvisSessionId,
            question,
            answer: data.answer,
            askedAt,
            answeredAt,
          }),
        })
          .then((r) => {
            if (!r.ok) return;
            const ts = new Date().toISOString();
            try {
              window.localStorage.setItem("jarvis.lastTurnAt", ts);
            } catch {
              /* ignore */
            }
            window.dispatchEvent(
              new StorageEvent("storage", { key: "jarvis.lastTurnAt", newValue: ts }),
            );
          })
          .catch(() => {});
        autoSpeakIfListening(stripMarkdownForSpeech(data.answer));
      } else {
        setAskNote(
          data.hint ?? "No local chat model is running. Pull one with: ollama pull qwen2.5:7b",
        );
      }
    } catch {
      setAskNote("Ask failed");
    } finally {
      setAsking(false);
    }
  }, [ask, chatModel, jarvisSessionId, loadConversation, autoSpeakIfListening]);

  // Used by the NEW CHAT button in the console.
  const startNewChat = useCallback((clearConversation: () => void) => {
    const newId = `jarvis-${Date.now()}`;
    try {
      window.localStorage.setItem("jarvis.sessionId", newId);
    } catch {
      /* ignore */
    }
    setJarvisSessionId(newId);
    clearConversation();
    setAnswer(null);
    setAskNote(null);
    setAsk("");
  }, []);

  // Called by the voice hook's onVoiceAnswer callback.
  const handleVoiceAnswer = useCallback(
    (
      voiceAnswer: string,
      sources: { title: string; path: string }[],
      via: string | null,
      citations: { title: string; url: string }[],
    ) => {
      setAnswer(voiceAnswer);
      setAnswerSources(sources);
      setAnswerVia(via);
      setAnswerCitations(citations);
    },
    [],
  );

  const handleVoiceAnswerFailed = useCallback((hint: string) => {
    setAskNote(hint);
  }, []);

  return {
    ask,
    setAsk,
    asking,
    answer,
    answerSources,
    answerCitations,
    answerVia,
    sourcesExpanded,
    setSourcesExpanded,
    askNote,
    setAskNote,
    submitAsk,
    startNewChat,
    handleVoiceAnswer,
    handleVoiceAnswerFailed,
  };
};
