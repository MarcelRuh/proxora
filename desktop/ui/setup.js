const { invoke } = window.__TAURI__.core;

const urlInput = document.getElementById("url");
const insecureRow = document.getElementById("insecure-row");
const insecureInput = document.getElementById("insecure");
const tlsNote = document.getElementById("tls-note");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const connectBtn = document.getElementById("connect");
const legacyEl = document.getElementById("legacy");
const updateEl = document.getElementById("update");
const verEl = document.getElementById("ver");

// Windows and Linux send failed loads back here with ?error=…; macOS keeps this page
// open instead, so a timeout reports a server that never loads.
const CONNECT_TIMEOUT_MS = 15000;
const MAC_NOTE =
  "macOS only opens servers with a trusted certificate. Using a self-signed one? Add it in Keychain Access and set it to “Always Trust”.";
const MAC_HINT = "Self-signed certificate? Trust it in Keychain Access (“Always Trust”).";
const INSECURE_HINT = "Self-signed certificate? Tick “Allow insecure TLS”.";

let os = "";
let initialInsecure = false;
let watchdog = 0;

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function showStatus(message) {
  statusEl.hidden = !message;
  statusEl.textContent = message || "";
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
  } else if (detail.status === "manual") {
    updateEl.textContent =
      detail.reason === "confirm"
        ? `Update ${detail.version} available — choose Check for updates… in the Proxora menu to install it (admin password required).`
        : `Update ${detail.version} available — download the new package from your Proxora server (Proxora → Download clients).`;
  } else if (detail.status === "error") {
    updateEl.textContent = `Update check failed: ${detail.message || "unknown error"}`;
  } else {
    updateEl.hidden = true;
  }
}

function updateTlsNote() {
  if (os === "macos") {
    tlsNote.textContent = MAC_NOTE;
    tlsNote.hidden = false;
  } else if (os === "windows" && insecureInput.checked !== initialInsecure) {
    // WebView2 reads this flag only at startup.
    tlsNote.textContent = "Proxora restarts once to apply this setting.";
    tlsNote.hidden = false;
  } else {
    tlsNote.hidden = true;
  }
}

function failureMessage(code) {
  if (code === "tls") {
    return `The server certificate is not trusted. ${os === "macos" ? MAC_HINT : INSECURE_HINT}`;
  }
  if (code === "unreachable" || code === "timeout") {
    const base =
      code === "timeout"
        ? "The server did not open. Check the URL and your network, then Connect again."
        : "Server could not be reached. Check the URL and your network, then Connect again.";
    // Linux reports certificate problems separately (code "tls").
    if (os === "macos") return `${base} ${MAC_HINT}`;
    if (os === "windows" && !insecureInput.checked) return `${base} ${INSECURE_HINT}`;
    return base;
  }
  return code ? `Setup error: ${code}` : "";
}

function readQueryCode() {
  try {
    return new URLSearchParams(window.location.search || "").get("error") || "";
  } catch {
    return "";
  }
}

function stopWatchdog() {
  window.clearTimeout(watchdog);
  watchdog = 0;
}

function startConnecting(url) {
  showError("");
  showStatus(`Connecting to ${url}…`);
  stopWatchdog();
  watchdog = window.setTimeout(() => {
    watchdog = 0;
    showStatus("");
    showError(failureMessage("timeout"));
    connectBtn.disabled = false;
  }, CONNECT_TIMEOUT_MS);
}

async function bootstrap() {
  try {
    const prefs = await invoke("get_prefs");
    os = prefs?.os || "";
    initialInsecure = Boolean(prefs?.allowInsecureTls);
    if (prefs?.serverUrl && !urlInput.value) urlInput.value = prefs.serverUrl;
    if (os === "macos") {
      // WKWebView cannot skip certificate checks; the macOS trust store decides.
      insecureRow.hidden = true;
      insecureInput.checked = false;
    } else {
      insecureInput.checked = initialInsecure;
    }
    updateTlsNote();
    if (prefs?.appVersion) verEl.textContent = `· v${prefs.appVersion}`;
    showLegacy(prefs?.legacyInstall ?? null);
    const code = readQueryCode();
    if (code) showError(failureMessage(code));
  } catch (err) {
    showError(String(err));
  }
}

async function connect() {
  const url = urlInput.value.trim();
  showError("");
  stopWatchdog();
  connectBtn.disabled = true;
  try {
    const restarting = await invoke("save_server", {
      url,
      allowInsecureTls: insecureInput.checked,
    });
    if (restarting) {
      showStatus("Restarting Proxora to apply the certificate setting…");
    } else {
      startConnecting(url);
    }
  } catch (err) {
    showStatus("");
    showError(err?.message || String(err));
    connectBtn.disabled = false;
  }
}

connectBtn.addEventListener("click", () => void connect());
urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void connect();
});
insecureInput.addEventListener("change", updateTlsNote);
window.addEventListener("proxora-update", (event) => {
  showUpdate(event.detail);
});
// Sent by the app when it opens the saved server right after start.
window.addEventListener("proxora-connecting", (event) => {
  if (event.detail?.url) startConnecting(event.detail.url);
});

void bootstrap();
