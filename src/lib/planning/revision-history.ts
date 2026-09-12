import { prisma } from "@/lib/prisma";

export type PlanRevisionState =
  | "CURRENT"
  | "FUTURE"
  | "HISTORICAL"
  | "DRAFT";

function startOfUtcDay(value = new Date()) {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ),
  );
}

export function planRevisionState(
  plan: {
    status: string;
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
  },
  today = startOfUtcDay(),
): PlanRevisionState {
  if (plan.status === "DRAFT" || plan.status === "IN_REVIEW") {
    return "DRAFT";
  }

  if (plan.effectiveFrom && plan.effectiveFrom > today) {
    return "FUTURE";
  }

  if (
    (!plan.effectiveFrom || plan.effectiveFrom <= today) &&
    (!plan.effectiveTo || plan.effectiveTo >= today) &&
    (plan.status === "PUBLISHED" || plan.status === "SUPERSEDED")
  ) {
    return "CURRENT";
  }

  return "HISTORICAL";
}

export async function getPlanRevisionHistory({
  tenantId,
  planningScopeId,
}: {
  tenantId: string;
  planningScopeId: string;
}) {
  return prisma.plan.findMany({
    where: {
      tenantId,
      planningScopeId,
    },
    include: {
      _count: {
        select: {
          sessions: true,
          distributions: true,
        },
      },
      publishedRecoveryCases: {
        select: {
          id: true,
          version: true,
          publishedAt: true,
          publishedByName: true,
          disruptions: {
            where: { active: true },
            select: {
              id: true,
              type: true,
              resourceLabel: true,
              startDate: true,
              endDate: true,
            },
          },
          proposals: {
            where: { status: "ACCEPTED" },
            select: {
              scenario: {
                select: {
                  id: true,
                  _count: {
                    select: { changes: true },
                  },
                },
              },
            },
            take: 1,
          },
        },
        take: 1,
      },
      distributions: {
        orderBy: { generatedAt: "desc" },
        take: 8,
      },
    },
    orderBy: { version: "desc" },
  });
}
