from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .contracts import (
    InstructorInput,
    LoadProfileInput,
    RoomInput,
    SolverInput,
    SolverOutput,
    TeachingGroupInput,
    TravelInput,
    solver_output_to_dict,
)


SUPPORTED_SCHEMA_VERSIONS = {"1.0", "1.1"}


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
        )
        for item in _required(data, "instructors")
    )

    rooms = tuple(
        RoomInput(
            id=str(item["id"]),
            name=str(item["name"]),
            capacity=int(item["capacity"]),
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

    return SolverInput(
        schema_version=schema_version,
        tenant_id=str(_required(data, "tenantId")),
        plan_scenario_id=str(_required(data, "planScenarioId")),
        date=str(_required(data, "date")),
        start_times=tuple(int(value) for value in _required(data, "startTimes")),
        instructors=instructors,
        rooms=rooms,
        teaching_groups=teaching_groups,
        travel=travel,
        student_load_profile=student_load_profile,
        metadata=dict(data.get("metadata", {})),
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
