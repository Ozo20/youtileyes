import Link from "next/link";

type CalendarSession = {
  id: string;
  href: string;
  selected: boolean;
  dateKey: string;
  startMinute: number;
  endMinute: number;
  courseCode: string | null;
  courseName: string;
  roomName: string | null;
  instructorName: string | null;
};

type CalendarDay = {
  key: string;
  label: string;
  dateLabel: string;
  href: string;
};

type ResourceCalendarProps = {
  days: CalendarDay[];
  sessions: CalendarSession[];
  resourceType: "student" | "instructor" | "room";
};

const DEFAULT_START = 8 * 60;
const DEFAULT_END = 16 * 60;
const SLOT_MINUTES = 30;
const SLOT_HEIGHT = 36;
const MIN_CARD_HEIGHT = 18;

function displayTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function floorToSlot(minutes: number) {
  return Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function ceilToSlot(minutes: number) {
  return Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

export function ResourceCalendar({ days, sessions, resourceType }: ResourceCalendarProps) {
  const weekKeys = new Set(days.map((day) => day.key));
  const weekSessions = sessions.filter((session) => weekKeys.has(session.dateKey));

  const firstSessionMinute = weekSessions.length
    ? Math.min(...weekSessions.map((session) => session.startMinute))
    : DEFAULT_START;
  const lastSessionMinute = weekSessions.length
    ? Math.max(...weekSessions.map((session) => session.endMinute))
    : DEFAULT_END;

  // Keep some breathing room around the actual timetable while ensuring a useful
  // school-day frame even on days with only a few sessions.
  const startMinute = Math.min(DEFAULT_START, floorToSlot(firstSessionMinute));
  const endMinute = Math.max(DEFAULT_END, ceilToSlot(lastSessionMinute));
  const totalMinutes = endMinute - startMinute;
  const gridHeight = (totalMinutes / SLOT_MINUTES) * SLOT_HEIGHT;
  const ticks = Array.from(
    { length: totalMinutes / SLOT_MINUTES + 1 },
    (_, index) => startMinute + index * SLOT_MINUTES,
  );

  const resourceLabel =
    resourceType === "student"
      ? "student"
      : resourceType === "instructor"
        ? "instructor"
        : "room";

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            Calendar view for one {resourceLabel}. Empty space represents free time.
          </span>
          <span>{displayTime(startMinute)}–{displayTime(endMinute)}</span>
        </div>

        <div className="grid grid-cols-[72px_repeat(5,minmax(150px,1fr))] border-b">
          <div className="border-r p-2 text-xs font-medium text-slate-500">Time</div>
          {days.map((day) => (
            <Link
              key={day.key}
              href={day.href}
              className="border-r p-2 text-center last:border-r-0 hover:bg-slate-50"
            >
              <strong className="block text-sm">{day.label}</strong>
              <span className="text-xs text-slate-500">{day.dateLabel}</span>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-[72px_repeat(5,minmax(150px,1fr))]">
          <div className="relative border-r" style={{ height: gridHeight }}>
            {ticks.map((minute, index) => (
              <div
                key={minute}
                className="absolute left-0 right-0 -translate-y-1/2 pr-2 text-right text-[11px] text-slate-500"
                style={{ top: index * SLOT_HEIGHT }}
              >
                {minute % 60 === 0 ? displayTime(minute) : ""}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const daySessions = weekSessions
              .filter((session) => session.dateKey === day.key)
              .sort((left, right) => left.startMinute - right.startMinute);

            return (
              <div
                key={day.key}
                className="relative border-r bg-white last:border-r-0"
                style={{ height: gridHeight }}
              >
                {ticks.map((minute, index) => (
                  <div
                    key={minute}
                    className={`absolute left-0 right-0 border-t ${
                      minute % 60 === 0 ? "border-slate-200" : "border-slate-100"
                    }`}
                    style={{ top: index * SLOT_HEIGHT }}
                  />
                ))}

                {daySessions.map((session) => {
                  const top = ((session.startMinute - startMinute) / SLOT_MINUTES) * SLOT_HEIGHT;
                  const durationHeight =
                    ((session.endMinute - session.startMinute) / SLOT_MINUTES) * SLOT_HEIGHT;
                  const height = Math.max(MIN_CARD_HEIGHT, durationHeight - 2);

                  return (
                    <Link
                      key={session.id}
                      href={session.href}
                      className="absolute left-1.5 right-1.5 z-10 overflow-hidden rounded-md border bg-white px-2 py-1.5 shadow-sm transition hover:z-20 hover:shadow-md"
                      data-selected={session.selected}
                      style={{ top, height }}
                      title={`${displayTime(session.startMinute)}–${displayTime(session.endMinute)} · ${session.courseCode ?? session.courseName}`}
                    >
                      <div className="text-[11px] font-medium text-slate-500">
                        {displayTime(session.startMinute)}–{displayTime(session.endMinute)}
                      </div>
                      <div className="truncate text-xs font-semibold">
                        {session.courseCode ?? session.courseName}
                      </div>
                      {height >= 58 ? (
                        <div className="truncate text-[11px] text-slate-500">
                          {resourceType === "room"
                            ? session.instructorName ?? "No instructor"
                            : session.roomName ?? "No room"}
                        </div>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
