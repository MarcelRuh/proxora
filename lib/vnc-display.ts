export const VNC_VIEW_PRESETS = [
  { id: "fit", w: 0, h: 0 },
  { id: "native", w: 0, h: 0 },
  { id: "1024x768", w: 1024, h: 768 },
  { id: "1280x720", w: 1280, h: 720 },
  { id: "1600x900", w: 1600, h: 900 },
  { id: "1920x1080", w: 1920, h: 1080 },
] as const;

export type VncViewId = (typeof VNC_VIEW_PRESETS)[number]["id"];

const VNC_VIEW_IDS = new Set<string>(VNC_VIEW_PRESETS.map((p) => p.id));
export const VNC_VIEW_STORAGE_KEY = "proxora-vnc-view";

export function parseVncView(raw: string | null | undefined): VncViewId {
  return raw && VNC_VIEW_IDS.has(raw) ? (raw as VncViewId) : "fit";
}

export type VncViewSettings = {
  scaleViewport: boolean;
  resizeSession: boolean;
  clipViewport: boolean;
  width?: number;
  height?: number;
};

export function vncViewSettings(view: VncViewId): VncViewSettings {
  if (view === "fit") return { scaleViewport: true, resizeSession: false, clipViewport: false };
  if (view === "native") return { scaleViewport: false, resizeSession: false, clipViewport: true };
  const preset = VNC_VIEW_PRESETS.find((p) => p.id === view);
  return {
    scaleViewport: false,
    resizeSession: true,
    clipViewport: false,
    width: preset?.w || undefined,
    height: preset?.h || undefined,
  };
}

type VncViewTarget = {
  scaleViewport: boolean;
  resizeSession: boolean;
  clipViewport: boolean;
};

export function applyVncView(rfb: VncViewTarget | null, screen: HTMLElement | null, view: VncViewId) {
  if (!rfb || !screen) return;
  const settings = vncViewSettings(view);
  rfb.scaleViewport = settings.scaleViewport;
  rfb.resizeSession = settings.resizeSession;
  rfb.clipViewport = settings.clipViewport;
  screen.dataset.view = view;
  if (settings.width && settings.height) {
    screen.style.width = `${settings.width}px`;
    screen.style.height = `${settings.height}px`;
  } else {
    screen.style.width = "";
    screen.style.height = "";
  }
}
