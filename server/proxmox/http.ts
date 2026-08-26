import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { ProxmoxApiError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ProxmoxConnectionConfig } from "@/server/proxmox/types";

type Query = Record<string, string | number | boolean | undefined | null>;

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function toSearch(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function toFormBody(body?: Record<string, unknown>): string | undefined {
  if (!body) return undefined;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export class ProxmoxHttpClient {
  readonly baseUrl: string;
  private readonly config: ProxmoxConnectionConfig;
  private readonly agent: Agent;
  private ticket?: { ticket: string; csrf: string };
  private ticketExpiresAt = 0;

  constructor(config: ProxmoxConnectionConfig) {
    this.config = config;
    this.baseUrl = normalizeBaseUrl(config.url);
    this.agent = new Agent({
      connect: {
        rejectUnauthorized: !config.allowInsecureTls,
      },
      keepAliveTimeout: 10_000,
    });
  }

  async get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  async post<T>(path: string, body?: Record<string, unknown>, query?: Query): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }

  async put<T>(path: string, body?: Record<string, unknown>, query?: Query): Promise<T> {
    return this.request<T>("PUT", path, { body, query });
  }

  async del<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("DELETE", path, { query });
  }

  websocketUrl(path: string, query?: Query): string {
    const httpUrl = new URL(`/api2/json${path}${toSearch(query)}`, this.baseUrl);
    httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    return httpUrl.toString();
  }

  async authHeaders(): Promise<Record<string, string>> {
    if (this.config.authType === "API_TOKEN") {
      const tokenId = this.config.tokenId;
      if (!tokenId) {
        throw new ProxmoxApiError("API token ID is required");
      }
      return {
        Authorization: `PVEAPIToken=${this.config.username}!${tokenId}=${this.config.secret}`,
      };
    }
    const ticket = await this.ensureTicket();
    return {
      Cookie: `PVEAuthCookie=${ticket.ticket}`,
      CSRFPreventionToken: ticket.csrf,
    };
  }

  private async ensureTicket(): Promise<{ ticket: string; csrf: string }> {
    if (this.ticket && Date.now() < this.ticketExpiresAt) {
      return this.ticket;
    }
    const url = `${this.baseUrl}/api2/json/access/ticket`;
    const body = toFormBody({
      username: this.config.username,
      password: this.config.secret,
    });
    const response = await this.rawFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await response.json()) as {
      data?: { ticket: string; CSRFPreventionToken: string };
      message?: string;
    };
    if (!response.ok || !json.data?.ticket) {
      throw new ProxmoxApiError(json.message ?? "Authentication failed", response.status);
    }
    this.ticket = { ticket: json.data.ticket, csrf: json.data.CSRFPreventionToken };
    this.ticketExpiresAt = Date.now() + 90 * 60 * 1000;
    return this.ticket;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { query?: Query; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}/api2/json${path}${toSearch(options.query)}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(await this.authHeaders()),
    };
    let body: string | undefined;
    if (options.body && method !== "GET") {
      body = toFormBody(options.body);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const response = await this.rawFetch(url, { method, headers, body });
    const text = await response.text();
    let parsed: { data?: T; errors?: unknown; message?: string } = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        throw new ProxmoxApiError("Invalid JSON from Proxmox API", response.status, undefined, {
          body: text.slice(0, 200),
        });
      }
    }

    if (!response.ok) {
      const message =
        parsed.message ??
        (typeof parsed.errors === "string" ? parsed.errors : `Proxmox API error (${response.status})`);
      logger.warn(
        { path, method, status: response.status, message },
        "Proxmox API request failed",
      );
      throw new ProxmoxApiError(message, response.status, undefined, parsed.errors);
    }

    return (parsed.data as T) ?? (undefined as T);
  }

  private async rawFetch(url: string, init: UndiciRequestInit) {
    const timeout = this.config.timeoutMs ?? 20_000;
    try {
      return await undiciFetch(url, {
        ...init,
        dispatcher: this.agent,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown network error";
      logger.error({ url: this.baseUrl, reason }, "Proxmox API request failed");
      throw new ProxmoxApiError(`Connection failed: ${reason}`, 503);
    }
  }
}
