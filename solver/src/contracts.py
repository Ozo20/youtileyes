from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class InstructorInput:
    id: str
    name: str
    course_ids: tuple[str, ...]
    course_penalties: dict[str, int] = field(default_factory=dict)
    qualification_levels: dict[str, int] = field(default_factory=dict)
    course_qualification_levels: dict[str, str] = field(default_factory=dict)
    course_levels: dict[str, int] = field(default_factory=dict)
    course_validity: dict[str, list[str | None]] = field(default_factory=dict)
    qualification_validity: dict[str, list[str | None]] = field(default_factory=dict)


@dataclass(frozen=True)
class StaffingRoleInput:
    id: str
    role: str
    required_qualification_id: str | None = None
    minimum_qualification_level: int | None = None
    minimum_course_qualification_level: str | None = None
    minimum_course_level: int | None = None
    preferred_course_level: int | None = None
    minimum_student_count: int = 0
    hard: bool = True
    weight: int = 100
    valid_from: str | None = None
    valid_to: str | None = None


@dataclass(frozen=True)
class RoomInput:
    id: str
    name: str
    capacity: int
    staffing_roles: tuple[StaffingRoleInput, ...] = ()


@dataclass(frozen=True)
class TeachingGroupInput:
    id: str
    course_id: str
    student_ids: tuple[str, ...]
    duration_minutes: int
    allowed_room_ids: tuple[str, ...]
    room_penalties: dict[str, int] = field(default_factory=dict)
    instructor_penalties: dict[str, int] = field(default_factory=dict)
    staffing_roles: tuple[StaffingRoleInput, ...] = ()


@dataclass(frozen=True)
class LoadProfileInput:
    max_teaching_minutes_per_day: int | None = None
    max_continuous_teaching_minutes: int | None = None
    min_break_minutes: int = 0
    min_break_after_double_minutes: int = 0
    max_sessions_per_day: int | None = None
    min_lunch_minutes: int | None = None
    lunch_window_start: int | None = None
    lunch_window_end: int | None = None
    travel_consumes_break_time: bool = True


@dataclass(frozen=True)
class TravelInput:
    from_room_id: str
    to_room_id: str
    minutes: int


@dataclass(frozen=True)
class PlanningWindowInput:
    as_of_date: str
    frozen_through_date: str | None
    start_date: str
    end_date: str


@dataclass(frozen=True)
class CalendarDayInput:
    date: str
    teaching_allowed: bool


@dataclass(frozen=True)
class TeachingOccurrenceInput:
    id: str
    teaching_group_id: str
    week_start_date: str
    duration_minutes: int
    allowed_dates: tuple[str, ...]


@dataclass(frozen=True)
class ResourceBlockInput:
    resource_id: str
    date: str
    start_minute: int
    end_minute: int


@dataclass(frozen=True)
class SolverInput:
    schema_version: str
    tenant_id: str
    plan_scenario_id: str
    start_times: tuple[int, ...]
    instructors: tuple[InstructorInput, ...]
    rooms: tuple[RoomInput, ...]
    teaching_groups: tuple[TeachingGroupInput, ...]
    travel: tuple[TravelInput, ...]
    student_load_profile: LoadProfileInput
    metadata: dict[str, Any] = field(default_factory=dict)

    # 1.0/1.1 single-day compatibility.
    date: str | None = None

    # 1.2 planning-horizon fields.
    planning_window: PlanningWindowInput | None = None
    calendar_days: tuple[CalendarDayInput, ...] = ()
    teaching_occurrences: tuple[TeachingOccurrenceInput, ...] = ()
    instructor_blocks: tuple[ResourceBlockInput, ...] = ()
    student_blocks: tuple[ResourceBlockInput, ...] = ()
    room_blocks: tuple[ResourceBlockInput, ...] = ()
    placement_rules: tuple[dict[str, Any], ...] = ()
    student_break_rules: tuple[dict[str, Any], ...] = ()
    instructor_break_rules: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class StaffingAssignmentOutput:
    role: str
    instructor_id: str


@dataclass(frozen=True)
class ScheduledSessionOutput:
    teaching_group_id: str
    start_minute: int
    end_minute: int
    instructor_id: str
    room_id: str
    date: str | None = None
    occurrence_id: str | None = None
    instructor_ids: tuple[str, ...] = ()
    staffing_assignments: tuple[StaffingAssignmentOutput, ...] = ()


@dataclass(frozen=True)
class SolverMetricOutput:
    key: str
    value: float
    unit: str | None = None


@dataclass(frozen=True)
class SolverOutput:
    schema_version: str
    tenant_id: str
    plan_scenario_id: str
    status: str
    objective_value: float | None
    sessions: tuple[ScheduledSessionOutput, ...]
    metrics: tuple[SolverMetricOutput, ...] = ()
    diagnostics: dict[str, Any] = field(default_factory=dict)


def solver_output_to_dict(output: SolverOutput) -> dict[str, Any]:
    return asdict(output)
