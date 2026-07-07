const AUTH_TOKEN_STORAGE_KEY = "octogent.authToken";

// localStorage access is wrapped so the app still works where storage is
// blocked (private browsing) — the token then lives only for the page session.
let inMemoryToken: string | null = null;

export const getStoredAuthToken = (): string | null => {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? inMemoryToken;
  } catch {
    return inMemoryToken;
  }
};

export const storeAuthToken = (token: string): void => {
  inMemoryToken = token;
  try {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage unavailable; the in-memory copy keeps this session working.
  }
};

export const clearStoredAuthToken = (): void => {
  inMemoryToken = null;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing persisted to clear.
  }
};

type UnauthorizedListener = () => void;

let unauthorizedListener: UnauthorizedListener | null = null;

// The auth gate registers here so any 401 anywhere in the app (e.g. after the
// token is rotated server-side) flips the UI back to the token prompt.
export const setUnauthorizedListener = (listener: UnauthorizedListener | null): void => {
  unauthorizedListener = listener;
};

export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const token = getStoredAuthToken();
  let nextInit = init;
  if (token) {
    const headers = new Headers(init?.headers);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    nextInit = { ...init, headers };
  }

  // biome-ignore lint/style/noRestrictedGlobals: the single authorized raw-fetch call site — everything else must go through apiFetch.
  const response = await fetch(input, nextInit);
  if (response.status === 401) {
    unauthorizedListener?.();
  }
  return response;
};

// WebSocket handshakes cannot carry Authorization headers; pass the token as a
// Sec-WebSocket-Protocol value so it stays out of URLs and server logs.
export const getWsAuthProtocols = (): string[] => {
  const token = getStoredAuthToken();
  return token ? [`token.${encodeURIComponent(token)}`] : [];
};

// <a href> download links cannot carry Authorization headers either.
// Use this only for download link hrefs — never for WebSocket URLs.
export const appendAuthTokenParam = (url: string): string => {
  const token = getStoredAuthToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
};
