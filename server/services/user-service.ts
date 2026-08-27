import { z } from "zod";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { sanitizePermissions } from "@/lib/permissions";
import { hashPassword } from "@/lib/password";
import { parseGuestKind } from "@/lib/guest-scope";

const guestScopeSchema = z.object({
  hostId: z.string().min(1),
  kind: z.enum(["vm", "lxc"]),
  vmid: z.number().int().positive(),
});

export const createUserSchema = z.object({
  username: z.string().min(2).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().email(),
  password: z.string().min(10).max(200),
  roleId: z.string().min(1),
  hostIds: z.array(z.string()).optional(),
  guests: z.array(guestScopeSchema).optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(10).max(200).optional(),
  roleId: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  hostIds: z.array(z.string()).optional(),
  guests: z.array(guestScopeSchema).optional(),
});

export const createRoleSchema = z.object({
  name: z.string().min(2).max(60),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(400).optional(),
  permissions: z.array(z.string()),
});

function sanitizeUser<T extends { passwordHash: string; totpSecret: string | null }>(user: T) {
  const { passwordHash, totpSecret, ...rest } = user;
  void passwordHash;
  void totpSecret;
  return rest;
}

function toGuestScope(rows: Array<{ hostId: string; kind: string; vmid: number }>) {
  return rows.flatMap((g) => {
    const kind = parseGuestKind(g.kind);
    return kind ? [{ hostId: g.hostId, kind, vmid: g.vmid }] : [];
  });
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    include: { role: true, hostAccess: true, guestAccess: true },
    orderBy: { username: "asc" },
  });
  return users.map((u) => ({
    ...sanitizeUser(u),
    hostIds: u.hostAccess.map((h) => h.hostId),
    guests: toGuestScope(u.guestAccess),
  }));
}

export async function createUser(input: z.infer<typeof createUserSchema>) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: input.username }, { email: input.email }] },
  });
  if (existing) throw new ConflictError("Username or email already exists");
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new ValidationError("Role not found");
  const user = await prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      roleId: input.roleId,
      hostAccess: input.hostIds?.length
        ? { create: input.hostIds.map((hostId) => ({ hostId })) }
        : undefined,
      guestAccess: input.guests?.length
        ? { create: input.guests.map((g) => ({ hostId: g.hostId, kind: g.kind, vmid: g.vmid })) }
        : undefined,
    },
    include: { role: true, hostAccess: true, guestAccess: true },
  });
  return {
    ...sanitizeUser(user),
    hostIds: user.hostAccess.map((h) => h.hostId),
    guests: toGuestScope(user.guestAccess),
  };
}

export async function updateUser(id: string, input: z.infer<typeof updateUserSchema>) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError("User not found");
  const data: Record<string, unknown> = {};
  if (input.email) data.email = input.email;
  if (input.roleId) data.roleId = input.roleId;
  if (input.status) data.status = input.status;
  if (input.password) data.passwordHash = await hashPassword(input.password);
  await prisma.user.update({
    where: { id },
    data,
  });
  if (input.hostIds) {
    await prisma.userHostAccess.deleteMany({ where: { userId: id } });
    if (input.hostIds.length) {
      await prisma.userHostAccess.createMany({
        data: input.hostIds.map((hostId) => ({ userId: id, hostId })),
      });
    }
  }
  if (input.guests) {
    await prisma.userGuestAccess.deleteMany({ where: { userId: id } });
    if (input.guests.length) {
      await prisma.userGuestAccess.createMany({
        data: input.guests.map((g) => ({ userId: id, hostId: g.hostId, kind: g.kind, vmid: g.vmid })),
      });
    }
  }
  const fresh = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { role: true, hostAccess: true, guestAccess: true },
  });
  return {
    ...sanitizeUser(fresh),
    hostIds: fresh.hostAccess.map((h) => h.hostId),
    guests: toGuestScope(fresh.guestAccess),
  };
}

export async function deleteUser(id: string, actorId: string) {
  if (id === actorId) throw new ValidationError("You cannot delete your own account");
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError("User not found");
  await prisma.user.delete({ where: { id } });
}

export async function listRoles() {
  return prisma.role.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { users: true } } },
  });
}

export async function createRole(input: z.infer<typeof createRoleSchema>) {
  const permissions = sanitizePermissions(input.permissions);
  return prisma.role.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      isSystem: false,
      permissions,
    },
  });
}

export async function updateRole(id: string, input: Partial<z.infer<typeof createRoleSchema>>) {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw new NotFoundError("Role not found");
  if (role.isSystem && input.slug && input.slug !== role.slug) {
    throw new ValidationError("System roles cannot be renamed");
  }
  return prisma.role.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      permissions: input.permissions ? sanitizePermissions(input.permissions) : undefined,
    },
  });
}

export async function deleteRole(id: string) {
  const role = await prisma.role.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw new NotFoundError("Role not found");
  if (role.isSystem) throw new ValidationError("System roles cannot be deleted");
  if (role._count.users > 0) throw new ValidationError("Role is still assigned to users");
  await prisma.role.delete({ where: { id } });
}
