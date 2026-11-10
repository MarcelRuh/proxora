import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  role: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  userHostAccess: { deleteMany: vi.fn(), createMany: vi.fn() },
  userGuestAccess: { deleteMany: vi.fn(), createMany: vi.fn() },
  session: { deleteMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/password", () => ({ hashPassword: async (p: string) => `hash:${p}`, verifyPassword: vi.fn() }));

import { ROLE_PRESETS } from "@/lib/permissions";
import {
  assertCanAddPermissions,
  assertCanGrantPermissions,
  assertScopeWithinActor,
  assertUserChangeAllowed,
  type GrantingActor,
} from "@/lib/access-policy";
import { createRole, createUser, deleteUser, updateRole, updateUser } from "@/server/services/user-service";

function actor(slug: keyof typeof ROLE_PRESETS | "custom", permissions?: string[], partial: Partial<GrantingActor> = {}): GrantingActor {
  return {
    id: "actor",
    role: { slug, permissions: permissions ?? ROLE_PRESETS[slug as keyof typeof ROLE_PRESETS].permissions },
    allowedHostIds: null,
    allowedGuests: null,
    ...partial,
  };
}

const userManager = actor("custom", ["users.view", "users.create", "users.update", "users.delete", "vm.view", "vm.start"]);
const superAdmin = actor("super-admin");

const roles = {
  "super-admin": { id: "r-sa", slug: "super-admin", permissions: ROLE_PRESETS["super-admin"].permissions },
  operator: { id: "r-op", slug: "operator", permissions: ROLE_PRESETS.operator.permissions },
  small: { id: "r-small", slug: "small", permissions: ["vm.view"] },
};

function target(slug: keyof typeof roles, status: "ACTIVE" | "DISABLED" = "ACTIVE", id = "target") {
  const role = roles[slug];
  return { id, username: id, email: `${id}@x`, status, roleId: role.id, role, passwordHash: "h", totpSecret: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.role.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    Object.values(roles).find((r) => r.id === where.id) ?? null,
  );
  db.user.findFirst.mockResolvedValue(null);
  db.user.count.mockResolvedValue(0);
  db.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data, id: "new", passwordHash: "h", totpSecret: null, hostAccess: [], guestAccess: [],
  }));
  db.user.findUniqueOrThrow.mockResolvedValue({ ...target("small"), hostAccess: [], guestAccess: [] });
});

describe("access policy", () => {
  it("rejects granting permissions the actor lacks", () => {
    expect(() => assertCanGrantPermissions(userManager, ["vm.view"])).not.toThrow();
    expect(() => assertCanGrantPermissions(userManager, ["vm.view", "hosts.delete"])).toThrow(/hosts\.delete/);
    expect(() => assertCanGrantPermissions(superAdmin, ROLE_PRESETS["super-admin"].permissions)).not.toThrow();
  });

  it("expands legacy aliases before comparing", () => {
    expect(() => assertCanGrantPermissions(userManager, ["users.manage"])).not.toThrow();
    expect(() => assertCanGrantPermissions(userManager, ["roles.manage"])).toThrow();
  });

  it("only checks newly added role permissions", () => {
    expect(() => assertCanAddPermissions(userManager, ["hosts.delete"], ["hosts.delete", "vm.view"])).not.toThrow();
    expect(() => assertCanAddPermissions(userManager, ["vm.view"], ["vm.view", "hosts.delete"])).toThrow();
  });

  it("keeps scoped actors inside their scope", () => {
    const scoped = actor("custom", ["users.create"], { allowedHostIds: ["h1"] });
    expect(() => assertScopeWithinActor(scoped, { hosts: [], guests: [] })).toThrow(/all hosts/);
    expect(() => assertScopeWithinActor(scoped, { hosts: [{ hostId: "h2" }], guests: [] })).toThrow();
    expect(() => assertScopeWithinActor(scoped, { hosts: [{ hostId: "h1" }], guests: [] })).not.toThrow();
    const guestScoped = actor("custom", ["users.create"], {
      allowedHostIds: ["h1"],
      allowedGuests: [{ hostId: "h1", kind: "vm", vmid: 100 }],
    });
    expect(() => assertScopeWithinActor(guestScoped, { hosts: [{ hostId: "h1" }], guests: [] })).toThrow();
    expect(() =>
      assertScopeWithinActor(guestScoped, { hosts: [], guests: [{ hostId: "h1", kind: "vm", vmid: 101 }] }),
    ).toThrow();
    expect(() =>
      assertScopeWithinActor(guestScoped, { hosts: [], guests: [{ hostId: "h1", kind: "vm", vmid: 100 }] }),
    ).not.toThrow();
    expect(() => assertScopeWithinActor(superAdmin, { hosts: [], guests: [] })).not.toThrow();
  });

  it("guards super-admins and self-disable", () => {
    const sa = { id: "t", status: "ACTIVE" as const, role: { slug: "super-admin" } };
    expect(() => assertUserChangeAllowed(userManager, sa, {}, 5)).toThrow(/super-admin/);
    expect(() => assertUserChangeAllowed(superAdmin, sa, { status: "DISABLED" }, 0)).toThrow(/remain/);
    expect(() => assertUserChangeAllowed(superAdmin, sa, { roleSlug: "operator" }, 0)).toThrow(/remain/);
    expect(() => assertUserChangeAllowed(superAdmin, sa, "delete", 0)).toThrow(/remain/);
    expect(() => assertUserChangeAllowed(superAdmin, sa, { status: "DISABLED" }, 1)).not.toThrow();
    expect(() => assertUserChangeAllowed(superAdmin, sa, { roleSlug: "super-admin" }, 0)).not.toThrow();
    const self = { id: "actor", status: "ACTIVE" as const, role: { slug: "custom" } };
    expect(() => assertUserChangeAllowed(userManager, self, { status: "DISABLED" }, 1)).toThrow(/own account/);
  });
});

describe("user service privilege checks", () => {
  const base = { username: "bob", email: "bob@x.de", password: "0123456789" };

  it("rejects creating a user with a broader role", async () => {
    await expect(createUser(userManager, { ...base, roleId: "r-op" })).rejects.toThrow(/do not hold/);
    await expect(createUser(userManager, { ...base, roleId: "r-sa" })).rejects.toThrow(/do not hold/);
    expect(db.user.create).not.toHaveBeenCalled();
    await createUser(userManager, { ...base, roleId: "r-small" });
    expect(db.user.create).toHaveBeenCalledOnce();
  });

  it("rejects host overrides beyond the actor", async () => {
    await expect(
      createUser(userManager, { ...base, roleId: "r-small", hosts: [{ hostId: "h1", permissions: ["hosts.delete"] }] }),
    ).rejects.toThrow(/hosts\.delete/);
  });

  it("keeps the unscoped super-admin flow unchanged", async () => {
    await createUser(superAdmin, { ...base, roleId: "r-sa" });
    expect(db.user.create).toHaveBeenCalledOnce();
  });

  it("rejects promoting a user to a broader role", async () => {
    db.user.findUnique.mockResolvedValue(target("small"));
    await expect(updateUser(userManager, "target", { roleId: "r-sa" })).rejects.toThrow(/do not hold/);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects non-super-admins changing a super-admin's password", async () => {
    db.user.findUnique.mockResolvedValue(target("super-admin"));
    db.user.count.mockResolvedValue(3);
    await expect(updateUser(userManager, "target", { password: "newpassword1" })).rejects.toThrow(/super-admin/);
    await expect(deleteUser(userManager, "target")).rejects.toThrow(/super-admin/);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.user.delete).not.toHaveBeenCalled();
  });

  it("rejects disabling the last active super-admin", async () => {
    db.user.findUnique.mockResolvedValue(target("super-admin"));
    db.user.count.mockResolvedValue(0);
    await expect(updateUser(superAdmin, "target", { status: "DISABLED" })).rejects.toThrow(/remain/);
    await expect(updateUser(superAdmin, "target", { roleId: "r-op" })).rejects.toThrow(/remain/);
    await expect(deleteUser(superAdmin, "target")).rejects.toThrow(/remain/);
  });

  it("rejects disabling yourself", async () => {
    db.user.findUnique.mockResolvedValue(target("small", "ACTIVE", "actor"));
    await expect(updateUser(userManager, "actor", { status: "DISABLED" })).rejects.toThrow(/own account/);
  });

  it("rejects adding role permissions the actor lacks", async () => {
    const roleManager = actor("custom", ["roles.create", "roles.update", "vm.view"]);
    await expect(
      createRole(roleManager, { name: "x", slug: "x", permissions: ["hosts.delete"] }),
    ).rejects.toThrow(/do not hold/);
    await expect(updateRole(roleManager, "r-small", { permissions: ["vm.view", "users.delete"] })).rejects.toThrow(
      /users\.delete/,
    );
    await expect(updateRole(roleManager, "r-sa", { name: "Renamed" })).rejects.toThrow(/super-admin/);
    db.role.update.mockResolvedValue(roles.small);
    await updateRole(roleManager, "r-small", { permissions: [] });
    expect(db.role.update).toHaveBeenCalledOnce();
  });
});
