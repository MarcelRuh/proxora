import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "@/lib/logger";
import {
  isSignalDirReady,
  isUpdateBusyFromSignal,
  resolveUpdateSignalDir,
  writeUpdateRequest,
  writeUpdateTarget,
} from "@/lib/self-update-signal";
import {
  APP_VERSION,
  DEFAULT_GITHUB_BRANCH,
  DEFAULT_GITHUB_REPO,
  isSelfUpdateAvailable,
  selfUpdateTargetVersion,
} from "@/lib/version";
import {
  fetchGithubChangelog,
  fetchGithubCommitSha,
  fetchGithubLatestRelease,
  fetchGithubPackageVersion,
} from "@/server/services/github-revision";
import {
  mergeProgress,
  parseUpdaterLogs,
  readComposeLogsFromDir,
  readProgressFromDir,
  REVISION_FILE,
  type SelfUpdateProgress,
} from "@/server/services/self-update-progress";

const execFileAsync = promisify(execFile);
const APPLY_TIMEOUT_MS = 20 * 60 * 1000;

export type SelfUpdateMode = "compose" | "none";
export type SelfUpdateSidecar = "ready" | "missing" | "host";

export interface SelfUpdateStatus {
  enabled: boolean;
  mode: SelfUpdateMode;
  sidecar: SelfUpdateSidecar;
  currentVersion: string;
  sourceVersion: string | null;
  remoteVersion: string | null;
  localRevision: string | null;
  remoteRevision: string | null;
  updateAvailable: boolean;
  message: string;
  installDir: string | null;
  repo: string | null;
  branch: string | null;
  targetTag: string | null;
  updating: boolean;
  progress: SelfUpdateProgress | null;
  changelog: string | null;
  targetVersion: string | null;
}

let applyInFlight = false;

function options() {
  return {
    installDirHost: process.env.PROXORA_INSTALL_DIR ?? process.env.DOCKORA_INSTALL_DIR ?? null,
    installDirMount: process.env.PROXORA_INSTALL_MOUNT ?? process.env.PROXORA_INSTALL_DIR ?? process.cwd(),
    repo: process.env.PROXORA_REPO ?? DEFAULT_GITHUB_REPO,
    branch: process.env.PROXORA_BRANCH ?? DEFAULT_GITHUB_BRANCH,
  };
}

function progressDir(): string | null {
  const signal = resolveUpdateSignalDir();
  if (isSignalDirReady(signal)) return signal;
  const mount = options().installDirMount;
  return mount && existsSync(mount) ? mount : null;
}

function sidecarState(): SelfUpdateSidecar {
  if (!existsSync("/.dockerenv")) return "host";
  return isSignalDirReady(resolveUpdateSignalDir()) ? "ready" : "missing";
}

function readSourceVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function readLocalRevision(dir: string | null): string | null {
  if (!dir) return process.env.GIT_SHA ?? null;
  const file = path.join(dir, REVISION_FILE);
  if (existsSync(file)) {
    try {
      return readFileSync(file, "utf8").trim() || null;
    } catch {
      /* ignore */
    }
  }
  return process.env.GIT_SHA ?? null;
}

function isUpdaterRunning(): boolean {
  const signalDir = resolveUpdateSignalDir();
  return isSignalDirReady(signalDir) && isUpdateBusyFromSignal(signalDir);
}

export async function getSelfUpdateStatus(): Promise<SelfUpdateStatus> {
  const opts = options();
  const sidecar = sidecarState();
  const updating = applyInFlight || isUpdaterRunning();
  const mount = opts.installDirMount;
  const sourceDir = mount && existsSync(path.join(mount, "package.json")) ? mount : null;
  const sourceVersion = sourceDir ? readSourceVersion(mount) : null;
  const enabled = Boolean(opts.installDirHost) || sidecar === "ready" || sidecar === "host";

  const base: SelfUpdateStatus = {
    enabled,
    mode: enabled ? "compose" : "none",
    sidecar,
    currentVersion: APP_VERSION,
    sourceVersion,
    remoteVersion: null,
    localRevision: readLocalRevision(progressDir()),
    remoteRevision: null,
    updateAvailable: false,
    message:
      sidecar === "missing"
        ? "Self-update sidecar is missing. Recreate the stack with docker compose up -d."
        : enabled
          ? "Checking GitHub…"
          : "Self-update unavailable. Set PROXORA_INSTALL_DIR to the Compose install path.",
    installDir: opts.installDirHost ?? mount,
    repo: opts.repo,
    branch: opts.branch,
    targetTag: null,
    updating,
    progress: null,
    changelog: null,
    targetVersion: null,
  };

  if (!enabled || sidecar === "missing") return withProgress(base);

  let remoteRevision: string | null = null;
  let shaError: string | null = null;
  let remoteVersion: string | null = null;
  let targetTag: string | null = null;
  try {
    const release = await fetchGithubLatestRelease(opts.repo);
    if (release) {
      targetTag = release.tag;
      remoteVersion = release.version;
      remoteRevision = release.sha;
    }
  } catch (error) {
    shaError = error instanceof Error ? error.message : String(error);
  }
  if (!remoteRevision && !remoteVersion) {
    try {
      remoteRevision = await fetchGithubCommitSha(opts.repo, targetTag ?? opts.branch);
    } catch (error) {
      shaError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!remoteVersion) {
    try {
      remoteVersion = await fetchGithubPackageVersion(opts.repo, remoteRevision ?? targetTag ?? opts.branch);
    } catch {
      remoteVersion = null;
    }
  }

  const targetVersion = selfUpdateTargetVersion(APP_VERSION, remoteVersion, sourceVersion);
  const updateAvailable = isSelfUpdateAvailable({
    runningVersion: APP_VERSION,
    sourceVersion,
    remoteVersion,
  });

  let changelog: string | null = null;
  if (updateAvailable) {
    try {
      changelog = await fetchGithubChangelog(opts.repo, targetTag ?? remoteRevision ?? opts.branch, APP_VERSION);
    } catch {
      changelog = null;
    }
  }

  return withProgress({
    ...base,
    remoteVersion,
    remoteRevision,
    targetTag,
    updateAvailable,
    targetVersion,
    changelog,
    message: updating
      ? "Update running…"
      : shaError && !updateAvailable
        ? `GitHub check failed: ${shaError}`
        : updateAvailable
          ? targetVersion
            ? `Update available — ${APP_VERSION} → ${targetVersion}`
            : "Update available from GitHub"
          : "Up to date",
  });
}

async function withProgress(status: SelfUpdateStatus): Promise<SelfUpdateStatus> {
  const dir = progressDir();
  const file = readProgressFromDir(dir);
  const logs = status.updating ? parseUpdaterLogs(readComposeLogsFromDir(dir) ?? "") : null;
  const progress = mergeProgress(file, logs);
  if (progress && status.updating && progress.step === "done") {
    return { ...status, progress };
  }
  return { ...status, progress: status.updating || progress?.step === "error" ? progress : progress };
}

export async function applySelfUpdate(): Promise<{ ok: boolean; message: string; mode: SelfUpdateMode }> {
  if (applyInFlight || isUpdaterRunning()) {
    return { ok: false, message: "Update already running", mode: "compose" };
  }
  const status = await getSelfUpdateStatus();
  if (!status.enabled) return { ok: false, message: status.message, mode: status.mode };
  if (status.sidecar === "missing") {
    return { ok: false, message: status.message, mode: status.mode };
  }

  const opts = options();
  const hostDir = opts.installDirHost ?? opts.installDirMount;
  const mount = opts.installDirMount;
  if (!hostDir || !mount) {
    return { ok: false, message: "PROXORA_INSTALL_DIR is not set", mode: "compose" };
  }

  applyInFlight = true;
  try {
    if (!existsSync("/.dockerenv")) {
      return await applyOnHost(mount, opts.repo, opts.branch, status.targetTag);
    }
    return applyViaSignal(hostDir, opts.repo, status.targetTag);
  } finally {
    applyInFlight = false;
  }
}

async function applyOnHost(installMount: string, repo: string, branch: string, tag: string | null) {
  const scriptPath = path.join(installMount, "scripts", "self-update-apply.sh");
  if (!existsSync(scriptPath)) {
    return { ok: false, message: "self-update-apply.sh missing", mode: "compose" as const };
  }
  try {
    const { stdout, stderr } = await execFileAsync("sh", [scriptPath], {
      env: {
        ...process.env,
        PROXORA_INSTALL_DIR: installMount,
        PROXORA_REPO: repo,
        PROXORA_BRANCH: branch,
        PROXORA_RELEASE_TAG: tag ?? "",
        PROXORA_SKIP_COMPOSE: existsSync("/.dockerenv") ? "0" : "1",
      },
      timeout: APPLY_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-8).join("\n");
    return { ok: true, mode: "compose" as const, message: `Files synced.\n${tail}` };
  } catch (error) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    return {
      ok: false,
      mode: "compose" as const,
      message: [err.message, err.stderr, err.stdout].filter(Boolean).join("\n") || String(error),
    };
  }
}

function applyViaSignal(hostDir: string, repo: string, tag: string | null) {
  const signalDir = resolveUpdateSignalDir();
  if (!isSignalDirReady(signalDir)) {
    return {
      ok: false,
      mode: "compose" as const,
      message: "Self-update sidecar is missing. Recreate the stack with docker compose up -d.",
    };
  }
  if (isUpdateBusyFromSignal(signalDir)) {
    return { ok: false, mode: "compose" as const, message: "Update already running" };
  }
  try {
    writeUpdateTarget(signalDir, tag);
    writeUpdateRequest(signalDir);
    logger.info({ hostDir, repo, tag, signalDir }, "Proxora update requested via sidecar");
    return {
      ok: true,
      mode: "compose" as const,
      message: "Updater started. Proxora will rebuild and come back shortly.",
    };
  } catch (error) {
    return {
      ok: false,
      mode: "compose" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
