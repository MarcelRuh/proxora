const { invoke } = window.__TAURI__.core;

const urlInput = document.getElementById("url");
const insecureInput = document.getElementById("insecure");
const errorEl = document.getElementById("error");
const connectBtn = document.getElementById("connect");
const legacyEl = document.getElementById("legacy");
const updateEl = document.getElementById("update");
const verEl = document.getElementById("ver");

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function showLegacy(hint) {
  if (!hint) {
    legacyEl.hidden = true;
    return;
  }
  legacyEl.hidden = false;
  if (hint.kind === "self") {
    legacyEl.textContent =
      "This copy still lives under %LOCALAPPDATA%\\Proxora. Install the new Program Files build from GitHub Releases, then uninstall this user install via Windows Settings.";
  } else {
    legacyEl.textContent =
      `An old user install is still at ${hint.path}. Uninstall “Proxora” from Settings → Apps (the Local App Data one) so shortcuts do not reopen the outdated build.`;
  }
}

function showUpdate(detail) {
  if (!detail?.status) {
    updateEl.hidden = true;
    return;
  }
  updateEl.hidden = false;
  updateEl.classList.toggle("banner-error", detail.status === "error");
  updateEl.classList.toggle("banner-info", detail.status !== "error");
  if (detail.status === "available") {
    updateEl.textContent = `Update ${detail.version} found — downloading…`;
  } else if (detail.status === "installed") {
    updateEl.textContent = `Update ${detail.version} installed — restarting…`;
  } else if (detail.status === "upToDate") {
    updateEl.textContent = "You are on the latest desktop build.";
  } else if (detail.status === "error") {
    updateEl.textContent = `Update check failed: ${detail.message || "unknown error"}`;
  } else {
    updateEl.hidden = true;
  }
}

function readQueryError() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const code = params.get("error");
    if (code === "unreachable") {
      return "Server could not be reached (DNS/network). Check the URL or your connection, then Connect again.";
    }
    return code ? `Setup error: ${code}` : "";
  } catch {
    return "";
  }
}

async function bootstrap() {
  try {
    const prefs = await invoke("get_prefs");
    if (prefs?.serverUrl) urlInput.value = prefs.serverUrl;
    insecureInput.checked = Boolean(prefs?.allowInsecureTls);
    if (prefs?.appVersion) verEl.textContent = `· v${prefs.appVersion}`;
    showLegacy(prefs?.legacyInstall ?? null);
    const queryError = readQueryError();
    if (queryError) showError(queryError);
  } catch (err) {
    showError(String(err));
  }
}

async function connect() {
  showError("");
  connectBtn.disabled = true;
  try {
    await invoke("save_server", {
      url: urlInput.value,
      allowInsecureTls: insecureInput.checked,
    });
  } catch (err) {
    showError(err?.message || String(err));
    connectBtn.disabled = false;
  }
}

connectBtn.addEventListener("click", () => void connect());
urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void connect();
});
window.addEventListener("proxora-update", (event) => {
  showUpdate(event.detail);
});

void bootstrap();
