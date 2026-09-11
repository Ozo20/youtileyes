from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from itertools import permutations

from ortools.sat.python import cp_model

from .models import Instructor, LoadProfile, Room, StaffingRole, TeachingGroup


@dataclass(frozen=True)
class MultiDayOccurrence:
    id: str
    teaching_group_id: str
    duration_minutes: int
    allowed_dates: tuple[str, ...]


@dataclass(frozen=True)
class ResourceBlock:
    resource_id: str
    date: str
    start_minute: int
    end_minute: int


@dataclass(frozen=True)
class MultiDayCandidate:
    occurrence_id: str
    teaching_group_id: str
    date: str
    start: int
    end: int
    instructor_ids: tuple[str, ...]
    staffing_roles: tuple[str, ...]
    room_id: str
    assignment_penalty: int


@dataclass(frozen=True)
class MultiDayScheduledSession:
    occurrence_id: str
    group: TeachingGroup
    date: str
    start: int
    end: int
    instructors: tuple[Instructor, ...]
    staffing_assignments: tuple[tuple[str, Instructor], ...]
    room: Room


@dataclass
class MultiDayScheduleResult:
    status: str
    objective_value: float
    sessions: list[MultiDayScheduledSession]


class MultiDayScheduleError(RuntimeError):
    pass


def _overlaps(start_a: int, end_a: int, start_b: int, end_b: int) -> bool:
    return start_a < end_b and start_b < end_a


def _is_blocked(
    *,
    resource_id: str,
    date: str,
    start: int,
    end: int,
    block_map: dict[tuple[str, str], list[tuple[int, int]]],
) -> bool:
    return any(
        _overlaps(start, end, block_start, block_end)
        for block_start, block_end in block_map.get((resource_id, date), [])
    )


def _travel_minutes(
    from_room_id: str,
    to_room_id: str,
    travel_matrix: dict[tuple[str, str], int],
) -> int:
    if from_room_id == to_room_id:
        return 0
    return travel_matrix.get((from_room_id, to_room_id), 0)


def _block_map(blocks: list[ResourceBlock]) -> dict[tuple[str, str], list[tuple[int, int]]]:
    result: dict[tuple[str, str], list[tuple[int, int]]] = defaultdict(list)
    for block in blocks:
        result[(block.resource_id, block.date)].append(
            (block.start_minute, block.end_minute)
        )
    return result


def _effective_roles(group: TeachingGroup, room: Room) -> tuple[StaffingRole, ...]:
    roles = tuple(group.staffing_roles) + tuple(room.staffing_roles)
    if roles:
        return roles

    # Backward-compatible default: every lesson needs one lead instructor.
    return (StaffingRole(id="default-lead", role="LEAD"),)


def _qualified_for_role(
    instructor: Instructor,
    group: TeachingGroup,
    role: StaffingRole,
) -> bool:
    # Course eligibility remains a hard requirement for every staffing slot.
    if group.course not in instructor.courses:
        return False

    if role.required_qualification_id is None:
        return True

    level = instructor.qualification_levels.get(role.required_qualification_id)
    if level is None:
        return False

    minimum = role.minimum_qualification_level or 1
    return level >= minimum


def _staffing_assignments(
    *,
    group: TeachingGroup,
    room: Room,
    instructors: list[Instructor],
    date: str,
    start: int,
    end: int,
    instructor_block_map: dict[tuple[str, str], list[tuple[int, int]]],
) -> list[tuple[tuple[str, ...], tuple[str, ...], int]]:
    roles = _effective_roles(group, room)

    eligible_by_role: list[list[Instructor]] = []
    for role in roles:
        eligible = [
            instructor
            for instructor in instructors
            if _qualified_for_role(instructor, group, role)
            and not _is_blocked(
                resource_id=instructor.id,
                date=date,
                start=start,
                end=end,
                block_map=instructor_block_map,
            )
        ]
        if not eligible:
            return []
        eligible_by_role.append(eligible)

    # Role counts are materialised into repeated role slots by the TypeScript
    # input builder. We need distinct people across those slots.
    unique_instructors = {item.id: item for items in eligible_by_role for item in items}
    if len(unique_instructors) < len(roles):
        return []

    results: list[tuple[tuple[str, ...], tuple[str, ...], int]] = []
    seen: set[tuple[str, ...]] = set()

    # The demo and intended operational rules normally use small staffing counts.
    # permutations keeps the implementation exact and transparent.
    for instructor_order in permutations(unique_instructors.values(), len(roles)):
        if any(
            instructor not in eligible_by_role[index]
            for index, instructor in enumerate(instructor_order)
        ):
            continue

        ids = tuple(item.id for item in instructor_order)
        if ids in seen:
            continue
        seen.add(ids)

        penalty = sum(
            instructor.course_penalties.get(group.course, 0)
            + group.instructor_penalties.get(instructor.id, 0)
            for instructor in instructor_order
        )

        results.append(
            (
                ids,
                tuple(role.role for role in roles),
                penalty,
            )
        )

    return results


def build_multi_day_candidates(
    *,
    occurrences: list[MultiDayOccurrence],
    groups: list[TeachingGroup],
    instructors: list[Instructor],
    rooms: list[Room],
    start_times: list[int],
    instructor_blocks: list[ResourceBlock],
    student_blocks: list[ResourceBlock],
    room_blocks: list[ResourceBlock],
) -> list[MultiDayCandidate]:
    group_by_id = {group.id: group for group in groups}
    instructor_block_map = _block_map(instructor_blocks)
    student_block_map = _block_map(student_blocks)
    room_block_map = _block_map(room_blocks)

    candidates: list[MultiDayCandidate] = []

    for occurrence in occurrences:
        group = group_by_id.get(occurrence.teaching_group_id)
        if group is None:
            raise MultiDayScheduleError(
                f"Occurrence {occurrence.id} references unknown teaching group "
                f"{occurrence.teaching_group_id}"
            )

        for date in occurrence.allowed_dates:
            for start in start_times:
                end = start + occurrence.duration_minutes

                if any(
                    _is_blocked(
                        resource_id=student_id,
                        date=date,
                        start=start,
                        end=end,
                        block_map=student_block_map,
                    )
                    for student_id in group.students
                ):
                    continue

                for room in rooms:
                    if room.id not in group.allowed_rooms:
                        continue
                    if len(group.students) > room.capacity:
                        continue
                    if _is_blocked(
                        resource_id=room.id,
                        date=date,
                        start=start,
                        end=end,
                        block_map=room_block_map,
                    ):
                        continue

                    for instructor_ids, staffing_roles, staffing_penalty in _staffing_assignments(
                        group=group,
                        room=room,
                        instructors=instructors,
                        date=date,
                        start=start,
                        end=end,
                        instructor_block_map=instructor_block_map,
                    ):
                        candidates.append(
                            MultiDayCandidate(
                                occurrence_id=occurrence.id,
                                teaching_group_id=group.id,
                                date=date,
                                start=start,
                                end=end,
                                instructor_ids=instructor_ids,
                                staffing_roles=staffing_roles,
                                room_id=room.id,
                                assignment_penalty=(
                                    staffing_penalty
                                    + group.room_penalties.get(room.id, 0)
                                ),
                            )
                        )

    return candidates


def solve_multi_day_week(
    *,
    occurrences: list[MultiDayOccurrence],
    groups: list[TeachingGroup],
    instructors: list[Instructor],
    rooms: list[Room],
    start_times: list[int],
    travel_matrix: dict[tuple[str, str], int],
    student_profile: LoadProfile,
    instructor_blocks: list[ResourceBlock] | None = None,
    student_blocks: list[ResourceBlock] | None = None,
    room_blocks: list[ResourceBlock] | None = None,
    max_time_seconds: float = 10,
) -> MultiDayScheduleResult:
    instructor_blocks = instructor_blocks or []
    student_blocks = student_blocks or []
    room_blocks = room_blocks or []

    group_by_id = {group.id: group for group in groups}
    instructor_by_id = {item.id: item for item in instructors}
    room_by_id = {item.id: item for item in rooms}

    candidates = build_multi_day_candidates(
        occurrences=occurrences,
        groups=groups,
        instructors=instructors,
        rooms=rooms,
        start_times=start_times,
        instructor_blocks=instructor_blocks,
        student_blocks=student_blocks,
        room_blocks=room_blocks,
    )

    model = cp_model.CpModel()
    variables = [
        model.new_bool_var(
            f"occ_{candidate.occurrence_id}_{candidate.date}_{candidate.start}_"
            f"{'_'.join(candidate.instructor_ids)}_{candidate.room_id}"
        )
        for candidate in candidates
    ]

    candidates_by_occurrence: dict[str, list[int]] = defaultdict(list)
    candidates_by_date: dict[str, list[int]] = defaultdict(list)

    for index, candidate in enumerate(candidates):
        candidates_by_occurrence[candidate.occurrence_id].append(index)
        candidates_by_date[candidate.date].append(index)

    for occurrence in occurrences:
        indices = candidates_by_occurrence.get(occurrence.id, [])
        if not indices:
            raise MultiDayScheduleError(
                f"No valid candidates for occurrence {occurrence.id} "
                f"(teaching group {occurrence.teaching_group_id})"
            )
        model.add(sum(variables[index] for index in indices) == 1)

    for date_indices in candidates_by_date.values():
        for left_position, left_index in enumerate(date_indices):
            left = candidates[left_index]
            left_group = group_by_id[left.teaching_group_id]

            for right_index in date_indices[left_position + 1 :]:
                right = candidates[right_index]
                if left.occurrence_id == right.occurrence_id:
                    continue

                right_group = group_by_id[right.teaching_group_id]
                incompatible = False

                if left.room_id == right.room_id and _overlaps(
                    left.start, left.end, right.start, right.end
                ):
                    incompatible = True

                shared_instructors = set(left.instructor_ids) & set(right.instructor_ids)
                if shared_instructors:
                    if _overlaps(left.start, left.end, right.start, right.end):
                        incompatible = True
                    elif left.end <= right.start:
                        if right.start - left.end < _travel_minutes(
                            left.room_id, right.room_id, travel_matrix
                        ):
                            incompatible = True
                    elif right.end <= left.start:
                        if left.start - right.end < _travel_minutes(
                            right.room_id, left.room_id, travel_matrix
                        ):
                            incompatible = True

                shared_students = set(left_group.students) & set(right_group.students)
                if shared_students:
                    if _overlaps(left.start, left.end, right.start, right.end):
                        incompatible = True
                    else:
                        if left.end <= right.start:
                            first, second = left, right
                        else:
                            first, second = right, left

                        travel = (
                            _travel_minutes(first.room_id, second.room_id, travel_matrix)
                            if student_profile.travel_consumes_break_time
                            else 0
                        )
                        real_break = second.start - first.end - travel
                        required_break = student_profile.min_break_minutes

                        if first.end - first.start > 45:
                            required_break = max(
                                required_break,
                                student_profile.min_break_after_double_minutes,
                            )

                        if real_break < required_break:
                            incompatible = True

                if incompatible:
                    model.add(variables[left_index] + variables[right_index] <= 1)

    students = {student for group in groups for student in group.students}

    for date_indices in candidates_by_date.values():
        if student_profile.max_sessions_per_day is not None:
            for student in students:
                indices = [
                    index
                    for index in date_indices
                    if student in group_by_id[candidates[index].teaching_group_id].students
                ]
                if indices:
                    model.add(
                        sum(variables[index] for index in indices)
                        <= student_profile.max_sessions_per_day
                    )

        if student_profile.max_teaching_minutes_per_day is not None:
            for student in students:
                terms = []
                for index in date_indices:
                    candidate = candidates[index]
                    group = group_by_id[candidate.teaching_group_id]
                    if student in group.students:
                        terms.append((candidate.end - candidate.start) * variables[index])
                if terms:
                    model.add(
                        sum(terms) <= student_profile.max_teaching_minutes_per_day
                    )

    objective_terms = []
    for index, candidate in enumerate(candidates):
        time_penalty = max(0, candidate.start - 8 * 60) // 15
        objective_terms.append(
            (candidate.assignment_penalty + time_penalty) * variables[index]
        )

    model.minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time_seconds
    status_code = solver.solve(model)
    status = solver.status_name(status_code)

    if status not in {"OPTIMAL", "FEASIBLE"}:
        return MultiDayScheduleResult(
            status=status,
            objective_value=0.0,
            sessions=[],
        )

    scheduled: list[MultiDayScheduledSession] = []
    for index, candidate in enumerate(candidates):
        if not solver.boolean_value(variables[index]):
            continue

        assigned = tuple(
            instructor_by_id[instructor_id]
            for instructor_id in candidate.instructor_ids
        )
        staffing_assignments = tuple(
            (role, instructor)
            for role, instructor in zip(candidate.staffing_roles, assigned)
        )

        scheduled.append(
            MultiDayScheduledSession(
                occurrence_id=candidate.occurrence_id,
                group=group_by_id[candidate.teaching_group_id],
                date=candidate.date,
                start=candidate.start,
                end=candidate.end,
                instructors=assigned,
                staffing_assignments=staffing_assignments,
                room=room_by_id[candidate.room_id],
            )
        )

    scheduled.sort(key=lambda item: (item.date, item.start, item.group.id))

    return MultiDayScheduleResult(
        status=status,
        objective_value=solver.objective_value,
        sessions=scheduled,
    )
