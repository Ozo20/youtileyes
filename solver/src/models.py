from dataclasses import dataclass, field


@dataclass(frozen=True)
class Instructor:
    id: str
    name: str
    courses: frozenset[str]
    course_penalties: dict[str, int] = field(default_factory=dict)
    qualification_levels: dict[str, int] = field(default_factory=dict)
    course_levels: dict[str, int] = field(default_factory=dict)
    course_validity: dict[str, list[str | None]] = field(default_factory=dict)
    qualification_validity: dict[str, list[str | None]] = field(default_factory=dict)


@dataclass(frozen=True)
class StaffingRole:
    id: str
    role: str
    required_qualification_id: str | None = None
    minimum_qualification_level: int | None = None
    minimum_course_level: int | None = None
    preferred_course_level: int | None = None
    minimum_student_count: int = 0
    hard: bool = True
    weight: int = 100
    valid_from: str | None = None
    valid_to: str | None = None


@dataclass(frozen=True)
class Room:
    id: str
    name: str
    capacity: int
    staffing_roles: tuple[StaffingRole, ...] = ()


@dataclass(frozen=True)
class TeachingGroup:
    id: str
    course: str
    students: tuple[str, ...]
    duration_minutes: int
    allowed_rooms: frozenset[str]
    room_penalties: dict[str, int] = field(default_factory=dict)
    instructor_penalties: dict[str, int] = field(default_factory=dict)
    staffing_roles: tuple[StaffingRole, ...] = ()


@dataclass(frozen=True)
class Candidate:
    group_id: str
    start: int
    end: int
    instructor_id: str
    room_id: str
    assignment_penalty: int = 0


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
