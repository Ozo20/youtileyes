from dataclasses import dataclass


@dataclass(frozen=True)
class Instructor:
   id: str
   name: str
   courses: frozenset[str]


@dataclass(frozen=True)
class Room:
   id: str
   name: str
   capacity: int


@dataclass(frozen=True)
class TeachingGroup:
   id: str
   course: str
   students: tuple[str, ...]
   duration_minutes: int
   allowed_rooms: frozenset[str]


@dataclass(frozen=True)
class Candidate:
   group_id: str
   start: int
   end: int
   instructor_id: str
   room_id: str


@dataclass(frozen=True)
class LoadProfile:
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
class ScheduledSession:
   group: TeachingGroup
   start: int
   end: int
   instructor: Instructor
   room: Room
