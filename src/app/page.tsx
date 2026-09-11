import Link from "next/link";
import {
  Activity,
  CalendarClock,
  FileCheck2,
  GraduationCap,
  School,
  Sparkles,
  Users,
} from "lucide-react";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { prisma } from "@/lib/prisma";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export default async function HomePage() {
  const tenant = await prisma.tenant.findUnique({
    where: {
      code: "DEMO",
    },
  });

  if (!tenant) {
    return (
      <AppShell>
        <div className="page-container">
          <PageHeader
            title="Overview"
            description="No tenant is available."
          />
        </div>
      </AppShell>
    );
  }

  const plan = await prisma.plan.findFirst({
    where: {
      tenantId: tenant.id,
      status: {
        not: "ARCHIVED",
      },
    },
    orderBy: {
      version: "desc",
    },
    include: {
      planningScope: true,
      academicPeriod: true,
    },
  });

  const asOfDate =
    plan?.planningAsOfDate ?? new Date();

  const [
    latestScenario,
    students,
    instructors,
    rooms,
    pendingReviews,
    upcomingExceptions,
    recentEvents,
  ] = await Promise.all([
    prisma.planScenario.findFirst({
      where: {
        tenantId: tenant.id,
        ...(plan ? { planId: plan.id } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.student.count({
      where: {
        tenantId: tenant.id,
        status: "ACTIVE",
      },
    }),
    prisma.instructor.count({
      where: {
        tenantId: tenant.id,
        status: "ACTIVE",
      },
    }),
    prisma.room.count({
      where: {
        tenantId: tenant.id,
        active: true,
      },
    }),
    prisma.planReviewStep.count({
      where: {
        tenantId: tenant.id,
        status: {
          in: ["PENDING", "READY", "IN_REVIEW"],
        },
      },
    }),
    prisma.planningException.count({
      where: {
        tenantId: tenant.id,
        status: "ACTIVE",
        endAt: {
          gte: asOfDate,
        },
      },
    }),
    prisma.eventLog.findMany({
      where: {
        tenantId: tenant.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 8,
    }),
  ]);

  return (
    <AppShell>
      <div className="page-container">
        <PageHeader
          title="Overview"
          description={`${tenant.name} · planning and operational status`}
          actions={
            plan ? (
              <Badge tone="info">
                Plan v{plan.version} · {plan.status}
              </Badge>
            ) : null
          }
        />

        <div className="overview-stats">
          <StatCard
            label="Current plan"
            value={plan ? `v${plan.version}` : "—"}
            detail={
              plan
                ? `${plan.planningScope.name} · ${plan.status}`
                : "No plan available"
            }
            icon={<CalendarClock size={17} />}
            tone="info"
          />

          <StatCard
            label="Latest scenario"
            value={latestScenario?.status ?? "—"}
            detail={
              latestScenario?.name ??
              "No generated scenario"
            }
            icon={<Sparkles size={17} />}
            tone={
              latestScenario?.status === "FAILED"
                ? "danger"
                : "success"
            }
          />

          <StatCard
            label="Pending review"
            value={pendingReviews}
            detail="Review steps requiring attention"
            icon={<FileCheck2 size={17} />}
            tone={pendingReviews > 0 ? "warning" : "neutral"}
          />

          <StatCard
            label="Upcoming exceptions"
            value={upcomingExceptions}
            detail="Active exceptions from the planning as-of date"
            icon={<Activity size={17} />}
            tone={upcomingExceptions > 0 ? "warning" : "neutral"}
          />
        </div>

        <div className="overview-grid">
          <Card>
            <CardHeader>
              <div>
                <span className="eyebrow">
                  Planning horizon
                </span>
                <h2>
                  {plan?.name ?? "No active plan"}
                </h2>
              </div>

              {plan ? (
                <Link
                  href="/schedule?view=week"
                  className="overview-link"
                >
                  Open schedule
                </Link>
              ) : null}
            </CardHeader>

            <CardContent>
              {plan ? (
                <dl className="overview-plan-grid">
                  <div>
                    <dt>As-of date</dt>
                    <dd>
                      {plan.planningAsOfDate
                        ? dateFormatter.format(
                            plan.planningAsOfDate,
                          )
                        : "—"}
                    </dd>
                  </div>

                  <div>
                    <dt>Frozen through</dt>
                    <dd>
                      {plan.frozenThroughDate
                        ? dateFormatter.format(
                            plan.frozenThroughDate,
                          )
                        : "—"}
                    </dd>
                  </div>

                  <div>
                    <dt>Editable from</dt>
                    <dd>
                      {plan.planningStartDate
                        ? dateFormatter.format(
                            plan.planningStartDate,
                          )
                        : "—"}
                    </dd>
                  </div>

                  <div>
                    <dt>Planning end</dt>
                    <dd>
                      {plan.planningEndDate
                        ? dateFormatter.format(
                            plan.planningEndDate,
                          )
                        : "—"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <EmptyState
                  icon={<CalendarClock size={20} />}
                  title="No planning horizon"
                  description="Create a plan before generating schedules."
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <span className="eyebrow">
                  Resources
                </span>
                <h2>Active master data</h2>
              </div>
            </CardHeader>

            <CardContent>
              <div className="resource-count-grid">
                <div>
                  <GraduationCap size={17} />
                  <strong>{students}</strong>
                  <span>Students</span>
                </div>

                <div>
                  <Users size={17} />
                  <strong>{instructors}</strong>
                  <span>Instructors</span>
                </div>

                <div>
                  <School size={17} />
                  <strong>{rooms}</strong>
                  <span>Rooms</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">
                Recent changes
              </span>
              <h2>Audit activity</h2>
            </div>

            <Link
              href="/history"
              className="overview-link"
            >
              View full history
            </Link>
          </CardHeader>

          <CardContent className="history-list-content">
            <AuditEventList
              events={recentEvents}
              baseHref="/history"
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
