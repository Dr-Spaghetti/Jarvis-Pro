import type { ComponentProps, ReactNode } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { AnalyzerPrimaryView } from "./AnalyzerPrimaryView";
import { AgentArsenalPanel } from "./AgentArsenalPanel";
import { ConversationsPrimaryView } from "./ConversationsPrimaryView";
import { IdeasPrimaryView } from "./IdeasPrimaryView";
import { JarvisHomePrimaryView } from "./JarvisHomePrimaryView";
import { SettingsPrimaryView } from "./SettingsPrimaryView";
import { SurveillancePanel } from "./SurveillancePanel";
import { WorkflowsPrimaryView } from "./WorkflowsPrimaryView";

type PrimaryViewRouterProps = {
  activePrimaryNav: PrimaryNavIndex;
  settingsPrimaryViewProps: ComponentProps<typeof SettingsPrimaryView>;
  conversationsEnabled: boolean;
  onConversationsSidebarContent: (content: ReactNode) => void;
  onConversationsActionPanel: (content: ReactNode) => void;
  onPrimaryNavChange: (index: PrimaryNavIndex) => void;
};

export const PrimaryViewRouter = ({
  activePrimaryNav,
  settingsPrimaryViewProps,
  conversationsEnabled,
  onConversationsSidebarContent,
  onConversationsActionPanel,
  onPrimaryNavChange,
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
    return <SurveillancePanel />;
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
  return <SettingsPrimaryView {...settingsPrimaryViewProps} />;
};
