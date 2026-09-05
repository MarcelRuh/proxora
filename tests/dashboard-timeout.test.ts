import { describe, expect, it } from "vitest";
import { hostSnapshotTimeoutMs, HOST_SNAPSHOT_TIMEOUT_MS, HOST_SNAPSHOT_TIMEOUT_PEER_MS } from "@/server/services/dashboard-service";

describe("hostSnapshotTimeoutMs", () => {
  it("gives colleague hosts more time than local ones", () => {
    expect(hostSnapshotTimeoutMs({ origin: "LOCAL" })).toBe(HOST_SNAPSHOT_TIMEOUT_MS);
    expect(hostSnapshotTimeoutMs({})).toBe(HOST_SNAPSHOT_TIMEOUT_MS);
    expect(hostSnapshotTimeoutMs({ origin: "PEER" })).toBe(HOST_SNAPSHOT_TIMEOUT_PEER_MS);
    expect(HOST_SNAPSHOT_TIMEOUT_PEER_MS).toBeGreaterThan(HOST_SNAPSHOT_TIMEOUT_MS);
  });
});
