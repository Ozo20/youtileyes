from solver.src.models import Instructor, LoadProfile, Room, TeachingGroup
from solver.src.scheduler import solve_schedule
from solver.src.time_utils import clock


def main() -> None:
    instructors = [
        Instructor(
            "T1",
            "Primary teacher",
            frozenset({"MAT"}),
            course_penalties={"MAT": 0},
        ),
        Instructor(
            "T2",
            "Fallback teacher",
            frozenset({"MAT"}),
            course_penalties={"MAT": 30},
        ),
    ]

    rooms = [
        Room("A10", "A10", 10),
        Room("B14", "B14", 10),
    ]

    groups = [
        TeachingGroup(
            "G1",
            "MAT",
            ("S1", "S2"),
            45,
            frozenset({"A10", "B14"}),
            room_penalties={"A10": 0, "B14": 90},
            instructor_penalties={"T1": -20, "T2": 120},
        )
    ]

    result = solve_schedule(
        groups=groups,
        instructors=instructors,
        rooms=rooms,
        start_times=[clock(8, 15)],
        travel_matrix={},
        student_profile=LoadProfile(),
    )

    if result.status not in ("OPTIMAL", "FEASIBLE"):
        raise SystemExit(f"Unexpected solver status: {result.status}")

    if len(result.sessions) != 1:
        raise SystemExit("Expected exactly one scheduled session")

    session = result.sessions[0]

    if session.instructor.id != "T1":
        raise SystemExit(
            f"Expected preferred primary instructor T1, got {session.instructor.id}"
        )

    if session.room.id != "A10":
        raise SystemExit(
            f"Expected preferred room A10, got {session.room.id}"
        )

    print("Resource preference test: PASS")


if __name__ == "__main__":
    main()
