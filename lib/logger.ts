import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "secret",
      "password",
      "token",
      "ticket",
      "encryptedSecret",
      "authorization",
      "headers.authorization",
      "headers.cookie",
      "*.secret",
      "*.password",
      "*.token",
      "*.ticket",
      "*.encryptedSecret",
    ],
    censor: "[REDACTED]",
  },
  ...(process.env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }
    : {}),
});
