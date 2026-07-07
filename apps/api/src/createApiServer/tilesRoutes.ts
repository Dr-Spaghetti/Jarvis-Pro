import { fetchGmailUnreadCount } from "../gmail/gmailAuth";
import { computeBrainTileStats } from "./brainRoutes";
import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed } from "./routeHelpers";

export type HomeTile = {
  id: string;
  title: string;
  status: "ok" | "not-configured" | "error";
  value: string | number | null;
  unit?: string;
  detail?: string;
};

// ── Phase A: local-data tiles ($0, always available when the vault/Gmail exist)

const brainTiles = (): HomeTile[] => {
  const stats = computeBrainTileStats();
  if (!stats.configured) {
    const notConfigured: HomeTile["status"] = "not-configured";
    const detail = "Set OBSIDIAN_VAULT_PATH in .env to enable.";
    return [
      { id: "open-tasks", title: "Open tasks", status: notConfigured, value: null, detail },
      { id: "brain-notes", title: "Brain notes", status: notConfigured, value: null, detail },
      {
        id: "journal-week",
        title: "Activity this week",
        status: notConfigured,
        value: null,
        detail,
      },
    ];
  }

  return [
    { id: "open-tasks", title: "Open tasks", status: "ok", value: stats.openTaskCount },
    { id: "brain-notes", title: "Brain notes", status: "ok", value: stats.noteCount },
    {
      id: "journal-week",
      title: "Activity this week",
      status: "ok",
      value: stats.journalThisWeek,
      unit: "events",
    },
  ];
};

const gmailTile = async (): Promise<HomeTile> => {
  const result = await fetchGmailUnreadCount();
  if (!result.configured) {
    return {
      id: "gmail-unread",
      title: "Gmail unread",
      status: "not-configured",
      value: null,
      detail: "Connect Gmail in Settings to enable.",
    };
  }
  if (!result.ok) {
    return {
      id: "gmail-unread",
      title: "Gmail unread",
      status: "error",
      value: null,
      detail: "Could not reach Gmail. Try reconnecting in Settings.",
    };
  }
  return { id: "gmail-unread", title: "Gmail unread", status: "ok", value: result.unread };
};

// ── Phase B: external providers (only light up when a real key is in .env) ──
// QuickBooks is intentionally deferred (OAuth complexity not worth it yet).

const checkProvider = async (
  url: string,
  headers: Record<string, string>,
): Promise<"ok" | "error"> => {
  try {
    const response = await fetch(url, { headers });
    return response.ok ? "ok" : "error";
  } catch {
    return "error";
  }
};

const apolloTile = async (): Promise<HomeTile> => {
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    return {
      id: "apollo",
      title: "Apollo",
      status: "not-configured",
      value: null,
      detail: "Add APOLLO_API_KEY to .env to enable.",
    };
  }
  const status = await checkProvider("https://api.apollo.io/v1/auth/health", {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
  });
  return {
    id: "apollo",
    title: "Apollo",
    status,
    value: status === "ok" ? "Connected" : null,
    ...(status === "error" ? { detail: "API key set but Apollo did not respond OK." } : {}),
  };
};

const localFalconTile = async (): Promise<HomeTile> => {
  const apiKey = process.env.LOCALFALCON_API_KEY?.trim();
  if (!apiKey) {
    return {
      id: "local-falcon",
      title: "Local Falcon",
      status: "not-configured",
      value: null,
      detail: "Add LOCALFALCON_API_KEY to .env to enable.",
    };
  }
  const status = await checkProvider(
    `https://api.localfalcon.com/v1/whoami?api_key=${encodeURIComponent(apiKey)}`,
    { Accept: "application/json" },
  );
  return {
    id: "local-falcon",
    title: "Local Falcon",
    status,
    value: status === "ok" ? "Connected" : null,
    ...(status === "error" ? { detail: "API key set but Local Falcon did not respond OK." } : {}),
  };
};

// GET /api/tiles — live home tiles. Each tile carries an explicit status so the
// UI never shows a fabricated value: unconfigured sources report
// "not-configured", unreachable sources report "error".
export const handleTilesRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/tiles") {
    return false;
  }
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const [gmail, apollo, localFalcon] = await Promise.all([
    gmailTile(),
    apolloTile(),
    localFalconTile(),
  ]);

  const tiles: HomeTile[] = [...brainTiles(), gmail, apollo, localFalcon];
  writeJson(response, 200, { tiles, generatedAt: new Date().toISOString() }, corsOrigin);
  return true;
};
