"use client";

import { Toaster } from "sonner";
import { useUiTheme } from "@/components/theme/ui-theme-provider";

export function AppToaster() {
  const { uiTheme } = useUiTheme();
  return (
    <Toaster
      theme={uiTheme === "atelier" ? "light" : "dark"}
      richColors
      position="top-right"
      toastOptions={{
        className:
          "!rounded-[var(--ui-radius)] !border-[var(--ui-chrome-border)] !bg-[var(--card)] !text-[var(--foreground)] !shadow-[var(--ui-dialog-shadow)]",
      }}
    />
  );
}
