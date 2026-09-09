import { describe, expect, it } from "vitest";
import { actionDeniedTitle } from "@/lib/action-lock";

describe("actionDeniedTitle", () => {
  it("is silent when both RBAC and share allow the action", () => {
    expect(actionDeniedTitle(true, true, "share", "rbac")).toBeUndefined();
  });

  it("prefers the share ceiling over a missing role permission", () => {
    expect(actionDeniedTitle(false, false, "share", "rbac")).toBe("share");
  });

  it("names a missing role permission when the share would allow it", () => {
    expect(actionDeniedTitle(false, true, "share", "rbac")).toBe("rbac");
  });
});
