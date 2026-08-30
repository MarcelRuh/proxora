function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getEnv() {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrl: required("DATABASE_URL"),
    encryptionKey: required("ENCRYPTION_KEY"),
    sessionSecret: process.env.SESSION_SECRET ?? required("ENCRYPTION_KEY"),
    sessionDays: Number(process.env.SESSION_DAYS ?? 7),
    wsPort: Number(process.env.WS_PORT ?? 3001),
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}

export const SESSION_COOKIE = "pm_session";
