"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { AppToaster } from "@/components/ui/toaster";
import { LocaleProvider } from "@/components/i18n/locale-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 10_000,
          },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" enableSystem={false}>
      <LocaleProvider>
        <QueryClientProvider client={client}>
          {children}
          <AppToaster />
        </QueryClientProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
