import type { RecentWorkflowRun } from "./types";
import { formatTimeAgo } from "./utils";

type Props = {
  recentRuns: RecentWorkflowRun[];
};

export const JarvisActivityFeed = ({ recentRuns }: Props) => {
  if (recentRuns.length === 0) return null;
  return (
    <div className="nc-hq-activity">
      <div className="nc-hq-activity-hdr">EXEC_LOG</div>
      <div className="nc-hq-activity-list">
        {recentRuns.slice(0, 6).map((run) => (
          <div key={run.id} className="nc-hq-activity-item">
            <span className="nc-hq-activity-badge" data-status={run.status}>
              {run.status === "ok" ? "✓" : "✗"}
            </span>
            <span className="nc-hq-activity-name">{run.workflowName}</span>
            <span className="nc-hq-activity-meta">
              {run.steps.length} step{run.steps.length !== 1 ? "s" : ""} · {formatTimeAgo(run.startedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
