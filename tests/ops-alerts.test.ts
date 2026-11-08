import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/notifications/dispatch", () => ({
  notifyTopic: vi.fn(),
}));

import { notifyTopic } from "@/server/notifications/dispatch";
import {
  clearWireguardUnreachableState,
  maybeNotifySelfUpdateFailed,
  notifyWireguardUnreachable,
} from "@/server/notifications/ops-alerts";

describe("ops alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWireguardUnreachableState();
    maybeNotifySelfUpdateFailed({ step: "done", detail: null });
  });

  it("notifies once per unreachable peer reason", () => {
    const row = {
      peerId: "p1",
      name: "peer-a",
      ok: false,
      error: "HTTP 502",
      url: "http://10.0.0.2/api/health",
    };
    expect(notifyWireguardUnreachable([row])).toBe(1);
    expect(notifyWireguardUnreachable([row])).toBe(0);
    expect(notifyTopic).toHaveBeenCalledTimes(1);
    expect(notifyWireguardUnreachable([{ ...row, ok: true, error: null }])).toBe(0);
    expect(notifyWireguardUnreachable([row])).toBe(1);
    expect(notifyTopic).toHaveBeenCalledTimes(2);
  });

  it("notifies once per self-update error detail", () => {
    maybeNotifySelfUpdateFailed({ step: "error", detail: "pull failed" });
    maybeNotifySelfUpdateFailed({ step: "error", detail: "pull failed" });
    expect(notifyTopic).toHaveBeenCalledTimes(1);
    maybeNotifySelfUpdateFailed({ step: "done", detail: null });
    maybeNotifySelfUpdateFailed({ step: "error", detail: "pull failed" });
    expect(notifyTopic).toHaveBeenCalledTimes(2);
  });
});
