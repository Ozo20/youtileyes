from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class InstructorInput:
   id: str
   name: str
   course_ids: tuple[str, ...]


@dataclass(frozen=True)
class RoomInput:
   id: str
   name: str
   capacity: int


@dataclass(frozen=True)
class TeachingGroupInput:
   id: str
   course_id: str
   student_ids: tuple[str, ...]
   duration_minutes: int
   allowed_room_ids: tuple[str, ...]


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
class SolverInput:
   schema_version: str
   tenant_id: str
   plan_scenario_id: str
   date: str
   start_times: tuple[int, ...]
   instructors: tuple[InstructorInput, ...]
   rooms: tuple[RoomInput, ...]
   teaching_groups: tuple[TeachingGroupInput, ...]
   travel: tuple[TravelInput, ...]
   student_load_profile: LoadProfileInput
   metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ScheduledSessionOutput:
   teaching_group_id: str
   start_minute: int
   end_minute: int
   instructor_id: str
   room_id: str


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
