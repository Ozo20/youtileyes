from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .contracts import (
    CalendarDayInput,
    InstructorInput,
    LoadProfileInput,
    PlanningWindowInput,
    ResourceBlockInput,
    RoomInput,
    StaffingRoleInput,
    SolverInput,
    SolverOutput,
    TeachingGroupInput,
    TeachingOccurrenceInput,
    TravelInput,
    solver_output_to_dict,
)


SUPPORTED_SCHEMA_VERSIONS = {"1.0", "1.1", "1.2", "1.3", "1.4"}


class SolverInputError(ValueError):
    pass


def _required(data: dict[str, Any], key: str) -> Any:
    if key not in data:
        raise SolverInputError(f"Missing required field: {key}")
    return data[key]


def _int_map(value: Any) -> dict[str, int]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise SolverInputError("Expected a JSON object containing integer penalties")
    return {str(key): int(item) for key, item in value.items()}


def _resource_blocks(items: Any) -> tuple[ResourceBlockInput, ...]:
    return tuple(
        ResourceBlockInput(
            resource_id=str(item["resourceId"]),
            date=str(item["date"]),
            start_minute=int(item["startMinute"]),
            end_minute=int(item["endMinute"]),
        )
        for item in (items or [])
    )


def _placement_rules(items: Any) -> tuple[dict[str, Any], ...]:
    if not isinstance(items, list):
        raise SolverInputError("placementRules must be an array")
    result = []
    from datetime import date
    for item in items:
        if not isinstance(item, dict):
            raise SolverInputError("Invalid placement rule")
        for key in ("ruleId", "name", "date"):
            if not isinstance(item.get(key), str) or not item[key]:
                raise SolverInputError(f"Invalid placement rule {key}")
        try:
            date.fromisoformat(item["date"])
        except ValueError as exc:
            raise SolverInputError("Invalid placement rule date") from exc
        if any(type(item.get(key)) is not int for key in ("startMinute", "endMinute", "weight")):
            raise SolverInputError("Placement times and weights must be integers")
        if not 0 <= item["startMinute"] < item["endMinute"] <= 1440 or item["weight"] < 0:
            raise SolverInputError("Invalid placement interval or weight")
        if type(item.get("hard")) is not bool:
            raise SolverInputError("Placement hard must be boolean")
        result.append(dict(item))
    return tuple(result)


def _student_break_rules(items: Any) -> tuple[dict[str, Any], ...]:
    if not isinstance(items, list):
        raise SolverInputError("studentBreakRules must be an array")

    result: list[dict[str, Any]] = []

    from datetime import date

    for item in items:
        if not isinstance(item, dict):
            raise SolverInputError("Invalid student break rule")

        for key in ("ruleId", "name", "date"):
            if not isinstance(item.get(key), str) or not item[key]:
                raise SolverInputError(f"Invalid student break rule {key}")

        try:
            date.fromisoformat(item["date"])
        except ValueError as exc:
            raise SolverInputError("Invalid student break rule date") from exc

        if type(item.get("minBreakMinutes")) is not int:
            raise SolverInputError("Student break minimum must be an integer")

        if not 0 <= item["minBreakMinutes"] <= 240:
            raise SolverInputError("Student break minimum must be 0-240 minutes")

        if type(item.get("weight")) is not int or item["weight"] < 0:
            raise SolverInputError("Student break weight must be a non-negative integer")

        if type(item.get("hard")) is not bool:
            raise SolverInputError("Student break hard must be boolean")

        for key in ("studentId", "groupId", "courseId"):
            if key in item and item[key] is not None and not isinstance(item[key], str):
                raise SolverInputError(f"Invalid student break rule {key}")

        result.append(dict(item))

    return tuple(result)


def _instructor_break_rules(items: Any) -> tuple[dict[str, Any], ...]:
    if not isinstance(items, list):
        raise SolverInputError("instructorBreakRules must be an array")

    result: list[dict[str, Any]] = []

    from datetime import date

    for item in items:
        if not isinstance(item, dict):
            raise SolverInputError("Invalid instructor break rule")

        for key in ("ruleId", "name", "date", "instructorId"):
            if not isinstance(item.get(key), str) or not item[key]:
                raise SolverInputError(f"Invalid instructor break rule {key}")

        try:
            date.fromisoformat(item["date"])
        except ValueError as exc:
            raise SolverInputError("Invalid instructor break rule date") from exc

        if type(item.get("minBreakMinutes")) is not int:
            raise SolverInputError("Instructor break minimum must be an integer")

        if not 0 <= item["minBreakMinutes"] <= 240:
            raise SolverInputError("Instructor break minimum must be 0-240 minutes")

        if type(item.get("weight")) is not int or item["weight"] < 0:
            raise SolverInputError(
                "Instructor break weight must be a non-negative integer"
            )

        if type(item.get("hard")) is not bool:
            raise SolverInputError("Instructor break hard must be boolean")

        result.append(dict(item))

    return tuple(result)


def solver_input_from_dict(data: dict[str, Any]) -> SolverInput:
    schema_version = str(_required(data, "schemaVersion"))

    if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        supported = ", ".join(sorted(SUPPORTED_SCHEMA_VERSIONS))
        raise SolverInputError(
            f"Unsupported schemaVersion {schema_version!r}; supported versions: {supported}"
        )

    instructors = tuple(
        InstructorInput(
            id=str(item["id"]),
            name=str(item["name"]),
            course_ids=tuple(str(value) for value in item["courseIds"]),
            course_penalties=_int_map(item.get("coursePenalties")),
            qualification_levels=_int_map(item.get("qualificationLevels")),
            course_qualification_levels={
                str(key): str(value)
                for key, value in item.get("courseQualificationLevels", {}).items()
            },
            course_levels=_int_map(item.get("courseLevels")),
            course_validity=dict(item.get("courseValidity", {})),
            qualification_validity=dict(item.get("qualificationValidity", {})),
        )
        for item in _required(data, "instructors")
    )

    rooms = tuple(
        RoomInput(
            id=str(item["id"]),
            name=str(item["name"]),
            capacity=int(item["capacity"]),
            staffing_roles=tuple(
                StaffingRoleInput(
                    id=str(role["id"]),
                    role=str(role["role"]),
                    minimum_course_level=role.get("minimumCourseLevel"),
                    preferred_course_level=role.get("preferredCourseLevel"),
                    minimum_student_count=int(role.get("minimumStudentCount") or 0),
                    hard=role.get("hard", True),
                    weight=int(role.get("weight", 100)),
                    valid_from=role.get("validFrom"),
                    valid_to=role.get("validTo"),
                    required_qualification_id=(
                        str(role["requiredQualificationId"])
                        if role.get("requiredQualificationId") is not None
                        else None
                    ),
                    minimum_qualification_level=(
                        int(role["minimumQualificationLevel"])
                        if role.get("minimumQualificationLevel") is not None
                        else None
                    ),
                    minimum_course_qualification_level=(
                        str(role["minimumCourseQualificationLevel"])
                        if role.get("minimumCourseQualificationLevel") is not None
                        else None
                    ),
                )
                for role in item.get("staffingRoles", [])
            ),
        )
        for item in _required(data, "rooms")
    )

    teaching_groups = tuple(
        TeachingGroupInput(
            id=str(item["id"]),
            course_id=str(item["courseId"]),
            student_ids=tuple(str(value) for value in item["studentIds"]),
            duration_minutes=int(item["durationMinutes"]),
            allowed_room_ids=tuple(str(value) for value in item["allowedRoomIds"]),
            room_penalties=_int_map(item.get("roomPenalties")),
            instructor_penalties=_int_map(item.get("instructorPenalties")),
            staffing_roles=tuple(
                StaffingRoleInput(
                    id=str(role["id"]),
                    role=str(role["role"]),
                    minimum_course_level=role.get("minimumCourseLevel"),
                    preferred_course_level=role.get("preferredCourseLevel"),
                    minimum_student_count=int(role.get("minimumStudentCount") or 0),
                    hard=role.get("hard", True),
                    weight=int(role.get("weight", 100)),
                    valid_from=role.get("validFrom"),
                    valid_to=role.get("validTo"),
                    required_qualification_id=(
                        str(role["requiredQualificationId"])
                        if role.get("requiredQualificationId") is not None
                        else None
                    ),
                    minimum_qualification_level=(
                        int(role["minimumQualificationLevel"])
                        if role.get("minimumQualificationLevel") is not None
                        else None
                    ),
                    minimum_course_qualification_level=(
                        str(role["minimumCourseQualificationLevel"])
                        if role.get("minimumCourseQualificationLevel") is not None
                        else None
                    ),
                )
                for role in item.get("staffingRoles", [])
            ),
        )
        for item in _required(data, "teachingGroups")
    )

    travel = tuple(
        TravelInput(
            from_room_id=str(item["fromRoomId"]),
            to_room_id=str(item["toRoomId"]),
            minutes=int(item["minutes"]),
        )
        for item in data.get("travel", [])
    )

    profile = _required(data, "studentLoadProfile")
    student_load_profile = LoadProfileInput(
        max_teaching_minutes_per_day=profile.get("maxTeachingMinutesPerDay"),
        max_continuous_teaching_minutes=profile.get("maxContinuousTeachingMinutes"),
        min_break_minutes=int(profile.get("minBreakMinutes", 0)),
        min_break_after_double_minutes=int(profile.get("minBreakAfterDoubleMinutes", 0)),
        max_sessions_per_day=profile.get("maxSessionsPerDay"),
        min_lunch_minutes=profile.get("minLunchMinutes"),
        lunch_window_start=profile.get("lunchWindowStart"),
        lunch_window_end=profile.get("lunchWindowEnd"),
        travel_consumes_break_time=bool(profile.get("travelConsumesBreakTime", True)),
    )

    planning_window = None
    calendar_days: tuple[CalendarDayInput, ...] = ()
    teaching_occurrences: tuple[TeachingOccurrenceInput, ...] = ()
    instructor_blocks: tuple[ResourceBlockInput, ...] = ()
    student_blocks: tuple[ResourceBlockInput, ...] = ()
    room_blocks: tuple[ResourceBlockInput, ...] = ()

    if schema_version in {"1.2", "1.3", "1.4"}:
        window = _required(data, "planningWindow")
        planning_window = PlanningWindowInput(
            as_of_date=str(_required(window, "asOfDate")),
            frozen_through_date=(
                str(window["frozenThroughDate"])
                if window.get("frozenThroughDate") is not None
                else None
            ),
            start_date=str(_required(window, "startDate")),
            end_date=str(_required(window, "endDate")),
        )

        calendar_days = tuple(
            CalendarDayInput(
                date=str(item["date"]),
                teaching_allowed=bool(item["teachingAllowed"]),
            )
            for item in _required(data, "calendarDays")
        )

        teaching_occurrences = tuple(
            TeachingOccurrenceInput(
                id=str(item["id"]),
                teaching_group_id=str(item["teachingGroupId"]),
                week_start_date=str(item["weekStartDate"]),
                duration_minutes=int(item["durationMinutes"]),
                allowed_dates=tuple(str(value) for value in item["allowedDates"]),
            )
            for item in _required(data, "teachingOccurrences")
        )

        blocks = data.get("resourceBlocks", {})
        instructor_blocks = _resource_blocks(blocks.get("instructors"))
        student_blocks = _resource_blocks(blocks.get("students"))
        room_blocks = _resource_blocks(blocks.get("rooms"))

    date = str(data["date"]) if data.get("date") is not None else None
    if schema_version in {"1.0", "1.1"} and date is None:
        raise SolverInputError("Single-day solver contracts require field: date")

    return SolverInput(
        schema_version=schema_version,
        tenant_id=str(_required(data, "tenantId")),
        plan_scenario_id=str(_required(data, "planScenarioId")),
        date=date,
        start_times=tuple(int(value) for value in _required(data, "startTimes")),
        latest_end_minute=(
            int(data["latestEndMinute"])
            if data.get("latestEndMinute") is not None
            else None
        ),
        instructors=instructors,
        rooms=rooms,
        teaching_groups=teaching_groups,
        travel=travel,
        student_load_profile=student_load_profile,
        metadata=dict(data.get("metadata", {})),
        planning_window=planning_window,
        calendar_days=calendar_days,
        teaching_occurrences=teaching_occurrences,
        instructor_blocks=instructor_blocks,
        student_blocks=student_blocks,
        room_blocks=room_blocks,
        placement_rules=_placement_rules(data.get("placementRules", [])),
        student_break_rules=_student_break_rules(data.get("studentBreakRules", [])),
        instructor_break_rules=_instructor_break_rules(
            data.get("instructorBreakRules", [])
        ),
    )


def load_solver_input(path: str | Path) -> SolverInput:
    source = Path(path)
    return solver_input_from_dict(json.loads(source.read_text(encoding="utf-8")))


def write_solver_output(output: SolverOutput, path: str | Path) -> None:
    target = Path(path)
    target.write_text(
        json.dumps(solver_output_to_dict(output), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
