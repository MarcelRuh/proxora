import { describe, expect, it } from "vitest";
import { groupSharedDashboardHosts, ownDashboardHosts, sharedDashboardHosts } from "@/lib/dashboard-hosts";

describe("dashboard host groups", () => {
  const hosts = [
    { id: "a", origin: "LOCAL" as const, peerName: null },
    { id: "b", origin: "PEER" as const, peerName: "Ada" },
    { id: "c", origin: "PEER" as const, peerName: "Ada" },
    { id: "d", origin: "PEER" as const, peerName: "  " },
    { id: "e" },
  ];

  it("keeps local hosts and hosts without an origin on the own side", () => {
    expect(ownDashboardHosts(hosts).map((host) => host.id)).toEqual(["a", "e"]);
    expect(sharedDashboardHosts(hosts).map((host) => host.id)).toEqual(["b", "c", "d"]);
  });

  it("groups shared hosts by colleague and uses a fallback name", () => {
    expect(groupSharedDashboardHosts(sharedDashboardHosts(hosts), "Kollege")).toEqual([
      ["Ada", [hosts[1], hosts[2]]],
      ["Kollege", [hosts[3]]],
    ]);
  });
});
