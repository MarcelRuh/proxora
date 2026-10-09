"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MENU_WIDTH = 224;
const VIEWPORT_PAD = 8;

type TriggerSize = React.ComponentProps<typeof Button>["size"];
type TriggerVariant = React.ComponentProps<typeof Button>["variant"];

function isInsideOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[role="dialog"], [data-radix-dialog-content], [data-radix-popper-content-wrapper]'),
  );
}

export function ActionMenu({
  label,
  children,
  align = "end",
  triggerSize = "sm",
  triggerVariant = "ghost",
  triggerClassName,
  contentClassName,
  menuWidth = MENU_WIDTH,
}: {
  label: string;
  children: ReactNode;
  align?: "start" | "end";
  triggerSize?: TriggerSize;
  triggerVariant?: TriggerVariant;
  triggerClassName?: string;
  contentClassName?: string;
  menuWidth?: number;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  function place() {
    const button = triggerRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = menuWidth;
    const left =
      align === "end"
        ? Math.min(Math.max(VIEWPORT_PAD, rect.right - width), window.innerWidth - width - VIEWPORT_PAD)
        : Math.min(Math.max(VIEWPORT_PAD, rect.left), window.innerWidth - width - VIEWPORT_PAD);
    const estimatedHeight = menuRef.current?.offsetHeight ?? 280;
    const below = rect.bottom + 4;
    const above = rect.top - estimatedHeight - 4;
    const top =
      below + estimatedHeight > window.innerHeight - VIEWPORT_PAD && above > VIEWPORT_PAD ? above : below;
    setPos({ top, left });
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, align, menuWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      if (isInsideOverlay(event.target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isInsideOverlay(event.target)) setOpen(false);
    };
    const onReposition = () => place();
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, align, menuWidth]);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size={triggerSize}
        variant={triggerVariant}
        className={triggerClassName}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setMounted(true);
          setOpen((current) => !current);
        }}
      >
        {label}
      </Button>
      {mounted
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className={cn(
                open
                  ? "fixed z-[60] rounded-[var(--ui-radius)] border border-border bg-card p-1 shadow-lg"
                  : "hidden",
                contentClassName,
              )}
              style={{ top: pos.top, left: pos.left, width: menuWidth }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
