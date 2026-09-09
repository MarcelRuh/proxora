export function isLxcRootSshEnabled(permitRootLogin: string | null | undefined): boolean {
  return String(permitRootLogin ?? "")
    .trim()
    .toLowerCase() === "yes";
}

/** Uncommented `PermitRootLogin yes` in /etc/ssh/sshd_config. */
export function isSshdConfigRootLoginYes(config: string): boolean {
  for (const raw of config.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^PermitRootLogin\s+yes(\s|#|$)/i.test(line)) return true;
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
  const jsonMatch = /\{[\s\S]*\}/.exec(stdout);
  let running = false;
  let permitRootLogin = "no";
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { running?: unknown; permitRootLogin?: unknown };
      running = parsed.running === true || parsed.running === 1 || parsed.running === "1";
      permitRootLogin = String(parsed.permitRootLogin ?? "no").trim().toLowerCase() || "no";
    } catch {
      /* fall through */
    }
  }
  return { running, permitRootLogin, enabled: isLxcRootSshEnabled(permitRootLogin) };
}

const PATH_PREFIX = 'export PATH="/usr/sbin:/sbin:/usr/bin:/bin${PATH:+:$PATH}"';

export function lxcSshRootStatusScript(): string {
  return [
    PATH_PREFIX,
    "permit=no",
    "if [ -f /etc/ssh/sshd_config ] && grep -Eq '^[[:space:]]*PermitRootLogin[[:space:]]+yes([#[:space:]]|$)' /etc/ssh/sshd_config; then",
    "  permit=yes",
    "fi",
    'printf \'{"running":1,"permitRootLogin":"%s"}\\n\' "$permit"',
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
  const value = enabled ? "yes" : "no";
  return [
    PATH_PREFIX,
    "if [ ! -f /etc/ssh/sshd_config ]; then",
    "  echo NO_SSHD_CONFIG",
    "  exit 2",
    "fi",
    "rm -f /etc/ssh/sshd_config.d/99-proxora-root.conf",
    "if grep -qE '^[[:space:]]*PermitRootLogin[[:space:]]+' /etc/ssh/sshd_config; then",
    `  sed -i 's/^[[:space:]]*PermitRootLogin[[:space:]].*/PermitRootLogin ${value}/' /etc/ssh/sshd_config`,
    "else",
    `  printf '\\nPermitRootLogin ${value}\\n' >> /etc/ssh/sshd_config`,
    "fi",
    ...RESTART_SSHD,
    lxcSshRootStatusScript(),
  ].join("\n");
}
