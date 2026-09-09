export function isLxcRootSshEnabled(permitRootLogin: string | null | undefined): boolean {
  const v = String(permitRootLogin ?? "")
    .trim()
    .toLowerCase();
  return v === "yes" || v === "without-password" || v === "prohibit-password";
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
  let permitRootLogin = "unknown";
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { running?: unknown; permitRootLogin?: unknown };
      running = parsed.running === true || parsed.running === 1 || parsed.running === "1";
      permitRootLogin = String(parsed.permitRootLogin ?? "unknown").trim().toLowerCase() || "unknown";
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
    "running=0",
    "pgrep -x sshd >/dev/null 2>&1 && running=1",
    "permit=",
    "if command -v timeout >/dev/null 2>&1 && command -v sshd >/dev/null 2>&1; then",
    "  permit=$(timeout 2 sshd -T 2>/dev/null | awk 'tolower($1)==\"permitrootlogin\"{print tolower($2);exit}')",
    "fi",
    'if [ -z "$permit" ]; then',
    "  awk_cmd='$1~/^#/{next} tolower($1)==\"permitrootlogin\"{print tolower($2);exit}'",
    "  for f in /etc/ssh/sshd_config.d/*.conf /etc/ssh/sshd_config; do",
    '    [ -f "$f" ] || continue',
    '    [ -n "$permit" ] && break',
    '    permit=$(awk "$awk_cmd" "$f")',
    "  done",
    "fi",
    'if [ -z "$permit" ] && { [ -f /etc/ssh/sshd_config ] || command -v sshd >/dev/null 2>&1; }; then',
    "  permit=prohibit-password",
    "fi",
    '[ -n "$permit" ] || permit=unknown',
    'printf \'{"running":%s,"permitRootLogin":"%s"}\\n\' "$running" "$permit"',
  ].join("\n");
}

const RESTART_SSHD = [
  "if command -v systemctl >/dev/null 2>&1; then",
  "  systemctl enable ssh >/dev/null 2>&1 || systemctl enable sshd >/dev/null 2>&1 || true",
  "  systemctl restart ssh >/dev/null 2>&1 || systemctl restart sshd >/dev/null 2>&1 || true",
  "elif command -v rc-service >/dev/null 2>&1; then",
  "  rc-update add sshd default >/dev/null 2>&1 || rc-update add ssh default >/dev/null 2>&1 || true",
  "  rc-service sshd restart >/dev/null 2>&1 || rc-service ssh restart >/dev/null 2>&1 || true",
  "elif command -v service >/dev/null 2>&1; then",
  "  service ssh restart >/dev/null 2>&1 || service sshd restart >/dev/null 2>&1 || true",
  "else",
  "  pkill -HUP -x sshd >/dev/null 2>&1 || true",
  "  pgrep -x sshd >/dev/null 2>&1 || /usr/sbin/sshd >/dev/null 2>&1 || sshd >/dev/null 2>&1 || true",
  "fi",
];

export function lxcSshRootSetScript(enabled: boolean): string {
  const value = enabled ? "yes" : "no";
  return [
    PATH_PREFIX,
    "if ! command -v sshd >/dev/null 2>&1 && [ ! -x /usr/sbin/sshd ]; then",
    "  echo NO_SSHD",
    "  exit 2",
    "fi",
    "if [ -d /etc/ssh/sshd_config.d ]; then",
    `  printf 'PermitRootLogin ${value}\\n' > /etc/ssh/sshd_config.d/99-proxora-root.conf`,
    "  chmod 644 /etc/ssh/sshd_config.d/99-proxora-root.conf",
    "elif [ -f /etc/ssh/sshd_config ]; then",
    "  if grep -qE '^[[:space:]]*#?[[:space:]]*PermitRootLogin[[:space:]]' /etc/ssh/sshd_config; then",
    `    sed -i 's/^[[:space:]]*#*[[:space:]]*PermitRootLogin[[:space:]].*/PermitRootLogin ${value}/' /etc/ssh/sshd_config`,
    "  else",
    `    printf '\\nPermitRootLogin ${value}\\n' >> /etc/ssh/sshd_config`,
    "  fi",
    "else",
    "  echo NO_SSHD_CONFIG",
    "  exit 2",
    "fi",
    ...RESTART_SSHD,
    lxcSshRootStatusScript(),
  ].join("\n");
}
