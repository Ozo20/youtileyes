from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import combinations, product
from time import perf_counter

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
    diagnostics: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class _ResourceOption:
    room_id: str
    instructor_ids: tuple[str, ...]
    staffing_roles: tuple[str, ...]
    assignment_penalty: int
    allowed_dates: tuple[str, ...] = ()


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


def _block_map(
    blocks: list[ResourceBlock],
) -> dict[tuple[str, str], list[tuple[int, int]]]:
    result: dict[tuple[str, str], list[tuple[int, int]]] = defaultdict(list)
    for block in blocks:
        result[(block.resource_id, block.date)].append(
            (block.start_minute, block.end_minute)
        )
    return result


def _valid_on(date: str | None, start: str | None, end: str | None) -> bool:
    return date is None or ((start is None or date >= start) and (end is None or date <= end))


def _effective_roles(group: TeachingGroup, room: Room, date: str | None = None) -> tuple[StaffingRole, ...]:
    roles = tuple(role for role in (*group.staffing_roles, *room.staffing_roles)
                  if len(group.students) >= role.minimum_student_count
                  and _valid_on(date, role.valid_from, role.valid_to))
    # Optional assistants must never allow a lesson without a teacher.
    if not any(role.hard for role in roles):
        roles = (StaffingRole(id="default-lead", role="LEAD"),) + roles
    return roles


_COURSE_QUALIFICATION_RANK = {
    "SUPPORT": 1,
    "SECONDARY": 2,
    "PRIMARY": 3,
}


def _qualified_for_role(instructor: Instructor, group: TeachingGroup,
                        role: StaffingRole, date: str | None = None) -> bool:
    if group.course not in instructor.courses:
        return False
    if not _valid_on(date, *instructor.course_validity.get(group.course, [None, None])):
        return False
    if role.minimum_course_qualification_level is not None:
        actual_course_qualification = instructor.course_qualification_levels.get(
            group.course
        )

        if actual_course_qualification is None:
            return False

        if (
            _COURSE_QUALIFICATION_RANK.get(actual_course_qualification, 0)
            < _COURSE_QUALIFICATION_RANK.get(
                role.minimum_course_qualification_level,
                0,
            )
        ):
            return False

    if (
        role.minimum_course_level is not None
        and instructor.course_levels.get(group.course, 0)
        < role.minimum_course_level
    ):
        return False

    if role.required_qualification_id is None:
        return True
    level = instructor.qualification_levels.get(role.required_qualification_id)
    return (level is not None and level >= (role.minimum_qualification_level or 1)
            and _valid_on(date, *instructor.qualification_validity.get(role.required_qualification_id, [None, None])))


def _staffing_options(*, group: TeachingGroup, room: Room,
                     instructors: list[Instructor], date: str | None = None
                     ) -> list[tuple[tuple[str, ...], tuple[str, ...], int]]:
    roles = _effective_roles(group, room, date)
    choices = []
    for role in roles:
        eligible = [i for i in instructors if _qualified_for_role(i, group, role, date)]
        choices.append(eligible if role.hard else [*eligible, None])
    results = {}
    for assignment in product(*choices):
        present = [i for i in assignment if i is not None]
        ids = tuple(i.id for i in present)
        if not ids or len(set(ids)) != len(ids):
            continue
        selected_roles = tuple(role.role for role, i in zip(roles, assignment) if i is not None)
        penalty = sum(
            role.weight if i is None else (
                i.course_penalties.get(group.course, 0) + group.instructor_penalties.get(i.id, 0)
                + max(0, (role.preferred_course_level or 0) - i.course_levels.get(group.course, 0)) * role.weight
            ) for role, i in zip(roles, assignment)
        )
        key = (ids, selected_roles)
        results[key] = min(results.get(key, penalty), penalty)
    return [(ids, roles, penalty) for (ids, roles), penalty in results.items()]


def _resource_options(
    *,
    group: TeachingGroup,
    instructors: list[Instructor],
    rooms: list[Room],
    date: str | None = None,
) -> list[_ResourceOption]:
    result: list[_ResourceOption] = []

    for room in rooms:
        if room.id not in group.allowed_rooms:
            continue
        if len(group.students) > room.capacity:
            continue

        for instructor_ids, staffing_roles, staffing_penalty in _staffing_options(
            group=group,
            room=room,
            instructors=instructors,
            date=date,
        ):
            result.append(
                _ResourceOption(
                    room_id=room.id,
                    allowed_dates=((date,) if date is not None else ()),
                    instructor_ids=instructor_ids,
                    staffing_roles=staffing_roles,
                    assignment_penalty=(
                        staffing_penalty
                        + group.room_penalties.get(room.id, 0)
                    ),
                )
            )

    return result


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
    """Backward-compatible candidate helper used by diagnostics/tests."""

    return [
        option
        for option in _staffing_options(
            group=group,
            room=room,
            instructors=instructors,
            date=date,
        )
        if all(
            not _is_blocked(
                resource_id=instructor_id,
                date=date,
                start=start,
                end=end,
                block_map=instructor_block_map,
            )
            for instructor_id in option[0]
        )
    ]


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
    """Materialise legacy full candidates for diagnostics only.

    solve_multi_day_week no longer uses this Cartesian representation.
    """

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

                    for (
                        instructor_ids,
                        staffing_roles,
                        staffing_penalty,
                    ) in _staffing_assignments(
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
    placement_rules: list[dict] | None = None,
    student_break_rules: list[dict] | None = None,
    instructor_break_rules: list[dict] | None = None,
    max_time_seconds: float | None = None,
    progress_callback: Callable[[dict[str, object]], None] | None = None,
) -> MultiDayScheduleResult:
    """Solve one week with decoupled placement and resource assignment.

    A lesson's date/start decision is represented once. Room/staffing choices
    are selected separately and linked to optional resource intervals. This
    preserves the full room/teacher solution space while avoiding the previous
    date x start x room x staffing Cartesian Boolean candidate model.
    """

    placement_rules = placement_rules or []
    student_break_rules = student_break_rules or []
    instructor_break_rules = instructor_break_rules or []
    started = perf_counter()
    instructor_blocks = instructor_blocks or []
    student_blocks = student_blocks or []
    room_blocks = room_blocks or []

    if not start_times:
        raise MultiDayScheduleError("At least one start time is required.")

    unique_start_times = sorted(set(start_times))
    group_by_id = {group.id: group for group in groups}
    instructor_by_id = {item.id: item for item in instructors}
    room_by_id = {item.id: item for item in rooms}
    occurrence_by_id = {item.id: item for item in occurrences}
    student_block_map = _block_map(student_blocks)

    def emit(**event: object) -> None:
        if progress_callback is not None:
            progress_callback(dict(event))

    emit(
        phase="BUILDING_MODEL",
        phaseLabel="Preparing decision space",
        message=(
            f"Preparing placement and resource choices for "
            f"{len(occurrences)} teaching occurrences."
        ),
    )

    preparation_started = perf_counter()

    resource_options_by_occurrence: dict[str, list[_ResourceOption]] = {}
    valid_starts_by_occurrence_date: dict[tuple[str, str], tuple[int, ...]] = {}
    legacy_candidate_equivalent = 0
    placement_domain_size = 0

    resource_option_counts: list[int] = []
    room_choice_counts: list[int] = []
    instructor_choice_counts: list[int] = []
    staffing_combo_counts_per_date_room: list[int] = []
    raw_resource_option_counts_by_occurrence_date: dict[
        tuple[str, str], int
    ] = {}

    for occurrence in occurrences:
        group = group_by_id.get(occurrence.teaching_group_id)
        if group is None:
            raise MultiDayScheduleError(
                f"Occurrence {occurrence.id} references unknown teaching group "
                f"{occurrence.teaching_group_id}"
            )

        merged_option_dates: dict[
            tuple[str, tuple[str, ...], tuple[str, ...], int],
            set[str],
        ] = {}

        for date in occurrence.allowed_dates:
            date_options = _resource_options(
                group=group,
                instructors=instructors,
                rooms=rooms,
                date=date,
            )
            raw_resource_option_counts_by_occurrence_date[
                (occurrence.id, date)
            ] = len(date_options)

            options_by_room: dict[str, int] = defaultdict(int)
            for option in date_options:
                options_by_room[option.room_id] += 1

                merge_key = (
                    option.room_id,
                    option.instructor_ids,
                    option.staffing_roles,
                    option.assignment_penalty,
                )
                merged_option_dates.setdefault(merge_key, set()).add(date)

            staffing_combo_counts_per_date_room.extend(
                options_by_room.values()
            )

        options = [
            _ResourceOption(
                room_id=room_id,
                instructor_ids=instructor_ids,
                staffing_roles=staffing_roles,
                assignment_penalty=assignment_penalty,
                allowed_dates=tuple(sorted(allowed_dates)),
            )
            for (
                room_id,
                instructor_ids,
                staffing_roles,
                assignment_penalty,
            ), allowed_dates in merged_option_dates.items()
        ]

        if not options:
            raise MultiDayScheduleError(
                f"No valid room/staffing options for occurrence {occurrence.id} "
                f"(teaching group {group.id})."
            )
        resource_options_by_occurrence[occurrence.id] = options

        resource_option_counts.append(len(options))
        room_choice_counts.append(
            len({option.room_id for option in options})
        )
        instructor_choice_counts.append(
            len({
                instructor_id
                for option in options
                for instructor_id in option.instructor_ids
            })
        )

        valid_date_count = 0
        for date in occurrence.allowed_dates:
            valid_starts = tuple(
                start
                for start in unique_start_times
                if not any(
                    _is_blocked(
                        resource_id=student_id,
                        date=date,
                        start=start,
                        end=start + occurrence.duration_minutes,
                        block_map=student_block_map,
                    )
                    for student_id in group.students
                )
            )
            if not valid_starts:
                continue

            valid_starts_by_occurrence_date[(occurrence.id, date)] = valid_starts
            placement_domain_size += len(valid_starts)
            legacy_candidate_equivalent += (
                len(valid_starts)
                * raw_resource_option_counts_by_occurrence_date.get(
                    (occurrence.id, date),
                    0,
                )
            )
            valid_date_count += 1

        if valid_date_count == 0:
            raise MultiDayScheduleError(
                f"No valid date/start placements for occurrence {occurrence.id}."
            )

    preparation_seconds = perf_counter() - preparation_started

    emit(
        phase="BUILDING_MODEL",
        phaseLabel="Building compact model",
        candidateCount=legacy_candidate_equivalent,
        placementCount=placement_domain_size,
        resourceOptionCount=sum(
            len(options)
            for options in resource_options_by_occurrence.values()
        ),
        resourceOptionsPerOccurrence={
            "min": min(resource_option_counts, default=0),
            "avg": round(
                sum(resource_option_counts) / len(resource_option_counts),
                2,
            ) if resource_option_counts else 0,
            "max": max(resource_option_counts, default=0),
        },
        roomsPerOccurrence={
            "min": min(room_choice_counts, default=0),
            "avg": round(
                sum(room_choice_counts) / len(room_choice_counts),
                2,
            ) if room_choice_counts else 0,
            "max": max(room_choice_counts, default=0),
        },
        instructorsPerOccurrence={
            "min": min(instructor_choice_counts, default=0),
            "avg": round(
                sum(instructor_choice_counts) / len(instructor_choice_counts),
                2,
            ) if instructor_choice_counts else 0,
            "max": max(instructor_choice_counts, default=0),
        },
        staffingCombosPerDateRoom={
            "min": min(staffing_combo_counts_per_date_room, default=0),
            "avg": round(
                sum(staffing_combo_counts_per_date_room)
                / len(staffing_combo_counts_per_date_room),
                2,
            ) if staffing_combo_counts_per_date_room else 0,
            "max": max(staffing_combo_counts_per_date_room, default=0),
        },
        candidateSeconds=round(preparation_seconds, 3),
        message=(
            f"Compact decision space prepared in {preparation_seconds:.1f}s: "
            f"{placement_domain_size:,} placement values instead of "
            f"{legacy_candidate_equivalent:,} full Cartesian candidates."
        ),
    )

    model_started = perf_counter()
    model = cp_model.CpModel()

    date_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    start_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    chosen_start_vars: dict[str, cp_model.IntVar] = {}
    time_penalty_vars: dict[str, cp_model.IntVar] = {}

    option_vars: dict[tuple[str, int], cp_model.IntVar] = {}
    room_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    instructor_vars: dict[tuple[str, str], cp_model.IntVar] = {}

    room_ids_by_occurrence: dict[str, tuple[str, ...]] = {}
    instructor_ids_by_occurrence: dict[str, tuple[str, ...]] = {}

    # Placement variables: one date per occurrence, one start variable for each
    # feasible date. A global chosen start is linked to whichever date is active.
    for occurrence in occurrences:
        date_choices: list[cp_model.IntVar] = []
        valid_date_keys: list[tuple[str, str]] = []

        for date in occurrence.allowed_dates:
            key = (occurrence.id, date)
            valid_starts = valid_starts_by_occurrence_date.get(key)
            if not valid_starts:
                continue

            date_var = model.new_bool_var(f"date_{occurrence.id}_{date}")
            start_var = model.new_int_var_from_domain(
                cp_model.Domain.from_values(list(valid_starts)),
                f"start_{occurrence.id}_{date}",
            )
            date_vars[key] = date_var
            start_vars[key] = start_var
            date_choices.append(date_var)
            valid_date_keys.append(key)

        model.add_exactly_one(date_choices)

        global_start = model.new_int_var(
            min(unique_start_times),
            max(unique_start_times),
            f"chosen_start_{occurrence.id}",
        )
        chosen_start_vars[occurrence.id] = global_start

        for key in valid_date_keys:
            model.add(global_start == start_vars[key]).only_enforce_if(
                date_vars[key]
            )

        penalty_values = [
            max(0, start - 8 * 60) // 15
            for start in unique_start_times
        ]
        time_penalty = model.new_int_var(
            min(penalty_values),
            max(penalty_values),
            f"time_penalty_{occurrence.id}",
        )
        time_penalty_vars[occurrence.id] = time_penalty
        model.add_allowed_assignments(
            [global_start, time_penalty],
            [
                [start, max(0, start - 8 * 60) // 15]
                for start in unique_start_times
            ],
        )

    # Resource options: each occurrence chooses one exact room + staffing
    # combination. Room/instructor selector variables are derived from this
    # choice and reused throughout availability, overlap and travel constraints.
    for occurrence in occurrences:
        options = resource_options_by_occurrence[occurrence.id]
        occurrence_option_vars: list[cp_model.IntVar] = []

        room_to_options: dict[str, list[cp_model.IntVar]] = defaultdict(list)
        instructor_to_options: dict[str, list[cp_model.IntVar]] = defaultdict(list)

        for option_index, option in enumerate(options):
            option_var = model.new_bool_var(
                f"resource_{occurrence.id}_{option_index}"
            )
            option_vars[(occurrence.id, option_index)] = option_var
            occurrence_option_vars.append(option_var)
            if option.allowed_dates:
                matching_dates = [
                    date_vars[(occurrence.id, date)]
                    for date in option.allowed_dates
                    if (occurrence.id, date) in date_vars
                ]
                if matching_dates:
                    model.add(option_var <= sum(matching_dates))
                else:
                    model.add(option_var == 0)

            room_to_options[option.room_id].append(option_var)
            for instructor_id in option.instructor_ids:
                instructor_to_options[instructor_id].append(option_var)

        model.add_exactly_one(occurrence_option_vars)

        room_ids = tuple(sorted(room_to_options))
        instructor_ids = tuple(sorted(instructor_to_options))
        room_ids_by_occurrence[occurrence.id] = room_ids
        instructor_ids_by_occurrence[occurrence.id] = instructor_ids

        for room_id, source_vars in room_to_options.items():
            room_var = model.new_bool_var(
                f"room_{occurrence.id}_{room_id}"
            )
            model.add(sum(source_vars) == room_var)
            room_vars[(occurrence.id, room_id)] = room_var

        for instructor_id, source_vars in instructor_to_options.items():
            instructor_var = model.new_bool_var(
                f"instructor_{occurrence.id}_{instructor_id}"
            )
            model.add(sum(source_vars) == instructor_var)
            instructor_vars[(occurrence.id, instructor_id)] = instructor_var

    preference_penalty_vars = []
    for occurrence in occurrences:
        for option_index, option in enumerate(
            resource_options_by_occurrence[occurrence.id]
        ):
            selected = option_vars[(occurrence.id, option_index)]

            for date in option.allowed_dates:
                key = (occurrence.id, date)
                date_selected = date_vars.get(key)

                if key not in start_vars or date_selected is None:
                    continue

                applicable = [
                    rule
                    for rule in placement_rules
                    if rule["date"] == date
                    and (
                        not rule.get("groupId")
                        or rule["groupId"] == occurrence.teaching_group_id
                    )
                    and (
                        not rule.get("instructorId")
                        or rule["instructorId"] in option.instructor_ids
                    )
                    and (
                        not rule.get("roomId")
                        or rule["roomId"] == option.room_id
                    )
                ]

                if not applicable:
                    continue

                rows = []
                for start in valid_starts_by_occurrence_date[key]:
                    penalty = 0
                    blocked = False

                    for rule in applicable:
                        overlap = max(
                            0,
                            min(
                                start + occurrence.duration_minutes,
                                rule["endMinute"],
                            )
                            - max(start, rule["startMinute"]),
                        )
                        blocked |= bool(overlap and rule["hard"])
                        penalty += (
                            overlap * rule["weight"]
                            if not rule["hard"]
                            else 0
                        )

                    if not blocked:
                        rows.append([start, penalty])

                if not rows:
                    # This resource option remains valid on its other dates,
                    # but may not be combined with this particular date.
                    model.add(selected + date_selected <= 1)
                    continue

                cost = model.new_int_var(
                    0,
                    max(row[1] for row in rows),
                    (
                        f"preference_{occurrence.id}_{option_index}_"
                        f"{date}"
                    ),
                )

                model.add_allowed_assignments(
                    [start_vars[key], cost],
                    rows,
                ).only_enforce_if([selected, date_selected])

                model.add(cost == 0).only_enforce_if(selected.Not())
                model.add(cost == 0).only_enforce_if(date_selected.Not())

                preference_penalty_vars.append(cost)

    # Room and instructor overlap/availability use optional fixed-size intervals.
    # Presence is the conjunction of selected date and selected resource.
    room_intervals: dict[tuple[str, str], list[cp_model.IntervalVar]] = defaultdict(list)
    instructor_intervals: dict[tuple[str, str], list[cp_model.IntervalVar]] = defaultdict(list)
    resource_presence_count = 0

    def conjunction(
        left: cp_model.IntVar,
        right: cp_model.IntVar,
        name: str,
    ) -> cp_model.IntVar:
        nonlocal resource_presence_count
        result = model.new_bool_var(name)
        model.add(result <= left)
        model.add(result <= right)
        model.add(result >= left + right - 1)
        resource_presence_count += 1
        return result

    for occurrence in occurrences:
        for date in occurrence.allowed_dates:
            date_key = (occurrence.id, date)
            date_var = date_vars.get(date_key)
            start_var = start_vars.get(date_key)
            if date_var is None or start_var is None:
                continue

            for room_id in room_ids_by_occurrence[occurrence.id]:
                presence = conjunction(
                    date_var,
                    room_vars[(occurrence.id, room_id)],
                    f"room_presence_{occurrence.id}_{date}_{room_id}",
                )
                interval = model.new_optional_fixed_size_interval_var(
                    start_var,
                    occurrence.duration_minutes,
                    presence,
                    f"room_interval_{occurrence.id}_{date}_{room_id}",
                )
                room_intervals[(room_id, date)].append(interval)

            for instructor_id in instructor_ids_by_occurrence[occurrence.id]:
                presence = conjunction(
                    date_var,
                    instructor_vars[(occurrence.id, instructor_id)],
                    f"instructor_presence_{occurrence.id}_{date}_{instructor_id}",
                )
                interval = model.new_optional_fixed_size_interval_var(
                    start_var,
                    occurrence.duration_minutes,
                    presence,
                    f"instructor_interval_{occurrence.id}_{date}_{instructor_id}",
                )
                instructor_intervals[(instructor_id, date)].append(interval)

    for block_index, block in enumerate(room_blocks):
        duration = block.end_minute - block.start_minute
        if duration <= 0:
            continue
        room_intervals[(block.resource_id, block.date)].append(
            model.new_fixed_size_interval_var(
                block.start_minute,
                duration,
                f"room_block_{block_index}",
            )
        )

    for block_index, block in enumerate(instructor_blocks):
        duration = block.end_minute - block.start_minute
        if duration <= 0:
            continue
        instructor_intervals[(block.resource_id, block.date)].append(
            model.new_fixed_size_interval_var(
                block.start_minute,
                duration,
                f"instructor_block_{block_index}",
            )
        )

    for intervals in room_intervals.values():
        if len(intervals) > 1:
            model.add_no_overlap(intervals)

    for intervals in instructor_intervals.values():
        if len(intervals) > 1:
            model.add_no_overlap(intervals)

    # Student bundles keep daily-load constraints compact. Students with the
    # exact same occurrence set have identical timetable/load constraints.
    occurrence_ids_by_student: dict[str, set[str]] = defaultdict(set)
    for occurrence in occurrences:
        group = group_by_id[occurrence.teaching_group_id]
        for student_id in group.students:
            occurrence_ids_by_student[student_id].add(occurrence.id)

    student_bundles: dict[frozenset[str], list[str]] = defaultdict(list)
    for student_id, occurrence_ids in occurrence_ids_by_student.items():
        student_bundles[frozenset(occurrence_ids)].append(student_id)

    student_pairs: set[tuple[str, str]] = set()
    for occurrence_ids in student_bundles:
        for left_id, right_id in combinations(sorted(occurrence_ids), 2):
            student_pairs.add((left_id, right_id))

    all_dates = sorted({date for _, date in date_vars})
    for occurrence_ids in student_bundles:
        for date in all_dates:
            date_terms = [
                date_vars[(occurrence_id, date)]
                for occurrence_id in occurrence_ids
                if (occurrence_id, date) in date_vars
            ]
            if not date_terms:
                continue

            if student_profile.max_sessions_per_day is not None:
                model.add(
                    sum(date_terms)
                    <= student_profile.max_sessions_per_day
                )

            if student_profile.max_teaching_minutes_per_day is not None:
                minute_terms = [
                    occurrence_by_id[occurrence_id].duration_minutes
                    * date_vars[(occurrence_id, date)]
                    for occurrence_id in occurrence_ids
                    if (occurrence_id, date) in date_vars
                ]
                model.add(
                    sum(minute_terms)
                    <= student_profile.max_teaching_minutes_per_day
                )

    # One chronological ordering literal per occurrence-pair/date is shared by
    # student and instructor travel constraints. If both lessons land on that
    # date, the literal determines which lesson is first.
    order_vars: dict[tuple[str, str, str], cp_model.IntVar] = {}

    def order_var(left_id: str, right_id: str, date: str) -> cp_model.IntVar:
        key = (left_id, right_id, date)
        existing = order_vars.get(key)
        if existing is not None:
            return existing
        created = model.new_bool_var(
            f"order_{left_id}_{right_id}_{date}"
        )
        order_vars[key] = created
        return created

    student_break_constraints = 0
    student_travel_constraints = 0

    for left_id, right_id in sorted(student_pairs):
        left = occurrence_by_id[left_id]
        right = occurrence_by_id[right_id]
        common_dates = sorted(
            set(left.allowed_dates) & set(right.allowed_dates)
        )

        left_break = student_profile.min_break_minutes
        if left.duration_minutes > 45:
            left_break = max(
                left_break,
                student_profile.min_break_after_double_minutes,
            )

        right_break = student_profile.min_break_minutes
        if right.duration_minutes > 45:
            right_break = max(
                right_break,
                student_profile.min_break_after_double_minutes,
            )

        for date in common_dates:
            left_date = date_vars.get((left_id, date))
            right_date = date_vars.get((right_id, date))
            left_start = start_vars.get((left_id, date))
            right_start = start_vars.get((right_id, date))
            if (
                left_date is None
                or right_date is None
                or left_start is None
                or right_start is None
            ):
                continue

            order = order_var(left_id, right_id, date)

            model.add(
                left_start + left.duration_minutes + left_break
                <= right_start
            ).only_enforce_if([left_date, right_date, order])
            model.add(
                right_start + right.duration_minutes + right_break
                <= left_start
            ).only_enforce_if([left_date, right_date, order.Not()])
            student_break_constraints += 2

            if not student_profile.travel_consumes_break_time:
                continue

            for left_room in room_ids_by_occurrence[left_id]:
                left_room_var = room_vars[(left_id, left_room)]
                for right_room in room_ids_by_occurrence[right_id]:
                    travel_lr = _travel_minutes(
                        left_room,
                        right_room,
                        travel_matrix,
                    )
                    travel_rl = _travel_minutes(
                        right_room,
                        left_room,
                        travel_matrix,
                    )
                    if travel_lr <= 0 and travel_rl <= 0:
                        continue

                    right_room_var = room_vars[(right_id, right_room)]

                    if travel_lr > 0:
                        model.add(
                            left_start
                            + left.duration_minutes
                            + left_break
                            + travel_lr
                            <= right_start
                        ).only_enforce_if(
                            [
                                left_date,
                                right_date,
                                left_room_var,
                                right_room_var,
                                order,
                            ]
                        )
                        student_travel_constraints += 1

                    if travel_rl > 0:
                        model.add(
                            right_start
                            + right.duration_minutes
                            + right_break
                            + travel_rl
                            <= left_start
                        ).only_enforce_if(
                            [
                                left_date,
                                right_date,
                                left_room_var,
                                right_room_var,
                                order.Not(),
                            ]
                        )
                        student_travel_constraints += 1

    # Scoped student break rules extend the global LoadProfile.
    #
    # Hard rules increase the feasible minimum break.
    # Soft rules preserve feasibility and penalize missing real break minutes.
    # "Real break" excludes room-to-room travel when travel consumes break time.
    student_break_preference_vars: list[cp_model.IntVar] = []
    student_break_rule_constraints = 0

    def break_rule_applies(
        rule: dict,
        *,
        date: str,
        left_group: TeachingGroup,
        right_group: TeachingGroup,
        shared_students: set[str],
    ) -> bool:
        if rule["date"] != date:
            return False

        student_id = rule.get("studentId")
        if student_id and student_id not in shared_students:
            return False

        group_id = rule.get("groupId")
        if group_id and group_id not in {left_group.id, right_group.id}:
            return False

        course_id = rule.get("courseId")
        if course_id and course_id not in {left_group.course, right_group.course}:
            return False

        return True

    for left_id, right_id in sorted(student_pairs):
        left = occurrence_by_id[left_id]
        right = occurrence_by_id[right_id]
        left_group = group_by_id[left.teaching_group_id]
        right_group = group_by_id[right.teaching_group_id]

        shared_students = set(left_group.students) & set(right_group.students)
        if not shared_students:
            continue

        common_dates = sorted(set(left.allowed_dates) & set(right.allowed_dates))

        for date in common_dates:
            left_date = date_vars.get((left_id, date))
            right_date = date_vars.get((right_id, date))
            left_start = start_vars.get((left_id, date))
            right_start = start_vars.get((right_id, date))

            if (
                left_date is None
                or right_date is None
                or left_start is None
                or right_start is None
            ):
                continue

            # Cohort-scoped rules may be compiled into one group-scoped row
            # per teaching group while retaining the same ruleId. A pair of
            # groups must still incur the originating preference only once.
            applicable_rule_by_id: dict[str, dict] = {}
            for rule in student_break_rules:
                if not break_rule_applies(
                    rule,
                    date=date,
                    left_group=left_group,
                    right_group=right_group,
                    shared_students=shared_students,
                ):
                    continue
                applicable_rule_by_id.setdefault(str(rule["ruleId"]), rule)

            applicable_rules = list(applicable_rule_by_id.values())

            if not applicable_rules:
                continue

            order = order_var(left_id, right_id, date)

            hard_minimum = max(
                (
                    int(rule["minBreakMinutes"])
                    for rule in applicable_rules
                    if rule["hard"]
                ),
                default=0,
            )

            # Existing LoadProfile remains the baseline hard requirement.
            left_hard_break = max(student_profile.min_break_minutes, hard_minimum)
            if left.duration_minutes > 45:
                left_hard_break = max(
                    left_hard_break,
                    student_profile.min_break_after_double_minutes,
                )

            right_hard_break = max(student_profile.min_break_minutes, hard_minimum)
            if right.duration_minutes > 45:
                right_hard_break = max(
                    right_hard_break,
                    student_profile.min_break_after_double_minutes,
                )

            # Create only two soft deficit variables per
            # occurrence-pair/date/rule. Room combinations condition the
            # constraints, but do not need their own copies of the variables.
            soft_rule_vars: list[
                tuple[int, dict, int, int, cp_model.IntVar, cp_model.IntVar]
            ] = []

            for rule_index, rule in enumerate(applicable_rules):
                if rule["hard"]:
                    continue

                required = int(rule["minBreakMinutes"])
                weight = int(rule["weight"])

                if required <= 0 or weight <= 0:
                    continue

                deficit_lr = model.new_int_var(
                    0,
                    required,
                    f"break_pref_lr_{left_id}_{right_id}_{date}_{rule_index}",
                )
                deficit_rl = model.new_int_var(
                    0,
                    required,
                    f"break_pref_rl_{left_id}_{right_id}_{date}_{rule_index}",
                )

                soft_rule_vars.append(
                    (
                        rule_index,
                        rule,
                        required,
                        weight,
                        deficit_lr,
                        deficit_rl,
                    )
                )

                student_break_preference_vars.extend(
                    [
                        deficit_lr * weight,
                        deficit_rl * weight,
                    ]
                )

                # If the lessons are not both on this date, this preference
                # contributes nothing.
                model.add(deficit_lr == 0).only_enforce_if(left_date.Not())
                model.add(deficit_lr == 0).only_enforce_if(right_date.Not())
                model.add(deficit_rl == 0).only_enforce_if(left_date.Not())
                model.add(deficit_rl == 0).only_enforce_if(right_date.Not())

                # Only the chronological direction that is actually selected
                # may carry a deficit.
                model.add(deficit_lr == 0).only_enforce_if(
                    [left_date, right_date, order.Not()]
                )
                model.add(deficit_rl == 0).only_enforce_if(
                    [left_date, right_date, order]
                )

            for left_room in room_ids_by_occurrence[left_id]:
                left_room_var = room_vars[(left_id, left_room)]

                for right_room in room_ids_by_occurrence[right_id]:
                    right_room_var = room_vars[(right_id, right_room)]

                    travel_lr = (
                        _travel_minutes(left_room, right_room, travel_matrix)
                        if student_profile.travel_consumes_break_time
                        else 0
                    )
                    travel_rl = (
                        _travel_minutes(right_room, left_room, travel_matrix)
                        if student_profile.travel_consumes_break_time
                        else 0
                    )

                    base_literals = [
                        left_date,
                        right_date,
                        left_room_var,
                        right_room_var,
                    ]

                    # Hard scoped break requirements.
                    if hard_minimum > student_profile.min_break_minutes:
                        model.add(
                            left_start
                            + left.duration_minutes
                            + left_hard_break
                            + travel_lr
                            <= right_start
                        ).only_enforce_if(base_literals + [order])

                        model.add(
                            right_start
                            + right.duration_minutes
                            + right_hard_break
                            + travel_rl
                            <= left_start
                        ).only_enforce_if(base_literals + [order.Not()])

                        student_break_rule_constraints += 2

                    # The same pair/date/rule deficit is constrained by the
                    # selected room combination. Exactly one room is selected
                    # for each occurrence, so only one such constraint becomes
                    # active in the realised timetable.
                    for (
                        _rule_index,
                        _rule,
                        required,
                        _weight,
                        deficit_lr,
                        deficit_rl,
                    ) in soft_rule_vars:
                        model.add(
                            deficit_lr
                            >= required
                            - (
                                right_start
                                - left_start
                                - left.duration_minutes
                                - travel_lr
                            )
                        ).only_enforce_if(base_literals + [order])

                        model.add(
                            deficit_rl
                            >= required
                            - (
                                left_start
                                - right_start
                                - right.duration_minutes
                                - travel_rl
                            )
                        ).only_enforce_if(base_literals + [order.Not()])

    # Instructor-specific break rules are conditional on the instructor
    # actually being selected for both occurrences.
    #
    # Hard rules require real free time in addition to room-to-room travel.
    # Soft rules contribute a deficit penalty while preserving feasibility.
    instructor_break_preference_vars: list[cp_model.LinearExpr] = []
    instructor_break_rule_constraints = 0

    occurrence_ids = [occurrence.id for occurrence in occurrences]

    for left_id, right_id in combinations(occurrence_ids, 2):
        common_instructors = sorted(
            set(instructor_ids_by_occurrence[left_id])
            & set(instructor_ids_by_occurrence[right_id])
        )
        if not common_instructors:
            continue

        left = occurrence_by_id[left_id]
        right = occurrence_by_id[right_id]

        common_dates = sorted(
            set(left.allowed_dates) & set(right.allowed_dates)
        )
        if not common_dates:
            continue

        for date in common_dates:
            left_date = date_vars.get((left_id, date))
            right_date = date_vars.get((right_id, date))
            left_start = start_vars.get((left_id, date))
            right_start = start_vars.get((right_id, date))

            if (
                left_date is None
                or right_date is None
                or left_start is None
                or right_start is None
            ):
                continue

            order = order_var(left_id, right_id, date)

            for instructor_id in common_instructors:
                applicable_rules = [
                    rule
                    for rule in instructor_break_rules
                    if rule["date"] == date
                    and rule["instructorId"] == instructor_id
                ]
                if not applicable_rules:
                    continue

                left_instructor = instructor_vars[(left_id, instructor_id)]
                right_instructor = instructor_vars[(right_id, instructor_id)]

                hard_minimum = max(
                    (
                        int(rule["minBreakMinutes"])
                        for rule in applicable_rules
                        if rule["hard"]
                    ),
                    default=0,
                )

                for left_room in room_ids_by_occurrence[left_id]:
                    left_room_var = room_vars[(left_id, left_room)]

                    for right_room in room_ids_by_occurrence[right_id]:
                        right_room_var = room_vars[(right_id, right_room)]

                        travel_lr = _travel_minutes(
                            left_room,
                            right_room,
                            travel_matrix,
                        )
                        travel_rl = _travel_minutes(
                            right_room,
                            left_room,
                            travel_matrix,
                        )

                        base_literals = [
                            left_date,
                            right_date,
                            left_instructor,
                            right_instructor,
                            left_room_var,
                            right_room_var,
                        ]

                        if hard_minimum > 0:
                            model.add(
                                left_start
                                + left.duration_minutes
                                + travel_lr
                                + hard_minimum
                                <= right_start
                            ).only_enforce_if(base_literals + [order])

                            model.add(
                                right_start
                                + right.duration_minutes
                                + travel_rl
                                + hard_minimum
                                <= left_start
                            ).only_enforce_if(
                                base_literals + [order.Not()]
                            )

                            instructor_break_rule_constraints += 2

                        for rule_index, rule in enumerate(applicable_rules):
                            if rule["hard"]:
                                continue

                            required = int(rule["minBreakMinutes"])
                            weight = int(rule["weight"])

                            if required <= 0 or weight <= 0:
                                continue

                            deficit_lr = model.new_int_var(
                                0,
                                required,
                                (
                                    f"instructor_break_lr_{left_id}_{right_id}_"
                                    f"{date}_{instructor_id}_{left_room}_"
                                    f"{right_room}_{rule_index}"
                                ),
                            )

                            model.add(
                                deficit_lr
                                >= required
                                - (
                                    right_start
                                    - left_start
                                    - left.duration_minutes
                                    - travel_lr
                                )
                            ).only_enforce_if(base_literals + [order])

                            model.add(deficit_lr == 0).only_enforce_if(
                                [*base_literals, order.Not()]
                            )

                            deficit_rl = model.new_int_var(
                                0,
                                required,
                                (
                                    f"instructor_break_rl_{left_id}_{right_id}_"
                                    f"{date}_{instructor_id}_{left_room}_"
                                    f"{right_room}_{rule_index}"
                                ),
                            )

                            model.add(
                                deficit_rl
                                >= required
                                - (
                                    left_start
                                    - right_start
                                    - right.duration_minutes
                                    - travel_rl
                                )
                            ).only_enforce_if(
                                base_literals + [order.Not()]
                            )

                            model.add(deficit_rl == 0).only_enforce_if(
                                [*base_literals, order]
                            )

                            # Zero the room-specific term whenever this
                            # occurrence/resource combination is not selected.
                            for literal in (
                                left_date,
                                right_date,
                                left_instructor,
                                right_instructor,
                                left_room_var,
                                right_room_var,
                            ):
                                model.add(deficit_lr == 0).only_enforce_if(
                                    literal.Not()
                                )
                                model.add(deficit_rl == 0).only_enforce_if(
                                    literal.Not()
                                )

                            instructor_break_preference_vars.extend(
                                [
                                    deficit_lr * weight,
                                    deficit_rl * weight,
                                ]
                            )

    # Instructor overlap is already covered by AddNoOverlap. The constraints
    # below add only room-to-room travel time when the same instructor is chosen
    # for both occurrences.
    instructor_travel_constraints = 0
    occurrence_ids = [occurrence.id for occurrence in occurrences]

    for left_id, right_id in combinations(occurrence_ids, 2):
        common_instructors = sorted(
            set(instructor_ids_by_occurrence[left_id])
            & set(instructor_ids_by_occurrence[right_id])
        )
        if not common_instructors:
            continue

        left = occurrence_by_id[left_id]
        right = occurrence_by_id[right_id]
        common_dates = sorted(
            set(left.allowed_dates) & set(right.allowed_dates)
        )
        if not common_dates:
            continue

        for date in common_dates:
            left_date = date_vars.get((left_id, date))
            right_date = date_vars.get((right_id, date))
            left_start = start_vars.get((left_id, date))
            right_start = start_vars.get((right_id, date))
            if (
                left_date is None
                or right_date is None
                or left_start is None
                or right_start is None
            ):
                continue

            order = order_var(left_id, right_id, date)

            for instructor_id in common_instructors:
                left_instructor = instructor_vars[(left_id, instructor_id)]
                right_instructor = instructor_vars[(right_id, instructor_id)]

                for left_room in room_ids_by_occurrence[left_id]:
                    left_room_var = room_vars[(left_id, left_room)]
                    for right_room in room_ids_by_occurrence[right_id]:
                        travel_lr = _travel_minutes(
                            left_room,
                            right_room,
                            travel_matrix,
                        )
                        travel_rl = _travel_minutes(
                            right_room,
                            left_room,
                            travel_matrix,
                        )
                        if travel_lr <= 0 and travel_rl <= 0:
                            continue

                        right_room_var = room_vars[(right_id, right_room)]
                        base_literals = [
                            left_date,
                            right_date,
                            left_instructor,
                            right_instructor,
                            left_room_var,
                            right_room_var,
                        ]

                        if travel_lr > 0:
                            model.add(
                                left_start
                                + left.duration_minutes
                                + travel_lr
                                <= right_start
                            ).only_enforce_if(base_literals + [order])
                            instructor_travel_constraints += 1

                        if travel_rl > 0:
                            model.add(
                                right_start
                                + right.duration_minutes
                                + travel_rl
                                <= left_start
                            ).only_enforce_if(base_literals + [order.Not()])
                            instructor_travel_constraints += 1

    model_seconds = perf_counter() - model_started
    selector_count = (
        len(date_vars)
        + len(option_vars)
        + len(room_vars)
        + len(instructor_vars)
        + resource_presence_count
        + len(order_vars)
    )

    if max_time_seconds is None:
        if selector_count < 150_000:
            complexity_budget_seconds = 30.0
        elif selector_count < 400_000:
            complexity_budget_seconds = 120.0
        elif selector_count < 800_000:
            complexity_budget_seconds = 600.0
        elif selector_count < 1_500_000:
            complexity_budget_seconds = 600.0
        elif selector_count < 3_000_000:
            complexity_budget_seconds = 600.0
        else:
            complexity_budget_seconds = 600.0

        solver_time_budget_seconds = min(
            600.0,
            max(complexity_budget_seconds, model_seconds),
        )
    else:
        solver_time_budget_seconds = max(0.01, float(max_time_seconds))

    if selector_count < 150_000:
        solver_worker_count = 8
    elif selector_count < 400_000:
        solver_worker_count = 4
    else:
        solver_worker_count = 2

    emit(
        phase="SOLVING",
        phaseLabel="Finding feasible timetable",
        candidateCount=legacy_candidate_equivalent,
        placementCount=placement_domain_size,
        resourceOptionCount=len(option_vars),
        selectorCount=selector_count,
        candidateSeconds=round(preparation_seconds, 3),
        modelSeconds=round(model_seconds, 3),
        timeLimitSeconds=round(solver_time_budget_seconds, 3),
        solverWorkerCount=solver_worker_count,
        instructorTravelConstraints=instructor_travel_constraints,
        studentBreakConstraints=(
            student_break_constraints + student_travel_constraints
        ),
        message=(
            f"Compact model built in {model_seconds:.1f}s. "
            f"Finding the first feasible timetable."
        ),
    )

    # Phase 1: find any feasible timetable. This is intentionally objective-free
    # and stops at the first solution so users get a usable plan quickly.
    feasibility_solver = cp_model.CpSolver()
    feasibility_solver.parameters.max_time_in_seconds = solver_time_budget_seconds
    feasibility_solver.parameters.num_workers = solver_worker_count
    feasibility_solver.parameters.stop_after_first_solution = True

    feasibility_started = perf_counter()
    feasibility_status_code = feasibility_solver.solve(model)
    feasibility_seconds = perf_counter() - feasibility_started
    feasibility_status = feasibility_solver.status_name(
        feasibility_status_code
    )

    diagnostics: dict[str, object] = {
        "legacyCandidateEquivalent": legacy_candidate_equivalent,
        "placementDomainSize": placement_domain_size,
        "resourceOptionCount": len(option_vars),
        "dateChoiceCount": len(date_vars),
        "roomChoiceCount": len(room_vars),
        "instructorChoiceCount": len(instructor_vars),
        "resourcePresenceCount": resource_presence_count,
        "orderingVariableCount": len(order_vars),
        "studentBundleCount": len(student_bundles),
        "studentBreakConstraintCount": student_break_constraints,
        "studentTravelConstraintCount": student_travel_constraints,
        "studentBreakRuleConstraintCount": student_break_rule_constraints,
        "studentBreakPreferenceTermCount": len(student_break_preference_vars),
        "instructorTravelConstraintCount": instructor_travel_constraints,
        "instructorBreakRuleConstraintCount": instructor_break_rule_constraints,
        "instructorBreakPreferenceTermCount": len(instructor_break_preference_vars),
        "candidateSeconds": round(preparation_seconds, 6),
        "modelSeconds": round(model_seconds, 6),
        "feasibilitySeconds": round(feasibility_seconds, 6),
        "timeLimitSeconds": round(solver_time_budget_seconds, 3),
        "solverWorkerCount": solver_worker_count,
    }

    if feasibility_status not in {"OPTIMAL", "FEASIBLE"}:
        diagnostics["optimizationSeconds"] = 0.0
        diagnostics["solveSeconds"] = round(feasibility_seconds, 6)
        diagnostics["totalSeconds"] = round(perf_counter() - started, 6)
        return MultiDayScheduleResult(
            status=feasibility_status,
            objective_value=0.0,
            sessions=[],
            diagnostics=diagnostics,
        )

    emit(
        phase="SOLVING",
        phaseLabel="Optimizing quality",
        message=(
            f"Feasible timetable found in {feasibility_seconds:.1f}s. "
            f"Optimizing room, staffing and time preferences."
        ),
    )

    def evaluate_student_break_preferences(
        sessions: list[MultiDayScheduledSession],
    ) -> tuple[int, list[dict[str, object]]]:
        """Recalculate soft break cost from a concrete timetable.

        This mirrors the CP-SAT objective so the reported objective and
        diagnostics describe the same quality criteria that were optimized.
        """
        total_penalty = 0
        violations: list[dict[str, object]] = []

        for left_session, right_session in combinations(sessions, 2):
            if left_session.date != right_session.date:
                continue

            shared_students = (
                set(left_session.group.students)
                & set(right_session.group.students)
            )
            if not shared_students:
                continue

            if (
                left_session.start,
                left_session.end,
                left_session.occurrence_id,
            ) <= (
                right_session.start,
                right_session.end,
                right_session.occurrence_id,
            ):
                first = left_session
                second = right_session
            else:
                first = right_session
                second = left_session

            applicable_rules = [
                rule
                for rule in student_break_rules
                if not rule["hard"]
                and break_rule_applies(
                    rule,
                    date=first.date,
                    left_group=first.group,
                    right_group=second.group,
                    shared_students=shared_students,
                )
            ]

            if not applicable_rules:
                continue

            travel_minutes = (
                _travel_minutes(
                    first.room.id,
                    second.room.id,
                    travel_matrix,
                )
                if student_profile.travel_consumes_break_time
                else 0
            )

            real_break = max(
                0,
                second.start - first.end - travel_minutes,
            )

            for rule in applicable_rules:
                required = int(rule["minBreakMinutes"])
                deficit = max(0, required - real_break)

                if deficit <= 0:
                    continue

                penalty = deficit * int(rule["weight"])
                total_penalty += penalty

                violations.append(
                    {
                        "ruleId": rule["ruleId"],
                        "name": rule["name"],
                        "date": first.date,
                        "firstOccurrenceId": first.occurrence_id,
                        "secondOccurrenceId": second.occurrence_id,
                        "firstGroupId": first.group.id,
                        "secondGroupId": second.group.id,
                        "studentId": rule.get("studentId"),
                        "requiredMinutes": required,
                        "actualBreakMinutes": real_break,
                        "travelMinutes": travel_minutes,
                        "deficitMinutes": deficit,
                        "penalty": penalty,
                    }
                )

        return total_penalty, violations


    def evaluate_instructor_break_preferences(
        sessions: list[MultiDayScheduledSession],
    ) -> tuple[int, list[dict[str, object]]]:
        """Evaluate soft instructor-break rules for a concrete timetable."""
        total_penalty = 0
        violations: list[dict[str, object]] = []

        for left_session, right_session in combinations(sessions, 2):
            if left_session.date != right_session.date:
                continue

            shared_instructors = {
                instructor.id
                for instructor in left_session.instructors
            } & {
                instructor.id
                for instructor in right_session.instructors
            }

            if not shared_instructors:
                continue

            if (
                left_session.start,
                left_session.end,
                left_session.occurrence_id,
            ) <= (
                right_session.start,
                right_session.end,
                right_session.occurrence_id,
            ):
                first = left_session
                second = right_session
            else:
                first = right_session
                second = left_session

            travel_minutes = _travel_minutes(
                first.room.id,
                second.room.id,
                travel_matrix,
            )
            real_break = max(
                0,
                second.start - first.end - travel_minutes,
            )

            for instructor_id in shared_instructors:
                for rule in instructor_break_rules:
                    if (
                        rule["hard"]
                        or rule["date"] != first.date
                        or rule["instructorId"] != instructor_id
                    ):
                        continue

                    required = int(rule["minBreakMinutes"])
                    deficit = max(0, required - real_break)

                    if deficit <= 0:
                        continue

                    penalty = deficit * int(rule["weight"])
                    total_penalty += penalty

                    violations.append(
                        {
                            "ruleId": rule["ruleId"],
                            "name": rule["name"],
                            "date": first.date,
                            "instructorId": instructor_id,
                            "firstOccurrenceId": first.occurrence_id,
                            "secondOccurrenceId": second.occurrence_id,
                            "firstGroupId": first.group.id,
                            "secondGroupId": second.group.id,
                            "requiredMinutes": required,
                            "actualBreakMinutes": real_break,
                            "travelMinutes": travel_minutes,
                            "deficitMinutes": deficit,
                            "penalty": penalty,
                        }
                    )

        return total_penalty, violations


    # Save the first solution before the optimization pass. If the remaining
    # time budget is too small or optimization returns UNKNOWN, this solution is
    # still valid and should be returned to the product.
    def selected_solution(
        solver: cp_model.CpSolver,
    ) -> tuple[
        list[MultiDayScheduledSession],
        float,
    ]:
        scheduled: list[MultiDayScheduledSession] = []
        objective = 0.0

        for occurrence in occurrences:
            selected_date: str | None = None
            for date in occurrence.allowed_dates:
                date_var = date_vars.get((occurrence.id, date))
                if date_var is not None and solver.boolean_value(date_var):
                    selected_date = date
                    break

            if selected_date is None:
                raise MultiDayScheduleError(
                    f"Solver did not select a date for occurrence {occurrence.id}."
                )

            start = int(
                solver.value(start_vars[(occurrence.id, selected_date)])
            )
            options = resource_options_by_occurrence[occurrence.id]
            selected_option: _ResourceOption | None = None

            for option_index, option in enumerate(options):
                if solver.boolean_value(
                    option_vars[(occurrence.id, option_index)]
                ):
                    selected_option = option
                    break

            if selected_option is None:
                raise MultiDayScheduleError(
                    f"Solver did not select resources for occurrence {occurrence.id}."
                )

            assigned = tuple(
                instructor_by_id[instructor_id]
                for instructor_id in selected_option.instructor_ids
            )
            staffing_assignments = tuple(
                (role, instructor)
                for role, instructor in zip(
                    selected_option.staffing_roles,
                    assigned,
                )
            )
            group = group_by_id[occurrence.teaching_group_id]

            scheduled.append(
                MultiDayScheduledSession(
                    occurrence_id=occurrence.id,
                    group=group,
                    date=selected_date,
                    start=start,
                    end=start + occurrence.duration_minutes,
                    instructors=assigned,
                    staffing_assignments=staffing_assignments,
                    room=room_by_id[selected_option.room_id],
                )
            )

            objective += selected_option.assignment_penalty
            objective += max(0, start - 8 * 60) // 15
            for rule in placement_rules:
                if (rule["date"] == selected_date and not rule["hard"]
                    and (not rule.get("groupId") or rule["groupId"] == group.id)
                    and (not rule.get("roomId") or rule["roomId"] == selected_option.room_id)
                    and (not rule.get("instructorId") or rule["instructorId"] in selected_option.instructor_ids)):
                    objective += max(0, min(start + occurrence.duration_minutes, rule["endMinute"]) - max(start, rule["startMinute"])) * rule["weight"]

        scheduled.sort(
            key=lambda session: (
                session.date,
                session.start,
                session.end,
                session.occurrence_id,
            )
        )

        break_penalty, _ = evaluate_student_break_preferences(scheduled)
        objective += break_penalty

        instructor_break_penalty, _ = evaluate_instructor_break_preferences(
            scheduled
        )
        objective += instructor_break_penalty

        return scheduled, objective

    feasible_sessions, feasible_objective = selected_solution(
        feasibility_solver
    )

    remaining_seconds = max(
        0.0,
        solver_time_budget_seconds - feasibility_seconds,
    )
    optimization_seconds = 0.0
    final_status = "FEASIBLE"
    final_sessions = feasible_sessions
    final_objective = feasible_objective

    if remaining_seconds >= 0.25:
        # Hint the complete feasible solution into the optimization pass.
        for variable in date_vars.values():
            model.add_hint(variable, feasibility_solver.value(variable))
        for variable in start_vars.values():
            model.add_hint(variable, feasibility_solver.value(variable))
        for variable in option_vars.values():
            model.add_hint(variable, feasibility_solver.value(variable))
        for variable in chosen_start_vars.values():
            model.add_hint(variable, feasibility_solver.value(variable))

        objective_terms = [
            time_penalty_vars[occurrence.id]
            for occurrence in occurrences
        ]
        for occurrence in occurrences:
            for option_index, option in enumerate(
                resource_options_by_occurrence[occurrence.id]
            ):
                objective_terms.append(
                    option.assignment_penalty
                    * option_vars[(occurrence.id, option_index)]
                )

        model.minimize(
            sum(objective_terms)
            + sum(preference_penalty_vars)
            + sum(student_break_preference_vars)
            + sum(instructor_break_preference_vars)
        )

        optimization_solver = cp_model.CpSolver()
        optimization_solver.parameters.max_time_in_seconds = remaining_seconds
        optimization_solver.parameters.num_workers = solver_worker_count

        optimization_started = perf_counter()
        optimization_status_code = optimization_solver.solve(model)
        optimization_seconds = perf_counter() - optimization_started
        optimization_status = optimization_solver.status_name(
            optimization_status_code
        )

        if optimization_status in {"OPTIMAL", "FEASIBLE"}:
            final_sessions, final_objective = selected_solution(
                optimization_solver
            )
            final_status = optimization_status

    diagnostics["optimizationSeconds"] = round(
        optimization_seconds,
        6,
    )
    diagnostics["solveSeconds"] = round(
        feasibility_seconds + optimization_seconds,
        6,
    )
    diagnostics["totalSeconds"] = round(
        perf_counter() - started,
        6,
    )

    violations = []
    for session in final_sessions:
        for rule in placement_rules:
            if (rule["hard"] or rule["date"] != session.date
                or (rule.get("groupId") and rule["groupId"] != session.group.id)
                or (rule.get("roomId") and rule["roomId"] != session.room.id)
                or (rule.get("instructorId") and rule["instructorId"] not in [i.id for i in session.instructors])):
                continue
            minutes = max(0, min(session.end, rule["endMinute"]) - max(session.start, rule["startMinute"]))
            if minutes:
                violations.append({"ruleId": rule["ruleId"], "name": rule["name"],
                    "date": session.date, "occurrenceId": session.occurrence_id,
                    "groupId": session.group.id, "instructorId": rule.get("instructorId"),
                    "roomId": session.room.id, "minutes": minutes, "penalty": minutes * rule["weight"]})
    diagnostics["preferenceViolations"] = violations

    _, student_break_violations = evaluate_student_break_preferences(
        final_sessions
    )
    diagnostics["studentBreakViolations"] = student_break_violations

    _, instructor_break_violations = evaluate_instructor_break_preferences(
        final_sessions
    )
    diagnostics["instructorBreakViolations"] = instructor_break_violations

    return MultiDayScheduleResult(
        status=final_status,
        objective_value=final_objective,
        sessions=final_sessions,
        diagnostics=diagnostics,
    )
