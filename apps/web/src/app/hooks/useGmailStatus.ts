import { useCallback, useEffect, useRef, useState } from "react";

import { buildGmailAuthUrl, buildGmailStatusUrl } from "../../runtime/runtimeEndpoints";

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

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(buildGmailStatusUrl(), { cache: "no-store" });
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
    }
  }, [fetchStatus]);

  const connectGmail = useCallback(() => {
    setIsConnectingGmail(true);
    void (async () => {
      try {
        const res = await fetch(buildGmailAuthUrl());
        if (!res.ok) {
          setIsConnectingGmail(false);
          return;
        }
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.open(data.url, "_blank");
        } else {
          setIsConnectingGmail(false);
        }
      } catch {
        setIsConnectingGmail(false);
      }
    })();
  }, []);

  const disconnectGmail = useCallback(() => {
    void (async () => {
      try {
        await fetch(buildGmailAuthUrl(), { method: "DELETE" });
        setGmailStatus({ connected: false });
      } catch {
        // ignore
      }
    })();
  }, []);

  return { gmailStatus, isConnectingGmail, connectGmail, disconnectGmail };
};
