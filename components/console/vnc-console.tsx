"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardCopy, Maximize2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/i18n/locale-provider";
import { disableQemuExtendedKeys, grabRfbKeyboard, rfbKeysymFromKeyboardEvent } from "@/lib/vnc-input";

type Props = {
  hostId: string;
  node: string;
  vmid: number;
  running: boolean;
};

type RfbInstance = InstanceType<typeof import("@novnc/novnc/lib/rfb.js").default>;

function applyScale(rfb: RfbInstance | null) {
  if (!rfb) return;
  rfb.scaleViewport = true;
}

function focusRfb(container: HTMLElement | null, rfb: RfbInstance | null) {
  if (!rfb) return;
  const canvas = container?.querySelector("canvas");
  if (canvas instanceof HTMLCanvasElement) canvas.tabIndex = 0;
  rfb.focus();
}

export function VncConsole({ hostId, node, vmid, running }: Props) {
  const { t } = useI18n();
  const shellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

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
      applyScale(rfbRef.current);
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
        rfb.scaleViewport = true;
        rfb.clipViewport = false;
        rfb.resizeSession = false;
        rfb.viewOnly = false;
        rfb.showDotCursor = true;
        rfb.qualityLevel = 6;
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
          );
          requestAnimationFrame(() => {
            applyScale(rfb);
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

  async function pasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.error(t("guest.consoleClipboardEmpty"));
        return;
      }
      rfbRef.current?.clipboardPasteFrom(text);
      toast.success(t("guest.consoleClipboardSent"));
    } catch {
      toast.error(t("guest.consoleClipboardDenied"));
    }
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
    window.setTimeout(() => applyScale(rfbRef.current), 80);
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
        <div
          ref={containerRef}
          className="vnc-console-screen min-h-0 flex-1 touch-none select-none"
          onPointerDown={() => focusRfb(containerRef.current, rfbRef.current)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-slate-400">
          {t("guest.consoleVmStoppedHint")}
        </div>
      )}
    </div>
  );
}
