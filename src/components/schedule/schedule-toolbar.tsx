"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type FilterOption = {
  value: string;
  label: string;
};

type ScheduleToolbarProps = {
  currentView: "day" | "week";
  students: FilterOption[];
  instructors: FilterOption[];
  courses: FilterOption[];
  rooms: FilterOption[];
};

export function ScheduleToolbar({
  currentView,
  students,
  instructors,
  courses,
  rooms,
}: ScheduleToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  const dayParams = new URLSearchParams(searchParams.toString());
  dayParams.set("view", "day");

  const weekParams = new URLSearchParams(searchParams.toString());
  weekParams.set("view", "week");

  return (
    <div className="schedule-toolbar">
      <div className="schedule-view-switch">
        <Link
          href={`${pathname}?${dayParams.toString()}`}
          className="schedule-view-button"
          data-active={currentView === "day"}
        >
          Day
        </Link>

        <Link
          href={`${pathname}?${weekParams.toString()}`}
          className="schedule-view-button"
          data-active={currentView === "week"}
        >
          Week
        </Link>
      </div>

      <div className="schedule-toolbar-filters">
        <select
          className="schedule-filter"
          value={searchParams.get("student") ?? ""}
          onChange={(event) =>
            updateFilter("student", event.target.value)
          }
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
          onChange={(event) =>
            updateFilter("instructor", event.target.value)
          }
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
          onChange={(event) =>
            updateFilter("course", event.target.value)
          }
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
          onChange={(event) =>
            updateFilter("room", event.target.value)
          }
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

            router.push(`${pathname}?${params.toString()}`);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
