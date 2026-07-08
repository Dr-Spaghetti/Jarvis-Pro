import { useState } from "react";

import type { WorkspaceSetupSnapshot, WorkspaceSetupStep } from "@octogent/core";
import { apiFetch } from "../runtime/apiClient";
import { buildWorkspaceSetupStepUrl } from "../runtime/runtimeEndpoints";

type WorkspaceSetupCardProps = {
  setup: WorkspaceSetupSnapshot;
  onSetupChange: (updated: WorkspaceSetupSnapshot) => void;
};

const SetupStep = ({
  step,
  onAction,
}: {
  step: WorkspaceSetupStep;
  onAction: (stepId: string) => Promise<void>;
}) => {
  const [running, setRunning] = useState(false);

  const handleAction = async () => {
    setRunning(true);
    await onAction(step.id);
    setRunning(false);
  };

  return (
    <div
      className="workspace-setup-step"
      data-complete={step.complete ? "true" : "false"}
      data-required={step.required ? "true" : "false"}
    >
      <div className="workspace-setup-step-header">
        <span className="workspace-setup-step-title">{step.title}</span>
        {step.complete ? (
          <span className="workspace-setup-step-done">Done</span>
        ) : step.actionLabel ? (
          <button
            type="button"
            className="workspace-setup-step-action"
            onClick={() => void handleAction()}
            disabled={running}
          >
            {running ? "Running…" : step.actionLabel}
          </button>
        ) : null}
      </div>
      {!step.complete && step.guidance && (
        <p className="workspace-setup-step-guidance">{step.guidance}</p>
      )}
      {!step.complete && step.command && (
        <code className="workspace-setup-step-command">{step.command}</code>
      )}
    </div>
  );
};

export const WorkspaceSetupCard = ({ setup, onSetupChange }: WorkspaceSetupCardProps) => {
  const handleStepAction = async (stepId: string) => {
    try {
      const res = await apiFetch(buildWorkspaceSetupStepUrl(stepId), { method: "POST" });
      if (res.ok) {
        const updated = (await res.json()) as WorkspaceSetupSnapshot;
        onSetupChange(updated);
      }
    } catch {
      // step action failed silently — user can retry
    }
  };

  return (
    <section className="workspace-setup-card" aria-label="Workspace setup">
      <h2 className="workspace-setup-title">Workspace Setup</h2>
      <p className="workspace-setup-desc">
        Complete these steps before creating your first agent.
      </p>
      <div className="workspace-setup-steps">
        {setup.steps.map((step) => (
          <SetupStep key={step.id} step={step} onAction={handleStepAction} />
        ))}
      </div>
    </section>
  );
};
