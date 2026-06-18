// Decides which network interface the API server binds to.
//
// - Local-only (default): 127.0.0.1 — reachable only from this machine.
// - Remote mode (OCTOGENT_ALLOW_REMOTE_ACCESS=1): 0.0.0.0 — also reachable over
//   the LAN / a Tailscale interface so a phone can connect. This is gated: the
//   CLI refuses to start remote mode without OCTOGENT_AUTH_TOKEN, and every
//   request is bearer-token protected, so binding all interfaces is not an open door.
// - OCTOGENT_API_HOST overrides everything (explicit bind address).
export const resolveListenHost = (env: NodeJS.ProcessEnv = process.env): string => {
  const explicit = env.OCTOGENT_API_HOST?.trim();
  if (explicit) {
    return explicit;
  }
  return env.OCTOGENT_ALLOW_REMOTE_ACCESS === "1" ? "0.0.0.0" : "127.0.0.1";
};

// A wildcard bind address (0.0.0.0 / ::) is not browsable; map it to loopback
// for the locally-opened browser tab and the recorded local base URL.
export const toDisplayHost = (host: string): string =>
  host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
