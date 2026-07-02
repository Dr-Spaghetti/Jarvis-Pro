import type { ComponentProps } from "react";

import { UsageBarChart } from "./UsageHeatmap";
import { AgentAnalyticsPanel } from "./activity/AgentAnalyticsPanel";
import { JournalTimeline } from "./activity/JournalTimeline";

type ActivityPrimaryViewProps = {
  usageChartProps: ComponentProps<typeof UsageBarChart>;
};

export const ActivityPrimaryView = ({ usageChartProps }: ActivityPrimaryViewProps) => {
  return (
    <section className="activity-view" aria-label="Activity primary view">
      <JournalTimeline />
      <AgentAnalyticsPanel />
      <UsageBarChart {...usageChartProps} />
    </section>
  );
};
