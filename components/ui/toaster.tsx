"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      theme="dark"
      richColors
      position="top-right"
      toastOptions={{
        className:
          "!rounded-[var(--ui-radius)] !border-[var(--ui-chrome-border)] !bg-[var(--card)] !text-[var(--foreground)] !shadow-[var(--ui-dialog-shadow)]",
      }}
    />
  );
}
