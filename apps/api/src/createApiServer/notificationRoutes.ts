import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

type Notification = {
  id: string;
  ts: string;
  type: "action" | "info" | "warn" | "error";
  title: string;
  detail?: string;
  read: boolean;
};

const MAX_NOTIFICATIONS = 100;

const notificationsPath = (projectStateDir: string) =>
  join(projectStateDir, "state", "notifications.json");

const readNotifications = (projectStateDir: string): Notification[] => {
  const path = notificationsPath(projectStateDir);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Notification[];
  } catch {
    return [];
  }
};

const writeNotifications = (projectStateDir: string, notifications: Notification[]): void => {
  const path = notificationsPath(projectStateDir);
  const dir = join(projectStateDir, "state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(notifications, null, 2), "utf8");
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const VALID_TYPES = new Set(["action", "info", "warn", "error"]);

export const handleNotificationsReadRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/notifications/read") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const notifications = readNotifications(projectStateDir);
  writeNotifications(
    projectStateDir,
    notifications.map((n) => ({ ...n, read: true })),
  );
  writeJson(response, 200, { ok: true }, corsOrigin);
  return true;
};

export const handleNotificationsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/notifications") return false;

  if (request.method === "GET") {
    const notifications = readNotifications(projectStateDir);
    const unreadCount = notifications.filter((n) => !n.read).length;
    writeJson(response, 200, { notifications, unreadCount }, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;
    const payload = asRecord(body.payload);

    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    if (!title) {
      writeJson(response, 400, { error: "title is required" }, corsOrigin);
      return true;
    }

    const type =
      typeof payload.type === "string" && VALID_TYPES.has(payload.type)
        ? (payload.type as Notification["type"])
        : "action";
    const detail =
      typeof payload.detail === "string" ? payload.detail.trim() || undefined : undefined;

    const notifications = readNotifications(projectStateDir);
    const notification: Notification = {
      id: `n-${Date.now()}`,
      ts: new Date().toISOString(),
      type,
      title,
      ...(detail !== undefined && { detail }),
      read: false,
    };
    notifications.unshift(notification);
    if (notifications.length > MAX_NOTIFICATIONS) {
      notifications.splice(MAX_NOTIFICATIONS);
    }
    writeNotifications(projectStateDir, notifications);
    writeJson(response, 201, { ok: true, notification }, corsOrigin);
    return true;
  }

  if (request.method === "DELETE") {
    writeNotifications(projectStateDir, []);
    writeJson(response, 200, { ok: true }, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};
