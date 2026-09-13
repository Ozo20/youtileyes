"""Behavioural tests for hard and soft instructor break rules."""

from solver.src.models import Instructor, LoadProfile, Room, TeachingGroup
from solver.src.multi_day import MultiDayOccurrence, solve_multi_day_week


DATE = "2026-09-14"


def rule(**overrides):
    return {
        "ruleId": "teacher-break",
        "name": "Teacher break",
        "date": DATE,
        "minBreakMinutes": 30,
        "hard": False,
        "weight": 100,
        "instructorId": "T1",
    } | overrides


def make_domain(*, travel_rooms: bool = False):
    instructors = [
        Instructor(
            "T1",
            "Teacher 1",
            frozenset({"C1", "C2"}),
        ),
    ]

    if travel_rooms:
        rooms = [
            Room("R1", "Room 1", 30),
            Room("R2", "Room 2", 30),
        ]
        g1_rooms = frozenset({"R1"})
        g2_rooms = frozenset({"R2"})
    else:
        rooms = [Room("R", "Room", 30)]
        g1_rooms = frozenset({"R"})
        g2_rooms = frozenset({"R"})

    groups = [
        TeachingGroup(
            "G1",
            "C1",
            ("S1",),
            45,
            g1_rooms,
        ),
        TeachingGroup(
            "G2",
            "C2",
            ("S2",),
            45,
            g2_rooms,
        ),
    ]

    occurrences = [
        MultiDayOccurrence("O1", "G1", 45, (DATE,)),
        MultiDayOccurrence("O2", "G2", 45, (DATE,)),
    ]

    return instructors, rooms, groups, occurrences


def ordered(result):
    return sorted(result.sessions, key=lambda item: item.start)


# ------------------------------------------------------------------
# HARD: same teacher needs 30 real free minutes between lessons.
# ------------------------------------------------------------------
instructors, rooms, groups, occurrences = make_domain()

result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 525, 555],
    travel_matrix={},
    student_profile=LoadProfile(),
    instructor_break_rules=[rule(hard=True)],
    max_time_seconds=3,
)

assert result.status in {"OPTIMAL", "FEASIBLE"}, result
sessions = ordered(result)
assert sessions[1].start - sessions[0].end >= 30, sessions


# Only back-to-back placement remains: hard rule must make it infeasible.
result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 525],
    travel_matrix={},
    student_profile=LoadProfile(),
    instructor_break_rules=[rule(hard=True)],
    max_time_seconds=3,
)

assert result.status == "INFEASIBLE", result


# ------------------------------------------------------------------
# SOFT: back-to-back remains feasible but costs 30 * 100.
# ------------------------------------------------------------------
result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 525],
    travel_matrix={},
    student_profile=LoadProfile(),
    instructor_break_rules=[rule()],
    max_time_seconds=3,
)

assert result.status in {"OPTIMAL", "FEASIBLE"}, result

violations = result.diagnostics.get("instructorBreakViolations", [])
assert len(violations) == 1, violations

violation = violations[0]
assert violation["instructorId"] == "T1", violation
assert violation["requiredMinutes"] == 30, violation
assert violation["actualBreakMinutes"] == 0, violation
assert violation["deficitMinutes"] == 30, violation
assert violation["penalty"] == 3000, violation

# 08:00 contributes 0, 08:45 contributes 3, break deficit contributes 3000.
assert result.objective_value == 3003, result.objective_value


# ------------------------------------------------------------------
# Travel consumes the clock gap before instructor free time is counted.
# 30-minute clock gap - 15-minute travel = 15-minute real break.
# ------------------------------------------------------------------
instructors, rooms, groups, occurrences = make_domain(travel_rooms=True)

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
    student_profile=LoadProfile(),
    instructor_break_rules=[rule()],
    max_time_seconds=3,
)

assert result.status in {"OPTIMAL", "FEASIBLE"}, result

violations = result.diagnostics.get("instructorBreakViolations", [])
assert len(violations) == 1, violations

violation = violations[0]
assert violation["travelMinutes"] == 15, violation
assert violation["actualBreakMinutes"] == 15, violation
assert violation["deficitMinutes"] == 15, violation
assert violation["penalty"] == 1500, violation


# ------------------------------------------------------------------
# Rule follows the selected teacher, not merely a possible candidate.
# With two interchangeable teachers, the solver can avoid assigning T1
# to both lessons instead of paying T1's soft break penalty.
# ------------------------------------------------------------------
instructors = [
    Instructor("T1", "Teacher 1", frozenset({"C1", "C2"})),
    Instructor("T2", "Teacher 2", frozenset({"C1", "C2"})),
]
rooms = [Room("R", "Room", 30)]
groups = [
    TeachingGroup("G1", "C1", ("S1",), 45, frozenset({"R"})),
    TeachingGroup("G2", "C2", ("S2",), 45, frozenset({"R"})),
]
occurrences = [
    MultiDayOccurrence("O1", "G1", 45, (DATE,)),
    MultiDayOccurrence("O2", "G2", 45, (DATE,)),
]

result = solve_multi_day_week(
    occurrences=occurrences,
    groups=groups,
    instructors=instructors,
    rooms=rooms,
    start_times=[480, 525],
    travel_matrix={},
    student_profile=LoadProfile(),
    instructor_break_rules=[rule()],
    max_time_seconds=3,
)

assert result.status in {"OPTIMAL", "FEASIBLE"}, result

assigned = [
    session.instructors[0].id
    for session in ordered(result)
]
assert assigned != ["T1", "T1"], assigned
assert result.diagnostics.get("instructorBreakViolations", []) == [], (
    result.diagnostics
)

print("Instructor break preference tests: PASS")
