"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardCopy, Maximize2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/components/i18n/locale-provider";

type Props = {
  hostId: string;
  node: string;
  vmid: number;
  running: boolean;
};

type RfbInstance = {
  scaleViewport: boolean;
  resizeSession: boolean;
  focus: () => void;
  disconnect: () => void;
  sendCtrlAltDel: () => void;
  clipboardPasteFrom: (text: string) => void;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
};

export function VncConsole({ hostId, node, vmid, running }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!running) {
      rfbRef.current = null;
      setStatus("disconnected");
      return;
    }
    const target = containerRef.current;
    if (!target) return;
    let cancelled = false;
    setStatus("connecting");

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsBase = process.env.NEXT_PUBLIC_WS_URL || `${proto}://${window.location.host}`;
    const params = new URLSearchParams({
      hostId,
      node,
      kind: "vm",
      vmid: String(vmid),
    });
    const url = `${wsBase}/ws/vnc?${params.toString()}`;

    void import("@novnc/novnc/lib/rfb.js").then(({ default: RFB }) => {
      if (cancelled || !containerRef.current) return;
      const rfb = new RFB(target, url) as RfbInstance;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.addEventListener("connect", () => setStatus("connected"));
      rfb.addEventListener("disconnect", () => {
        if (!cancelled) setStatus("disconnected");
      });
      rfb.addEventListener("securityfailure", () => setStatus("error"));
      rfb.addEventListener("clipboard", (event) => {
        const text = String((event as CustomEvent<{ text?: string }>).detail?.text ?? "");
        if (!text) return;
        void navigator.clipboard.writeText(text).catch(() => undefined);
      });
      rfbRef.current = rfb;
    });

    return () => {
      cancelled = true;
      try {
        rfbRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      rfbRef.current = null;
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

  const statusLabel =
    status === "connected"
      ? t("guest.consoleConnected")
      : status === "error"
        ? t("guest.consoleError")
        : status === "connecting"
          ? t("guest.consoleConnecting")
          : t("guest.consoleDisconnected");

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-[#020617]">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-slate-300">
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
          <Button
            size="icon"
            variant="ghost"
            onClick={() => containerRef.current?.parentElement?.requestFullscreen()}
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {running ? (
        <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden [&_canvas]:h-full [&_canvas]:w-full" />
      ) : (
        <div className="flex min-h-[420px] flex-1 items-center justify-center px-6 text-center text-sm text-slate-400">
          {t("guest.consoleVmStoppedHint")}
        </div>
      )}
    </div>
  );
}
