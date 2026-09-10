from solver.src.io import solver_input_from_dict

payload = solver_input_from_dict(
    {
        "schemaVersion": "1.2",
        "tenantId": "tenant",
        "planScenarioId": "scenario",
        "planningWindow": {
            "asOfDate": "2026-09-01",
            "frozenThroughDate": "2026-09-13",
            "startDate": "2026-09-14",
            "endDate": "2026-09-18",
        },
        "startTimes": [495, 540],
        "instructors": [
            {"id": "i1", "name": "Teacher", "courseIds": ["c1"], "coursePenalties": {}}
        ],
        "rooms": [{"id": "r1", "name": "Room", "capacity": 30}],
        "teachingGroups": [
            {
                "id": "g1",
                "courseId": "c1",
                "studentIds": ["s1"],
                "durationMinutes": 45,
                "allowedRoomIds": ["r1"],
                "roomPenalties": {},
                "instructorPenalties": {},
            }
        ],
        "calendarDays": [
            {"date": "2026-09-14", "teachingAllowed": True},
            {"date": "2026-09-15", "teachingAllowed": True},
        ],
        "teachingOccurrences": [
            {
                "id": "occ1",
                "teachingGroupId": "g1",
                "weekStartDate": "2026-09-14",
                "durationMinutes": 45,
                "allowedDates": ["2026-09-14", "2026-09-15"],
            }
        ],
        "resourceBlocks": {
            "instructors": [
                {"resourceId": "i1", "date": "2026-09-14", "startMinute": 480, "endMinute": 600}
            ],
            "students": [],
            "rooms": [],
        },
        "travel": [],
        "studentLoadProfile": {"minBreakMinutes": 15},
    }
)

assert payload.schema_version == "1.2"
assert payload.planning_window is not None
assert payload.planning_window.start_date == "2026-09-14"
assert len(payload.teaching_occurrences) == 1
assert payload.teaching_occurrences[0].allowed_dates == ("2026-09-14", "2026-09-15")
assert len(payload.instructor_blocks) == 1
print("Solver contract 1.2 test: PASS")
