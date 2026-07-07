import type { PendingVoiceIntent } from "./types";

type Props = {
  pendingVoiceIntent: PendingVoiceIntent;
  intentCountdown: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export const JarvisIntentConfirmOverlay = ({
  pendingVoiceIntent,
  intentCountdown,
  onConfirm,
  onCancel,
}: Props) => (
  <div className="nc-hq-intent-confirm" role="alertdialog" aria-label="Confirm voice action">
    <span className="nc-hq-intent-confirm-countdown">{intentCountdown}s</span>
    <p className="nc-hq-intent-confirm-label">{pendingVoiceIntent.displayLabel}</p>
    <div className="nc-hq-intent-confirm-actions">
      <button type="button" className="nc-hq-intent-confirm-ok" onClick={onConfirm}>
        {pendingVoiceIntent.confirmLabel}
      </button>
      <button type="button" className="nc-hq-intent-confirm-cancel" onClick={onCancel}>
        CANCEL
      </button>
    </div>
    <p className="nc-hq-intent-confirm-hint">or say "confirm" / "cancel"</p>
  </div>
);
