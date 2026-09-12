import Link from "next/link";

type MonthSession = {
  id: string;
  href: string;
  startMinute: number;
  courseCode: string | null;
  courseName: string;
};

type MonthDay = {
  key: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  dayHref: string;
  sessions: MonthSession[];
};

type MonthWeek = {
  key: string;
  label: string;
  weekHref: string;
  days: MonthDay[];
};

type MonthScheduleProps = {
  weeks: MonthWeek[];
};

function displayTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthSchedule({ weeks }: MonthScheduleProps) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b text-xs font-medium text-slate-500">
          <div className="p-2">Week</div>
          {weekdayLabels.map((label) => (
            <div key={label} className="p-2 text-center">
              {label}
            </div>
          ))}
        </div>

        {weeks.map((week) => (
          <div
            key={week.key}
            className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b last:border-b-0"
          >
            <div className="border-r p-2 text-center text-sm">
              <Link href={week.weekHref} className="font-medium hover:underline">
                {week.label}
              </Link>
            </div>

            {week.days.map((day) => (
              <div
                key={day.key}
                className={`min-h-32 border-r p-2 last:border-r-0 ${
                  day.inCurrentMonth ? "" : "opacity-45"
                }`}
              >
                <Link
                  href={day.dayHref}
                  className={`mb-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-medium hover:underline ${
                    day.isToday ? "border" : ""
                  }`}
                >
                  {day.dayNumber}
                </Link>

                {day.sessions.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">
                      {day.sessions.length} session{day.sessions.length === 1 ? "" : "s"}
                    </div>
                    {day.sessions.slice(0, 3).map((session) => (
                      <Link
                        key={session.id}
                        href={session.href}
                        className="block truncate rounded border px-1.5 py-1 text-xs hover:underline"
                        title={`${displayTime(session.startMinute)} · ${session.courseCode ?? session.courseName}`}
                      >
                        {displayTime(session.startMinute)} · {session.courseCode ?? session.courseName}
                      </Link>
                    ))}
                    {day.sessions.length > 3 ? (
                      <Link href={day.dayHref} className="block text-xs font-medium hover:underline">
                        +{day.sessions.length - 3} more
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
