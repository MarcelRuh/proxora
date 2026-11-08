const { invoke } = window.__TAURI__.core;

const urlInput = document.getElementById("url");
const insecureInput = document.getElementById("insecure");
const errorEl = document.getElementById("error");
const connectBtn = document.getElementById("connect");

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

async function bootstrap() {
  try {
    const prefs = await invoke("get_prefs");
    if (prefs?.serverUrl) urlInput.value = prefs.serverUrl;
    insecureInput.checked = Boolean(prefs?.allowInsecureTls);
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

void bootstrap();
