import { hashPassword } from "../lib/password";
import { prisma } from "../lib/db";
import { ROLE_PRESETS } from "../lib/permissions";

async function main() {
  for (const [slug, preset] of Object.entries(ROLE_PRESETS)) {
    await prisma.role.upsert({
      where: { slug },
      update: {
        name: preset.name,
        description: preset.description,
        permissions: [...preset.permissions],
        isSystem: true,
      },
      create: {
        slug,
        name: preset.name,
        description: preset.description,
        permissions: [...preset.permissions],
        isSystem: true,
      },
    });
  }

  const username = process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "changeme-now";
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@localhost";

  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { slug: "super-admin" } });
    await prisma.user.create({
      data: {
        username,
        email,
        passwordHash: await hashPassword(password),
        roleId: superAdmin.id,
      },
    });
    console.log(`Created bootstrap admin user "${username}"`);
  } else {
    console.log(`Admin user "${username}" already exists`);
  }

  await prisma.setting.upsert({
    where: { key: "app" },
    update: {},
    create: {
      key: "app",
      value: {
        name: "Proxora",
        allowRegistration: false,
        sessionDays: 7,
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
