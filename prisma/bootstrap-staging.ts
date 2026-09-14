import { prisma } from "../src/lib/prisma";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { code: "VERIZEL-PLANNER-STAGING" },
    update: {
      name: "Verizel Planner Staging",
      timezone: "Europe/Oslo",
      status: "ACTIVE",
    },
    create: {
      name: "Verizel Planner Staging",
      code: "VERIZEL-PLANNER-STAGING",
      timezone: "Europe/Oslo",
      status: "ACTIVE",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "olasolem@gmail.com" },
    update: {
      name: "Ola Solem",
      active: true,
    },
    create: {
      email: "olasolem@gmail.com",
      name: "Ola Solem",
      active: true,
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id,
      },
    },
    update: {
      role: "ADMIN",
      active: true,
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: "ADMIN",
      active: true,
    },
  });

  console.log("Staging bootstrap complete.");
  console.log(`Tenant: ${tenant.name} (${tenant.code})`);
  console.log(`Admin: ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
