import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const APPROVAL_KINDS = ["gmail-send", "gmail-archive", "calendar-create"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export const APPROVAL_STATUSES = ["pending", "approved", "dismissed", "failed"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type Approval = {
  id: string;
  ts: string;
  status: ApprovalStatus;
  kind: ApprovalKind;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  error?: string;
};

const MAX_APPROVALS = 80;

const approvalsPath = (projectStateDir: string) => join(projectStateDir, "state", "approvals.json");

export const isApprovalKind = (value: unknown): value is ApprovalKind =>
  typeof value === "string" && (APPROVAL_KINDS as readonly string[]).includes(value);

export const readApprovals = (projectStateDir: string): Approval[] => {
  const path = approvalsPath(projectStateDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Approval[]) : [];
  } catch {
    return [];
  }
};

export const writeApprovals = (projectStateDir: string, approvals: Approval[]): void => {
  const dir = join(projectStateDir, "state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(approvalsPath(projectStateDir), `${JSON.stringify(approvals, null, 2)}\n`, "utf8");
};

export const createApproval = (
  projectStateDir: string,
  input: {
    kind: ApprovalKind;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  },
): Approval => {
  const approval: Approval = {
    id: `ap-${randomUUID()}`,
    ts: new Date().toISOString(),
    status: "pending",
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    payload: input.payload,
  };
  const approvals = readApprovals(projectStateDir);
  approvals.unshift(approval);
  if (approvals.length > MAX_APPROVALS) approvals.splice(MAX_APPROVALS);
  writeApprovals(projectStateDir, approvals);
  return approval;
};

export const updateApproval = (
  projectStateDir: string,
  id: string,
  patch: Partial<Pick<Approval, "status" | "error">>,
): Approval | null => {
  const approvals = readApprovals(projectStateDir);
  const index = approvals.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const current = approvals[index];
  if (!current) return null;
  const next: Approval = { ...current, ...patch };
  approvals[index] = next;
  writeApprovals(projectStateDir, approvals);
  return next;
};

export const pendingApprovals = (projectStateDir: string): Approval[] =>
  readApprovals(projectStateDir).filter((item) => item.status === "pending");
