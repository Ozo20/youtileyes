import type { TenantRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const ROLE_RANK: Record<TenantRole, number> = {
  VIEWER: 10,
  MEMBER: 20,
  PLANNER: 30,
  ADMIN: 40,
};

const DEMO_USER_EMAIL =
  process.env.YOUTILEYES_DEMO_USER_EMAIL ?? "ola.solem@example.test";

const DEMO_TENANT_CODE = process.env.YOUTILEYES_DEMO_TENANT_CODE ?? "DEMO";

export type TenantContext = {
  tenant: {
    id: string;
    code: string;
    name: string;
    timezone: string;
    recoveryApprovalRequired: boolean;
  };
  user: {
    id: string;
    email: string;
    name: string;
  };
  role: TenantRole;
  actor: {
    id: string;
    name: string;
  };
};

export function roleAtLeast(actual: TenantRole, required: TenantRole) {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export async function getTenantContext(): Promise<TenantContext> {
  // Development identity only. When real authentication is introduced,
  // replace these environment-backed selectors with the authenticated user
  // and an institution selected from that user's active memberships.
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      active: true,
      user: {
        email: DEMO_USER_EMAIL,
        active: true,
      },
      tenant: {
        code: DEMO_TENANT_CODE,
        status: "ACTIVE",
      },
    },
    include: {
      tenant: {
        select: {
          id: true,
          code: true,
          name: true,
          timezone: true,
          recoveryApprovalRequired: true,
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  if (!membership) {
    throw new Error(
      `No active institution membership found for ${DEMO_USER_EMAIL} in ${DEMO_TENANT_CODE}. Run the seed or configure the development tenant context.`,
    );
  }

  return {
    tenant: membership.tenant,
    user: membership.user,
    role: membership.role,
    actor: {
      id: membership.user.id,
      name: membership.user.name,
    },
  };
}

export async function requireTenantRole(
  required: TenantRole | readonly TenantRole[],
): Promise<TenantContext> {
  const context = await getTenantContext();
  const roles = Array.isArray(required) ? required : [required];

  if (!roles.some((role) => roleAtLeast(context.role, role))) {
    throw new Error("You do not have permission to perform this action.");
  }

  return context;
}

export async function requireInstitutionAdmin() {
  return requireTenantRole("ADMIN");
}
