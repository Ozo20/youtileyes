from __future__ import annotations

from collections import defaultdict

from .contracts import (
    ScheduledSessionOutput,
    StaffingAssignmentOutput,
    SolverInput,
    SolverMetricOutput,
    SolverOutput,
)
from .models import Instructor, LoadProfile, Room, StaffingRole, TeachingGroup
from .multi_day import MultiDayOccurrence, ResourceBlock, solve_multi_day_week
from .scheduler import solve_schedule


def _domain_resources(payload: SolverInput):
    instructors = [
        Instructor(
            id=item.id,
            name=item.name,
            courses=frozenset(item.course_ids),
            course_penalties=dict(item.course_penalties),
            qualification_levels=dict(item.qualification_levels),
        )
        for item in payload.instructors
    ]

    rooms = [
        Room(
            id=item.id,
            name=item.name,
            capacity=item.capacity,
            staffing_roles=tuple(
                StaffingRole(
                    id=role.id,
                    role=role.role,
                    required_qualification_id=role.required_qualification_id,
                    minimum_qualification_level=role.minimum_qualification_level,
                )
                for role in item.staffing_roles
            ),
        )
        for item in payload.rooms
    ]

    groups = [
        TeachingGroup(
            id=item.id,
            course=item.course_id,
            students=item.student_ids,
            duration_minutes=item.duration_minutes,
            allowed_rooms=frozenset(item.allowed_room_ids),
            room_penalties=dict(item.room_penalties),
            instructor_penalties=dict(item.instructor_penalties),
            staffing_roles=tuple(
                StaffingRole(
                    id=role.id,
                    role=role.role,
                    required_qualification_id=role.required_qualification_id,
                    minimum_qualification_level=role.minimum_qualification_level,
                )
                for role in item.staffing_roles
            ),
        )
        for item in payload.teaching_groups
    ]

    profile = LoadProfile(
        max_teaching_minutes_per_day=payload.student_load_profile.max_teaching_minutes_per_day,
        max_continuous_teaching_minutes=payload.student_load_profile.max_continuous_teaching_minutes,
        min_break_minutes=payload.student_load_profile.min_break_minutes,
        min_break_after_double_minutes=payload.student_load_profile.min_break_after_double_minutes,
        max_sessions_per_day=payload.student_load_profile.max_sessions_per_day,
        min_lunch_minutes=payload.student_load_profile.min_lunch_minutes,
        lunch_window_start=payload.student_load_profile.lunch_window_start,
        lunch_window_end=payload.student_load_profile.lunch_window_end,
        travel_consumes_break_time=payload.student_load_profile.travel_consumes_break_time,
    )

    travel_matrix = {
        (item.from_room_id, item.to_room_id): item.minutes
        for item in payload.travel
    }
    for room in rooms:
        travel_matrix[(room.id, room.id)] = 0

    return instructors, rooms, groups, profile, travel_matrix


def _run_single_day(payload: SolverInput) -> SolverOutput:
    if payload.date is None:
        raise ValueError("Single-day solver input is missing date")

    instructors, rooms, groups, profile, travel_matrix = _domain_resources(payload)

    result = solve_schedule(
        groups=groups,
        instructors=instructors,
        rooms=rooms,
        start_times=list(payload.start_times),
        travel_matrix=travel_matrix,
        student_profile=profile,
    )

    sessions = tuple(
        ScheduledSessionOutput(
            teaching_group_id=session.group.id,
            start_minute=session.start,
            end_minute=session.end,
            instructor_id=session.instructor.id,
            room_id=session.room.id,
            date=payload.date,
        )
        for session in result.sessions
    )

    total_teaching_minutes = sum(session.end - session.start for session in result.sessions)

    return SolverOutput(
        schema_version=payload.schema_version,
        tenant_id=payload.tenant_id,
        plan_scenario_id=payload.plan_scenario_id,
        status=result.status,
        objective_value=result.objective_value,
        sessions=sessions,
        metrics=(
            SolverMetricOutput("scheduledSessionCount", float(len(sessions)), "count"),
            SolverMetricOutput("scheduledTeachingMinutes", float(total_teaching_minutes), "minutes"),
        ),
        diagnostics={
            "date": payload.date,
            "inputTeachingGroupCount": len(payload.teaching_groups),
            "resourcePreferenceModel": payload.schema_version in {"1.1", "1.2"},
        },
    )


def _run_planning_horizon(payload: SolverInput) -> SolverOutput:
    if payload.planning_window is None:
        raise ValueError("Solver contract 1.2 requires planning_window")

    instructors, rooms, groups, profile, travel_matrix = _domain_resources(payload)

    instructor_blocks = [
        ResourceBlock(
            resource_id=item.resource_id,
            date=item.date,
            start_minute=item.start_minute,
            end_minute=item.end_minute,
        )
        for item in payload.instructor_blocks
    ]
    student_blocks = [
        ResourceBlock(
            resource_id=item.resource_id,
            date=item.date,
            start_minute=item.start_minute,
            end_minute=item.end_minute,
        )
        for item in payload.student_blocks
    ]
    room_blocks = [
        ResourceBlock(
            resource_id=item.resource_id,
            date=item.date,
            start_minute=item.start_minute,
            end_minute=item.end_minute,
        )
        for item in payload.room_blocks
    ]

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

    all_sessions: list[ScheduledSessionOutput] = []
    objective_total = 0.0
    week_statuses: dict[str, str] = {}

    for week_start in sorted(occurrences_by_week):
        occurrences = occurrences_by_week[week_start]
        allowed_dates = {
            date
            for occurrence in occurrences
            for date in occurrence.allowed_dates
        }

        result = solve_multi_day_week(
            occurrences=occurrences,
            groups=groups,
            instructors=instructors,
            rooms=rooms,
            start_times=list(payload.start_times),
            travel_matrix=travel_matrix,
            student_profile=profile,
            instructor_blocks=[block for block in instructor_blocks if block.date in allowed_dates],
            student_blocks=[block for block in student_blocks if block.date in allowed_dates],
            room_blocks=[block for block in room_blocks if block.date in allowed_dates],
        )

        week_statuses[week_start] = result.status
        if result.status not in {"OPTIMAL", "FEASIBLE"}:
            return SolverOutput(
                schema_version=payload.schema_version,
                tenant_id=payload.tenant_id,
                plan_scenario_id=payload.plan_scenario_id,
                status=result.status,
                objective_value=None,
                sessions=(),
                metrics=(),
                diagnostics={
                    "planningWindow": {
                        "asOfDate": payload.planning_window.as_of_date,
                        "frozenThroughDate": payload.planning_window.frozen_through_date,
                        "startDate": payload.planning_window.start_date,
                        "endDate": payload.planning_window.end_date,
                    },
                    "failedWeekStartDate": week_start,
                    "weekStatuses": week_statuses,
                },
            )

        objective_total += result.objective_value
        all_sessions.extend(
            ScheduledSessionOutput(
                occurrence_id=session.occurrence_id,
                teaching_group_id=session.group.id,
                date=session.date,
                start_minute=session.start,
                end_minute=session.end,
                instructor_id=session.instructors[0].id,
                room_id=session.room.id,
                instructor_ids=tuple(
                    instructor.id for instructor in session.instructors
                ),
                staffing_assignments=tuple(
                    StaffingAssignmentOutput(
                        role=role,
                        instructor_id=instructor.id,
                    )
                    for role, instructor in session.staffing_assignments
                ),
            )
            for session in result.sessions
        )

    total_minutes = sum(item.end_minute - item.start_minute for item in all_sessions)
    aggregate_status = (
        "OPTIMAL"
        if all(status == "OPTIMAL" for status in week_statuses.values())
        else "FEASIBLE"
    )

    return SolverOutput(
        schema_version=payload.schema_version,
        tenant_id=payload.tenant_id,
        plan_scenario_id=payload.plan_scenario_id,
        status=aggregate_status,
        objective_value=objective_total,
        sessions=tuple(all_sessions),
        metrics=(
            SolverMetricOutput("scheduledSessionCount", float(len(all_sessions)), "count"),
            SolverMetricOutput("scheduledTeachingMinutes", float(total_minutes), "minutes"),
            SolverMetricOutput("plannedWeekCount", float(len(week_statuses)), "count"),
        ),
        diagnostics={
            "planningWindow": {
                "asOfDate": payload.planning_window.as_of_date,
                "frozenThroughDate": payload.planning_window.frozen_through_date,
                "startDate": payload.planning_window.start_date,
                "endDate": payload.planning_window.end_date,
            },
            "inputTeachingOccurrenceCount": len(payload.teaching_occurrences),
            "plannedWeekCount": len(week_statuses),
            "weekStatuses": week_statuses,
            "resourcePreferenceModel": True,
            "planningHorizonModel": True,
        },
    )


def run_solver(payload: SolverInput) -> SolverOutput:
    if payload.schema_version in {"1.2", "1.3"}:
        return _run_planning_horizon(payload)
    return _run_single_day(payload)
