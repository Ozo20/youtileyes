from solver.src.models import Instructor, LoadProfile, Room, TeachingGroup
from solver.src.multi_day import MultiDayOccurrence, ResourceBlock, solve_multi_day_week

instructor = Instructor(id="i1", name="Teacher", courses=frozenset({"c1"}))
room = Room(id="r1", name="Room", capacity=30)
group = TeachingGroup(
    id="g1",
    course="c1",
    students=("s1", "s2"),
    duration_minutes=45,
    allowed_rooms=frozenset({"r1"}),
)

result = solve_multi_day_week(
    occurrences=[
        MultiDayOccurrence(
            id="occ1",
            teaching_group_id="g1",
            duration_minutes=45,
            allowed_dates=("2026-09-14", "2026-09-15"),
        ),
        MultiDayOccurrence(
            id="occ2",
            teaching_group_id="g1",
            duration_minutes=45,
            allowed_dates=("2026-09-14", "2026-09-15"),
        ),
    ],
    groups=[group],
    instructors=[instructor],
    rooms=[room],
    start_times=[495, 540, 585],
    travel_matrix={('r1', 'r1'): 0},
    student_profile=LoadProfile(min_break_minutes=15, max_sessions_per_day=4),
    instructor_blocks=[
        ResourceBlock(
            resource_id="i1",
            date="2026-09-14",
            start_minute=0,
            end_minute=24 * 60,
        )
    ],
)

assert result.status in {"OPTIMAL", "FEASIBLE"}
assert len(result.sessions) == 2
assert all(item.date == "2026-09-15" for item in result.sessions)
assert result.sessions[0].end <= result.sessions[1].start
print("Multi-day planning horizon test: PASS")
