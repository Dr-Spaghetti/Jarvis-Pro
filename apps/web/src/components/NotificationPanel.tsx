import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../runtime/apiClient";
import { buildNotificationsReadUrl, buildNotificationsUrl } from "../runtime/runtimeEndpoints";

type Notification = {
  id: string;
  ts: string;
  type: "action" | "info" | "warn" | "error";
  title: string;
  detail?: string;
  read: boolean;
};

const TYPE_ICON: Record<Notification["type"], string> = {
  action: "◆",
  info: "◈",
  warn: "⚠",
  error: "✕",
};

const TYPE_COLOR: Record<Notification["type"], string> = {
  action: "rgba(57,255,20,0.7)",
  info: "rgba(57,255,20,0.45)",
  warn: "rgba(255,200,60,0.7)",
  error: "rgba(255,80,80,0.7)",
};

const formatTs = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const mins = Math.round((now - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
};

type NotificationPanelProps = {
  onClose: () => void;
  onUnreadChange: (count: number) => void;
};

export const NotificationPanel = ({ onClose, onUnreadChange }: NotificationPanelProps) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(buildNotificationsUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications?: Notification[]; unreadCount?: number };
      if (Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
        onUnreadChange(data.unreadCount ?? 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark all as read when the panel opens.
  useEffect(() => {
    apiFetch(buildNotificationsReadUrl(), { method: "POST" })
      .then(() => {
        onUnreadChange(0);
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      })
      .catch(() => {});
  }, [onUnreadChange]);

  const clearAll = async () => {
    try {
      await apiFetch(buildNotificationsUrl(), { method: "DELETE" });
      setNotifications([]);
      onUnreadChange(0);
    } catch {
      // ignore
    }
  };

  return (
    <>
      {/* backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="nc-notification-panel" role="dialog" aria-label="Notifications">
        <div className="nc-notification-panel-header">
          <span className="nc-notification-panel-title">NOTIFICATIONS</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {notifications.length > 0 && (
              <button
                type="button"
                className="nc-notification-panel-clear"
                onClick={clearAll}
              >
                CLEAR ALL
              </button>
            )}
            <button
              type="button"
              className="nc-notification-panel-close"
              onClick={onClose}
              aria-label="Close notifications"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="nc-notification-panel-list">
          {loading && (
            <p className="nc-notification-panel-empty">Loading…</p>
          )}
          {!loading && notifications.length === 0 && (
            <p className="nc-notification-panel-empty">No notifications</p>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              className="nc-notification-panel-item"
              data-read={n.read ? "true" : "false"}
            >
              <span
                className="nc-notification-panel-item-icon"
                style={{ color: TYPE_COLOR[n.type] }}
                aria-hidden="true"
              >
                {TYPE_ICON[n.type]}
              </span>
              <div className="nc-notification-panel-item-body">
                <p className="nc-notification-panel-item-title">{n.title}</p>
                {n.detail && (
                  <p className="nc-notification-panel-item-detail">{n.detail}</p>
                )}
                <p className="nc-notification-panel-item-ts">{formatTs(n.ts)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
