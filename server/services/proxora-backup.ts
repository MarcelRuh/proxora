import { spawn } from "node:child_process";
import { ValidationError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

function parseDatabaseUrl(url: string): {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username || "proxora"),
    password: decodeURIComponent(parsed.password || ""),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] || "proxora"),
  };
}

export async function dumpProxoraPostgres(): Promise<Buffer> {
  const { databaseUrl } = getEnv();
  const db = parseDatabaseUrl(databaseUrl);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      [
        "--no-owner",
        "--no-privileges",
        "--clean",
        "--if-exists",
        "-h",
        db.host,
        "-p",
        db.port,
        "-U",
        db.user,
        "-d",
        db.database,
      ],
      {
        env: { ...process.env, PGPASSWORD: db.password },
      },
    );
    const chunks: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      reject(
        new ValidationError(
          error.message.includes("ENOENT")
            ? "pg_dump is not installed in this image"
            : error.message,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new ValidationError(Buffer.concat(err).toString("utf8").trim() || `pg_dump exited ${code}`));
    });
  });
}
