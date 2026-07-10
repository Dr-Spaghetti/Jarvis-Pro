import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import {
  buildAnalyzerChatUrl,
  buildAnalyzerImageUrl,
  buildAnalyzerItemUrl,
  buildAnalyzerUrl,
  buildAnalyzerVideoUrl,
  buildBrainJournalAppendUrl,
} from "../runtime/runtimeEndpoints";

// ─── types ───────────────────────────────────────────────────────────────────

type ImageBreakdown = {
  provider: "gemini" | "claude";
  objects: string;
  people: string;
  scene: string;
  text_on_image: string;
  composition: string;
  style: string;
  contextual_cues: string;
  focus_insights?: string;
};

type VideoScene = { start: number; end: number; description: string };
type TranscriptSegment = { start: number; end: number; transcript: string };
type TimelineEntry = { time_start: number; time_end: number; visual: string; spoken: string };

type VideoAnalysisResult = {
  scenes: VideoScene[];
  transcript: TranscriptSegment[];
  timeline: TimelineEntry[];
  ffmpeg_available: boolean;
  gemini_available: boolean;
  sampled?: boolean;
  sample_note?: string;
};

type AnalysisMeta = {
  id: string;
  type: "image" | "video";
  filename: string;
  mimeType: string;
  created: string;
  focusPrompt?: string;
};

type AnalysisRecord = {
  meta: AnalysisMeta;
  result: ImageBreakdown | VideoAnalysisResult | null;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

// ─── styles ──────────────────────────────────────────────────────────────────

const GREEN = "#39ff14";
const DIM = "rgba(57,255,20,0.25)";
const BORDER = "rgba(57,255,20,0.14)";
const BORDER_DIM = "rgba(57,255,20,0.09)";

const s = {
  panel: {
    display: "flex" as const,
    flexDirection: "column" as const,
    height: "100%",
    background: "#000",
    fontFamily: '"JetBrains Mono", "IBM Plex Mono", monospace',
    minHeight: 0,
    overflow: "hidden" as const,
  },
  hdr: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: "10px 14px",
    borderBottom: `1px solid ${BORDER}`,
    flexShrink: 0,
  },
  hdrTitle: {
    fontSize: 9,
    letterSpacing: "0.28em",
    textTransform: "uppercase" as const,
    color: DIM,
  },
  hdrActions: { display: "flex" as const, gap: 8 },
  smallBtn: {
    background: "none",
    border: "1px solid rgba(57,255,20,0.22)",
    color: "rgba(57,255,20,0.5)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "3px 8px",
    cursor: "pointer",
  },
  body: {
    display: "flex" as const,
    flex: 1,
    minHeight: 0,
    overflow: "hidden" as const,
  },
  sidebar: {
    width: 220,
    flexShrink: 0,
    borderRight: `1px solid ${BORDER_DIM}`,
    display: "flex" as const,
    flexDirection: "column" as const,
    overflow: "hidden" as const,
  },
  sidebarHdr: {
    padding: "8px 10px",
    borderBottom: `1px solid ${BORDER_DIM}`,
    fontSize: 8,
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.3)",
    flexShrink: 0,
  },
  sidebarList: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "4px 0",
  },
  sidebarItem: (active: boolean) => ({
    padding: "6px 10px",
    cursor: "pointer",
    background: active ? "rgba(57,255,20,0.07)" : "none",
    borderLeft: `2px solid ${active ? GREEN : "transparent"}`,
  }),
  sidebarItemLabel: {
    fontSize: 9,
    color: "#b0ccb0",
    overflow: "hidden" as const,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  sidebarItemMeta: { fontSize: 8, color: "rgba(57,255,20,0.3)", marginTop: 2 },
  main: {
    flex: 1,
    display: "flex" as const,
    flexDirection: "column" as const,
    overflow: "hidden" as const,
    minHeight: 0,
  },
  uploadZone: {
    margin: "12px 14px",
    border: "1px dashed rgba(57,255,20,0.3)",
    padding: "24px 16px",
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center" as const,
    gap: 8,
    flexShrink: 0,
  },
  uploadText: { fontSize: 10, color: "rgba(57,255,20,0.4)", textAlign: "center" as const },
  uploadBtn: {
    background: "rgba(57,255,20,0.08)",
    border: "1px solid rgba(57,255,20,0.35)",
    color: GREEN,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "6px 16px",
    cursor: "pointer",
  },
  resultArea: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "0 14px 14px",
    minHeight: 0,
  },
  section: {
    marginTop: 14,
  },
  sectionTitle: {
    fontSize: 8,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: DIM,
    marginBottom: 6,
    borderBottom: `1px solid ${BORDER_DIM}`,
    paddingBottom: 4,
  },
  field: {
    display: "flex" as const,
    gap: 8,
    marginBottom: 6,
    flexWrap: "wrap" as const,
  },
  fieldLabel: {
    fontSize: 8,
    color: "rgba(57,255,20,0.4)",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    minWidth: 90,
    flexShrink: 0,
  },
  fieldValue: {
    fontSize: 10,
    color: "#c0dcc0",
    flex: 1,
    lineHeight: 1.5,
    wordBreak: "break-word" as const,
  },
  timelineEntry: {
    background: "#050705",
    border: `1px solid ${BORDER_DIM}`,
    borderLeft: "2px solid rgba(57,255,20,0.2)",
    padding: "6px 10px",
    marginBottom: 6,
  },
  timelineTime: { fontSize: 8, color: "rgba(57,255,20,0.4)", marginBottom: 4 },
  timelineVisual: { fontSize: 10, color: "#c0dcc0", lineHeight: 1.5 },
  timelineSpoken: { fontSize: 10, color: "#8ab08a", fontStyle: "italic" as const, marginTop: 4 },
  statusMsg: (isErr: boolean) => ({
    fontSize: 10,
    color: isErr ? "rgba(255,80,80,0.65)" : "rgba(57,255,20,0.5)",
    padding: "8px 14px",
  }),
  emptyState: {
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    height: "100%",
    gap: 8,
    color: "rgba(57,255,20,0.18)",
  },
  emptyLabel: { fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase" as const },
  notice: {
    fontSize: 9,
    color: "rgba(255,180,0,0.6)",
    background: "rgba(255,180,0,0.05)",
    border: "1px solid rgba(255,180,0,0.2)",
    padding: "4px 8px",
    marginTop: 6,
  },
  chatSection: {
    flexShrink: 0,
    borderTop: `1px solid ${BORDER}`,
    display: "flex" as const,
    flexDirection: "column" as const,
    maxHeight: 340,
  },
  focusInput: {
    width: "100%",
    maxWidth: 400,
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.18)",
    color: "#c0dcc0",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    padding: "5px 8px",
    outline: "none",
  },
  chatHdr: {
    padding: "6px 14px",
    fontSize: 8,
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.3)",
    borderBottom: `1px solid ${BORDER_DIM}`,
    flexShrink: 0,
  },
  chatHistory: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "6px 14px",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 6,
    minHeight: 0,
  },
  chatBubble: (role: "user" | "assistant") => ({
    padding: "5px 8px",
    fontSize: 10,
    lineHeight: 1.5,
    color: role === "user" ? "#39ff14" : "#c0dcc0",
    background: role === "user" ? "rgba(57,255,20,0.06)" : "#050705",
    border: `1px solid ${BORDER_DIM}`,
    borderLeft: `2px solid ${role === "user" ? GREEN : "rgba(57,255,20,0.15)"}`,
    alignSelf: role === "user" ? ("flex-end" as const) : ("flex-start" as const),
    maxWidth: "85%",
    wordBreak: "break-word" as const,
  }),
  chatInputRow: {
    display: "flex" as const,
    gap: 6,
    padding: "6px 14px 8px",
    flexShrink: 0,
  },
  chatInput: {
    flex: 1,
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.22)",
    color: "#d0e8d0",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    padding: "5px 8px",
    outline: "none",
  },
  chatSendBtn: (disabled: boolean) => ({
    background: "rgba(57,255,20,0.08)",
    border: "1px solid rgba(57,255,20,0.3)",
    color: GREEN,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    padding: "5px 10px",
    cursor: disabled ? ("not-allowed" as const) : ("pointer" as const),
    opacity: disabled ? 0.4 : 1,
    flexShrink: 0,
  }),
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const isVideoResult = (r: ImageBreakdown | VideoAnalysisResult): r is VideoAnalysisResult =>
  "scenes" in r && Array.isArray((r as VideoAnalysisResult).scenes);

// ─── Image result display ─────────────────────────────────────────────────────

const ImageResult = ({ result }: { result: ImageBreakdown }) => {
  const fields: [string, string][] = [
    ["Objects", result.objects],
    ["People", result.people],
    ["Scene", result.scene],
    ["On-Image Text", result.text_on_image],
    ["Composition", result.composition],
    ["Style", result.style],
    ["Context", result.contextual_cues],
  ];
  return (
    <div style={s.section}>
      <p style={s.sectionTitle}>Image Analysis — via {result.provider}</p>
      {result.focus_insights && (
        <div
          style={{
            background: "rgba(57,255,20,0.04)",
            border: "1px solid rgba(57,255,20,0.22)",
            borderLeft: `3px solid ${GREEN}`,
            padding: "8px 10px",
            marginBottom: 10,
          }}
        >
          <p
            style={{
              fontSize: 8,
              color: GREEN,
              letterSpacing: "0.2em",
              textTransform: "uppercase" as const,
              marginBottom: 5,
            }}
          >
            ⬡ Focus Insights
          </p>
          <p style={{ fontSize: 10, color: "#d0f0d0", lineHeight: 1.7 }}>{result.focus_insights}</p>
        </div>
      )}
      {fields.map(([label, value]) => (
        <div key={label} style={s.field}>
          <span style={s.fieldLabel}>{label}</span>
          <span style={s.fieldValue}>{value || "—"}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Video result display ─────────────────────────────────────────────────────

const VideoResult = ({ result }: { result: VideoAnalysisResult }) => (
  <div>
    {!result.ffmpeg_available && (
      <p style={s.notice}>
        ⚠ ffmpeg not found — transcript unavailable. Install:{" "}
        <span style={{ color: GREEN }}>https://ffmpeg.org/download.html</span> then restart Jarvis.
      </p>
    )}
    {!result.gemini_available && (
      <p style={s.notice}>
        ⚠ Gemini video analysis unavailable (check GEMINI_API_KEY quota). Scene breakdown may be
        empty.
      </p>
    )}
    {result.sample_note && <p style={s.notice}>ℹ {result.sample_note}</p>}

    {result.timeline.length > 0 ? (
      <div style={s.section}>
        <p style={s.sectionTitle}>Timeline — {result.timeline.length} segments</p>
        {result.timeline.map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: no stable key available
          <div key={i} style={s.timelineEntry}>
            <p style={s.timelineTime}>
              {fmtTime(entry.time_start)} → {fmtTime(entry.time_end)}
            </p>
            {entry.visual && <p style={s.timelineVisual}>{entry.visual}</p>}
            {entry.spoken && <p style={s.timelineSpoken}>"{entry.spoken}"</p>}
          </div>
        ))}
      </div>
    ) : (
      <>
        {result.scenes.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionTitle}>Scenes — {result.scenes.length} detected</p>
            {result.scenes.map((scene, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: no stable key available
              <div key={i} style={s.timelineEntry}>
                <p style={s.timelineTime}>
                  {fmtTime(scene.start)} → {fmtTime(scene.end)}
                </p>
                <p style={s.timelineVisual}>{scene.description}</p>
              </div>
            ))}
          </div>
        )}
        {result.transcript.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionTitle}>Transcript — {result.transcript.length} utterances</p>
            {result.transcript.map((seg, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: no stable key available
              <div key={i} style={s.timelineEntry}>
                <p style={s.timelineTime}>
                  {fmtTime(seg.start)} → {fmtTime(seg.end)}
                </p>
                <p style={s.timelineSpoken}>"{seg.transcript}"</p>
              </div>
            ))}
          </div>
        )}
        {result.scenes.length === 0 && result.transcript.length === 0 && (
          <div style={{ ...s.emptyState, height: "auto", padding: "24px 0" }}>
            <span style={s.emptyLabel}>No analysis data available</span>
          </div>
        )}
      </>
    )}
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

export const AnalyzerPrimaryView = () => {
  const [analyses, setAnalyses] = useState<AnalysisMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<AnalysisRecord | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingRecord, setIsLoadingRecord] = useState(false);
  const [focusPrompt, setFocusPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatErrorRef = useRef<HTMLParagraphElement>(null);
  const uploadErrorRef = useRef<HTMLParagraphElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (chatError) chatErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatError]);

  useLayoutEffect(() => {
    if (uploadError)
      uploadErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [uploadError]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot
  useEffect(() => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setChatHistory([]);
    setChatError(null);
    setIsChatting(false);
  }, [selectedId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: chatHistoryRef.current is intentionally not a dep
  useEffect(() => {
    const el = chatHistoryRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatHistory]);

  const fetchList = useCallback(async () => {
    try {
      const res = await apiFetch(buildAnalyzerUrl());
      if (!res.ok) return;
      const data = (await res.json()) as { analyses: AnalysisMeta[] };
      setAnalyses(data.analyses);
    } catch {
      // silent — list is non-critical
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const fetchRecord = useCallback(async (id: string) => {
    setIsLoadingRecord(true);
    setSelectedRecord(null);
    try {
      const res = await apiFetch(buildAnalyzerItemUrl(id));
      if (!res.ok) return;
      const data = (await res.json()) as AnalysisRecord;
      setSelectedRecord(data);
    } catch {
      // leave null
    } finally {
      setIsLoadingRecord(false);
    }
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setChatHistory([]);
      setChatError(null);
      void fetchRecord(id);
    },
    [fetchRecord],
  );

  const handleChat = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || isChatting || !selectedId) return;
    chatAbortRef.current?.abort();
    const abort = new AbortController();
    chatAbortRef.current = abort;
    setIsChatting(true);
    setChatError(null);
    const next: ChatMessage[] = [...chatHistory, { role: "user", content: msg }];
    setChatHistory([...next, { role: "assistant", content: "" }]); // live streaming bubble
    setChatInput("");

    let accumulated = "";
    try {
      const res = await apiFetch(buildAnalyzerChatUrl(selectedId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: chatHistory }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setChatError(data.error ?? `Chat failed (${res.status}).`);
        setChatHistory(next);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data) as { delta?: string; error?: string };
            if (event.error) {
              setChatError(event.error);
              setChatHistory(next);
              return;
            }
            if (event.delta) {
              accumulated += event.delta;
              setChatHistory([...next, { role: "assistant", content: accumulated }]);
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      if (!accumulated) {
        setChatHistory(next);
        setChatError("No response received.");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setChatError("Chat request failed — check Jarvis is running.");
      setChatHistory(next);
    } finally {
      setIsChatting(false);
    }
  }, [chatInput, isChatting, selectedId, chatHistory]);

  const handleExport = useCallback(() => {
    if (!selectedRecord) return;
    const { meta, result } = selectedRecord;
    const lines: string[] = [];
    lines.push(`# ${meta.type === "image" ? "Image" : "Video"} Analysis — ${meta.filename}`);
    lines.push(
      `**Analyzed:** ${fmtDate(meta.created)}${meta.type === "image" && result && !isVideoResult(result) ? ` · via ${result.provider}` : ""}`,
    );
    if (meta.focusPrompt) lines.push(`**Focus:** ${meta.focusPrompt}`);
    lines.push("");

    if (result && isVideoResult(result)) {
      if (result.timeline.length > 0) {
        lines.push("## Timeline");
        for (const entry of result.timeline) {
          lines.push(`### ${fmtTime(entry.time_start)} → ${fmtTime(entry.time_end)}`);
          if (entry.visual) lines.push(entry.visual);
          if (entry.spoken) lines.push(`> "${entry.spoken}"`);
          lines.push("");
        }
      } else {
        if (result.scenes.length > 0) {
          lines.push("## Scenes");
          for (const scene of result.scenes) {
            lines.push(`**${fmtTime(scene.start)} → ${fmtTime(scene.end)}:** ${scene.description}`);
          }
          lines.push("");
        }
        if (result.transcript.length > 0) {
          lines.push("## Transcript");
          for (const seg of result.transcript) {
            lines.push(`**${fmtTime(seg.start)}:** ${seg.transcript}`);
          }
          lines.push("");
        }
      }
    } else if (result) {
      const img = result as ImageBreakdown;
      lines.push("## Analysis");
      if (img.focus_insights) {
        lines.push("### Focus Insights");
        lines.push(img.focus_insights);
        lines.push("");
      }
      lines.push(`**Objects:** ${img.objects}`);
      lines.push(`**People:** ${img.people}`);
      lines.push(`**Scene:** ${img.scene}`);
      lines.push(`**Text on Image:** ${img.text_on_image}`);
      lines.push(`**Composition:** ${img.composition}`);
      lines.push(`**Style:** ${img.style}`);
      lines.push(`**Context:** ${img.contextual_cues}`);
      lines.push("");
    }

    const filledChat = chatHistory.filter((m) => m.content);
    if (filledChat.length > 0) {
      lines.push("## Chat Session");
      for (const msg of filledChat) {
        lines.push(`**${msg.role === "user" ? "You" : "Jarvis"}:** ${msg.content}`);
        lines.push("");
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${meta.filename.replace(/\.[^.]+$/, "")}-analysis.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selectedRecord, chatHistory]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (fileInputRef.current) fileInputRef.current.value = "";

      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) {
        setUploadError("Select an image (jpeg, png, webp, gif) or video (mp4, mov, webm, avi).");
        return;
      }

      setIsUploading(true);
      setUploadError(null);

      try {
        const uploadUrl = isVideo ? buildAnalyzerVideoUrl() : buildAnalyzerImageUrl();
        const headers: Record<string, string> = {
          "Content-Type": file.type,
          "X-Filename": file.name,
        };
        if (focusPrompt.trim()) headers["X-Focus-Prompt"] = focusPrompt.trim();
        const res = await apiFetch(uploadUrl, {
          method: "POST",
          headers,
          body: file,
        });
        const data = (await res.json()) as {
          id?: string;
          error?: string;
          meta?: AnalysisMeta;
          result?: ImageBreakdown | VideoAnalysisResult;
        };
        if (!res.ok || !data.id) {
          setUploadError(data.error ?? `Analysis failed (${res.status}).`);
          return;
        }
        await fetchList();
        setSelectedId(data.id);
        if (data.meta && data.result !== undefined) {
          setSelectedRecord({ meta: data.meta, result: data.result ?? null });
        } else {
          void fetchRecord(data.id);
        }
        // Log successful analysis to the brain journal, then signal JarvisHome to reload it.
        void apiFetch(buildBrainJournalAppendUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: `Analyzed ${file.name}`,
            skill: "Content Analyzer",
            status: "ok",
            detail: `${isVideo ? "video" : "image"} analysis complete`,
          }),
        }).then((r) => {
          if (!r.ok) return;
          const ts = new Date().toISOString();
          try {
            window.localStorage.setItem("jarvis.lastJournalEntry", ts);
          } catch {
            /* ignore */
          }
          window.dispatchEvent(
            new StorageEvent("storage", { key: "jarvis.lastJournalEntry", newValue: ts }),
          );
        });
      } catch {
        setUploadError("Upload failed — check that Jarvis is running and try again.");
      } finally {
        setIsUploading(false);
      }
    },
    [fetchList, fetchRecord, focusPrompt],
  );

  return (
    <section className="analyzer-view" aria-label="Analyzer primary view" style={s.panel}>
      <header style={s.hdr}>
        <span style={s.hdrTitle}>⬡ Analyzer</span>
        <div style={s.hdrActions}>
          {selectedRecord && (
            <button type="button" style={s.smallBtn} onClick={handleExport}>
              ↓ Export
            </button>
          )}
          <button type="button" style={s.smallBtn} onClick={() => void fetchList()}>
            ↺ Refresh
          </button>
        </div>
      </header>

      <div style={s.body}>
        {/* Sidebar — past analyses */}
        <aside style={s.sidebar}>
          <p style={s.sidebarHdr}>Past Analyses</p>
          <div style={s.sidebarList}>
            {analyses.length === 0 ? (
              <p style={{ ...s.statusMsg(false), fontSize: 9 }}>No analyses yet</p>
            ) : (
              analyses.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  style={{
                    ...s.sidebarItem(a.id === selectedId),
                    width: "100%",
                    textAlign: "left" as const,
                    border: "none",
                  }}
                  onClick={() => handleSelect(a.id)}
                >
                  <p style={s.sidebarItemLabel}>{a.filename}</p>
                  <p style={s.sidebarItemMeta}>
                    {a.type} · {fmtDate(a.created)}
                  </p>
                  {a.focusPrompt && (
                    <p
                      style={{
                        fontSize: 8,
                        color: "rgba(57,255,20,0.22)",
                        marginTop: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap" as const,
                      }}
                    >
                      ⬡ {a.focusPrompt}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Main area */}
        <main style={s.main}>
          {/* Upload zone */}
          <div style={s.uploadZone}>
            <p style={s.uploadText}>
              {isUploading
                ? "Analyzing… this may take up to a minute for video"
                : "Drop an image or video here, or click to browse"}
            </p>
            {!isUploading && (
              <input
                type="text"
                value={focusPrompt}
                onChange={(e) => setFocusPrompt(e.target.value)}
                placeholder="Focus on… (e.g. 'brand logos', 'expressions', 'text')"
                style={s.focusInput}
                aria-label="Analysis focus prompt"
              />
            )}
            {!isUploading && (
              <button
                type="button"
                style={s.uploadBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                Choose File
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/x-msvideo"
              style={{ display: "none" }}
              onChange={(e) => void handleFileChange(e)}
              aria-label="Upload file for analysis"
            />
            {uploadError && (
              <p ref={uploadErrorRef} style={s.statusMsg(true)}>
                ⚠ {uploadError}
              </p>
            )}
          </div>

          {/* Result area */}
          <div style={s.resultArea}>
            {isLoadingRecord ? (
              <p style={s.statusMsg(false)}>Loading analysis…</p>
            ) : selectedRecord ? (
              <>
                <div style={s.section}>
                  <p style={s.sectionTitle}>
                    {selectedRecord.meta.filename} — {selectedRecord.meta.type}
                  </p>
                  {selectedRecord.meta.focusPrompt && (
                    <p style={{ fontSize: 9, color: "rgba(57,255,20,0.4)", marginTop: 3 }}>
                      ⬡ focus: {selectedRecord.meta.focusPrompt}
                    </p>
                  )}
                </div>
                {selectedRecord.result == null ? (
                  <p style={s.statusMsg(true)}>No result data for this analysis.</p>
                ) : isVideoResult(selectedRecord.result) ? (
                  <VideoResult result={selectedRecord.result} />
                ) : (
                  <ImageResult result={selectedRecord.result} />
                )}
              </>
            ) : (
              <div style={s.emptyState}>
                <span style={{ fontSize: 24, color: "rgba(57,255,20,0.15)" }}>⬡</span>
                <span style={s.emptyLabel}>Select an analysis or upload media</span>
              </div>
            )}
          </div>

          {/* Analysis Chat — shown when an analysis is selected */}
          {selectedRecord && (
            <section aria-label="Analysis chat" style={s.chatSection}>
              <p style={s.chatHdr}>⬡ Analysis Chat</p>
              {chatHistory.length > 0 && (
                <div ref={chatHistoryRef} style={s.chatHistory} aria-label="Chat history">
                  {chatHistory.map((msg, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: no stable key available
                    <div key={i} style={s.chatBubble(msg.role)}>
                      {msg.content || (isChatting && i === chatHistory.length - 1 ? "▋" : "—")}
                    </div>
                  ))}
                </div>
              )}
              {chatError && (
                <p ref={chatErrorRef} style={s.statusMsg(true)}>
                  ⚠ {chatError}
                </p>
              )}
              <div style={s.chatInputRow}>
                <input
                  type="text"
                  style={s.chatInput}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleChat();
                  }}
                  placeholder="Ask about this analysis…"
                  aria-label="Analysis chat input"
                  disabled={isChatting}
                />
                <button
                  type="button"
                  style={s.chatSendBtn(isChatting || !chatInput.trim())}
                  disabled={isChatting || !chatInput.trim()}
                  onClick={() => void handleChat()}
                >
                  Send
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </section>
  );
};
