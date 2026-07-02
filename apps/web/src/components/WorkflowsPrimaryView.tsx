import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import {
  buildWorkflowImproveUrl,
  buildWorkflowItemUrl,
  buildWorkflowRunHistoryUrl,
  buildWorkflowRunUrl,
  buildWorkflowsUrl,
} from "../runtime/runtimeEndpoints";

type Workflow = {
  id: string;
  name: string;
  description: string;
  steps: string;
  created: string;
  updated: string;
};

type RunStep = { step: string; answer: string; durationMs?: number };

type WorkflowRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  completedAt: string;
  status: "ok" | "error";
  steps: RunStep[];
};

type StepStatus = "pending" | "running" | "done" | "error";

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
    minHeight: 0,
    overflowY: "auto" as const,
    padding: 24,
    gap: 16,
  },
  mainCentered: {
    flex: 1,
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 16,
    padding: 24,
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
  detailCard: {
    width: "100%",
    maxWidth: 600,
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 0,
  },
  detailName: {
    fontSize: 13,
    color: "#39ff14",
    fontWeight: "bold" as const,
    margin: "0 0 8px",
    letterSpacing: "0.08em",
  },
  detailDesc: {
    fontSize: 10,
    color: "rgba(57,255,20,0.5)",
    marginBottom: 14,
  },
  stepsBlock: {
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.12)",
    padding: "12px 14px",
    fontSize: 10,
    color: "rgba(57,255,20,0.55)",
    whiteSpace: "pre-wrap" as const,
    lineHeight: 1.8,
    margin: 0,
  },
  detailActions: {
    display: "flex" as const,
    gap: 8,
    marginTop: 14,
  },
  runBtn: (running: boolean) => ({
    background: running ? "rgba(57,255,20,0.05)" : "rgba(57,255,20,0.12)",
    border: `1px solid ${running ? "rgba(57,255,20,0.2)" : "rgba(57,255,20,0.45)"}`,
    color: running ? "rgba(57,255,20,0.4)" : "#39ff14",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    padding: "6px 14px",
    cursor: running ? "not-allowed" : "pointer",
  }),
  deleteBtn: {
    background: "none",
    border: "1px solid rgba(255,80,80,0.25)",
    color: "rgba(255,80,80,0.5)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "6px 10px",
    cursor: "pointer",
  },
  divider: {
    height: 1,
    background: "rgba(57,255,20,0.08)",
    margin: "18px 0",
  },
  sectionLabel: {
    fontSize: 8,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.22)",
    marginBottom: 10,
  },
  // Live step progress
  liveStepsBox: {
    background: "#050705",
    border: "1px solid rgba(57,255,20,0.18)",
    marginTop: 14,
  },
  liveStepsHdr: {
    padding: "8px 12px",
    borderBottom: "1px solid rgba(57,255,20,0.08)",
    fontSize: 8,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.3)",
  },
  liveStep: (status: StepStatus) => ({
    padding: "10px 12px",
    borderBottom: "1px solid rgba(57,255,20,0.06)",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 4,
    background:
      status === "running"
        ? "rgba(57,255,20,0.04)"
        : "transparent",
  }),
  liveStepRow: {
    display: "flex" as const,
    alignItems: "flex-start" as const,
    gap: 8,
  },
  liveStepIcon: (status: StepStatus) => ({
    fontSize: 10,
    flexShrink: 0,
    marginTop: 1,
    color:
      status === "done"
        ? "#39ff14"
        : status === "error"
          ? "rgba(255,80,80,0.8)"
          : status === "running"
            ? "rgba(57,255,20,0.7)"
            : "rgba(57,255,20,0.2)",
  }),
  liveStepText: (status: StepStatus) => ({
    fontSize: 10,
    color:
      status === "running"
        ? "#d8ecd8"
        : status === "done" || status === "error"
          ? "rgba(57,255,20,0.55)"
          : "rgba(57,255,20,0.25)",
    lineHeight: 1.5,
  }),
  liveStepAnswer: {
    fontSize: 10,
    color: "#c8dcc8",
    lineHeight: 1.6,
    paddingLeft: 18,
    marginTop: 2,
  },
  liveStepAnswerError: {
    fontSize: 10,
    color: "rgba(255,80,80,0.65)",
    lineHeight: 1.6,
    paddingLeft: 18,
    marginTop: 2,
    fontStyle: "italic" as const,
  },
  liveStepDuration: {
    fontSize: 8,
    color: "rgba(57,255,20,0.2)",
    paddingLeft: 18,
  },
  liveStepConnector: {
    fontSize: 9,
    color: "rgba(57,255,20,0.15)",
    padding: "4px 12px",
    textAlign: "center" as const,
    userSelect: "none" as const,
  },
  runError: {
    fontSize: 10,
    color: "rgba(255,80,80,0.7)",
    padding: "8px 10px",
    border: "1px solid rgba(255,80,80,0.2)",
    background: "rgba(255,80,80,0.04)",
    marginTop: 12,
  },
  // Run history
  historyList: {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 6,
  },
  historyItem: (expanded: boolean) => ({
    background: "#050705",
    border: `1px solid ${expanded ? "rgba(57,255,20,0.22)" : "rgba(57,255,20,0.1)"}`,
    cursor: "pointer" as const,
  }),
  historyItemHdr: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: "8px 12px",
    gap: 8,
  },
  historyBadge: (status: "ok" | "error") => ({
    fontSize: 8,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "2px 6px",
    background:
      status === "ok" ? "rgba(57,255,20,0.08)" : "rgba(255,80,80,0.08)",
    border: `1px solid ${status === "ok" ? "rgba(57,255,20,0.22)" : "rgba(255,80,80,0.22)"}`,
    color: status === "ok" ? "#39ff14" : "rgba(255,80,80,0.8)",
    flexShrink: 0,
  }),
  historyMeta: {
    fontSize: 9,
    color: "rgba(57,255,20,0.3)",
    flex: 1,
  },
  historyExpandedSteps: {
    borderTop: "1px solid rgba(57,255,20,0.08)",
    padding: "10px 12px",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 8,
  },
  historyStep: {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 3,
  },
  historyStepLabel: {
    fontSize: 8,
    color: "rgba(57,255,20,0.25)",
    letterSpacing: "0.08em",
  },
  historyStepAnswer: {
    fontSize: 10,
    color: "#c0d8c0",
    lineHeight: 1.6,
  },
  // Inline editing
  editBtn: {
    background: "none",
    border: "1px solid rgba(57,255,20,0.2)",
    color: "rgba(57,255,20,0.45)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "6px 10px",
    cursor: "pointer",
  },
  saveEditBtn: {
    background: "rgba(57,255,20,0.1)",
    border: "1px solid rgba(57,255,20,0.4)",
    color: "#39ff14",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "6px 12px",
    cursor: "pointer",
  },
  improveBtn: (busy: boolean) => ({
    background: busy ? "rgba(57,255,20,0.03)" : "rgba(57,255,20,0.07)",
    border: `1px solid ${busy ? "rgba(57,255,20,0.15)" : "rgba(57,255,20,0.35)"}`,
    color: busy ? "rgba(57,255,20,0.3)" : "rgba(57,255,20,0.8)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "6px 12px",
    cursor: busy ? "not-allowed" : "pointer",
  }),
  stepsEditArea: {
    background: "#000",
    border: "1px solid rgba(57,255,20,0.28)",
    color: "#d0e8d0",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    padding: "10px 12px",
    width: "100%",
    minHeight: 120,
    resize: "vertical" as const,
    lineHeight: 1.8,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  // Improvement panel
  improvePanel: {
    background: "#020a02",
    border: "1px solid rgba(57,255,20,0.28)",
    marginTop: 14,
  },
  improvePanelHdr: {
    padding: "8px 12px",
    borderBottom: "1px solid rgba(57,255,20,0.1)",
    fontSize: 8,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: "rgba(57,255,20,0.45)",
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  improveRationale: {
    padding: "8px 12px",
    fontSize: 10,
    color: "rgba(57,255,20,0.55)",
    lineHeight: 1.6,
    borderBottom: "1px solid rgba(57,255,20,0.07)",
  },
  improveStepsPreview: {
    padding: "10px 12px",
    fontSize: 10,
    color: "#b8d8b8",
    whiteSpace: "pre-wrap" as const,
    lineHeight: 1.8,
    borderBottom: "1px solid rgba(57,255,20,0.07)",
  },
  improvePanelActions: {
    padding: "8px 12px",
    display: "flex" as const,
    gap: 8,
    justifyContent: "flex-end" as const,
  },
  applyBtn: {
    background: "rgba(57,255,20,0.12)",
    border: "1px solid rgba(57,255,20,0.45)",
    color: "#39ff14",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "5px 14px",
    cursor: "pointer",
  },
  dismissBtn: {
    background: "none",
    border: "1px solid rgba(57,255,20,0.12)",
    color: "rgba(57,255,20,0.3)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    padding: "5px 10px",
    cursor: "pointer",
  },
  // Step stats
  stepStats: {
    display: "flex" as const,
    flexWrap: "wrap" as const,
    gap: "6px 16px",
    padding: "8px 0 2px",
  },
  stepStat: {
    fontSize: 9,
    color: "rgba(57,255,20,0.28)",
    letterSpacing: "0.06em",
  },
};

const STEP_ICON: Record<StepStatus, string> = {
  pending: "○",
  running: "⟳",
  done: "✓",
  error: "✗",
};

const formatRelTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const formatDuration = (startedAt: string, completedAt: string): string => {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export const WorkflowsPrimaryView = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", steps: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Inline step editing
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  // AI improvement
  const [isImproving, setIsImproving] = useState(false);
  const [improvement, setImprovement] = useState<{ improvedSteps: string; rationale: string } | null>(null);
  // Live step progress during a run
  const [liveSteps, setLiveSteps] = useState<Array<{ step: string; status: StepStatus; answer?: string; durationMs?: number }>>([]);
  // Run history for the selected workflow
  const [runHistory, setRunHistory] = useState<WorkflowRun[]>([]);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await apiFetch(buildWorkflowsUrl(), { method: "GET" });
      if (!res.ok) return;
      const data = (await res.json()) as { workflows: Workflow[] };
      setWorkflows(Array.isArray(data.workflows) ? data.workflows : []);
    } catch {
      // ignore
    }
  }, []);

  const fetchRunHistory = useCallback(async (workflowId: string) => {
    try {
      const res = await apiFetch(buildWorkflowRunHistoryUrl(workflowId), { method: "GET" });
      if (!res.ok) return;
      const data = (await res.json()) as { runs: WorkflowRun[] };
      setRunHistory(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  useEffect(() => {
    if (selected) {
      setRunHistory([]);
      void fetchRunHistory(selected);
    }
  }, [selected, fetchRunHistory]);

  const handleSave = async () => {
    if (!draft.name.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const res = await apiFetch(buildWorkflowsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim(),
          steps: draft.steps.trim(),
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { workflow: Workflow };
      setWorkflows((prev) => [data.workflow, ...prev]);
      setSelected(data.workflow.id);
      setCreating(false);
      setDraft({ name: "", description: "", steps: "" });
    } catch {
      // stay in creating mode on error
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await apiFetch(buildWorkflowItemUrl(id), { method: "DELETE" });
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      if (selected === id) setSelected(null);
      setLiveSteps([]);
      setRunError(null);
      setRunHistory([]);
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveEdit = async (workflowId: string) => {
    if (isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      const res = await apiFetch(buildWorkflowItemUrl(workflowId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: editDraft.trim() }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { workflow: Workflow };
      setWorkflows((prev) => prev.map((w) => (w.id === workflowId ? data.workflow : w)));
      setIsEditing(false);
      setImprovement(null);
    } catch {
      // stay in edit mode on error
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleImprove = async (workflowId: string) => {
    if (isImproving) return;
    setIsImproving(true);
    setImprovement(null);
    try {
      const res = await apiFetch(buildWorkflowImproveUrl(workflowId), { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setRunError(data.error ?? "Improvement failed");
        return;
      }
      const data = (await res.json()) as { improvedSteps?: string; rationale?: string };
      if (data.improvedSteps) {
        setImprovement({ improvedSteps: data.improvedSteps, rationale: data.rationale ?? "" });
      } else {
        setRunError("Improvement returned no steps — try again.");
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Improvement failed");
    } finally {
      setIsImproving(false);
    }
  };

  const handleRun = async (workflow: Workflow) => {
    if (isRunning) return;
    setIsRunning(true);
    setRunError(null);
    setExpandedRunId(null);

    // Initialize live step display from the workflow definition
    const stepLines = workflow.steps
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const initialSteps = stepLines.map((step, i) => ({
      step,
      status: (i === 0 ? "running" : "pending") as StepStatus,
    }));
    setLiveSteps(initialSteps);

    try {
      const response = await apiFetch(buildWorkflowRunUrl(workflow.id), { method: "POST" });

      if (!response.ok || !response.body) {
        const data = (await response.json()) as { error?: string };
        setRunError(data.error ?? `Run failed (${response.status})`);
        setLiveSteps([]);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type?: string;
              stepIndex?: number;
              step?: string;
              answer?: string;
              durationMs?: number;
              error?: boolean;
              runId?: string;
              status?: string;
            };

            if (event.type === "step-start" && typeof event.stepIndex === "number") {
              setLiveSteps((prev) => {
                const next = [...prev];
                if (next[event.stepIndex!]) {
                  next[event.stepIndex!] = { ...next[event.stepIndex!]!, status: "running" };
                }
                return next;
              });
            } else if (event.type === "step-done" && typeof event.stepIndex === "number") {
              setLiveSteps((prev) => {
                const next = [...prev];
                const idx = event.stepIndex!;
                const cur = next[idx];
                if (cur) {
                  const updated: typeof cur = {
                    step: event.step ?? cur.step,
                    status: event.error ? "error" : "done",
                  };
                  if (event.answer !== undefined) updated.answer = event.answer;
                  if (event.durationMs !== undefined) updated.durationMs = event.durationMs;
                  next[idx] = updated;
                }
                return next;
              });
            }
          } catch {
            // skip malformed events
          }
        }
      }

      // Refresh run history after completion
      void fetchRunHistory(workflow.id);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed");
      setLiveSteps([]);
    } finally {
      setIsRunning(false);
    }
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
            setLiveSteps([]);
            setRunError(null);
            setRunHistory([]);
          }}
        >
          + New Workflow
        </button>
      </header>

      <div style={nc.body}>
        {workflows.length === 0 && !creating ? (
          <div style={nc.mainCentered}>
            <span style={nc.emptyGlyph}>⟐</span>
            <p style={nc.emptyTitle}>No workflows yet</p>
            <p style={nc.emptyDesc}>
              Workflows chain prompts and brain queries into repeatable automated pipelines. Design
              one here and run it on demand.
            </p>
            <button type="button" style={nc.createBtn} onClick={() => setCreating(true)}>
              Design first workflow
            </button>
          </div>
        ) : (
          <div style={nc.cols}>
            {/* Sidebar */}
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
                      setLiveSteps([]);
                      setRunError(null);
                      setIsEditing(false);
                      setImprovement(null);
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
                      <label style={nc.label} htmlFor="wf-name">
                        Name
                      </label>
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
                      <label style={nc.label} htmlFor="wf-desc">
                        Description
                      </label>
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
                      <label style={nc.label} htmlFor="wf-steps">
                        Steps
                      </label>
                      <textarea
                        id="wf-steps"
                        style={{ ...nc.textInput, minHeight: 80, resize: "vertical" as const }}
                        placeholder={
                          "Step 1: Fetch brain digest\nStep 2: Summarize open tasks\nStep 3: Draft priority list"
                        }
                        value={draft.steps}
                        onChange={(e) => setDraft((d) => ({ ...d, steps: e.target.value }))}
                      />
                      <span style={nc.stepHint}>
                        One step per line. Each step's answer is passed as context to the next —
                        chain prompts to build multi-step reasoning pipelines.
                      </span>
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
                      style={nc.saveBtn(!draft.name.trim() || isSaving)}
                      disabled={!draft.name.trim() || isSaving}
                      onClick={() => void handleSave()}
                    >
                      {isSaving ? "Saving…" : "Save Workflow"}
                    </button>
                  </div>
                </div>
              ) : active ? (
                <div style={nc.detailCard}>
                  <p style={nc.detailName}>{active.name}</p>
                  {active.description && <p style={nc.detailDesc}>{active.description}</p>}

                  {/* Steps — view or edit */}
                  {isEditing ? (
                    <textarea
                      style={nc.stepsEditArea}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    active.steps && <pre style={nc.stepsBlock}>{active.steps}</pre>
                  )}

                  {/* Per-step avg duration strip (requires ≥2 runs) */}
                  {!isEditing && runHistory.length >= 2 && (() => {
                    const stepCount = active.steps.split("\n").filter(Boolean).length;
                    if (stepCount === 0) return null;
                    const stats = Array.from({ length: stepCount }, (_, i) => {
                      const durations = runHistory
                        .map((r) => r.steps[i]?.durationMs)
                        .filter((d): d is number => typeof d === "number");
                      const avg = durations.length > 0
                        ? durations.reduce((a, b) => a + b, 0) / durations.length
                        : null;
                      return { i, avg };
                    });
                    return (
                      <div style={nc.stepStats}>
                        {stats.map(({ i, avg }) => (
                          avg !== null && (
                            <span key={i} style={nc.stepStat}>
                              step {i + 1} avg {(avg / 1000).toFixed(1)}s
                            </span>
                          )
                        ))}
                      </div>
                    );
                  })()}

                  <div style={nc.detailActions}>
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          style={nc.saveEditBtn}
                          disabled={isSavingEdit}
                          onClick={() => void handleSaveEdit(active.id)}
                        >
                          {isSavingEdit ? "Saving…" : "Save Steps"}
                        </button>
                        <button
                          type="button"
                          style={nc.cancelBtn}
                          onClick={() => { setIsEditing(false); setImprovement(null); }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          style={nc.runBtn(isRunning)}
                          disabled={isRunning}
                          onClick={() => void handleRun(active)}
                        >
                          {isRunning ? "Running…" : "▶ Run"}
                        </button>
                        <button
                          type="button"
                          style={nc.editBtn}
                          onClick={() => { setIsEditing(true); setEditDraft(active.steps); setImprovement(null); }}
                        >
                          Edit
                        </button>
                        {runHistory.length > 0 && (
                          <button
                            type="button"
                            style={nc.improveBtn(isImproving)}
                            disabled={isImproving}
                            onClick={() => void handleImprove(active.id)}
                          >
                            {isImproving ? "Analyzing…" : "✦ Improve"}
                          </button>
                        )}
                        <button
                          type="button"
                          style={nc.deleteBtn}
                          disabled={isDeleting}
                          onClick={() => void handleDelete(active.id)}
                        >
                          {isDeleting ? "Deleting…" : "Delete"}
                        </button>
                      </>
                    )}
                  </div>

                  {/* AI improvement panel */}
                  {improvement && (
                    <div style={nc.improvePanel}>
                      <div style={nc.improvePanelHdr}>
                        <span>✦ Suggested Improvements</span>
                      </div>
                      {improvement.rationale && (
                        <p style={nc.improveRationale}>{improvement.rationale}</p>
                      )}
                      <pre style={nc.improveStepsPreview}>{improvement.improvedSteps}</pre>
                      <div style={nc.improvePanelActions}>
                        <button
                          type="button"
                          style={nc.applyBtn}
                          onClick={() => {
                            setEditDraft(improvement.improvedSteps);
                            setIsEditing(true);
                            setImprovement(null);
                          }}
                        >
                          Apply & Edit
                        </button>
                        <button
                          type="button"
                          style={nc.dismissBtn}
                          onClick={() => setImprovement(null)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  {runError && <div style={nc.runError}>⚠ {runError}</div>}

                  {/* Live step progress */}
                  {liveSteps.length > 0 && (
                    <div style={nc.liveStepsBox}>
                      <div style={nc.liveStepsHdr}>
                        {isRunning ? "⟳ Running…" : "Run complete"}
                      </div>
                      {liveSteps.map((s, i) => (
                        <div key={`live-${i}`}>
                          {i > 0 && s.status !== "pending" && (
                            <div style={nc.liveStepConnector}>↓ context passed to step {i + 1}</div>
                          )}
                          <div style={nc.liveStep(s.status)}>
                            <div style={nc.liveStepRow}>
                              <span style={nc.liveStepIcon(s.status)}>
                                {STEP_ICON[s.status]}
                              </span>
                              <span style={nc.liveStepText(s.status)}>{s.step}</span>
                            </div>
                            {s.answer != null && (
                              <p
                                style={
                                  s.status === "error"
                                    ? nc.liveStepAnswerError
                                    : nc.liveStepAnswer
                                }
                              >
                                {s.answer}
                              </p>
                            )}
                            {s.durationMs != null && (
                              <span style={nc.liveStepDuration}>
                                {(s.durationMs / 1000).toFixed(1)}s
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Run history */}
                  {runHistory.length > 0 && (
                    <>
                      <div style={nc.divider} />
                      <p style={nc.sectionLabel}>Past Runs</p>
                      <div style={nc.historyList}>
                        {runHistory.map((run) => {
                          const isExpanded = expandedRunId === run.id;
                          return (
                            <div
                              key={run.id}
                              style={nc.historyItem(isExpanded)}
                              onClick={() =>
                                setExpandedRunId(isExpanded ? null : run.id)
                              }
                            >
                              <div style={nc.historyItemHdr}>
                                <span style={nc.historyBadge(run.status)}>
                                  {run.status === "ok" ? "✓" : "✗"}
                                </span>
                                <span style={nc.historyMeta}>
                                  {run.steps.length} step{run.steps.length !== 1 ? "s" : ""} ·{" "}
                                  {formatDuration(run.startedAt, run.completedAt)} ·{" "}
                                  {formatRelTime(run.startedAt)}
                                </span>
                                <span style={{ fontSize: 9, color: "rgba(57,255,20,0.2)" }}>
                                  {isExpanded ? "▲" : "▼"}
                                </span>
                              </div>
                              {isExpanded && (
                                <div style={nc.historyExpandedSteps}>
                                  {run.steps.map((step, i) => (
                                    // biome-ignore lint/suspicious/noArrayIndexKey: positional steps
                                    <div key={i} style={nc.historyStep}>
                                      <span style={nc.historyStepLabel}>
                                        Step {i + 1}: {step.step}
                                        {step.durationMs != null
                                          ? ` (${(step.durationMs / 1000).toFixed(1)}s)`
                                          : ""}
                                      </span>
                                      <p style={nc.historyStepAnswer}>{step.answer}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
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
