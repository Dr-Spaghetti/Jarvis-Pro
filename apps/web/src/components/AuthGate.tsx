import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  apiFetch,
  clearStoredAuthToken,
  getStoredAuthToken,
  setUnauthorizedListener,
  storeAuthToken,
} from "../runtime/apiClient";
import { buildAuthStatusUrl, buildAuthVerifyUrl } from "../runtime/runtimeEndpoints";

type GateState = "checking" | "prompt" | "ready" | "error";

type AuthGateProps = {
  children: ReactNode;
};

// Blocks the app until the API's auth requirement is known. When the server
// requires a bearer token (OCTOGENT_AUTH_TOKEN), the app is kept unmounted —
// so no unauthorized requests fire — until a token is verified and stored.
export const AuthGate = ({ children }: AuthGateProps) => {
  const [gateState, setGateState] = useState<GateState>("checking");
  const [tokenInput, setTokenInput] = useState("");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const checkAuthRequirement = useCallback(async () => {
    setGateState("checking");
    try {
      const statusResponse = await apiFetch(buildAuthStatusUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!statusResponse.ok) {
        setGateState("error");
        return;
      }

      const payload = (await statusResponse.json()) as { authRequired?: unknown };
      if (payload.authRequired !== true) {
        setGateState("ready");
        return;
      }

      if (getStoredAuthToken()) {
        const verifyResponse = await apiFetch(buildAuthVerifyUrl(), { method: "POST" });
        if (verifyResponse.status === 204) {
          setGateState("ready");
          return;
        }
        clearStoredAuthToken();
      }

      setGateState("prompt");
    } catch {
      setGateState("error");
    }
  }, []);

  useEffect(() => {
    void checkAuthRequirement();
  }, [checkAuthRequirement]);

  // Any 401 from anywhere in the app (e.g. the token was rotated server-side)
  // drops back to the prompt instead of leaving dead controls behind.
  useEffect(() => {
    setUnauthorizedListener(() => {
      clearStoredAuthToken();
      setPromptError("The server rejected the saved token. Enter the current one.");
      setGateState("prompt");
    });
    return () => {
      setUnauthorizedListener(null);
    };
  }, []);

  useEffect(() => {
    if (gateState === "prompt") {
      inputRef.current?.focus();
    }
  }, [gateState]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate || isVerifying) {
      return;
    }

    setIsVerifying(true);
    setPromptError(null);
    try {
      // Explicit header: the candidate must prove itself before being stored.
      const verifyResponse = await apiFetch(buildAuthVerifyUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${candidate}` },
      });
      if (verifyResponse.status === 204) {
        storeAuthToken(candidate);
        setTokenInput("");
        setGateState("ready");
      } else if (verifyResponse.status === 401) {
        setPromptError("That token was rejected. Check OCTOGENT_AUTH_TOKEN in .env and try again.");
      } else {
        setPromptError(`Unexpected response from the server (${verifyResponse.status}).`);
      }
    } catch {
      setPromptError("Could not reach the server. Is Jarvis running?");
    } finally {
      setIsVerifying(false);
    }
  };

  if (gateState === "ready") {
    return <>{children}</>;
  }

  if (gateState === "checking") {
    return (
      <output className="auth-gate" aria-label="Checking authentication">
        <div className="auth-gate-card">
          <p className="auth-gate-status">Checking access…</p>
        </div>
      </output>
    );
  }

  if (gateState === "error") {
    return (
      <div className="auth-gate" role="alert" aria-label="Authentication check failed">
        <div className="auth-gate-card">
          <h1 className="auth-gate-title">Jarvis</h1>
          <p className="auth-gate-status">Could not reach the server to check authentication.</p>
          <button
            className="auth-gate-submit"
            onClick={() => void checkAuthRequirement()}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-gate">
      <form
        aria-label="Access token prompt"
        className="auth-gate-card"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <h1 className="auth-gate-title">Jarvis</h1>
        <p className="auth-gate-subtitle">
          This server requires an access token. It is the value of <code>OCTOGENT_AUTH_TOKEN</code>{" "}
          in <code>.env</code> on the host machine.
        </p>
        <label className="auth-gate-label" htmlFor="auth-gate-token">
          Access token
        </label>
        <input
          autoComplete="off"
          className="auth-gate-input"
          id="auth-gate-token"
          onChange={(event) => setTokenInput(event.target.value)}
          ref={inputRef}
          type="password"
          value={tokenInput}
        />
        {promptError ? (
          <p className="auth-gate-error" role="alert">
            {promptError}
          </p>
        ) : null}
        <button
          className="auth-gate-submit"
          disabled={tokenInput.trim().length === 0 || isVerifying}
          type="submit"
        >
          {isVerifying ? "Verifying…" : "Unlock"}
        </button>
      </form>
    </div>
  );
};
