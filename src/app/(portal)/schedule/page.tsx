import { CalendarDays, Clock3 } from "lucide-react";

import { DaySchedule } from "@/components/schedule/day-schedule";
import { MonthSchedule } from "@/components/schedule/month-schedule";
import { ResourceCalendar } from "@/components/schedule/resource-calendar";
import { ScheduleToolbar } from "@/components/schedule/schedule-toolbar";
import { SessionDetailPanel } from "@/components/schedule/session-detail-panel";
import { WeekSchedule } from "@/components/schedule/week-schedule";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/prisma";

type ScheduleView = "day" | "week" | "month" | "calendar";

type PageProps = {
  searchParams: Promise<{
    view?: string;
    date?: string;
    student?: string;
    instructor?: string;
    course?: string;
    room?: string;
    session?: string;
  }>;
};

type ScheduleParams = Awaited<PageProps["searchParams"]>;

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonths(date: Date, months: number) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function startOfMonday(date: Date) {
  const result = new Date(date);
  const day = result.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  result.setUTCDate(result.getUTCDate() + offset);
  return result;
}

function startOfMonth(date: Date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function parseDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = utcDate(year, month - 1, day);
  return dateKey(parsed) === value ? parsed : null;
}

function displayTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function isoWeekNumber(date: Date) {
  const target = new Date(date);
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = utcDate(target.getUTCFullYear(), 0, 4);
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604_800_000);
}

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  timeZone: "UTC",
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const fullDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function buildScheduleHref(
  params: ScheduleParams,
  overrides: {
    view?: ScheduleView;
    date?: Date;
    session?: string | null;
  } = {},
) {
  const query = new URLSearchParams();

  const view = overrides.view ??
    (params.view === "week" || params.view === "month" || params.view === "calendar"
      ? params.view
      : "day");
  query.set("view", view);

  const date = overrides.date ?? parseDate(params.date);
  if (date) {
    query.set("date", dateKey(date));
  }

  for (const key of ["student", "instructor", "course", "room"] as const) {
    if (params[key]) {
      query.set(key, params[key]!);
    }
  }

  const session = overrides.session === undefined ? params.session : overrides.session;
  if (session) {
    query.set("session", session);
  }

  return `/schedule?${query.toString()}`;
}

export default async function SchedulePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestedView: ScheduleView =
    params.view === "week" ||
    params.view === "month" ||
    params.view === "calendar"
      ? params.view
      : "day";

  // A resource calendar is meaningful when the result set is anchored to a
  // resource that cannot have parallel bookings: one student, instructor or room.
  const calendarResource = params.student
    ? { type: "student" as const, id: params.student }
    : params.instructor
      ? { type: "instructor" as const, id: params.instructor }
      : params.room
        ? { type: "room" as const, id: params.room }
        : null;

  const currentView: ScheduleView =
    requestedView === "calendar" && !calendarResource ? "week" : requestedView;

  // Published Plan sessions are the operational source of truth. Scenarios are
  // proposals/previews and should never silently replace an official timetable.
  const plan = await prisma.plan.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { version: "desc" }],
    include: {
      planningScope: true,
      sessions: {
        include: {
          teachingGroup: { include: { course: true } },
          room: true,
          instructors: { include: { instructor: true } },
          students: { include: { student: true } },
        },
        orderBy: [{ date: "asc" }, { startMinute: "asc" }],
      },
    },
  });

  if (!plan) {
    return (
      <div className="page-container">
        <PageHeader
          title="Schedule"
          description="No published timetable is available."
        />
        <Card>
          <CardContent>
            Publish a Base Plan before using the operational schedule.
          </CardContent>
        </Card>
      </div>
    );
  }

  const firstSessionDate = plan.sessions[0]?.date ?? plan.planningStartDate ?? plan.effectiveFrom;
  const lastSessionDate =
    plan.sessions[plan.sessions.length - 1]?.date ?? plan.planningEndDate ?? plan.effectiveTo;

  const now = new Date();
  const today = utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const requestedDate = parseDate(params.date);
  const todayIsInPlan =
    firstSessionDate &&
    lastSessionDate &&
    today >= firstSessionDate &&
    today <= lastSessionDate;

  const selectedDate =
    requestedDate ??
    (todayIsInPlan ? today : firstSessionDate) ??
    today;

  const allSessions = plan.sessions.map((session) => {
    const instructorIds = session.instructors.map((membership) => membership.instructor.id);
    const instructorNames = session.instructors.map(
      (membership) => `${membership.instructor.firstName} ${membership.instructor.lastName}`,
    );

    return {
      id: session.id,
      href: buildScheduleHref(params, {
        date: session.date,
        session: session.id,
      }),
      selected: params.session === session.id,
      date: session.date,
      dateKey: dateKey(session.date),
      startMinute: session.startMinute,
      endMinute: session.endMinute,
      studentCount: session.students.length,
      studentIds: session.students.map((membership) => membership.student.id),
      students: session.students.map((membership) => ({
        id: membership.student.id,
        name: `${membership.student.firstName} ${membership.student.lastName}`,
      })),
      courseId: session.teachingGroup.course.id,
      courseCode: session.teachingGroup.course.code,
      courseName: session.teachingGroup.course.name,
      groupName: session.teachingGroup.name,
      roomId: session.room?.id ?? null,
      roomName: session.room?.name ?? null,
      instructorIds,
      instructorName: instructorNames.length > 0 ? instructorNames.join(", ") : null,
      origin: session.origin,
      locked: session.locked,
      changeReason: session.changeReason,
    };
  });

  const filteredSessions = allSessions.filter((session) => {
    if (params.student && !session.studentIds.includes(params.student)) {
      return false;
    }
    if (params.instructor && !session.instructorIds.includes(params.instructor)) {
      return false;
    }
    if (params.course && session.courseId !== params.course) {
      return false;
    }
    if (params.room && session.roomId !== params.room) {
      return false;
    }
    return true;
  });

  const selectedDayKey = dateKey(selectedDate);
  const daySessions = filteredSessions.filter((session) => session.dateKey === selectedDayKey);

  const weekStart = startOfMonday(selectedDate);
  const weekDays = Array.from({ length: 5 }, (_, index) => {
    const date = addDays(weekStart, index);
    return {
      key: dateKey(date),
      label: dayFormatter.format(date),
      dateLabel: dateFormatter.format(date),
      href: buildScheduleHref(params, { view: "day", date, session: null }),
    };
  });

  const monthStart = startOfMonth(selectedDate);
  const monthGridStart = startOfMonday(monthStart);
  const monthWeeks = Array.from({ length: 6 }, (_, weekIndex) => {
    const firstDay = addDays(monthGridStart, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addDays(firstDay, dayIndex);
      const key = dateKey(date);
      return {
        key,
        dayNumber: date.getUTCDate(),
        inCurrentMonth: date.getUTCMonth() === monthStart.getUTCMonth(),
        isToday: key === dateKey(today),
        dayHref: buildScheduleHref(params, { view: "day", date, session: null }),
        sessions: filteredSessions
          .filter((session) => session.dateKey === key)
          .map((session) => ({
            id: session.id,
            href: buildScheduleHref(params, {
              view: "day",
              date: session.date,
              session: session.id,
            }),
            startMinute: session.startMinute,
            courseCode: session.courseCode,
            courseName: session.courseName,
          })),
      };
    });

    return {
      key: dateKey(firstDay),
      label: `W${isoWeekNumber(firstDay)}`,
      weekHref: buildScheduleHref(params, { view: "week", date: firstDay, session: null }),
      days,
    };
  });

  const selectedSession = params.session
    ? allSessions.find((session) => session.id === params.session) ?? null
    : null;

  const periodDelta =
    currentView === "day" ? 1 : currentView === "week" || currentView === "calendar" ? 7 : null;
  const previousDate = periodDelta ? addDays(selectedDate, -periodDelta) : addMonths(selectedDate, -1);
  const nextDate = periodDelta ? addDays(selectedDate, periodDelta) : addMonths(selectedDate, 1);

  const [students, instructors, courses, rooms] = await Promise.all([
    prisma.student.findMany({
      where: { tenantId: plan.tenantId, status: "ACTIVE" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.instructor.findMany({
      where: { tenantId: plan.tenantId, status: "ACTIVE" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.course.findMany({
      where: { tenantId: plan.tenantId, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.room.findMany({
      where: { tenantId: plan.tenantId, active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const title =
    currentView === "day"
      ? fullDateFormatter.format(selectedDate)
      : currentView === "week" || currentView === "calendar"
        ? `Week ${isoWeekNumber(weekStart)} · ${dateFormatter.format(weekStart)}–${dateFormatter.format(addDays(weekStart, 4))}`
        : monthFormatter.format(monthStart);

  const calendarResourceLabel = calendarResource
    ? calendarResource.type === "student"
      ? students.find((student) => student.id === calendarResource.id)
        ? `${students.find((student) => student.id === calendarResource.id)!.firstName} ${students.find((student) => student.id === calendarResource.id)!.lastName}`
        : "Selected student"
      : calendarResource.type === "instructor"
        ? instructors.find((instructor) => instructor.id === calendarResource.id)
          ? `${instructors.find((instructor) => instructor.id === calendarResource.id)!.firstName} ${instructors.find((instructor) => instructor.id === calendarResource.id)!.lastName}`
          : "Selected instructor"
        : rooms.find((room) => room.id === calendarResource.id)?.name ?? "Selected room"
    : null;

  return (
    <div className="page-container">
      <PageHeader
        title="Schedule"
        description={plan.planningScope.name}
        actions={
          <div className="header-badges">
            <Badge tone="success">PUBLISHED</Badge>
            <Badge>Base Plan v{plan.version}</Badge>
          </div>
        }
      />

      <ScheduleToolbar
        currentView={currentView}
        currentDate={dateKey(selectedDate)}
        calendarAvailable={Boolean(calendarResource)}
        previousHref={buildScheduleHref(params, {
          view: currentView,
          date: previousDate,
          session: null,
        })}
        todayHref={buildScheduleHref(params, {
          view: currentView,
          date: today,
          session: null,
        })}
        nextHref={buildScheduleHref(params, {
          view: currentView,
          date: nextDate,
          session: null,
        })}
        students={students.map((student) => ({
          value: student.id,
          label: `${student.firstName} ${student.lastName}`,
        }))}
        instructors={instructors.map((instructor) => ({
          value: instructor.id,
          label: `${instructor.firstName} ${instructor.lastName}`,
        }))}
        courses={courses.map((course) => ({
          value: course.id,
          label: course.code ? `${course.code} · ${course.name}` : course.name,
        }))}
        rooms={rooms.map((room) => ({ value: room.id, label: room.name }))}
      />

      <div className="schedule-summary">
        <Card>
          <CardContent className="summary-card">
            <CalendarDays size={18} />
            <div>
              <span className="summary-label">Published plan</span>
              <strong>Base Plan v{plan.version}</strong>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="summary-card">
            <Clock3 size={18} />
            <div>
              <span className="summary-label">Matching sessions</span>
              <strong>{filteredSessions.length}</strong>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="schedule-workspace" data-detail-open={Boolean(selectedSession)}>
        <Card className="schedule-card">
          <CardHeader>
            <div>
              <span className="eyebrow">
                {currentView === "calendar" ? "Resource calendar" : "Published timetable"}
              </span>
              <h2>{title}</h2>
              {currentView === "calendar" && calendarResourceLabel ? (
                <p className="mt-1 text-sm text-slate-500">{calendarResourceLabel}</p>
              ) : null}
            </div>
            <Badge tone="success">Official schedule</Badge>
          </CardHeader>

          <CardContent>
            {currentView === "day" ? (
              <DaySchedule sessions={daySessions} />
            ) : currentView === "week" ? (
              <WeekSchedule days={weekDays} sessions={filteredSessions} />
            ) : currentView === "calendar" ? (
              <ResourceCalendar
                days={weekDays}
                sessions={filteredSessions}
                resourceType={calendarResource?.type ?? "student"}
              />
            ) : (
              <MonthSchedule weeks={monthWeeks} />
            )}
          </CardContent>
        </Card>

        {selectedSession ? (
          <SessionDetailPanel
            closeHref={buildScheduleHref(params, { session: null })}
            session={{
              id: selectedSession.id,
              courseCode: selectedSession.courseCode,
              courseName: selectedSession.courseName,
              groupName: selectedSession.groupName,
              dateLabel: fullDateFormatter.format(selectedSession.date),
              startTime: displayTime(selectedSession.startMinute),
              endTime: displayTime(selectedSession.endMinute),
              roomName: selectedSession.roomName,
              instructorName: selectedSession.instructorName,
              students: selectedSession.students,
              origin: selectedSession.origin,
              locked: selectedSession.locked,
              changeReason: selectedSession.changeReason,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
