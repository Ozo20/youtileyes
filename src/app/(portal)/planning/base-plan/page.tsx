import Link from "next/link";
import {
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  Clock3,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import {
  CheckboxField,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import {
  createBasePlanRevision,
  generateBasePlanAllocations,
  saveTeachingRequirement,
} from "@/lib/planning/base-plan-actions";
import {
  dateKey,
  isoWeekNumber,
  startOfUtcMonday,
} from "@/lib/planning/base-plan";
import { getTenantContext } from "@/lib/access/tenant-context";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<{ status?: string; error?: string }>;
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function hours(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "";
  const value = minutes / 60;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function displayHours(minutes: number) {
  const value = minutes / 60;
  return Number.isInteger(value) ? `${value} h` : `${value.toFixed(1)} h`;
}

function inclusiveDays(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

export default async function BasePlanPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { tenant } = await getTenantContext();

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader title="Base plan" description="No active tenant found." />
      </div>
    );
  }

  const latestPlan = await prisma.plan.findFirst({
    where: { tenantId: tenant.id, status: { not: "ARCHIVED" } },
    include: { academicPeriod: true, planningScope: true },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });

  const period = latestPlan?.academicPeriod ?? await prisma.academicPeriod.findFirst({
    where: { tenantId: tenant.id, active: true },
    orderBy: { startDate: "desc" },
  });

  if (!period) {
    return (
      <div className="page-container">
        <PageHeader
          title="Base plan"
          description="Configure long-horizon teaching demand before generating a timetable."
        />
        <EmptyState
          icon={<CalendarRange size={20} />}
          title="No academic period"
          description="Create an academic period before configuring the base plan."
        />
      </div>
    );
  }

  const [
    groups,
    requirements,
    calendarDays,
    timeBlockCount,
    roomCount,
    instructorCourses,
  ] = await Promise.all([
    prisma.teachingGroup.findMany({
      where: {
        tenantId: tenant.id,
        academicPeriodId: period.id,
        status: { not: "ARCHIVED" },
      },
      include: { course: true, studentCohort: true },
      orderBy: [{ code: "asc" }, { name: "asc" }],
    }),
    latestPlan
      ? prisma.teachingRequirement.findMany({
          where: {
            tenantId: tenant.id,
            planId: latestPlan.id,
            academicPeriodId: period.id,
            active: true,
          },
          include: {
            weeklyAllocations: {
              orderBy: { weekStartDate: "asc" },
            },
          },
        })
      : Promise.resolve([]),
    prisma.calendarDay.findMany({
      where: {
        tenantId: tenant.id,
        academicPeriodId: period.id,
        date: { gte: period.startDate, lte: period.endDate },
      },
      orderBy: { date: "asc" },
    }),
    prisma.timeBlock.count({ where: { tenantId: tenant.id, active: true } }),
    prisma.room.count({ where: { tenantId: tenant.id, active: true } }),
    prisma.instructorCourse.findMany({
      where: { tenantId: tenant.id, active: true },
      select: { courseId: true, instructorId: true },
    }),
  ]);

  const requirementByGroup = new Map(
    requirements.map((requirement) => [requirement.teachingGroupId, requirement]),
  );

  const calendarComplete = calendarDays.length === inclusiveDays(period.startDate, period.endDate);
  const teachingDayCount = calendarDays.filter((day) => day.teachingAllowed).length;
  const teachingWeekCount = new Set(
    calendarDays
      .filter((day) => day.teachingAllowed)
      .map((day) => dateKey(startOfUtcMonday(day.date))),
  ).size;
  const totalMinutes = requirements.reduce((sum, requirement) => sum + requirement.totalMinutes, 0);
  const requirementsReady = groups.filter((group) => requirementByGroup.has(group.id)).length;
  const allocationsReady = requirements.filter((requirement) => {
    const allocated = requirement.weeklyAllocations.reduce(
      (sum, week) => sum + week.targetMinutes,
      0,
    );
    return requirement.weeklyAllocations.length > 0 && allocated === requirement.totalMinutes;
  }).length;
  const unqualifiedGroups = groups.filter((group) =>
    !instructorCourses.some((item) => item.courseId === group.courseId),
  );

  const weekStarts = Array.from(new Map(
    calendarDays.map((day) => {
      const monday = startOfUtcMonday(day.date);
      return [dateKey(monday), monday] as const;
    }),
  ).values()).sort((a, b) => a.getTime() - b.getTime());

  const canEditBasePlan = Boolean(
    latestPlan &&
      ["DRAFT", "GENERATED", "REVIEWED"].includes(
        latestPlan.status,
      ),
  );

  const readyForFeasibility =
    groups.length > 0 &&
    requirementsReady === groups.length &&
    allocationsReady === requirements.length &&
    calendarComplete &&
    timeBlockCount > 0 &&
    roomCount > 0 &&
    unqualifiedGroups.length === 0;

  return (
    <div className="page-container">
      <PageHeader
        title="Base plan"
        description={`${period.name} · configure teaching demand across the complete ${period.type === "ACADEMIC_YEAR" ? "academic year" : "academic period"}`}
        actions={
          <Link href="/planning">
            <Button type="button" variant="secondary">
              Planning workspace <ArrowRight size={14} />
            </Button>
          </Link>
        }
      />

      {params.error ? (
        <div className="base-plan-feedback base-plan-feedback-error" role="alert">
          <TriangleAlert size={16} />
          <div>
            <strong>Weekly allocation needs adjustment</strong>
            <span>{params.error}</span>
          </div>
        </div>
      ) : params.status ? (
        <div className="base-plan-feedback">
          <CheckCircle2 size={14} />
          <span>
            {params.status === "allocations-generated"
              ? "Weekly teaching targets regenerated across the full period."
              : "Teaching requirement saved. Weekly targets must be regenerated."}
          </span>
        </div>
      ) : null}

      {latestPlan ? (
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Revision</span>
              <h2>
                Base Plan v{latestPlan.version} ·{" "}
                {latestPlan.status.replaceAll("_", " ")}
              </h2>
            </div>

            {latestPlan.status === "PUBLISHED" ? (
              <form action={createBasePlanRevision}>
                <input
                  type="hidden"
                  name="tenantId"
                  value={tenant.id}
                />
                <input
                  type="hidden"
                  name="sourcePlanId"
                  value={latestPlan.id}
                />
                <Button type="submit" variant="primary">
                  Create new revision
                </Button>
              </form>
            ) : null}
          </CardHeader>
          <CardContent>
            <p className="base-plan-note">
              {canEditBasePlan
                ? "This revision is the editable Base Plan workset."
                : latestPlan.status === "PUBLISHED"
                  ? "Published Base Plan revisions are read-only. Create a new revision for structural changes."
                  : "This Base Plan revision is read-only in the editor."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="base-plan-stats">
        <StatCard
          label="Planning horizon"
          value={`${weekStarts.length} weeks`}
          detail={`${dateFormatter.format(period.startDate)} – ${dateFormatter.format(period.endDate)}`}
        />
        <StatCard
          label="Teaching days"
          value={String(teachingDayCount)}
          detail={`${calendarDays.length} calendar days materialised`}
        />
        <StatCard
          label="Teaching demand"
          value={displayHours(totalMinutes)}
          detail={`${requirementsReady}/${groups.length} groups configured`}
        />
        <StatCard
          label="Weekly allocation"
          value={`${allocationsReady}/${requirements.length}`}
          detail="requirements distributed across weeks"
        />
      </div>

      <Card className="base-plan-period-card">
        <CardHeader>
          <div>
            <span className="eyebrow">1 · Horizon & readiness</span>
            <h2>{period.name}</h2>
          </div>
          <Badge tone={readyForFeasibility ? "success" : "warning"}>
            {readyForFeasibility ? "READY" : "SETUP REQUIRED"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="base-plan-period-meta">
            <div><span>Period type</span><strong>{period.type.replaceAll("_", " ")}</strong></div>
            <div><span>Start</span><strong>{dateFormatter.format(period.startDate)}</strong></div>
            <div><span>End</span><strong>{dateFormatter.format(period.endDate)}</strong></div>
            <div><span>Scope</span><strong>{latestPlan?.planningScope.name ?? "Not assigned"}</strong></div>
          </div>

          <div className="base-plan-readiness-grid">
            <div data-ready={calendarComplete}>
              {calendarComplete ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
              <span>Calendar</span>
              <strong>{calendarComplete ? "Complete" : "Missing dates"}</strong>
            </div>
            <div data-ready={timeBlockCount > 0}>
              {timeBlockCount > 0 ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
              <span>Time blocks</span>
              <strong>{timeBlockCount}</strong>
            </div>
            <div data-ready={roomCount > 0}>
              {roomCount > 0 ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
              <span>Rooms</span>
              <strong>{roomCount}</strong>
            </div>
            <div data-ready={unqualifiedGroups.length === 0}>
              {unqualifiedGroups.length === 0 ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
              <span>Qualified staffing</span>
              <strong>{unqualifiedGroups.length === 0 ? "Covered" : `${unqualifiedGroups.length} gaps`}</strong>
            </div>
          </div>

          <p className="base-plan-note">
            The planning horizon comes from the academic period. The data model already supports both semester and academic-year periods; weekly demand is generated for every week in that horizon rather than for one representative week.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">2 · Teaching demand</span>
            <h2>Hours and weekly distribution rules</h2>
          </div>
        </CardHeader>
        <CardContent>
          <p className="base-plan-demand-help">
            <strong>Period total is authoritative.</strong>{" "}
            Average required is calculated from the total across the teaching weeks.
            Preferred h/w is a soft target; minimum and maximum h/w are hard weekly limits.
          </p>

          <div className="base-plan-requirement-table-wrap">
            <table className="base-plan-requirement-table">
              <thead>
                <tr>
                  <th>Group / course</th>
                  <th>Period total</th>
                  <th>Avg required</th>
                  <th>Distribution</th>
                  <th>Preferred h/w</th>
                  <th>Min h/w</th>
                  <th>Max h/w</th>
                  <th>Carry over</th>
                  <th>Priority</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const requirement = requirementByGroup.get(group.id);
                  const allocated = requirement?.weeklyAllocations.reduce(
                    (sum, week) => sum + week.targetMinutes,
                    0,
                  ) ?? 0;
                  const allocationCurrent = Boolean(
                    requirement &&
                    requirement.weeklyAllocations.length > 0 &&
                    allocated === requirement.totalMinutes,
                  );
                  const activeWeeks =
                    requirement?.weeklyAllocations.filter(
                      (week) => week.availableTeachingDays > 0,
                    ).length || teachingWeekCount || weekStarts.length || 1;
                  const averageMinutes =
                    (requirement?.totalMinutes ?? 0) / activeWeeks;
                  const formId = `requirement-${group.id}`;

                  return (
                    <tr key={group.id}>
                      <td className="base-plan-group-cell">
                        <form id={formId} action={saveTeachingRequirement} />
                        <input form={formId} type="hidden" name="tenantId" value={tenant.id} />
                        {latestPlan ? (
                          <input
                            form={formId}
                            type="hidden"
                            name="planId"
                            value={latestPlan.id}
                          />
                        ) : null}
                        <input form={formId} type="hidden" name="academicPeriodId" value={period.id} />
                        <input form={formId} type="hidden" name="teachingGroupId" value={group.id} />

                        <strong>{group.code ?? group.name}</strong>
                        <span>{group.studentCohort?.code ?? "—"} · {group.course.code ?? group.course.name}</span>
                        <small>
                          Session {group.course.preferredSessionMinutes ?? group.course.minSessionMinutes ?? 45} min
                          {group.course.allowDoubleSession ? " · doubles allowed" : ""}
                        </small>
                        <Badge tone={allocationCurrent ? "success" : "warning"}>
                          {allocationCurrent ? "ALLOCATED" : "REGENERATE"}
                        </Badge>
                      </td>

                      <td>
                        <TextInput
                          form={formId}
                          name="totalHours"
                          type="number"
                          min="0"
                          step="0.25"
                          defaultValue={hours(requirement?.totalMinutes ?? 0)}
                          aria-label="Period total hours"
                        />
                      </td>

                      <td className="base-plan-derived-cell">
                        <strong>{hours(Math.round(averageMinutes)) || "0"} h/w</strong>
                        <span>{activeWeeks} teaching weeks</span>
                      </td>

                      <td>
                        <SelectInput
                          form={formId}
                          name="distributionMode"
                          defaultValue={requirement?.distributionMode ?? "EVEN_BY_TEACHING_CAPACITY"}
                          aria-label="Distribution mode"
                        >
                          <option value="EVEN_BY_TEACHING_CAPACITY">By capacity</option>
                          <option value="EVEN_BY_WEEK">Even by week</option>
                          <option value="FLEXIBLE">Flexible</option>
                        </SelectInput>
                      </td>

                      <td>
                        <TextInput
                          form={formId}
                          name="preferredWeeklyHours"
                          type="number"
                          min="0"
                          step="0.25"
                          defaultValue={hours(requirement?.preferredWeeklyMinutes)}
                          aria-label="Preferred weekly hours"
                        />
                      </td>

                      <td>
                        <TextInput
                          form={formId}
                          name="minWeeklyHours"
                          type="number"
                          min="0"
                          step="0.25"
                          defaultValue={hours(requirement?.minWeeklyMinutes)}
                          aria-label="Minimum weekly hours"
                        />
                      </td>

                      <td>
                        <TextInput
                          form={formId}
                          name="maxWeeklyHours"
                          type="number"
                          min="0"
                          step="0.25"
                          defaultValue={hours(requirement?.maxWeeklyMinutes)}
                          aria-label="Maximum weekly hours"
                        />
                      </td>

                      <td className="base-plan-checkbox-cell">
                        <CheckboxField
                          form={formId}
                          name="carryoverAllowed"
                          label="Allowed"
                          defaultChecked={requirement?.carryoverAllowed ?? true}
                        />
                      </td>

                      <td>
                        <SelectInput
                          form={formId}
                          name="priority"
                          defaultValue={requirement?.priority ?? "NORMAL"}
                          aria-label="Priority"
                        >
                          <option value="LOW">Low</option>
                          <option value="NORMAL">Normal</option>
                          <option value="HIGH">High</option>
                          <option value="CRITICAL">Critical</option>
                        </SelectInput>
                      </td>

                      <td>
                        <Button
                          form={formId}
                          type="submit"
                          variant="secondary"
                          disabled={!canEditBasePlan}
                        >
                          Save
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="base-plan-allocation-action">
            <div>
              <strong>Generate week-by-week targets</strong>
              <span>
                Distributes {displayHours(totalMinutes)} across all {weekStarts.length} weeks, adjusted for teaching days and blocking class/group exceptions.
              </span>
            </div>
            <form action={generateBasePlanAllocations}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              {latestPlan ? (
                <input
                  type="hidden"
                  name="planId"
                  value={latestPlan.id}
                />
              ) : null}
              <input type="hidden" name="academicPeriodId" value={period.id} />
              <Button
                type="submit"
                variant="primary"
                disabled={
                  requirements.length === 0 || !canEditBasePlan
                }
              >
                <RefreshCw size={14} /> Generate weekly allocation
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">3 · Full-horizon preview</span>
            <h2>Teaching demand by week</h2>
          </div>
          <span className="base-plan-scroll-hint">Scroll horizontally for long periods</span>
        </CardHeader>
        <CardContent>
          <div className="base-plan-week-grid-wrap">
            <table className="base-plan-week-grid">
              <thead>
                <tr>
                  <th>Group</th>
                  {weekStarts.map((week) => (
                    <th key={dateKey(week)}>
                      <strong>W{isoWeekNumber(week)}</strong>
                      <span>{dateFormatter.format(week).replace(/\s\d{4}$/, "")}</span>
                    </th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const requirement = requirementByGroup.get(group.id);
                  const byWeek = new Map(
                    requirement?.weeklyAllocations.map((week) => [dateKey(week.weekStartDate), week]) ?? [],
                  );

                  return (
                    <tr key={group.id}>
                      <th>
                        <strong>{group.code ?? group.name}</strong>
                        <span>{group.course.code ?? group.course.name}</span>
                      </th>
                      {weekStarts.map((week) => {
                        const allocation = byWeek.get(dateKey(week));
                        return (
                          <td key={dateKey(week)} data-adjusted={Boolean(allocation?.adjustmentReason)}>
                            {allocation ? hours(allocation.targetMinutes) || "0" : "—"}
                          </td>
                        );
                      })}
                      <td className="base-plan-week-total">
                        {requirement ? hours(requirement.totalMinutes) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="base-plan-next-step" data-ready={readyForFeasibility}>
            {readyForFeasibility ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}
            <div>
              <strong>{readyForFeasibility ? "Base demand is ready for feasibility analysis" : "Complete setup before solver generation"}</strong>
              <span>
                This step defines demand across the entire horizon. The next solver slice can use these weekly targets to create concrete sessions without collapsing the problem into a single-week template.
              </span>
            </div>
            <Link href="/planning">
              <Button type="button" variant={readyForFeasibility ? "primary" : "secondary"}>
                Open planning <ArrowRight size={14} />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
