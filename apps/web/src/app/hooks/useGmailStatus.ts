import { useCallback, useEffect, useRef, useState } from "react";

import { buildGmailAuthUrl, buildGmailStatusUrl } from "../../runtime/runtimeEndpoints";

import { useToasts } from "../../components/ui/ToastProvider";
import { apiFetch } from "../../runtime/apiClient";

export type GmailStatus = { connected: boolean; email?: string };

export type UseGmailStatusResult = {
  gmailStatus: GmailStatus | null;
  isConnectingGmail: boolean;
  connectGmail: () => void;
  disconnectGmail: () => void;
};

const POLL_INTERVAL_MS = 5_000;

export const useGmailStatus = (): UseGmailStatusResult => {
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const isDisposedRef = useRef(false);
  const { showToast } = useToasts();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch(buildGmailStatusUrl(), { cache: "no-store" });
      if (!res.ok || isDisposedRef.current) return;
      const data = (await res.json()) as GmailStatus;
      setGmailStatus(data);
      if (data.connected) setIsConnectingGmail(false);
    } catch {
      // network errors are transient — stay silent
    }
  }, []);

  useEffect(() => {
    isDisposedRef.current = false;
    void fetchStatus();
    const timer = window.setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
    return () => {
      isDisposedRef.current = true;
      window.clearInterval(timer);
    };
  }, [fetchStatus]);

  // Detect OAuth callback result in URL params (fires in the newly-opened tab).
  // biome-ignore lint/correctness/useExhaustiveDependencies: showToast is stable from context
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("gmail_connected")) {
      window.history.replaceState(null, "", window.location.pathname);
      void fetchStatus();
      setIsConnectingGmail(false);
      window.close();
    } else if (params.has("gmail_error")) {
      window.history.replaceState(null, "", window.location.pathname);
      setIsConnectingGmail(false);
      const errCode = params.get("gmail_error");
      const message =
        (
          {
            access_denied: "Gmail access was denied.",
            invalid_state: "OAuth state mismatch — please try again.",
            missing_credentials: "Gmail is not configured on this server.",
            token_exchange_failed: "Could not exchange the OAuth code for a token.",
          } as Record<string, string>
        )[errCode ?? ""] ?? "Gmail connection failed.";
      showToast(message, "error");
    }
  }, [fetchStatus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: showToast is stable from context
  const connectGmail = useCallback(() => {
    setIsConnectingGmail(true);
    void (async () => {
      try {
        const res = await apiFetch(buildGmailAuthUrl());
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          showToast(body.error ?? "Failed to start Gmail connection", "error");
          setIsConnectingGmail(false);
          return;
        }
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.open(data.url, "_blank");
        } else {
          showToast("Failed to start Gmail connection", "error");
          setIsConnectingGmail(false);
        }
      } catch {
        showToast("Failed to start Gmail connection", "error");
        setIsConnectingGmail(false);
      }
    })();
  }, []);

  const disconnectGmail = useCallback(() => {
    void (async () => {
      try {
        await apiFetch(buildGmailAuthUrl(), { method: "DELETE" });
        setGmailStatus({ connected: false });
      } catch {
        // ignore
      }
    })();
  }, []);

  return { gmailStatus, isConnectingGmail, connectGmail, disconnectGmail };
};
