from solver.src.models import Instructor, LoadProfile, Room, StaffingRole, TeachingGroup
from solver.src.multi_day import MultiDayOccurrence, solve_multi_day_week


def main() -> None:
    lead_qualification = "QUAL-LEAD"
    support_qualification = "QUAL-SUPPORT"

    instructors = [
        Instructor(
            id="A",
            name="Teacher A",
            courses=frozenset({"FYS"}),
            course_penalties={"FYS": 0},
            qualification_levels={lead_qualification: 3},
        ),
        Instructor(
            id="B",
            name="Teacher B",
            courses=frozenset({"FYS"}),
            course_penalties={"FYS": 10},
            qualification_levels={support_qualification: 2},
        ),
        Instructor(
            id="C",
            name="Teacher C",
            courses=frozenset({"FYS"}),
            course_penalties={"FYS": 20},
            qualification_levels={support_qualification: 1},
        ),
    ]

    group = TeachingGroup(
        id="G1",
        course="FYS",
        students=("S1", "S2"),
        duration_minutes=45,
        allowed_rooms=frozenset({"R1"}),
        staffing_roles=(
            StaffingRole(
                id="lead",
                role="LEAD",
                required_qualification_id=lead_qualification,
                minimum_qualification_level=2,
            ),
            StaffingRole(
                id="assistant",
                role="ASSISTANT",
                required_qualification_id=support_qualification,
                minimum_qualification_level=1,
            ),
        ),
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
        rooms=[Room(id="R1", name="Lab", capacity=30)],
        start_times=[8 * 60 + 15],
        travel_matrix={("R1", "R1"): 0},
        student_profile=LoadProfile(),
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert len(result.sessions) == 1

    session = result.sessions[0]
    assert len(session.instructors) == 2
    assignments = {role: instructor.id for role, instructor in session.staffing_assignments}
    assert assignments["LEAD"] == "A"
    assert assignments["ASSISTANT"] in {"B", "C"}
    assert assignments["ASSISTANT"] != assignments["LEAD"]

    print("Multi-instructor staffing test: PASS")
    print(f"LEAD: {assignments['LEAD']}")
    print(f"ASSISTANT: {assignments['ASSISTANT']}")


if __name__ == "__main__":
    main()
