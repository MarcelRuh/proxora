import { z } from "zod";

/** Storage backends Proxora can add (Datacenter → Storage → Add in Proxmox). */
export const STORAGE_CREATE_TYPES = ["dir", "nfs", "cifs", "pbs", "lvm", "lvmthin", "zfspool"] as const;
export type StorageCreateType = (typeof STORAGE_CREATE_TYPES)[number];

export const STORAGE_CONTENT_KINDS = [
  "images",
  "rootdir",
  "iso",
  "vztmpl",
  "backup",
  "snippets",
  "import",
] as const;
export type StorageContentOption = (typeof STORAGE_CONTENT_KINDS)[number];

const FILE_CONTENT: StorageContentOption[] = ["images", "rootdir", "iso", "vztmpl", "backup", "snippets", "import"];
const BLOCK_CONTENT: StorageContentOption[] = ["images", "rootdir"];

/** Content types each backend accepts, in Proxmox's own order. */
export const STORAGE_TYPE_CONTENT: Record<StorageCreateType, StorageContentOption[]> = {
  dir: FILE_CONTENT,
  nfs: FILE_CONTENT,
  cifs: FILE_CONTENT,
  pbs: ["backup"],
  lvm: BLOCK_CONTENT,
  lvmthin: BLOCK_CONTENT,
  zfspool: BLOCK_CONTENT,
};

/** Sensible starting selection per backend. */
export const STORAGE_TYPE_DEFAULT_CONTENT: Record<StorageCreateType, StorageContentOption[]> = {
  dir: ["iso", "vztmpl", "backup"],
  nfs: ["iso", "vztmpl", "backup"],
  cifs: ["iso", "vztmpl", "backup"],
  pbs: ["backup"],
  lvm: ["images", "rootdir"],
  lvmthin: ["images", "rootdir"],
  zfspool: ["images", "rootdir"],
};

/** Types whose targets can be discovered via /nodes/{node}/scan/{kind}. */
export const STORAGE_SCAN_KIND: Partial<Record<StorageCreateType, "nfs" | "cifs" | "pbs" | "lvm" | "lvmthin" | "zfs">> = {
  nfs: "nfs",
  cifs: "cifs",
  pbs: "pbs",
  lvm: "lvm",
  lvmthin: "lvmthin",
  zfspool: "zfs",
};

/** Same rule as pve-storage-id: letter first, then letters, digits, - _ . and no trailing separator. */
export const STORAGE_ID_PATTERN = /^[a-z][a-z0-9_.-]*[a-z0-9]$/i;
const STORAGE_ID = STORAGE_ID_PATTERN;
/** Hostname, IPv4 or bracketless IPv6; no URL parts, spaces or shell characters. */
const SERVER = /^[a-z0-9]([a-z0-9.:_-]{0,252}[a-z0-9])?$/i;
const SAFE_NAME = /^[a-z0-9][a-z0-9_.@+-]{0,127}$/i;
const ABS_PATH = /^\/[^\0\n\r,;]*$/;
const PBS_FINGERPRINT = /^([0-9a-f]{2}:){31}[0-9a-f]{2}$/i;

const trimmed = (max: number) => z.string().trim().max(max);

const contentSchema = z.array(z.enum(STORAGE_CONTENT_KINDS)).min(1, "Mindestens einen Inhaltstyp wählen");

const common = {
  storage: trimmed(64).regex(STORAGE_ID, "Ungültige Storage-ID (Buchstabe zuerst, dann a–z, 0–9, - _ .)"),
  content: contentSchema,
  /** Empty = all nodes. */
  nodes: z.array(trimmed(64).regex(SAFE_NAME)).max(64).optional(),
  disable: z.boolean().optional(),
};

const server = trimmed(253).regex(SERVER, "Ungültiger Server (Hostname oder IP ohne Protokoll)");

export const storageCreateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dir"),
    ...common,
    path: trimmed(4096).regex(ABS_PATH, "Absoluter Pfad erforderlich, z. B. /mnt/data"),
    shared: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("nfs"),
    ...common,
    server,
    export: trimmed(4096).regex(ABS_PATH, "Export muss mit / beginnen"),
    nfsVersion: z.enum(["3", "4", "4.1", "4.2"]).optional(),
  }),
  z.object({
    type: z.literal("cifs"),
    ...common,
    server,
    share: trimmed(255).regex(/^[^/\\\0\n\r]+$/, "Ungültiger Share-Name"),
    username: trimmed(255).optional(),
    password: z.string().max(1024).optional(),
    domain: trimmed(255).optional(),
    subdir: trimmed(4096).regex(ABS_PATH).optional().or(z.literal("")),
    smbVersion: z.enum(["default", "2.0", "2.1", "3", "3.0", "3.11"]).optional(),
  }),
  z.object({
    type: z.literal("pbs"),
    ...common,
    server,
    port: z.number().int().min(1).max(65535).optional(),
    datastore: trimmed(128).regex(SAFE_NAME, "Ungültiger Datastore-Name"),
    username: trimmed(255).regex(/^[^\s:]+@[^\s:]+(![^\s:]+)?$/, "Format: user@realm oder user@realm!token"),
    password: z.string().min(1).max(1024),
    fingerprint: trimmed(95).regex(PBS_FINGERPRINT, "Fingerprint im Format aa:bb:…").optional().or(z.literal("")),
    namespace: trimmed(255).regex(/^[a-z0-9_.\-/]*$/i).optional(),
  }),
  z.object({
    type: z.literal("lvm"),
    ...common,
    vgname: trimmed(128).regex(SAFE_NAME, "Ungültige Volume Group"),
    shared: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("lvmthin"),
    ...common,
    vgname: trimmed(128).regex(SAFE_NAME, "Ungültige Volume Group"),
    thinpool: trimmed(128).regex(SAFE_NAME, "Ungültiger Thin-Pool"),
  }),
  z.object({
    type: z.literal("zfspool"),
    ...common,
    pool: trimmed(255).regex(/^[a-z0-9][a-z0-9_.:\-/]*$/i, "Ungültiger ZFS-Pool"),
    sparse: z.boolean().optional(),
    blocksize: z.enum(["4k", "8k", "16k", "32k", "64k", "128k"]).optional(),
  }),
]);

export type StorageCreateInput = z.infer<typeof storageCreateSchema>;

function flag(value: boolean | undefined): 0 | 1 | undefined {
  return value === undefined ? undefined : value ? 1 : 0;
}

function prune<T extends Record<string, unknown>>(body: T): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value as string | number;
  }
  return out;
}

/** Content list the backend actually supports, in Proxmox order, de-duplicated. */
export function normalizeStorageContent(type: StorageCreateType, content: readonly string[]): string {
  const allowed = STORAGE_TYPE_CONTENT[type];
  const wanted = new Set(content);
  return allowed.filter((item) => wanted.has(item)).join(",");
}

/** Body for POST /storage. Throws when the content selection is empty for this backend. */
export function storageCreateBody(input: StorageCreateInput): Record<string, string | number> {
  const content = normalizeStorageContent(input.type, input.content);
  if (!content) throw new Error("Kein gültiger Inhaltstyp für diesen Storage-Typ");
  const nodes = [...new Set((input.nodes ?? []).filter(Boolean))].join(",");
  const base = {
    storage: input.storage,
    type: input.type,
    content,
    nodes: nodes || undefined,
    disable: input.disable ? 1 : undefined,
  };
  switch (input.type) {
    case "dir":
      return prune({ ...base, path: input.path, shared: flag(input.shared) });
    case "nfs":
      return prune({
        ...base,
        server: input.server,
        export: input.export,
        options: input.nfsVersion ? `vers=${input.nfsVersion}` : undefined,
      });
    case "cifs":
      return prune({
        ...base,
        server: input.server,
        share: input.share,
        username: input.username || undefined,
        password: input.username ? input.password || undefined : undefined,
        domain: input.domain || undefined,
        subdir: input.subdir || undefined,
        smbversion: input.smbVersion && input.smbVersion !== "default" ? input.smbVersion : undefined,
      });
    case "pbs":
      return prune({
        ...base,
        server: input.server,
        port: input.port && input.port !== 8007 ? input.port : undefined,
        datastore: input.datastore,
        username: input.username,
        password: input.password,
        fingerprint: input.fingerprint ? input.fingerprint.toLowerCase() : undefined,
        namespace: input.namespace || undefined,
      });
    case "lvm":
      return prune({ ...base, vgname: input.vgname, shared: flag(input.shared) });
    case "lvmthin":
      return prune({ ...base, vgname: input.vgname, thinpool: input.thinpool });
    case "zfspool":
      return prune({ ...base, pool: input.pool, sparse: flag(input.sparse), blocksize: input.blocksize });
  }
}

/** Audit-safe view of the request: never contains passwords. */
export function storageCreateAuditMeta(input: StorageCreateInput): Record<string, string | number> {
  const body = storageCreateBody(input);
  delete body.password;
  return body;
}

export const storageScanSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("nfs"), node: trimmed(64).regex(SAFE_NAME), server }),
  z.object({
    kind: z.literal("cifs"),
    node: trimmed(64).regex(SAFE_NAME),
    server,
    username: trimmed(255).optional(),
    password: z.string().max(1024).optional(),
    domain: trimmed(255).optional(),
  }),
  z.object({
    kind: z.literal("pbs"),
    node: trimmed(64).regex(SAFE_NAME),
    server,
    port: z.number().int().min(1).max(65535).optional(),
    username: trimmed(255).min(1),
    password: z.string().min(1).max(1024),
    fingerprint: trimmed(95).regex(PBS_FINGERPRINT).optional().or(z.literal("")),
  }),
  z.object({ kind: z.literal("lvm"), node: trimmed(64).regex(SAFE_NAME) }),
  z.object({ kind: z.literal("lvmthin"), node: trimmed(64).regex(SAFE_NAME), vg: trimmed(128).regex(SAFE_NAME) }),
  z.object({ kind: z.literal("zfs"), node: trimmed(64).regex(SAFE_NAME) }),
]);

export type StorageScanInput = z.infer<typeof storageScanSchema>;

export type StorageScanOption = { value: string; label: string; detail?: string };

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** Normalizes the different /scan/* response shapes into selectable options. */
export function storageScanOptions(kind: StorageScanInput["kind"], rows: unknown): StorageScanOption[] {
  if (!Array.isArray(rows)) return [];
  const out: StorageScanOption[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    let value = "";
    let detail = "";
    switch (kind) {
      case "nfs":
        value = str(row.path);
        detail = str(row.options);
        break;
      case "cifs":
        value = str(row.share);
        detail = str(row.description);
        break;
      case "pbs":
        value = str(row.store);
        detail = str(row.comment);
        break;
      case "lvm":
        value = str(row.vg);
        break;
      case "lvmthin":
        value = str(row.lv);
        break;
      case "zfs":
        value = str(row.pool);
        break;
    }
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: value, detail: detail || undefined });
  }
  return out.sort((a, b) => a.value.localeCompare(b.value));
}
