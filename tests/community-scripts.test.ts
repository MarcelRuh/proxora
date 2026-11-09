import { describe, expect, it } from "vitest";
import {
  communityScriptInstallCommand,
  communityScriptKindFromTypeId,
  communityScriptLogoSrc,
  communityScriptRawUrl,
  communityScriptSourcePath,
  filterCommunityScripts,
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
});
