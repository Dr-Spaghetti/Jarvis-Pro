import { type CSSProperties, useCallback, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import { buildTerminalsUrl } from "../runtime/runtimeEndpoints";
import { Terminal } from "./Terminal";

type Session = { id: string; label: string };

const CLAUDE_MODELS = [
  { value: "claude-opus-4-8", label: "Opus 4.8  — reasoning" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 — balanced" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — fast / cheap" },
];

export const TerminalPrimaryView = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [provider, setProvider] = useState<"claude-code" | "codex">("claude-code");
  const [claudeModel, setClaudeModel] = useState(CLAUDE_MODELS[0]?.value ?? "claude-sonnet-4-6");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");

  const launch = useCallback(async () => {
    setLaunching(true);
    setLaunchError("");
    try {
      const bootstrapCommand =
        provider === "codex"
          ? "codex --approval-mode full-auto"
          : `claude --model ${claudeModel} --dangerously-skip-permissions`;

      const modelLabel =
        provider === "codex"
          ? "Codex"
          : (CLAUDE_MODELS.find((m) => m.value === claudeModel)?.label ?? claudeModel);
      const sessionLabel = `${modelLabel} #${sessions.length + 1}`;

      const res = await apiFetch(buildTerminalsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceMode: "shared",
          agentProvider: provider,
          bootstrapCommand,
          name: sessionLabel,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      const data = (await res.json()) as { terminalId?: string };
      if (!data.terminalId) throw new Error("No terminalId returned");

      const newSession: Session = { id: data.terminalId, label: sessionLabel };
      setSessions((prev) => [...prev, newSession]);
      setActiveId(data.terminalId);
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Failed to launch session");
    } finally {
      setLaunching(false);
    }
  }, [provider, claudeModel, sessions.length]);

  const closeSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        return next[next.length - 1]?.id ?? null;
      });
      return next;
    });
  }, []);

  const barStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid rgba(57,255,20,0.12)",
    background: "rgba(0,0,0,0.4)",
    flexShrink: 0,
    flexWrap: "wrap",
  };

  const btnBase: CSSProperties = {
    fontFamily: "var(--font-display)",
    fontSize: 10,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    padding: "4px 10px",
    border: "1px solid rgba(57,255,20,0.25)",
    background: "transparent",
    color: "rgba(57,255,20,0.5)",
    cursor: "pointer",
    borderRadius: 2,
  };

  const btnActive: CSSProperties = {
    ...btnBase,
    border: "1px solid rgba(57,255,20,0.7)",
    color: "rgba(57,255,20,1)",
    background: "rgba(57,255,20,0.08)",
  };

  const selectStyle: CSSProperties = {
    fontFamily: "var(--font-display)",
    fontSize: 10,
    letterSpacing: ".1em",
    background: "rgba(0,0,0,0.6)",
    color: "rgba(57,255,20,0.85)",
    border: "1px solid rgba(57,255,20,0.25)",
    padding: "3px 6px",
    borderRadius: 2,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0a0a0a",
        overflow: "hidden",
      }}
    >
      {/* Launcher bar */}
      <div style={barStyle}>
        {/* Provider toggle */}
        <button
          type="button"
          style={provider === "claude-code" ? btnActive : btnBase}
          onClick={() => setProvider("claude-code")}
        >
          Claude
        </button>
        <button
          type="button"
          style={provider === "codex" ? btnActive : btnBase}
          onClick={() => setProvider("codex")}
        >
          Codex
        </button>

        {/* Model picker — only for Claude */}
        {provider === "claude-code" && (
          <select
            style={selectStyle}
            value={claudeModel}
            onChange={(e) => setClaudeModel(e.target.value)}
            aria-label="Claude model"
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        )}

        {/* Launch */}
        <button
          type="button"
          style={{
            ...btnBase,
            marginLeft: 4,
            border: "1px solid rgba(57,255,20,0.6)",
            color: "rgba(57,255,20,1)",
            background: launching ? "rgba(57,255,20,0.06)" : "transparent",
          }}
          disabled={launching}
          onClick={() => {
            void launch();
          }}
        >
          {launching ? "Launching…" : "+ New Session"}
        </button>

        {launchError && (
          <span style={{ fontSize: 9, color: "var(--term-red, #ff4444)", marginLeft: 4 }}>
            ⚠ {launchError}
          </span>
        )}
      </div>

      {/* Session tab strip (only shown when >1 session) */}
      {sessions.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "4px 8px",
            borderBottom: "1px solid rgba(57,255,20,0.08)",
            background: "rgba(0,0,0,0.3)",
            flexShrink: 0,
            overflowX: "auto",
          }}
        >
          {sessions.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                fontSize: 9,
                fontFamily: "var(--font-display)",
                letterSpacing: ".1em",
                cursor: "pointer",
                borderRadius: 2,
                background: s.id === activeId ? "rgba(57,255,20,0.1)" : "transparent",
                color: s.id === activeId ? "rgba(57,255,20,1)" : "rgba(57,255,20,0.4)",
                border:
                  s.id === activeId ? "1px solid rgba(57,255,20,0.35)" : "1px solid transparent",
                whiteSpace: "nowrap",
              }}
              onClick={() => setActiveId(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setActiveId(s.id);
              }}
              role="button"
              tabIndex={0}
            >
              {s.label}
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                  opacity: 0.6,
                  fontSize: 10,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  closeSession(s.id);
                }}
                aria-label={`Close ${s.label}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Terminal area */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {activeId ? (
          <Terminal
            key={activeId}
            terminalId={activeId}
            {...(sessions.find((s) => s.id === activeId)?.label
              ? { terminalLabel: sessions.find((s) => s.id === activeId)?.label ?? "" }
              : {})}
            isSelected
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 12,
              color: "rgba(57,255,20,0.25)",
              fontFamily: "var(--font-display)",
              fontSize: 11,
              letterSpacing: ".14em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ fontSize: 32, opacity: 0.15 }}>⌨</span>
            <span>Select a provider and click + New Session</span>
          </div>
        )}
      </div>
    </div>
  );
};
