"""Behavioural tests for scoped hard and soft student break rules."""

from solver.src.models import Instructor, LoadProfile, Room, TeachingGroup
from solver.src.multi_day import MultiDayOccurrence, solve_multi_day_week


DATE = "2026-09-14"


def setup(*, rooms: list[Room] | None = None):
    instructors = [
        Instructor("T1", "Teacher 1", frozenset({"C1"})),
        Instructor("T2", "Teacher 2", frozenset({"C2"})),
    ]

    actual_rooms = rooms or [
        Room("R", "Room", 30),
    ]

    allowed_first = frozenset({"R1"}) if len(actual_rooms) > 1 else frozenset({"R"})
    allowed_second = frozenset({"R2"}) if len(actual_rooms) > 1 else frozenset({"R"})

    groups = [
        TeachingGroup(
            "G1",
            "C1",
            ("S1",),
            45,
            allowed_first,
        ),
        TeachingGroup(
            "G2",
            "C2",
            ("S1",),
            45,
            allowed_second,
        ),
    ]

    occurrences = [
        MultiDayOccurrence("O1", "G1", 45, (DATE,)),
        MultiDayOccurrence("O2", "G2", 45, (DATE,)),
    ]

    return instructors, actual_rooms, groups, occurrences


def rule(**overrides):
    return {
        "ruleId": "break-1",
        "name": "Preferred break",
        "date": DATE,
        "minBreakMinutes": 30,
        "hard": False,
        "weight": 100,
    } | overrides


def real_break(result, travel: int = 0) -> int:
    sessions = sorted(result.sessions, key=lambda item: item.start)
    return sessions[1].start - sessions[0].end - travel


# ------------------------------------------------------------------
# HARD: a scoped rule must change feasibility/placement.
# ------------------------------------------------------------------
instructors, rooms, groups, occurrences = setup()

result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 525, 555],
    travel_matrix={},
    student_profile=LoadProfile(min_break_minutes=0),
    student_break_rules=[rule(hard=True)],
    max_time_seconds=3,
)

assert result.status in {"OPTIMAL", "FEASIBLE"}, result
assert real_break(result) >= 30, result.sessions


# With only back-to-back slots, the hard rule makes the plan infeasible.
result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 525],
    travel_matrix={},
    student_profile=LoadProfile(min_break_minutes=0),
    student_break_rules=[rule(hard=True)],
    max_time_seconds=3,
)

assert result.status == "INFEASIBLE", result


# ------------------------------------------------------------------
# SOFT: insufficient break remains feasible and carries a penalty.
# ------------------------------------------------------------------
result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 525],
    travel_matrix={},
    student_profile=LoadProfile(min_break_minutes=0),
    student_break_rules=[rule()],
    max_time_seconds=3,
)

assert result.status in {"OPTIMAL", "FEASIBLE"}, result
assert real_break(result) == 0, result.sessions

violations = result.diagnostics.get("studentBreakViolations", [])
assert len(violations) == 1, violations

violation = violations[0]
assert violation["requiredMinutes"] == 30, violation
assert violation["actualBreakMinutes"] == 0, violation
assert violation["deficitMinutes"] == 30, violation
assert violation["penalty"] == 3000, violation

# Start-time quality contributes 3 (08:45 is three 15-minute units after 08:00)
# and the break deficit contributes 30 * 100.
assert result.objective_value == 3003, result.objective_value


# ------------------------------------------------------------------
# Travel consumes break time.
# Clock gap is 30 minutes, but 15 minutes travel leaves only 15 free.
# ------------------------------------------------------------------
travel_rooms = [
    Room("R1", "Room 1", 30),
    Room("R2", "Room 2", 30),
]

instructors, rooms, groups, occurrences = setup(rooms=travel_rooms)

result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 555],
    travel_matrix={
        ("R1", "R1"): 0,
        ("R2", "R2"): 0,
        ("R1", "R2"): 15,
        ("R2", "R1"): 15,
    },
    student_profile=LoadProfile(
        min_break_minutes=0,
        travel_consumes_break_time=True,
    ),
    student_break_rules=[rule()],
    max_time_seconds=3,
)

assert result.status in {"OPTIMAL", "FEASIBLE"}, result
assert real_break(result, travel=15) == 15, result.sessions

violations = result.diagnostics.get("studentBreakViolations", [])
assert len(violations) == 1, violations

violation = violations[0]
assert violation["travelMinutes"] == 15, violation
assert violation["actualBreakMinutes"] == 15, violation
assert violation["deficitMinutes"] == 15, violation
assert violation["penalty"] == 1500, violation


# ------------------------------------------------------------------
# Student-specific rule only applies when that student is shared.
# ------------------------------------------------------------------
result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 555],
    travel_matrix={
        ("R1", "R2"): 15,
        ("R2", "R1"): 15,
    },
    student_profile=LoadProfile(
        min_break_minutes=0,
        travel_consumes_break_time=True,
    ),
    student_break_rules=[rule(studentId="OTHER")],
    max_time_seconds=3,
)

assert result.diagnostics.get("studentBreakViolations", []) == [], result.diagnostics

print("Student break preference tests: PASS")
