type PanelStateProps = {
  state: "empty" | "loading" | "error";
  message: string;
  onRetry?: (() => void) | undefined;
};

export const PanelState = ({ state, message, onRetry }: PanelStateProps) => (
  <div className={`panel-state panel-state--${state}`} data-state={state}>
    <span className="panel-state-message">{message}</span>
    {state === "error" && onRetry && (
      <button type="button" className="panel-state-retry" onClick={onRetry}>
        Retry
      </button>
    )}
  </div>
);
