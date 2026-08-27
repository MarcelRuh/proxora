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
          "!rounded-[4px] !border-[rgba(131,56,236,0.28)] !bg-[#0d0d15] !text-white !shadow-[0_0_24px_rgba(131,56,236,0.18)]",
      }}
    />
  );
}
