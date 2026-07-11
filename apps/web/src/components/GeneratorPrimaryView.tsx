import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import {
  buildGeneratorAnimateUrl,
  buildGeneratorDeleteUrl,
  buildGeneratorImageUrl,
  buildGeneratorItemUrl,
  buildGeneratorStatusUrl,
  buildGeneratorUrl,
} from "../runtime/runtimeEndpoints";

// ─── types ────────────────────────────────────────────────────────────────────

type GenerationMode = "text2image" | "image2video";
type GenerationStatus = "generating" | "completed" | "failed";

type GenerationMeta = {
  id: string;
  mode: GenerationMode;
  prompt: string;
  status: GenerationStatus;
  resultUrl?: string;
  errorMessage?: string;
  model?: string;
  aspectRatio?: string;
  created: string;
  completedAt?: string;
};

type GeneratorStatus = {
  geminiKeyPresent: boolean;
  imagenModel: string;
  veoModel: string;
};

// ─── styles ───────────────────────────────────────────────────────────────────

const GREEN = "#39ff14";
const DIM = "rgba(57,255,20,0.25)";
const BORDER = "rgba(57,255,20,0.14)";
const GOLD = "#c8a84b";
const RED = "#ff4545";

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
  hdrLeft: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  hdrTitle: {
    fontSize: 9,
    letterSpacing: "0.28em",
    textTransform: "uppercase" as const,
    color: DIM,
  },
  hdrStar: { color: GREEN, marginRight: 6 },
  keyDot: (present: boolean | null) => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: present === null ? "rgba(200,168,75,0.5)" : present ? "rgba(57,255,20,0.7)" : RED,
    display: "inline-block" as const,
    flexShrink: 0,
  }),
  keyLabel: (present: boolean | null) => ({
    fontSize: 7,
    letterSpacing: "0.14em",
    color:
      present === null
        ? "rgba(200,168,75,0.6)"
        : present
          ? "rgba(57,255,20,0.5)"
          : "rgba(255,69,69,0.8)",
  }),
  hdrRight: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  hdrBtn: {
    background: "none",
    border: `1px solid ${BORDER}`,
    color: DIM,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    padding: "3px 8px",
    cursor: "pointer" as const,
    borderRadius: 2,
  },
  body: {
    display: "flex" as const,
    flexDirection: "column" as const,
    flex: 1,
    overflow: "hidden" as const,
    minHeight: 0,
  },
  createPanel: {
    padding: "12px 14px",
    borderBottom: `1px solid ${BORDER}`,
    flexShrink: 0,
  },
  modeTabs: {
    display: "flex" as const,
    gap: 6,
    marginBottom: 10,
  },
  modeTab: (active: boolean) => ({
    background: active ? "rgba(57,255,20,0.1)" : "none",
    border: `1px solid ${active ? "rgba(57,255,20,0.35)" : "rgba(57,255,20,0.14)"}`,
    color: active ? GREEN : "rgba(57,255,20,0.4)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    padding: "4px 10px",
    cursor: "pointer" as const,
    borderRadius: 2,
  }),
  sourceBadge: {
    fontSize: 8,
    color: GREEN,
    background: "rgba(57,255,20,0.07)",
    border: "1px solid rgba(57,255,20,0.2)",
    borderRadius: 2,
    padding: "3px 8px",
    marginBottom: 8,
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  row: {
    display: "flex" as const,
    gap: 8,
    marginBottom: 8,
    alignItems: "flex-start" as const,
  },
  label: {
    fontSize: 8,
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const,
    color: DIM,
    marginBottom: 4,
    display: "block" as const,
  },
  textarea: {
    background: "rgba(57,255,20,0.04)",
    border: "1px solid rgba(57,255,20,0.18)",
    color: GREEN,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    padding: "6px 8px",
    width: "100%",
    resize: "vertical" as const,
    minHeight: 60,
    outline: "none",
    borderRadius: 2,
    boxSizing: "border-box" as const,
  },
  input: {
    background: "rgba(57,255,20,0.04)",
    border: "1px solid rgba(57,255,20,0.18)",
    color: GREEN,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    padding: "5px 8px",
    width: "100%",
    outline: "none",
    borderRadius: 2,
    boxSizing: "border-box" as const,
  },
  select: {
    background: "#000",
    border: "1px solid rgba(57,255,20,0.18)",
    color: GREEN,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    padding: "4px 6px",
    outline: "none",
    borderRadius: 2,
    cursor: "pointer" as const,
  },
  genBtn: (busy: boolean) => ({
    background: busy ? "rgba(57,255,20,0.05)" : "rgba(57,255,20,0.1)",
    border: `1px solid ${busy ? "rgba(57,255,20,0.15)" : "rgba(57,255,20,0.4)"}`,
    color: busy ? DIM : GREEN,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const,
    padding: "7px 16px",
    cursor: busy ? ("not-allowed" as const) : ("pointer" as const),
    borderRadius: 2,
    alignSelf: "flex-end" as const,
    flexShrink: 0,
  }),
  statusLine: (ok: boolean) => ({
    fontSize: 9,
    color: ok ? GREEN : RED,
    marginTop: 6,
    letterSpacing: "0.08em",
  }),
  hint: {
    fontSize: 8,
    color: "rgba(57,255,20,0.2)",
    marginTop: 4,
  },
  gallery: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "12px 14px",
  },
  galleryTitle: {
    fontSize: 8,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: DIM,
    marginBottom: 10,
  },
  grid: {
    display: "grid" as const,
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 10,
  },
  card: {
    border: `1px solid ${BORDER}`,
    borderRadius: 3,
    overflow: "hidden" as const,
    background: "rgba(57,255,20,0.02)",
  },
  cardThumb: {
    width: "100%",
    aspectRatio: "1/1",
    objectFit: "cover" as const,
    display: "block" as const,
  },
  cardVideo: {
    width: "100%",
    display: "block" as const,
  },
  cardBody: { padding: "6px 8px" },
  cardPrompt: {
    fontSize: 9,
    color: "rgba(57,255,20,0.6)",
    marginBottom: 4,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
  },
  cardMeta: {
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    gap: 4,
    flexWrap: "wrap" as const,
  },
  cardDate: { fontSize: 8, color: "rgba(57,255,20,0.3)" },
  badge: (status: GenerationStatus) => ({
    fontSize: 7,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    padding: "1px 5px",
    borderRadius: 2,
    border: `1px solid ${status === "completed" ? "rgba(57,255,20,0.3)" : status === "failed" ? "rgba(255,69,69,0.4)" : "rgba(200,168,75,0.4)"}`,
    color: status === "completed" ? GREEN : status === "failed" ? RED : GOLD,
  }),
  animateBtn: {
    background: "none",
    border: "1px solid rgba(57,255,20,0.2)",
    color: "rgba(57,255,20,0.5)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 7,
    padding: "1px 5px",
    cursor: "pointer" as const,
    borderRadius: 2,
    letterSpacing: "0.1em",
  },
  deleteBtn: {
    background: "none",
    border: "1px solid rgba(255,69,69,0.2)",
    color: "rgba(255,69,69,0.4)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 7,
    padding: "1px 5px",
    cursor: "pointer" as const,
    borderRadius: 2,
    lineHeight: 1,
  },
  placeholderThumb: (status: GenerationStatus) => ({
    width: "100%",
    aspectRatio: "1/1" as const,
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    background:
      status === "generating"
        ? "rgba(200,168,75,0.05)"
        : status === "failed"
          ? "rgba(255,69,69,0.05)"
          : "rgba(57,255,20,0.04)",
    fontSize: 20,
  }),
  errorMsg: {
    fontSize: 8,
    color: RED,
    marginTop: 2,
    letterSpacing: "0.06em",
    wordBreak: "break-word" as const,
  },
  emptyState: {
    fontSize: 9,
    color: DIM,
    textAlign: "center" as const,
    padding: "40px 0",
    letterSpacing: "0.12em",
  },
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ─── generation card ──────────────────────────────────────────────────────────

type GenerationCardProps = {
  gen: GenerationMeta;
  onRefresh: () => void;
  onAnimate: (sourceId: string, sourcePrompt: string) => void;
  onDelete: (id: string) => void;
};

const GenerationCard = ({ gen, onRefresh, onAnimate, onDelete }: GenerationCardProps) => {
  const isVideo = gen.mode === "image2video";

  // biome-ignore lint/correctness/useExhaustiveDependencies: onRefresh excluded intentionally
  useEffect(() => {
    if (gen.status !== "generating") return;
    const timer = setInterval(async () => {
      try {
        const r = await apiFetch(buildGeneratorItemUrl(gen.id));
        if (!r.ok) return;
        const updated = (await r.json()) as GenerationMeta;
        if (updated.status !== "generating") onRefresh();
      } catch {
        // keep polling
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [gen.id, gen.status]);

  return (
    <div style={s.card}>
      {gen.status === "completed" && gen.resultUrl ? (
        isVideo ? (
          // biome-ignore lint/a11y/useMediaCaption: generated content
          <video src={gen.resultUrl} controls style={s.cardVideo} />
        ) : (
          <img src={gen.resultUrl} alt={gen.prompt} style={s.cardThumb} />
        )
      ) : (
        <div style={s.placeholderThumb(gen.status)}>
          {gen.status === "generating" ? "⏳" : gen.status === "failed" ? "✗" : "?"}
        </div>
      )}
      <div style={s.cardBody}>
        <div style={s.cardPrompt} title={gen.prompt}>
          {gen.prompt}
        </div>
        {gen.status === "failed" && gen.errorMessage && (
          <div style={s.errorMsg}>{gen.errorMessage}</div>
        )}
        <div style={s.cardMeta}>
          <span style={s.cardDate}>{fmtDate(gen.created)}</span>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {gen.status === "completed" && !isVideo && (
              <button
                type="button"
                style={s.animateBtn}
                onClick={() => onAnimate(gen.id, gen.prompt)}
              >
                → Animate
              </button>
            )}
            <span style={s.badge(gen.status)}>{gen.status}</span>
            <button
              type="button"
              style={s.deleteBtn}
              onClick={() => onDelete(gen.id)}
              title="Delete"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── main view ────────────────────────────────────────────────────────────────

export const GeneratorPrimaryView = () => {
  const [mode, setMode] = useState<GenerationMode>("text2image");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [videoAspect, setVideoAspect] = useState("16:9");

  // For animate mode: either a local imageId or an external imageUrl
  const [sourceImageId, setSourceImageId] = useState<string | null>(null);
  const [sourceImagePrompt, setSourceImagePrompt] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [generations, setGenerations] = useState<GenerationMeta[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [apiStatus, setApiStatus] = useState<GeneratorStatus | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Check API key presence + model availability
  useEffect(() => {
    apiFetch(buildGeneratorStatusUrl())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (mountedRef.current && data) setApiStatus(data as GeneratorStatus);
      })
      .catch(() => {
        // non-fatal
      });
  }, []);

  const loadGenerations = useCallback(async () => {
    try {
      const r = await apiFetch(buildGeneratorUrl());
      if (!r.ok || !mountedRef.current) return;
      const data = (await r.json()) as { generations: GenerationMeta[] };
      setGenerations(data.generations ?? []);
    } catch {
      // non-fatal
    } finally {
      if (mountedRef.current) setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadGenerations();
  }, [loadGenerations]);

  // Called when user clicks "→ Animate" on an image card
  const handleAnimateFromCard = useCallback((sourceId: string, srcPrompt: string) => {
    setMode("image2video");
    setSourceImageId(sourceId);
    setSourceImagePrompt(srcPrompt);
    setImageUrl("");
    setPrompt(`Animate: ${srcPrompt}`);
    setStatusMsg(null);
  }, []);

  const clearSource = useCallback(() => {
    setSourceImageId(null);
    setSourceImagePrompt(null);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await apiFetch(buildGeneratorDeleteUrl(id), { method: "DELETE" });
        await loadGenerations();
      } catch {
        // non-fatal — gallery will still show the item
      }
    },
    [loadGenerations],
  );

  const handleGenerate = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || busy) return;

    setBusy(true);
    setStatusMsg(null);

    try {
      if (mode === "text2image") {
        setStatusMsg({ text: "Imagen 3 generating… (~5-15s)", ok: true });
        const r = await apiFetch(buildGeneratorImageUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmedPrompt, aspectRatio }),
        });
        const data = (await r.json()) as GenerationMeta & { error?: string };
        if (!r.ok) {
          setStatusMsg({ text: data.error ?? "Generation failed.", ok: false });
        } else {
          setStatusMsg({ text: "Image generated.", ok: true });
          setPrompt("");
          await loadGenerations();
        }
      } else {
        const hasSource = sourceImageId || imageUrl.trim();
        setStatusMsg({
          text: hasSource
            ? "Veo 2 animating image… (~60-180s in background)"
            : "Veo 2 generating video from text… (~60-180s in background)",
          ok: true,
        });
        const r = await apiFetch(buildGeneratorAnimateUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: trimmedPrompt,
            imageId: sourceImageId ?? undefined,
            imageUrl: imageUrl.trim() || undefined,
            aspectRatio: videoAspect,
          }),
        });
        const data = (await r.json()) as GenerationMeta & { error?: string };
        if (!r.ok) {
          setStatusMsg({ text: data.error ?? "Video request failed.", ok: false });
        } else {
          setStatusMsg({ text: "Video job queued — watch gallery for status.", ok: true });
          setPrompt("");
          setImageUrl("");
          setSourceImageId(null);
          setSourceImagePrompt(null);
          await loadGenerations();
        }
      }
    } catch {
      setStatusMsg({ text: "Network error. Is Jarvis running?", ok: false });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [mode, prompt, aspectRatio, videoAspect, imageUrl, sourceImageId, busy, loadGenerations]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleGenerate();
    },
    [handleGenerate],
  );

  const keyPresent = apiStatus?.geminiKeyPresent ?? null;

  return (
    <div style={s.panel}>
      {/* header */}
      <div style={s.hdr}>
        <div style={s.hdrLeft}>
          <span style={s.hdrTitle}>
            <span style={s.hdrStar}>✦</span>Generator · Google AI
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={s.keyDot(keyPresent)} />
            <span style={s.keyLabel(keyPresent)}>
              {keyPresent === null
                ? "checking…"
                : keyPresent
                  ? "API key OK"
                  : "GEMINI_API_KEY missing"}
            </span>
          </span>
        </div>
        <div style={s.hdrRight}>
          <button type="button" style={s.hdrBtn} onClick={() => void loadGenerations()}>
            ↻ Refresh
          </button>
        </div>
      </div>

      <div style={s.body}>
        {/* create panel */}
        <div style={s.createPanel}>
          {/* mode tabs */}
          <div style={s.modeTabs}>
            <button
              type="button"
              style={s.modeTab(mode === "text2image")}
              onClick={() => setMode("text2image")}
            >
              Text → Image
            </button>
            <button
              type="button"
              style={s.modeTab(mode === "image2video")}
              onClick={() => setMode("image2video")}
            >
              → Video
            </button>
          </div>

          {/* source image for animate mode */}
          {mode === "image2video" &&
            (sourceImageId ? (
              <div style={s.sourceBadge}>
                <span>⬡ Local image: {sourceImagePrompt ?? sourceImageId}</span>
                <button
                  type="button"
                  onClick={clearSource}
                  style={{
                    background: "none",
                    border: "none",
                    color: DIM,
                    cursor: "pointer",
                    fontSize: 10,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div style={{ marginBottom: 8 }}>
                <label htmlFor="gen-image-url" style={s.label}>
                  Source image URL (optional — leave blank for text-to-video)
                </label>
                <input
                  id="gen-image-url"
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://… or leave blank"
                  style={s.input}
                />
              </div>
            ))}

          {/* prompt */}
          <div style={{ marginBottom: 8 }}>
            <label htmlFor="gen-prompt" style={s.label}>
              {mode === "text2image" ? "Prompt" : "Motion / scene description"}
            </label>
            <textarea
              id="gen-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === "text2image"
                  ? "Describe what to generate…"
                  : "Describe the motion, camera movement, or scene…"
              }
              style={s.textarea}
            />
          </div>

          {/* options row */}
          <div style={s.row}>
            {mode === "text2image" ? (
              <div>
                <label htmlFor="gen-aspect" style={s.label}>
                  Aspect
                </label>
                <select
                  id="gen-aspect"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  style={s.select}
                >
                  {["1:1", "16:9", "9:16", "4:3", "3:4"].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label htmlFor="gen-video-aspect" style={s.label}>
                  Aspect
                </label>
                <select
                  id="gen-video-aspect"
                  value={videoAspect}
                  onChange={(e) => setVideoAspect(e.target.value)}
                  style={s.select}
                >
                  {["16:9", "9:16", "1:1"].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="button"
              style={s.genBtn(busy)}
              onClick={() => void handleGenerate()}
              disabled={busy}
            >
              {busy ? "Generating…" : mode === "text2image" ? "✦ Generate" : "✦ Generate Video"}
            </button>
          </div>

          {/* status */}
          {statusMsg && <div style={s.statusLine(statusMsg.ok)}>{statusMsg.text}</div>}

          <div style={s.hint}>
            {mode === "text2image"
              ? "Ctrl+↵ to generate · Imagen 3 (Google AI) · uses your GEMINI_API_KEY"
              : "Veo 2 (Google AI) · 8s video · job runs in background · uses your GEMINI_API_KEY"}
          </div>
        </div>

        {/* gallery */}
        <div style={s.gallery}>
          <div style={s.galleryTitle}>Gallery ({generations.length})</div>
          {loadingList ? (
            <div style={s.emptyState}>Loading…</div>
          ) : generations.length === 0 ? (
            <div style={s.emptyState}>No generations yet. Generate something above.</div>
          ) : (
            <div style={s.grid}>
              {generations.map((gen) => (
                <GenerationCard
                  key={gen.id}
                  gen={gen}
                  onRefresh={() => void loadGenerations()}
                  onAnimate={handleAnimateFromCard}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
