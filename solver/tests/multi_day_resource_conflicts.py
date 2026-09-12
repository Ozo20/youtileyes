from solver.src.models import (
    Instructor,
    LoadProfile,
    Room,
    TeachingGroup,
)
from solver.src.multi_day import (
    MultiDayOccurrence,
    solve_multi_day_week,
)


def test_student_break_and_travel() -> None:
    """
    Two teaching groups share one student.

    The first lesson lasts until 09:00. With 15 minutes required break
    and 15 minutes travel between the rooms, the second lesson cannot
    start before 09:30.
    """
    instructors = [
        Instructor(
            id="T1",
            name="Teacher 1",
            courses=frozenset({"C1"}),
        ),
        Instructor(
            id="T2",
            name="Teacher 2",
            courses=frozenset({"C2"}),
        ),
    ]

    rooms = [
        Room(id="R1", name="Room 1", capacity=30),
        Room(id="R2", name="Room 2", capacity=30),
    ]

    groups = [
        TeachingGroup(
            id="G1",
            course="C1",
            students=("S1",),
            duration_minutes=45,
            allowed_rooms=frozenset({"R1"}),
        ),
        TeachingGroup(
            id="G2",
            course="C2",
            students=("S1",),
            duration_minutes=45,
            allowed_rooms=frozenset({"R2"}),
        ),
    ]

    result = solve_multi_day_week(
        occurrences=[
            MultiDayOccurrence(
                id="O1",
                teaching_group_id="G1",
                duration_minutes=45,
                allowed_dates=("2026-09-14",),
            ),
            MultiDayOccurrence(
                id="O2",
                teaching_group_id="G2",
                duration_minutes=45,
                allowed_dates=("2026-09-14",),
            ),
        ],
        groups=groups,
        instructors=instructors,
        rooms=rooms,
        start_times=[495, 555, 585],
        travel_matrix={
            ("R1", "R1"): 0,
            ("R2", "R2"): 0,
            ("R1", "R2"): 15,
            ("R2", "R1"): 15,
        },
        student_profile=LoadProfile(
            min_break_minutes=15,
            travel_consumes_break_time=True,
        ),
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert len(result.sessions) == 2

    sessions = sorted(result.sessions, key=lambda item: item.start)

    first = sessions[0]
    second = sessions[1]

    travel = 15 if first.room.id != second.room.id else 0
    real_break = second.start - first.end - travel

    assert real_break >= 15, (
        f"Expected at least 15 minutes real student break, "
        f"got {real_break}"
    )


def test_instructor_travel() -> None:
    """
    One instructor teaches two groups in different rooms.

    The instructor must have enough time to travel between the rooms.
    """
    instructor = Instructor(
        id="T1",
        name="Teacher",
        courses=frozenset({"C1", "C2"}),
    )

    rooms = [
        Room(id="R1", name="Room 1", capacity=30),
        Room(id="R2", name="Room 2", capacity=30),
    ]

    groups = [
        TeachingGroup(
            id="G1",
            course="C1",
            students=("S1",),
            duration_minutes=45,
            allowed_rooms=frozenset({"R1"}),
        ),
        TeachingGroup(
            id="G2",
            course="C2",
            students=("S2",),
            duration_minutes=45,
            allowed_rooms=frozenset({"R2"}),
        ),
    ]

    result = solve_multi_day_week(
        occurrences=[
            MultiDayOccurrence(
                id="O1",
                teaching_group_id="G1",
                duration_minutes=45,
                allowed_dates=("2026-09-14",),
            ),
            MultiDayOccurrence(
                id="O2",
                teaching_group_id="G2",
                duration_minutes=45,
                allowed_dates=("2026-09-14",),
            ),
        ],
        groups=groups,
        instructors=[instructor],
        rooms=rooms,
        start_times=[495, 540, 555],
        travel_matrix={
            ("R1", "R1"): 0,
            ("R2", "R2"): 0,
            ("R1", "R2"): 15,
            ("R2", "R1"): 15,
        },
        student_profile=LoadProfile(),
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert len(result.sessions) == 2

    sessions = sorted(result.sessions, key=lambda item: item.start)

    first = sessions[0]
    second = sessions[1]

    assert second.start - first.end >= 15, (
        "Instructor was scheduled without sufficient travel time."
    )


def main() -> None:
    test_student_break_and_travel()
    test_instructor_travel()
    print("Multi-day resource conflict tests: PASS")


if __name__ == "__main__":
    main()
