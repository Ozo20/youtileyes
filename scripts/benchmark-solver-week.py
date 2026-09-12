from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from solver.src.io import load_solver_input
from solver.src.multi_day import MultiDayOccurrence, ResourceBlock, solve_multi_day_week
from solver.src.runner import _domain_resources


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Benchmark one planning week from a Youtileyes solver input."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument(
        "--week",
        help="Week start date (YYYY-MM-DD). Defaults to the first week.",
    )
    parser.add_argument(
        "--max-time",
        type=float,
        default=10.0,
        help="CP-SAT time budget for the selected week.",
    )
    args = parser.parse_args()

    payload = load_solver_input(Path(args.input))
    instructors, rooms, groups, profile, travel_matrix = _domain_resources(payload)

    occurrences_by_week: dict[str, list[MultiDayOccurrence]] = defaultdict(list)
    for item in payload.teaching_occurrences:
        occurrences_by_week[item.week_start_date].append(
            MultiDayOccurrence(
                id=item.id,
                teaching_group_id=item.teaching_group_id,
                duration_minutes=item.duration_minutes,
                allowed_dates=item.allowed_dates,
            )
        )

    ordered_weeks = sorted(occurrences_by_week)
    if not ordered_weeks:
        raise SystemExit("Input contains no teaching occurrences.")

    week = args.week or ordered_weeks[0]
    if week not in occurrences_by_week:
        raise SystemExit(
            f"Week {week} not found. Available: {', '.join(ordered_weeks)}"
        )

    occurrences = occurrences_by_week[week]
    allowed_dates = {
        date for occurrence in occurrences for date in occurrence.allowed_dates
    }

    instructor_blocks = [
        ResourceBlock(
            resource_id=item.resource_id,
            date=item.date,
            start_minute=item.start_minute,
            end_minute=item.end_minute,
        )
        for item in payload.instructor_blocks
        if item.date in allowed_dates
    ]
    student_blocks = [
        ResourceBlock(
            resource_id=item.resource_id,
            date=item.date,
            start_minute=item.start_minute,
            end_minute=item.end_minute,
        )
        for item in payload.student_blocks
        if item.date in allowed_dates
    ]
    room_blocks = [
        ResourceBlock(
            resource_id=item.resource_id,
            date=item.date,
            start_minute=item.start_minute,
            end_minute=item.end_minute,
        )
        for item in payload.room_blocks
        if item.date in allowed_dates
    ]

    def progress(event: dict[str, object]) -> None:
        print(json.dumps(event, sort_keys=True), flush=True)

    print(
        f"Benchmarking week {week}: {len(occurrences)} occurrences, "
        f"{len(groups)} groups, {len(instructors)} instructors, {len(rooms)} rooms"
    )

    result = solve_multi_day_week(
        occurrences=occurrences,
        groups=groups,
        instructors=instructors,
        rooms=rooms,
        start_times=list(payload.start_times),
        travel_matrix=travel_matrix,
        student_profile=profile,
        instructor_blocks=instructor_blocks,
        student_blocks=student_blocks,
        room_blocks=room_blocks,
        max_time_seconds=args.max_time,
        progress_callback=progress,
    )

    print("\n=== RESULT ===")
    print("status:", result.status)
    print("objective:", result.objective_value)
    print("sessions:", len(result.sessions))
    print(json.dumps(result.diagnostics, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
