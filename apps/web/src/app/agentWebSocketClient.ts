let sendFn: ((msg: string) => void) | null = null;

export const setAgentWsSend = (fn: ((msg: string) => void) | null): void => {
  sendFn = fn;
};

export const cancelAgent = (agentId: string): void => {
  sendFn?.(JSON.stringify({ type: "cancel", agentId }));
};
