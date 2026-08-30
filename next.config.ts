import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Custom server (server/index.ts) is unsupported with `output: "standalone"`.
  poweredByHeader: false,
  transpilePackages: ["@novnc/novnc"],
  serverExternalPackages: ["@prisma/client", "pino", "pino-pretty", "ws", "bcryptjs", "undici"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
