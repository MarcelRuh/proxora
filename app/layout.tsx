import type { Metadata } from "next";
import { Inter, Orbitron, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { Providers } from "@/components/providers";
import { UI_THEME_BOOTSTRAP } from "@/lib/ui-theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["500", "700", "800", "900"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Proxora",
  description: "Zentrale Verwaltung unabhängiger Proxmox-VE-Hosts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      data-ui="standard"
      className={`dark ${inter.variable} ${orbitron.variable} ${jetbrains.variable} ${sourceSerif.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: UI_THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-full antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
