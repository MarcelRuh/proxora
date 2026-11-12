import { describe, expect, it } from "vitest";
import {
  communityScriptInstallCommand,
  communityScriptKindFromTypeId,
  communityScriptLogoSrc,
  communityScriptRawUrl,
  communityScriptSourcePath,
  communityScriptFacetCounts,
  filterCommunityScripts,
  parseCommunityScriptInstallStats,
  sortCommunityScripts,
  isSafeCommunityScriptSlug,
  parseCommunityScriptSummary,
  SCRIPT_TYPE_IDS,
  type CommunityScriptSummary,
} from "@/lib/community-scripts";

function sample(partial: Partial<CommunityScriptSummary> = {}): CommunityScriptSummary {
  return {
    id: "docker000000000",
    name: "Docker",
    slug: "docker",
    description: "Container runtime",
    logo: null,
    kind: "lxc",
    categoryIds: ["scriptcat00003"],
    port: null,
    privileged: false,
    updateable: true,
    website: null,
    documentation: null,
    defaultCpu: 2,
    defaultRamMb: 2048,
    defaultDiskGb: 4,
    defaultOs: "Debian",
    createdAt: null,
    updatedAt: null,
    hasArm: false,
    isDev: false,
    hasOidc: false,
    ...partial,
  };
}

describe("community scripts helpers", () => {
  it("maps PocketBase type ids to kinds and source paths", () => {
    expect(communityScriptKindFromTypeId(SCRIPT_TYPE_IDS.lxc)).toBe("lxc");
    expect(communityScriptKindFromTypeId(SCRIPT_TYPE_IDS.addon)).toBe("addon");
    expect(communityScriptSourcePath("lxc", "docker")).toBe("ct/docker.sh");
    expect(communityScriptSourcePath("addon", "add-netbird-lxc")).toBe("tools/addon/add-netbird-lxc.sh");
    expect(communityScriptSourcePath("pve", "add-iptag")).toBe("tools/pve/add-iptag.sh");
    expect(communityScriptRawUrl("vm", "ubuntu-vm")).toContain("/vm/ubuntu-vm.sh");
  });

  it("builds the install one-liner", () => {
    expect(communityScriptInstallCommand("lxc", "docker")).toBe(
      'bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/docker.sh)"',
    );
  });

  it("parses summaries and drops disabled entries", () => {
    const ok = parseCommunityScriptSummary({
      id: "x",
      name: "Docker",
      slug: "docker",
      description: "desc",
      type: SCRIPT_TYPE_IDS.lxc,
      categories: ["scriptcat00003"],
      install_methods: [{ type: "default", resources: { cpu: 2, ram: 1024, hdd: 8, os: "Debian" } }],
      is_deleted: false,
      is_disabled: false,
    });
    expect(ok?.defaultCpu).toBe(2);
    expect(ok?.kind).toBe("lxc");
    expect(
      parseCommunityScriptSummary({
        id: "x",
        name: "Docker",
        slug: "docker",
        is_disabled: true,
      }),
    ).toBeNull();
  });

  it("filters by query, category and kind", () => {
    const scripts = [
      sample(),
      sample({ id: "jf", name: "Jellyfin", slug: "jellyfin", description: "media", categoryIds: ["media"] }),
      sample({ id: "ha", name: "HAOS", slug: "haos-vm", kind: "vm", categoryIds: ["os"] }),
    ];
    expect(filterCommunityScripts(scripts, { query: "jelly" }).map((s) => s.slug)).toEqual(["jellyfin"]);
    expect(filterCommunityScripts(scripts, { categoryId: "os" }).map((s) => s.slug)).toEqual(["haos-vm"]);
    expect(filterCommunityScripts(scripts, { kind: "vm" }).map((s) => s.slug)).toEqual(["haos-vm"]);
  });

  it("validates slugs", () => {
    expect(isSafeCommunityScriptSlug("docker")).toBe(true);
    expect(isSafeCommunityScriptSlug("add-netbird-lxc")).toBe(true);
    expect(isSafeCommunityScriptSlug("../evil")).toBe(false);
    expect(isSafeCommunityScriptSlug("docker.sh")).toBe(false);
  });

  it("proxies CDN logos and keeps other https logos direct", () => {
    expect(communityScriptLogoSrc("https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/docker.webp")).toContain(
      "/api/community-scripts/logo?u=",
    );
    expect(communityScriptLogoSrc("https://cinny.in/assets/cinny.svg")).toBe("https://cinny.in/assets/cinny.svg");
    expect(communityScriptLogoSrc("http://evil.example/x.png")).toBeNull();
  });

  it("parses dates and flags from upstream records", () => {
    const parsed = parseCommunityScriptSummary({
      id: "x1",
      name: "marimo",
      slug: "marimo",
      type: SCRIPT_TYPE_IDS.lxc,
      script_created: "2026-11-12 00:00:00.000Z",
      script_updated: "",
      updated: "2026-11-12 20:59:00.832Z",
      architectures: ["amd64", "arm64"],
      has_arm: false,
      is_dev: true,
      oidc_url: "https://docs.example/oidc",
    });
    expect(parsed?.createdAt).toBe(Date.parse("2026-11-12T00:00:00.000Z"));
    const sameDay = parseCommunityScriptSummary({
      id: "x2",
      name: "GoatCounter",
      slug: "goatcounter",
      script_created: "2026-11-12 00:00:00.000Z",
      created: "2026-11-12 15:07:23.358Z",
    });
    expect(sameDay?.createdAt).toBe(Date.parse("2026-11-12T15:07:23.358Z"));
    expect(parsed?.updatedAt).toBe(Date.parse("2026-11-12T20:59:00.832Z"));
    expect(parsed).toMatchObject({ hasArm: true, isDev: true, hasOidc: true });
  });

  it("filters by kind chips and flags, and counts facets", () => {
    const scripts = [
      sample({ id: "a", slug: "a", name: "A", kind: "lxc", hasArm: true }),
      sample({ id: "b", slug: "b", name: "B", kind: "vm", hasArm: true, isDev: true }),
      sample({ id: "c", slug: "c", name: "C", kind: "addon", hasOidc: true }),
    ];
    expect(filterCommunityScripts(scripts, { kinds: ["lxc", "vm"] }).map((s) => s.slug)).toEqual(["a", "b"]);
    expect(filterCommunityScripts(scripts, { flags: ["arm", "testing"] }).map((s) => s.slug)).toEqual(["b"]);
    const facets = communityScriptFacetCounts(scripts, { kinds: ["vm"], flags: ["arm"] });
    // kind counts ignore the kind chips, flag counts ignore the flag chips
    expect(facets.kinds).toMatchObject({ lxc: 1, vm: 1, addon: 0 });
    expect(facets.flags).toMatchObject({ arm: 1, testing: 1, oidc: 0 });
  });

  it("sorts by popularity, age, update and category with unknowns last", () => {
    const scripts = [
      sample({ id: "a", slug: "a", name: "Alpha", installs30d: 5, createdAt: 3, updatedAt: null, categoryIds: ["c2"] }),
      sample({ id: "b", slug: "b", name: "Beta", installs30d: 50, createdAt: null, updatedAt: 9, categoryIds: ["c1"] }),
      sample({ id: "c", slug: "c", name: "Gamma", installs30d: null, createdAt: 7, updatedAt: 1, categoryIds: [] }),
    ];
    const slugs = (sort: Parameters<typeof sortCommunityScripts>[1]) =>
      sortCommunityScripts(scripts, sort, [
        { id: "c1", name: "One", description: "", sortOrder: 1 },
        { id: "c2", name: "Two", description: "", sortOrder: 2 },
      ]).map((s) => s.slug);
    expect(slugs("popular")).toEqual(["b", "a", "c"]);
    expect(slugs("least")).toEqual(["a", "b", "c"]);
    expect(slugs("newest")).toEqual(["c", "a", "b"]);
    expect(slugs("updated")).toEqual(["b", "c", "a"]);
    expect(slugs("category")).toEqual(["b", "a", "c"]);
    expect(slugs("name")).toEqual(["a", "b", "c"]);
  });

  it("extracts 30-day install counts from the escaped page payload", () => {
    const html = String.raw`x\"popularStats\":[{\"slug\":\"update-apps\",\"installCount30d\":14705},{\"slug\":\"docker\",\"installCount30d\":5762}]` +
      '{"slug":"plain","installCount30d":3}';
    const stats = parseCommunityScriptInstallStats(html);
    expect(Object.fromEntries(stats)).toEqual({ "update-apps": 14705, docker: 5762, plain: 3 });
  });
});
