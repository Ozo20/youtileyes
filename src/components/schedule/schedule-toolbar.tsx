"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type FilterOption = {
  value: string;
  label: string;
};

type ScheduleToolbarProps = {
  currentView: "day" | "week" | "month" | "calendar";
  currentDate: string;
  calendarAvailable: boolean;
  previousHref: string;
  todayHref: string;
  nextHref: string;
  students: FilterOption[];
  instructors: FilterOption[];
  courses: FilterOption[];
  rooms: FilterOption[];
};

export function ScheduleToolbar({
  currentView,
  currentDate,
  calendarAvailable,
  previousHref,
  todayHref,
  nextHref,
  students,
  instructors,
  courses,
  rooms,
}: ScheduleToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushParams(params: URLSearchParams) {
    params.delete("session");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    pushParams(params);
  }

  function updateDate(value: string) {
    if (!value) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("date", value);
    pushParams(params);
  }

  function viewHref(view: "day" | "week" | "month" | "calendar") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", view);
    params.set("date", currentDate);
    params.delete("session");
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="schedule-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="schedule-view-switch">
          {(["day", "week", "month"] as const).map((view) => (
            <Link
              key={view}
              href={viewHref(view)}
              className="schedule-view-button"
              data-active={currentView === view}
            >
              {view[0].toUpperCase() + view.slice(1)}
            </Link>
          ))}

          {calendarAvailable ? (
            <Link
              href={viewHref("calendar")}
              className="schedule-view-button"
              data-active={currentView === "calendar"}
              title="Outlook-style weekly calendar for the selected resource"
            >
              Calendar
            </Link>
          ) : (
            <span
              className="schedule-view-button cursor-not-allowed opacity-45"
              title="Select one student, instructor or room to use Calendar view"
              aria-disabled="true"
            >
              Calendar
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={previousHref}
            className="schedule-view-button"
            aria-label={`Previous ${currentView}`}
            title={`Previous ${currentView}`}
          >
            <ChevronLeft size={16} />
          </Link>

          <Link href={todayHref} className="schedule-view-button">
            Today
          </Link>

          <Link
            href={nextHref}
            className="schedule-view-button"
            aria-label={`Next ${currentView}`}
            title={`Next ${currentView}`}
          >
            <ChevronRight size={16} />
          </Link>

          <input
            type="date"
            className="schedule-filter"
            value={currentDate}
            onChange={(event) => updateDate(event.target.value)}
            aria-label="Go to date"
          />
        </div>
      </div>

      <div className="schedule-toolbar-filters">
        <select
          className="schedule-filter"
          value={searchParams.get("student") ?? ""}
          onChange={(event) => updateFilter("student", event.target.value)}
        >
          <option value="">All students</option>
          {students.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="schedule-filter"
          value={searchParams.get("instructor") ?? ""}
          onChange={(event) => updateFilter("instructor", event.target.value)}
        >
          <option value="">All instructors</option>
          {instructors.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="schedule-filter"
          value={searchParams.get("course") ?? ""}
          onChange={(event) => updateFilter("course", event.target.value)}
        >
          <option value="">All courses</option>
          {courses.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="schedule-filter"
          value={searchParams.get("room") ?? ""}
          onChange={(event) => updateFilter("room", event.target.value)}
        >
          <option value="">All rooms</option>
          {rooms.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="schedule-filter-clear"
          onClick={() => {
            const params = new URLSearchParams();
            params.set("view", currentView);
            params.set("date", currentDate);
            pushParams(params);
          }}
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}
