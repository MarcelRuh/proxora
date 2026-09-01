"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardCopy, Maximize2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/i18n/locale-provider";
import { disableQemuExtendedKeys, grabRfbKeyboard, rfbKeysymFromKeyboardEvent, sendClipboardAsKeys } from "@/lib/vnc-input";
import { QEMU_KEYBOARD_LAYOUTS, parseQemuKeyboard } from "@/lib/guest-console";
import {
  applyVncView,
  parseVncView,
  VNC_VIEW_PRESETS,
  VNC_VIEW_STORAGE_KEY,
  type VncViewId,
} from "@/lib/vnc-display";

type Props = {
  hostId: string;
  node: string;
  vmid: number;
  running: boolean;
  keyboard?: string;
  canSetKeyboard?: boolean;
  onKeyboardChange?: (layout: string) => Promise<void>;
};

type RfbInstance = InstanceType<typeof import("@novnc/novnc/lib/rfb.js").default>;

const toolbarSelectClass =
  "h-7 max-w-[11rem] rounded border border-white/15 bg-transparent px-1.5 text-[11px] text-slate-300";

function focusRfb(container: HTMLElement | null, rfb: RfbInstance | null) {
  if (!rfb) return;
  const canvas = container?.querySelector("canvas");
  if (canvas instanceof HTMLCanvasElement) canvas.tabIndex = 0;
  rfb.focus();
}

export function VncConsole({
  hostId,
  node,
  vmid,
  running,
  keyboard,
  canSetKeyboard,
  onKeyboardChange,
}: Props) {
  const { t } = useI18n();
  const shellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [view, setView] = useState<VncViewId>(() =>
    typeof window === "undefined" ? "fit" : parseVncView(window.localStorage.getItem(VNC_VIEW_STORAGE_KEY)),
  );
  const viewRef = useRef<VncViewId>(view);
  viewRef.current = view;
  const [savingKeyboard, setSavingKeyboard] = useState(false);
  const layout = parseQemuKeyboard(keyboard);

  useEffect(() => {
    applyVncView(rfbRef.current, containerRef.current, view);
  }, [view]);

  useEffect(() => {
    if (!running) {
      rfbRef.current = null;
      setStatus("disconnected");
      setDetail(null);
      return;
    }
    const target = containerRef.current;
    if (!target) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let attached = false;
    let releaseKeyboard: (() => void) | undefined;
    setStatus("connecting");
    setDetail(null);

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsBase = process.env.NEXT_PUBLIC_WS_URL || `${proto}://${window.location.host}`;
    const params = new URLSearchParams({
      hostId,
      node,
      kind: "vm",
      vmid: String(vmid),
    });
    const url = `${wsBase}/ws/vnc?${params.toString()}`;

    const onLayout = () => {
      if (cancelled) return;
      applyVncView(rfbRef.current, containerRef.current, viewRef.current);
    };

    void import("@novnc/novnc/lib/rfb.js").then(({ default: RFB }) => {
      if (cancelled || !containerRef.current) return;
      const ws = new WebSocket(url);
      socket = ws;
      ws.binaryType = "arraybuffer";

      const fail = (message: string) => {
        if (cancelled) return;
        setStatus("error");
        setDetail(message);
      };

      ws.addEventListener("close", (event) => {
        if (cancelled || attached) return;
        fail(event.reason || tRef.current("guest.consoleDisconnected"));
      });

      const onAuth = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        let msg: { type?: string; password?: string; status?: string; message?: string; code?: string };
        try {
          msg = JSON.parse(event.data) as typeof msg;
        } catch {
          return;
        }
        if (msg.type === "status" && msg.status === "error") {
          if (msg.code === "no-vga") fail(tRef.current("guest.consoleNoVga"));
          else fail(msg.message || tRef.current("guest.consoleError"));
          return;
        }
        if (msg.type !== "vnc-auth") return;
        ws.removeEventListener("message", onAuth);
        if (cancelled || !containerRef.current) return;
        const password = msg.password ?? "";
        const rfb = new RFB(containerRef.current, ws, {
          credentials: password ? { password } : undefined,
        });
        rfb.viewOnly = false;
        rfb.showDotCursor = true;
        rfb.qualityLevel = 6;
        applyVncView(rfb, containerRef.current, viewRef.current);
        disableQemuExtendedKeys(rfb);
        rfb.addEventListener("connect", () => {
          if (cancelled) return;
          attached = true;
          setStatus("connected");
          releaseKeyboard?.();
          releaseKeyboard = grabRfbKeyboard(
            rfb,
            () => !cancelled && rfbRef.current === rfb,
            (keyEvent, down) => {
              const keysym = rfbKeysymFromKeyboardEvent(keyEvent);
              if (!keysym) return;
              rfb.sendKey(keysym, keyEvent.code || null, down);
            },
            (text) => {
              const { truncated } = sendClipboardAsKeys(
                (keysym, code, down) => rfb.sendKey(keysym, code, down),
                text,
              );
              toast.success(
                truncated ? tRef.current("guest.consoleClipboardTruncated") : tRef.current("guest.consoleClipboardSent"),
              );
            },
          );
          requestAnimationFrame(() => {
            applyVncView(rfb, containerRef.current, viewRef.current);
            focusRfb(containerRef.current, rfb);
          });
        });
        rfb.addEventListener("disconnect", () => {
          if (!cancelled) setStatus("disconnected");
        });
        rfb.addEventListener("securityfailure", () => fail(tRef.current("guest.consoleError")));
        rfb.addEventListener("credentialsrequired", () => {
          if (password) rfb.sendCredentials({ password });
        });
        rfb.addEventListener("clipboard", (clipEvent) => {
          const text = String((clipEvent as CustomEvent<{ text?: string }>).detail?.text ?? "");
          if (!text) return;
          void navigator.clipboard.writeText(text).catch(() => undefined);
        });
        rfbRef.current = rfb;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "vnc-ready" }));
        }
      };

      ws.addEventListener("message", onAuth);
    });

    document.addEventListener("fullscreenchange", onLayout);
    window.addEventListener("resize", onLayout);

    return () => {
      cancelled = true;
      releaseKeyboard?.();
      document.removeEventListener("fullscreenchange", onLayout);
      window.removeEventListener("resize", onLayout);
      try {
        rfbRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      rfbRef.current = null;
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      target.replaceChildren();
    };
  }, [hostId, node, vmid, nonce, running]);

  function changeView(next: VncViewId) {
    setView(next);
    try {
      window.localStorage.setItem(VNC_VIEW_STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
    applyVncView(rfbRef.current, containerRef.current, next);
  }

  async function changeKeyboard(next: string) {
    if (!onKeyboardChange || next === layout) return;
    setSavingKeyboard(true);
    try {
      await onKeyboardChange(next);
      toast.success(t("guest.consoleKeyboardSaved"));
    } catch {
      toast.error(t("guest.consoleError"));
    } finally {
      setSavingKeyboard(false);
    }
  }

  async function pasteIntoGuest(rfb: RfbInstance) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.error(t("guest.consoleClipboardEmpty"));
        return;
      }
      const { truncated } = sendClipboardAsKeys(
        (keysym, code, down) => rfb.sendKey(keysym, code, down),
        text,
      );
      toast.success(truncated ? t("guest.consoleClipboardTruncated") : t("guest.consoleClipboardSent"));
    } catch {
      toast.error(t("guest.consoleClipboardDenied"));
    }
  }

  async function pasteClipboard() {
    const rfb = rfbRef.current;
    if (!rfb) return;
    await pasteIntoGuest(rfb);
  }

  async function toggleFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.requestFullscreen();
    } catch {
      /* browser blocked fullscreen */
    }
    window.setTimeout(() => applyVncView(rfbRef.current, containerRef.current, view), 80);
  }

  const statusLabel =
    status === "connected"
      ? t("guest.consoleConnected")
      : status === "error"
        ? t("guest.consoleError")
        : status === "connecting"
          ? t("guest.consoleConnecting")
          : t("guest.consoleDisconnected");

  return (
    <div
      ref={shellRef}
      className="vnc-shell flex h-[min(70vh,720px)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-[#020617]"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-slate-300">
        <span
          className={
            !running || status === "error"
              ? "text-red-400"
              : status === "connected"
                ? "text-emerald-400"
                : "text-amber-400"
          }
        >
          ● {running ? statusLabel : t("guest.consoleVmStopped")}
        </span>
        <span className="text-slate-500">VGA {vmid} @ {node}</span>
        {status === "connected" ? (
          <span className="text-slate-400">{t("guest.consoleInputGrabbed")}</span>
        ) : null}
        {detail && status === "error" ? <span className="text-red-400">{detail}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <label className="flex items-center gap-1 text-slate-400">
            <span className="sr-only">{t("guest.consoleView")}</span>
            <select
              className={toolbarSelectClass}
              value={view}
              title={t("guest.consoleView")}
              onChange={(e) => changeView(parseVncView(e.target.value))}
            >
              {VNC_VIEW_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.id === "fit"
                    ? t("guest.consoleViewFit")
                    : preset.id === "native"
                      ? t("guest.consoleViewNative")
                      : t("guest.consoleViewSize", { size: preset.id })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-slate-400">
            <span className="sr-only">{t("guest.consoleKeyboard")}</span>
            <select
              className={toolbarSelectClass}
              value={layout}
              title={t("guest.consoleKeyboard")}
              disabled={!canSetKeyboard || savingKeyboard || !onKeyboardChange}
              onChange={(e) => void changeKeyboard(e.target.value)}
            >
              {QEMU_KEYBOARD_LAYOUTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="ghost"
            disabled={!running || status !== "connected"}
            onClick={() => rfbRef.current?.sendCtrlAltDel()}
          >
            {t("guest.consoleCad")}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={t("guest.consoleClipboard")}
            disabled={!running || status !== "connected"}
            onClick={() => void pasteClipboard()}
          >
            <ClipboardCopy className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" disabled={!running} onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" disabled={!running} onClick={() => void toggleFullscreen()}>
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {running ? (
        <div className="vnc-console-frame min-h-0 flex-1">
          <div
            ref={containerRef}
            className="vnc-console-screen min-h-0 flex-1 touch-none select-none"
            onPointerDown={() => focusRfb(containerRef.current, rfbRef.current)}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-slate-400">
          {t("guest.consoleVmStoppedHint")}
        </div>
      )}
    </div>
  );
}
