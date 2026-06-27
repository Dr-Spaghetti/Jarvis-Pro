import { useState } from "react";

const nc = {
  view: {
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
    padding: "10px 16px",
    borderBottom: "1px solid rgba(57,255,20,0.14)",
    flexShrink: 0,
  },
  hdrTitle: {
    fontSize: 9,
    letterSpacing: "0.28em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.35)",
  },
  newBtn: {
    background: "rgba(57,255,20,0.08)",
    border: "1px solid rgba(57,255,20,0.3)",
    color: "#39ff14",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "5px 12px",
    cursor: "pointer",
  },
  body: {
    flex: 1,
    display: "flex" as const,
    flexDirection: "column" as const,
    minHeight: 0,
    overflow: "hidden" as const,
  },
  cols: {
    flex: 1,
    display: "grid" as const,
    gridTemplateColumns: "220px 1fr",
    minHeight: 0,
    overflow: "hidden" as const,
  },
  sidebar: {
    borderRight: "1px solid rgba(57,255,20,0.1)",
    display: "flex" as const,
    flexDirection: "column" as const,
    overflow: "hidden" as const,
  },
  sideHdr: {
    padding: "8px 12px",
    borderBottom: "1px solid rgba(57,255,20,0.08)",
    fontSize: 8,
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.25)",
    flexShrink: 0,
  },
  sideList: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "6px 0",
  },
  sideItem: (active: boolean) => ({
    display: "block" as const,
    width: "100%",
    textAlign: "left" as const,
    padding: "7px 14px",
    background: active ? "rgba(57,255,20,0.07)" : "none",
    borderLeft: `2px solid ${active ? "#39ff14" : "transparent"}`,
    border: "none",
    borderLeftStyle: "solid" as const,
    borderLeftWidth: 2,
    borderLeftColor: active ? "#39ff14" : "transparent",
    color: active ? "#d8ecd8" : "rgba(57,255,20,0.35)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    letterSpacing: "0.06em",
    cursor: "pointer",
  }),
  main: {
    flex: 1,
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 16,
    padding: 24,
    overflowY: "auto" as const,
  },
  emptyGlyph: {
    fontSize: 28,
    color: "rgba(57,255,20,0.12)",
    userSelect: "none" as const,
  },
  emptyTitle: {
    fontSize: 10,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.2)",
    margin: 0,
  },
  emptyDesc: {
    fontSize: 10,
    color: "rgba(57,255,20,0.18)",
    textAlign: "center" as const,
    maxWidth: 340,
    lineHeight: 1.7,
    margin: 0,
  },
  createBtn: {
    background: "none",
    border: "1px solid rgba(57,255,20,0.3)",
    color: "rgba(57,255,20,0.6)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    padding: "7px 18px",
    cursor: "pointer",
    marginTop: 8,
    transition: "all 0.12s",
  },
  form: {
    width: "100%",
    maxWidth: 480,
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.18)",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 0,
  },
  formHdr: {
    padding: "10px 14px",
    borderBottom: "1px solid rgba(57,255,20,0.1)",
    fontSize: 9,
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.4)",
  },
  formBody: {
    padding: "14px",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 12,
  },
  fieldRow: {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 4,
  },
  label: {
    fontSize: 8,
    letterSpacing: "0.15em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.3)",
  },
  textInput: {
    background: "#000",
    border: "1px solid rgba(57,255,20,0.2)",
    color: "#d0e8d0",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    padding: "6px 10px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  stepHint: {
    fontSize: 9,
    color: "rgba(57,255,20,0.2)",
    lineHeight: 1.6,
  },
  formFoot: {
    padding: "10px 14px",
    borderTop: "1px solid rgba(57,255,20,0.08)",
    display: "flex" as const,
    gap: 8,
    justifyContent: "flex-end" as const,
  },
  cancelBtn: {
    background: "none",
    border: "1px solid rgba(57,255,20,0.14)",
    color: "rgba(57,255,20,0.35)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "5px 10px",
    cursor: "pointer",
  },
  saveBtn: (disabled: boolean) => ({
    background: disabled ? "rgba(57,255,20,0.05)" : "rgba(57,255,20,0.1)",
    border: "1px solid rgba(57,255,20,0.3)",
    color: disabled ? "rgba(57,255,20,0.25)" : "#39ff14",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "5px 12px",
    cursor: disabled ? "not-allowed" : "pointer",
  }),
};

type Workflow = { id: string; name: string; description: string; steps: string };

export const WorkflowsPrimaryView = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", steps: "" });

  const save = () => {
    if (!draft.name.trim()) return;
    const w: Workflow = {
      id: `wf-${Date.now()}`,
      name: draft.name.trim(),
      description: draft.description.trim(),
      steps: draft.steps.trim(),
    };
    setWorkflows((prev) => [...prev, w]);
    setSelected(w.id);
    setCreating(false);
    setDraft({ name: "", description: "", steps: "" });
  };

  const active = workflows.find((w) => w.id === selected) ?? null;

  return (
    <section aria-label="Workflows primary view" style={nc.view}>
      <header style={nc.hdr}>
        <span style={nc.hdrTitle}>⟐ Workflows</span>
        <button
          type="button"
          style={nc.newBtn}
          onClick={() => {
            setCreating(true);
            setSelected(null);
          }}
        >
          + New Workflow
        </button>
      </header>

      <div style={nc.body}>
        {workflows.length === 0 && !creating ? (
          <div style={nc.main}>
            <span style={nc.emptyGlyph}>⟐</span>
            <p style={nc.emptyTitle}>No workflows yet</p>
            <p style={nc.emptyDesc}>
              Workflows chain skills, prompts, and brain queries into repeatable automated pipelines.
              Design one here and run it from Jarvis HQ.
            </p>
            <button
              type="button"
              style={nc.createBtn}
              onClick={() => setCreating(true)}
            >
              Design first workflow
            </button>
          </div>
        ) : (
          <div style={nc.cols}>
            {/* Sidebar list */}
            <div style={nc.sidebar}>
              <div style={nc.sideHdr}>Library</div>
              <div style={nc.sideList}>
                {workflows.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    style={nc.sideItem(selected === w.id)}
                    onClick={() => {
                      setSelected(w.id);
                      setCreating(false);
                    }}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Main area */}
            <div style={nc.main}>
              {creating ? (
                <div style={nc.form}>
                  <div style={nc.formHdr}>New Workflow</div>
                  <div style={nc.formBody}>
                    <div style={nc.fieldRow}>
                      <label style={nc.label} htmlFor="wf-name">Name</label>
                      <input
                        id="wf-name"
                        style={nc.textInput}
                        type="text"
                        placeholder="e.g. Morning Brief"
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      />
                    </div>
                    <div style={nc.fieldRow}>
                      <label style={nc.label} htmlFor="wf-desc">Description</label>
                      <input
                        id="wf-desc"
                        style={nc.textInput}
                        type="text"
                        placeholder="What does this workflow do?"
                        value={draft.description}
                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      />
                    </div>
                    <div style={nc.fieldRow}>
                      <label style={nc.label} htmlFor="wf-steps">Steps</label>
                      <textarea
                        id="wf-steps"
                        style={{ ...nc.textInput, minHeight: 80, resize: "vertical" as const }}
                        placeholder={"Step 1: Fetch brain digest\nStep 2: Summarize open tasks\nStep 3: Draft priority list"}
                        value={draft.steps}
                        onChange={(e) => setDraft((d) => ({ ...d, steps: e.target.value }))}
                      />
                      <span style={nc.stepHint}>One step per line. Jarvis will execute each step in sequence.</span>
                    </div>
                  </div>
                  <div style={nc.formFoot}>
                    <button
                      type="button"
                      style={nc.cancelBtn}
                      onClick={() => {
                        setCreating(false);
                        setDraft({ name: "", description: "", steps: "" });
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      style={nc.saveBtn(!draft.name.trim())}
                      disabled={!draft.name.trim()}
                      onClick={save}
                    >
                      Save Workflow
                    </button>
                  </div>
                </div>
              ) : active ? (
                <div style={{ width: "100%", maxWidth: 480 }}>
                  <p style={{ ...nc.emptyTitle, color: "#39ff14", marginBottom: 10 }}>{active.name}</p>
                  {active.description && (
                    <p style={{ ...nc.emptyDesc, marginBottom: 14, textAlign: "left" as const }}>{active.description}</p>
                  )}
                  {active.steps && (
                    <pre
                      style={{
                        background: "#050705",
                        border: "1px solid rgba(57,255,20,0.12)",
                        padding: "12px 14px",
                        fontSize: 10,
                        color: "rgba(57,255,20,0.55)",
                        whiteSpace: "pre-wrap" as const,
                        lineHeight: 1.8,
                        margin: 0,
                      }}
                    >
                      {active.steps}
                    </pre>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
