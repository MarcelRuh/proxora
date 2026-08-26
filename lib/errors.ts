export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = "APP_ERROR", details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, message, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(403, message, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, message, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, "CONFLICT");
    this.name = "ConflictError";
  }
}

export class ProxmoxApiError extends AppError {
  readonly hostName?: string;

  constructor(message: string, status = 502, hostName?: string, details?: unknown) {
    super(status, message, "PROXMOX_API_ERROR", details);
    this.name = "ProxmoxApiError";
    this.hostName = hostName;
  }
}

export class HostUnreachableError extends AppError {
  constructor(hostName: string, reason: string) {
    super(503, `Unable to connect to ${hostName}`, "HOST_UNREACHABLE", { reason });
    this.name = "HostUnreachableError";
  }
}
