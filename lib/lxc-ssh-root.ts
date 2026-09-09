export function isLxcRootSshEnabled(permitRootLogin: string | null | undefined): boolean {
  return String(permitRootLogin ?? "")
    .trim()
    .toLowerCase() === "yes";
}

export type SshdPermitRootLine = { commented: boolean; value: string };

/** One sshd_config line: `PermitRootLogin …` or `#PermitRootLogin …`. */
export function parseSshdPermitRootLoginLine(raw: string): SshdPermitRootLine | null {
  const line = raw.replace(/\r$/, "").replace(/^\s+/, "");
  if (!line) return null;
  const commented = line.startsWith("#");
  const rest = (commented ? line.replace(/^#\s*/, "") : line).replace(/^\s+/, "");
  const match = /^PermitRootLogin(?:\s+(\S+))?(?:\s|#|$)/i.exec(rest);
  if (!match) return null;
  const value = (match[1] ?? "").replace(/,.*/, "").toLowerCase();
  return { commented, value };
}

/**
 * Uncommented `PermitRootLogin` → on.
 * Only `#PermitRootLogin` (or no line) → off.
 * First uncommented line wins.
 */
export function isSshdConfigRootLoginEnabled(config: string): boolean {
  for (const raw of config.split("\n")) {
    const parsed = parseSshdPermitRootLoginLine(raw);
    if (!parsed || parsed.commented) continue;
    return parsed.value !== "no" && parsed.value !== "forced-commands-only";
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseLxcExecPayload(raw: string, begin: string, end: string): { stdout: string; exitCode: number } | null {
  const text = stripTermNoise(raw);
  const re = new RegExp(`(?:^|\\n)${escapeRegExp(begin)}\\n([\\s\\S]*?)\\n${escapeRegExp(end)}:(\\d+)`);
  const match = re.exec(text);
  if (!match) return null;
  return { stdout: match[1].trim(), exitCode: Number(match[2]) };
}

export function stripTermNoise(raw: string): string {
  return raw
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "");
}

/** Run the guest script in a heredoc so the container does not need base64. */
export function wrapLxcTermScript(script: string, begin: string, end: string): string {
  if (script.includes("PXR_SH")) {
    throw new Error("Script must not contain PXR_SH");
  }
  return [
    "stty -echo cols 512 2>/dev/null || true",
    `echo ${begin}`,
    "sh <<'PXR_SH'",
    script.replace(/\n$/, ""),
    "PXR_SH",
    `echo ${end}:$?`,
    "",
  ].join("\n");
}

export function parseLxcSshRootStatus(stdout: string): { running: boolean; permitRootLogin: string; enabled: boolean } {
  const enabled = isSshdConfigRootLoginEnabled(stdout);
  return { running: true, permitRootLogin: enabled ? "yes" : "no", enabled };
}

const PATH_PREFIX = 'export PATH="/usr/sbin:/sbin:/usr/bin:/bin${PATH:+:$PATH}"';

export function lxcSshRootStatusScript(): string {
  return [
    PATH_PREFIX,
    "if [ ! -f /etc/ssh/sshd_config ]; then",
    "  echo NO_SSHD_CONFIG",
    "  exit 2",
    "fi",
    "cat /etc/ssh/sshd_config",
  ].join("\n");
}

const RESTART_SSHD = [
  "if command -v systemctl >/dev/null 2>&1; then",
  "  systemctl restart ssh >/dev/null 2>&1 || systemctl restart sshd >/dev/null 2>&1 || true",
  "elif command -v rc-service >/dev/null 2>&1; then",
  "  rc-service sshd restart >/dev/null 2>&1 || rc-service ssh restart >/dev/null 2>&1 || true",
  "elif command -v service >/dev/null 2>&1; then",
  "  service ssh restart >/dev/null 2>&1 || service sshd restart >/dev/null 2>&1 || true",
  "else",
  "  pkill -HUP -x sshd >/dev/null 2>&1 || true",
  "fi",
];

export function lxcSshRootSetScript(enabled: boolean): string {
  const write = enabled
    ? [
        "if grep -qiE '^[[:space:]]*#?[[:space:]]*PermitRootLogin' /etc/ssh/sshd_config; then",
        "  sed -i 's/^[[:space:]]*#[[:space:]]*PermitRootLogin[[:space:]].*/PermitRootLogin yes/' /etc/ssh/sshd_config",
        "  sed -i 's/^[[:space:]]*PermitRootLogin[[:space:]].*/PermitRootLogin yes/' /etc/ssh/sshd_config",
        "else",
        "  printf '\\nPermitRootLogin yes\\n' >> /etc/ssh/sshd_config",
        "fi",
      ]
    : [
        "sed -i 's/^\\([[:space:]]*\\)PermitRootLogin\\([[:space:]].*\\)$/\\1#PermitRootLogin\\2/' /etc/ssh/sshd_config",
      ];
  return [
    PATH_PREFIX,
    "if [ ! -f /etc/ssh/sshd_config ]; then",
    "  echo NO_SSHD_CONFIG",
    "  exit 2",
    "fi",
    "rm -f /etc/ssh/sshd_config.d/99-proxora-root.conf",
    ...write,
    ...RESTART_SSHD,
    "cat /etc/ssh/sshd_config",
  ].join("\n");
}
