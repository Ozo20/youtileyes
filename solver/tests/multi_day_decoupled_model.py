from solver.src.models import Instructor, LoadProfile, Room, TeachingGroup
from solver.src.multi_day import MultiDayOccurrence, ResourceBlock, solve_multi_day_week


def test_preferences() -> None:
    instructors = [
        Instructor(
            id="T1",
            name="Preferred",
            courses=frozenset({"MAT"}),
            course_penalties={"MAT": 0},
        ),
        Instructor(
            id="T2",
            name="Fallback",
            courses=frozenset({"MAT"}),
            course_penalties={"MAT": 40},
        ),
    ]
    rooms = [
        Room(id="R1", name="Preferred room", capacity=30),
        Room(id="R2", name="Fallback room", capacity=30),
    ]
    group = TeachingGroup(
        id="G1",
        course="MAT",
        students=("S1", "S2"),
        duration_minutes=45,
        allowed_rooms=frozenset({"R1", "R2"}),
        room_penalties={"R1": 0, "R2": 50},
        instructor_penalties={"T1": 0, "T2": 50},
    )

    result = solve_multi_day_week(
        occurrences=[
            MultiDayOccurrence(
                id="O1",
                teaching_group_id="G1",
                duration_minutes=45,
                allowed_dates=("2026-09-14",),
            )
        ],
        groups=[group],
        instructors=instructors,
        rooms=rooms,
        start_times=[495, 540],
        travel_matrix={},
        student_profile=LoadProfile(),
        max_time_seconds=5,
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert len(result.sessions) == 1
    assert result.sessions[0].room.id == "R1"
    assert result.sessions[0].instructors[0].id == "T1"


def test_instructor_block() -> None:
    instructors = [
        Instructor(id="T1", name="Blocked", courses=frozenset({"MAT"})),
        Instructor(id="T2", name="Available", courses=frozenset({"MAT"})),
    ]
    room = Room(id="R1", name="Room", capacity=30)
    group = TeachingGroup(
        id="G1",
        course="MAT",
        students=("S1",),
        duration_minutes=45,
        allowed_rooms=frozenset({"R1"}),
    )

    result = solve_multi_day_week(
        occurrences=[
            MultiDayOccurrence(
                id="O1",
                teaching_group_id="G1",
                duration_minutes=45,
                allowed_dates=("2026-09-14",),
            )
        ],
        groups=[group],
        instructors=instructors,
        rooms=[room],
        start_times=[495],
        travel_matrix={},
        student_profile=LoadProfile(),
        instructor_blocks=[
            ResourceBlock(
                resource_id="T1",
                date="2026-09-14",
                start_minute=0,
                end_minute=24 * 60,
            )
        ],
        max_time_seconds=5,
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert len(result.sessions) == 1
    assert result.sessions[0].instructors[0].id == "T2"


def main() -> None:
    test_preferences()
    test_instructor_block()
    print("Decoupled multi-day model tests: PASS")


if __name__ == "__main__":
    main()
