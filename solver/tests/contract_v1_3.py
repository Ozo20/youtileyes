from solver.src.io import solver_input_from_dict


def main() -> None:
    payload = {
        "schemaVersion": "1.3",
        "tenantId": "T",
        "planScenarioId": "S",
        "planningWindow": {
            "asOfDate": "2026-09-01",
            "frozenThroughDate": "2026-09-13",
            "startDate": "2026-09-14",
            "endDate": "2026-09-18",
        },
        "startTimes": [495],
        "instructors": [
            {
                "id": "I1",
                "name": "Lead",
                "courseIds": ["C1"],
                "coursePenalties": {"C1": 0},
                "qualificationLevels": {"Q1": 3},
            },
            {
                "id": "I2",
                "name": "Assistant",
                "courseIds": ["C1"],
                "coursePenalties": {"C1": 10},
                "qualificationLevels": {"Q2": 2},
            },
        ],
        "rooms": [
            {
                "id": "R1",
                "name": "Room",
                "capacity": 30,
                "staffingRoles": [],
            }
        ],
        "teachingGroups": [
            {
                "id": "G1",
                "courseId": "C1",
                "studentIds": ["ST1"],
                "durationMinutes": 45,
                "allowedRoomIds": ["R1"],
                "roomPenalties": {},
                "instructorPenalties": {},
                "staffingRoles": [
                    {
                        "id": "role-1",
                        "role": "LEAD",
                        "requiredQualificationId": "Q1",
                        "minimumQualificationLevel": 2,
                    },
                    {
                        "id": "role-2",
                        "role": "ASSISTANT",
                        "requiredQualificationId": "Q2",
                        "minimumQualificationLevel": 1,
                    },
                ],
            }
        ],
        "calendarDays": [
            {"date": "2026-09-14", "teachingAllowed": True}
        ],
        "teachingOccurrences": [
            {
                "id": "O1",
                "teachingGroupId": "G1",
                "weekStartDate": "2026-09-14",
                "durationMinutes": 45,
                "allowedDates": ["2026-09-14"],
            }
        ],
        "resourceBlocks": {
            "instructors": [],
            "students": [],
            "rooms": [],
        },
        "travel": [{"fromRoomId": "R1", "toRoomId": "R1", "minutes": 0}],
        "studentLoadProfile": {
            "minBreakMinutes": 0,
            "minBreakAfterDoubleMinutes": 0,
            "travelConsumesBreakTime": True,
        },
        "metadata": {},
    }

    parsed = solver_input_from_dict(payload)

    assert parsed.schema_version == "1.3"
    assert parsed.instructors[0].qualification_levels["Q1"] == 3
    assert len(parsed.teaching_groups[0].staffing_roles) == 2
    assert parsed.teaching_groups[0].staffing_roles[0].role == "LEAD"

    print("Solver contract 1.3 staffing test: PASS")


if __name__ == "__main__":
    main()
