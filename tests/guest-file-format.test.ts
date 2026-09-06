import { describe, expect, it } from "vitest";
import { formatGuestFileText, prettyGuestFileOnOpen, tidyGuestFileText } from "@/lib/guest-file-format";

describe("guest file formatter", () => {
  it("pretty-prints JSON with two-space indent", () => {
    expect(formatGuestFileText("app.json", "{\"a\":1,\"b\":[true]}")).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}\n');
  });

  it("rejects invalid JSON for .json files", () => {
    expect(() => formatGuestFileText("broken.json", "{a:1}")).toThrow(/JSON/);
  });

  it("indents markup", () => {
    const out = formatGuestFileText("index.html", "<html><body><p>Hi</p></body></html>");
    expect(out).toContain("<html>");
    expect(out).toContain("  <body>");
    expect(out).toContain("    <p>");
  });

  it("tidies tabs and trailing space on open-unrelated files", () => {
    expect(tidyGuestFileText("line  \n\tindented\n\n\n\nend  ")).toBe("line\n  indented\n\n\nend\n");
  });

  it("pretty-prints JSON when a file is opened", () => {
    expect(prettyGuestFileOnOpen("x.json", '{"ok":true}')).toBe('{\n  "ok": true\n}\n');
    expect(prettyGuestFileOnOpen("x.conf", "foo = 1")).toBe("foo = 1");
  });
});
