function looksLikeJson(text: string): boolean {
  const s = text.trim();
  if (s.length < 2) return false;
  const start = s[0];
  const end = s[s.length - 1];
  return (start === "{" && end === "}") || (start === "[" && end === "]");
}

function isJsonName(name: string): boolean {
  return /\.json$/i.test(name);
}

function isMarkupName(name: string): boolean {
  return /\.(xml|html|htm|svg|xhtml)$/i.test(name);
}

function formatJson(text: string): string {
  return `${JSON.stringify(JSON.parse(text.replace(/^\uFEFF/, "")), null, 2)}\n`;
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function formatMarkup(text: string): string {
  const tokens = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split(/(<[^>]+>)/g);
  let indent = 0;
  const lines: string[] = [];
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    if (token.startsWith("</")) {
      indent = Math.max(0, indent - 1);
      lines.push(`${"  ".repeat(indent)}${token}`);
      continue;
    }
    if (token.startsWith("<")) {
      const name = /^<\/?([^\s>/]+)/.exec(token)?.[1]?.toLowerCase() ?? "";
      const selfClose =
        token.endsWith("/>") ||
        token.startsWith("<!--") ||
        token.startsWith("<?") ||
        token.startsWith("<!") ||
        VOID_TAGS.has(name);
      lines.push(`${"  ".repeat(indent)}${token}`);
      if (!selfClose) indent += 1;
      continue;
    }
    for (const line of token.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) lines.push(`${"  ".repeat(indent)}${trimmed}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function tidyGuestFileText(text: string): string {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, "  ").replace(/[ \t]+$/g, ""));
  const out: string[] = [];
  let blank = 0;
  for (const line of lines) {
    if (!line) {
      blank += 1;
      if (blank <= 2) out.push("");
      continue;
    }
    blank = 0;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? `${out.join("\n")}\n` : "";
}

/** Pretty-print on open: JSON and markup only. Invalid JSON stays as-is. */
export function prettyGuestFileOnOpen(name: string, text: string): string {
  try {
    if (isJsonName(name) || looksLikeJson(text)) return formatJson(text);
    if (isMarkupName(name)) return formatMarkup(text);
  } catch {
    return text;
  }
  return text;
}

/** Format button: JSON (strict for .json), markup, otherwise tidy whitespace. */
export function formatGuestFileText(name: string, text: string): string {
  const body = text.replace(/^\uFEFF/, "");
  if (isJsonName(name) || looksLikeJson(body)) {
    try {
      return formatJson(body);
    } catch {
      if (isJsonName(name)) throw new Error("JSON ungültig");
    }
  }
  if (isMarkupName(name)) return formatMarkup(body);
  return tidyGuestFileText(body);
}
