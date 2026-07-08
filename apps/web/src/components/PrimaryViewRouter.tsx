import type { ComponentProps, ReactNode } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { AnalyzerPrimaryView } from "./AnalyzerPrimaryView";
import { AgentArsenalPanel } from "./AgentArsenalPanel";
import { ConversationsPrimaryView } from "./ConversationsPrimaryView";
import { IdeasPrimaryView } from "./IdeasPrimaryView";
import { JarvisHomePrimaryView } from "./JarvisHomePrimaryView";
import { SettingsPrimaryView } from "./SettingsPrimaryView";
import { SurveillancePanel } from "./SurveillancePanel";
import { TerminalPrimaryView } from "./TerminalPrimaryView";
import { WorkflowsPrimaryView } from "./WorkflowsPrimaryView";

type CanvasPrimaryViewProps = {
  onSpawnSwarm?: (tentacleId: string, workspaceMode: "shared" | "worktree") => Promise<void>;
  onSolveTodoItem?: (tentacleId: string, itemIndex: number) => Promise<void>;
};

type PrimaryViewRouterProps = {
  activePrimaryNav: PrimaryNavIndex;
  settingsPrimaryViewProps: ComponentProps<typeof SettingsPrimaryView>;
  conversationsEnabled: boolean;
  onConversationsSidebarContent: (content: ReactNode) => void;
  onConversationsActionPanel: (content: ReactNode) => void;
  onPrimaryNavChange: (index: PrimaryNavIndex) => void;
  isMonitorEnabled?: boolean;
  canvasPrimaryViewProps?: CanvasPrimaryViewProps;
};

export const PrimaryViewRouter = ({
  activePrimaryNav,
  settingsPrimaryViewProps,
  conversationsEnabled,
  onConversationsSidebarContent,
  onConversationsActionPanel,
  onPrimaryNavChange,
  isMonitorEnabled = true,
}: PrimaryViewRouterProps) => {
  // 9 — Jarvis HQ
  if (activePrimaryNav === 9) {
    return <JarvisHomePrimaryView onNavigate={onPrimaryNavChange} />;
  }

  // 1 — Agent Arsenal (archetype grid + deploy)
  if (activePrimaryNav === 1) {
    return <AgentArsenalPanel />;
  }

  // 2 — Surveillance (live CCTV agent monitor)
  if (activePrimaryNav === 2) {
    return <SurveillancePanel isEnabled={isMonitorEnabled} />;
  }

  // 3 — Workflows
  if (activePrimaryNav === 3) {
    return <WorkflowsPrimaryView />;
  }

  // 4 — Recent Convos
  if (activePrimaryNav === 4) {
    return (
      <ConversationsPrimaryView
        enabled={conversationsEnabled}
        onSidebarContent={onConversationsSidebarContent}
        onActionPanel={onConversationsActionPanel}
      />
    );
  }

  // 5 — Content Analyzer
  if (activePrimaryNav === 5) {
    return <AnalyzerPrimaryView />;
  }

  // 6 — Ideas
  if (activePrimaryNav === 6) {
    return <IdeasPrimaryView onNavigate={onPrimaryNavChange} />;
  }

  // 7 — Settings
  if (activePrimaryNav === 7) {
    return <SettingsPrimaryView {...settingsPrimaryViewProps} />;
  }

  // 8 — Terminal
  if (activePrimaryNav === 8) {
    return <TerminalPrimaryView />;
  }

  return null;
};
