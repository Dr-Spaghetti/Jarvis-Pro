import { useEffect, useState } from "react";

import { type AgentRecord, agentStateStore } from "../agentStateStore";

export const useAgentStates = (): Map<string, AgentRecord> => {
  const [agents, setAgents] = useState<Map<string, AgentRecord>>(() =>
    agentStateStore.getSnapshot(),
  );

  useEffect(() => {
    setAgents(agentStateStore.getSnapshot());
    return agentStateStore.subscribe(() => {
      setAgents(agentStateStore.getSnapshot());
    });
  }, []);

  return agents;
};
