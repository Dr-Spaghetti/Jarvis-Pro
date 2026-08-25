import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createApproval,
  pendingApprovals,
  updateApproval,
} from "../src/createApiServer/approvalStore";

let projectStateDir: string;

beforeEach(() => {
  projectStateDir = mkdtempSync(join(tmpdir(), "octogent-approvals-"));
});

afterEach(() => {
  rmSync(projectStateDir, { recursive: true, force: true });
});

describe("approvalStore", () => {
  it("creates a pending approval and lists it", () => {
    const created = createApproval(projectStateDir, {
      kind: "gmail-send",
      title: "Send: Hello",
      summary: "To ada@example.com",
      payload: { to: "ada@example.com", subject: "Hello", body: "Hi" },
    });
    expect(created.status).toBe("pending");
    expect(pendingApprovals(projectStateDir)).toHaveLength(1);
  });

  it("updates status in place", () => {
    const created = createApproval(projectStateDir, {
      kind: "gmail-archive",
      title: "Archive: Hello",
      summary: "Remove from inbox",
      payload: { messageId: "abc" },
    });
    const updated = updateApproval(projectStateDir, created.id, { status: "dismissed" });
    expect(updated?.status).toBe("dismissed");
    expect(pendingApprovals(projectStateDir)).toHaveLength(0);
  });
});
