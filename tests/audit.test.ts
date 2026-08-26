import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";

describe("audit actions", () => {
  it("covers host, guest and auth events", () => {
    expect(AUDIT_ACTIONS.HOST_ADDED).toBe("HOST_ADDED");
    expect(AUDIT_ACTIONS.VM_STARTED).toBe("VM_STARTED");
    expect(AUDIT_ACTIONS.LXC_CREATED).toBe("LXC_CREATED");
    expect(AUDIT_ACTIONS.LOGIN_FAILED).toBe("LOGIN_FAILED");
    expect(AUDIT_ACTIONS.UPDATE_STARTED).toBe("UPDATE_STARTED");
  });
});
