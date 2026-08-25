import { archiveMail, createCalendarEvent, sendMail } from "../gmail/googleWorkspace";
import {
  type Approval,
  createApproval,
  isApprovalKind,
  pendingApprovals,
  readApprovals,
  updateApproval,
} from "./approvalStore";
import { asRecord, oneLine } from "./brain/vault";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const executeApproval = async (
  approval: Approval,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (approval.kind === "gmail-send") {
    const to = asString(approval.payload.to);
    const subject = asString(approval.payload.subject);
    const body = asString(approval.payload.body);
    if (!to || !subject || !body) return { ok: false, error: "Send payload is incomplete." };
    return sendMail({
      to,
      subject,
      body,
      ...(asString(approval.payload.threadId)
        ? { threadId: asString(approval.payload.threadId) }
        : {}),
      ...(asString(approval.payload.inReplyTo)
        ? { inReplyTo: asString(approval.payload.inReplyTo) }
        : {}),
    });
  }
  if (approval.kind === "gmail-archive") {
    const messageId = asString(approval.payload.messageId);
    if (!messageId) return { ok: false, error: "Archive payload is incomplete." };
    return archiveMail(messageId);
  }
  const title = asString(approval.payload.title);
  const start = asString(approval.payload.start);
  const end = asString(approval.payload.end);
  if (!title || !start || !end) return { ok: false, error: "Event payload is incomplete." };
  const created = await createCalendarEvent({ title, start, end });
  return created.ok ? { ok: true } : created;
};

export const handleApprovalsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/approvals") return false;

  if (request.method === "GET") {
    const pendingOnly = requestUrl.searchParams.get("pending") === "1";
    const approvals = pendingOnly
      ? pendingApprovals(projectStateDir)
      : readApprovals(projectStateDir);
    writeJson(response, 200, { approvals }, corsOrigin);
    return true;
  }

  if (request.method === "POST") {
    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;
    const payload = asRecord(body.payload);
    if (!isApprovalKind(payload.kind)) {
      writeJson(response, 400, { error: "kind is required" }, corsOrigin);
      return true;
    }
    const title = typeof payload.title === "string" ? oneLine(payload.title) : "";
    const summary = typeof payload.summary === "string" ? oneLine(payload.summary) : title;
    const inner = asRecord(payload.payload);
    if (!title) {
      writeJson(response, 400, { error: "title is required" }, corsOrigin);
      return true;
    }
    const approval = createApproval(projectStateDir, {
      kind: payload.kind,
      title,
      summary,
      payload: inner,
    });
    writeJson(response, 201, { ok: true, approval }, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};

export const handleApprovalItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  const match = /^\/api\/approvals\/([^/]+)\/(approve|dismiss)$/.exec(requestUrl.pathname);
  if (!match) return false;
  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }
  const id = decodeURIComponent(match[1] ?? "");
  const action = match[2];
  const current = readApprovals(projectStateDir).find((item) => item.id === id);
  if (!current || current.status !== "pending") {
    writeJson(response, 404, { error: "Approval not found" }, corsOrigin);
    return true;
  }
  if (action === "dismiss") {
    const approval = updateApproval(projectStateDir, id, { status: "dismissed" });
    writeJson(response, 200, { ok: true, approval }, corsOrigin);
    return true;
  }
  const result = await executeApproval(current);
  if (!result.ok) {
    const approval = updateApproval(projectStateDir, id, { status: "failed", error: result.error });
    writeJson(response, 200, { ok: false, approval, error: result.error }, corsOrigin);
    return true;
  }
  const approval = updateApproval(projectStateDir, id, { status: "approved" });
  writeJson(response, 200, { ok: true, approval }, corsOrigin);
  return true;
};
