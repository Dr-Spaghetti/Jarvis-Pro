import type { RecentWorkflowRun } from "./types";
import { formatTimeAgo } from "./utils";

type Props = {
  recentRuns: RecentWorkflowRun[];
};

const MAX_SHOWN = 6;

export const JarvisActivityFeed = ({ recentRuns }: Props) => {
  const shown = recentRuns.slice(0, MAX_SHOWN);
  const overflow = recentRuns.length - MAX_SHOWN;
  return (
    <div className="nc-hq-activity">
      <div className="nc-hq-activity-hdr">EXEC_LOG</div>
      {recentRuns.length === 0 ? (
        <div className="nc-hq-activity-empty">No recent workflow runs</div>
      ) : (
        <div className="nc-hq-activity-list">
          {shown.map((run) => (
            <div key={run.id} className="nc-hq-activity-item">
              <span className="nc-hq-activity-badge" data-status={run.status}>
                {run.status === "ok" ? "✓" : "✗"}
              </span>
              <span className="nc-hq-activity-name">{run.workflowName}</span>
              <span className="nc-hq-activity-meta">
                {run.steps.length} step{run.steps.length !== 1 ? "s" : ""} ·{" "}
                {formatTimeAgo(run.startedAt)}
              </span>
            </div>
          ))}
          {overflow > 0 && (
            <div className="nc-hq-activity-overflow">+{overflow} more</div>
          )}
        </div>
      )}
    </div>
  );
};
