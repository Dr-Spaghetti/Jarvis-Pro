import { listAgenda, listInbox } from "../gmail/googleWorkspace";
import { createApproval, pendingApprovals } from "./approvalStore";
import { asRecord, oneLine } from "./brain/vault";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

export const handleGmailInboxRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/gmail/inbox") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const result = await listInbox(8);
  writeJson(response, 200, result, corsOrigin);
  return true;
};

export const handleGmailReplyRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/gmail/reply") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = asRecord(body.payload);
  const to = typeof payload.to === "string" ? oneLine(payload.to) : "";
  const subject = typeof payload.subject === "string" ? oneLine(payload.subject) : "";
  const text = typeof payload.body === "string" ? payload.body.trim() : "";
  const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
  const inReplyTo = typeof payload.inReplyTo === "string" ? payload.inReplyTo : "";
  if (!to || !subject || !text) {
    writeJson(response, 400, { error: "to, subject, and body are required" }, corsOrigin);
    return true;
  }
  const approval = createApproval(projectStateDir, {
    kind: "gmail-send",
    title: `Send: ${subject}`,
    summary: `To ${to}`,
    payload: { to, subject, body: text, threadId, inReplyTo },
  });
  writeJson(response, 201, { ok: true, approval }, corsOrigin);
  return true;
};

export const handleGmailArchiveRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/gmail/archive") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = asRecord(body.payload);
  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  const subject = typeof payload.subject === "string" ? oneLine(payload.subject) : "message";
  if (!messageId) {
    writeJson(response, 400, { error: "messageId is required" }, corsOrigin);
    return true;
  }
  const approval = createApproval(projectStateDir, {
    kind: "gmail-archive",
    title: `Archive: ${subject}`,
    summary: "Remove from inbox",
    payload: { messageId },
  });
  writeJson(response, 201, { ok: true, approval }, corsOrigin);
  return true;
};

export const handleCalendarAgendaRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/calendar/agenda") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const result = await listAgenda(8);
  writeJson(response, 200, result, corsOrigin);
  return true;
};

export const handleCalendarProposeRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/calendar/propose") return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!body.ok) return true;
  const payload = asRecord(body.payload);
  const title = typeof payload.title === "string" ? oneLine(payload.title) : "";
  const start = typeof payload.start === "string" ? payload.start : "";
  const end = typeof payload.end === "string" ? payload.end : "";
  if (!title || !start || !end) {
    writeJson(response, 400, { error: "title, start, and end are required" }, corsOrigin);
    return true;
  }
  const approval = createApproval(projectStateDir, {
    kind: "calendar-create",
    title: `Event: ${title}`,
    summary: `${start} → ${end}`,
    payload: { title, start, end },
  });
  writeJson(response, 201, { ok: true, approval }, corsOrigin);
  return true;
};

export const handleTodayRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/today") return false;
  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const [mail, agenda] = await Promise.all([listInbox(6), listAgenda(6)]);
  writeJson(
    response,
    200,
    {
      mail,
      agenda,
      approvals: pendingApprovals(projectStateDir),
    },
    corsOrigin,
  );
  return true;
};
