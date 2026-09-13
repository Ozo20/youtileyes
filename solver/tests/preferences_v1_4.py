"""Behavioural tests for subject competence, optional staffing and timed wishes."""
from dataclasses import replace
from solver.src.models import Instructor, Room, StaffingRole, TeachingGroup, LoadProfile
from solver.src.multi_day import MultiDayOccurrence, solve_multi_day_week
from solver.src.io import solver_input_from_dict, SolverInputError

DATE = '2026-09-17'  # Thursday
base = dict(occurrences=[MultiDayOccurrence('O', 'G', 45, (DATE,))],
            groups=[TeachingGroup('G', 'MAT', ('S',), 45, frozenset({'R'}))],
            instructors=[Instructor('A', 'AAA', frozenset({'MAT'}), course_levels={'MAT': 3})],
            rooms=[Room('R', 'Room', 30)], start_times=[660, 720], travel_matrix={}, student_profile=LoadProfile(), max_time_seconds=3)

def solve(**overrides):
    return solve_multi_day_week(**(base | overrides))

def rule(**overrides):
    return dict(ruleId='lunch', name='Lunch', date=DATE, startMinute=690, endMinute=720, hard=False, weight=100) | overrides

result = solve(placement_rules=[rule()])
assert result.sessions[0].start == 720, result
# If there is no alternative, a soft wish permits a lesson and reports 15 affected minutes.
result = solve(start_times=[660], placement_rules=[rule()])
assert result.status in {'FEASIBLE', 'OPTIMAL'}
assert result.objective_value == 1512, result.objective_value
result = solve(start_times=[660], placement_rules=[rule(hard=True)])
assert result.status == 'INFEASIBLE', result
# Instructor-specific preference follows the chosen teacher, not every option.
result = solve(instructors=base['instructors'] + [Instructor('B', 'BBB', frozenset({'MAT'}))], start_times=[660], placement_rules=[rule(instructorId='A')])
assert result.sessions[0].instructors[0].id == 'B'
# Actual end time matters on Friday.
result = solve(start_times=[795, 810], placement_rules=[rule(startMinute=840, endMinute=1440)])
assert result.sessions[0].end == 840
# Required competence excludes an otherwise cheaper teacher.
roles = (StaffingRole('lead', 'LEAD', minimum_course_level=3),)
group = replace(base['groups'][0], staffing_roles=roles)
result = solve(groups=[group], instructors=[Instructor('B', 'BBB', frozenset({'MAT'}), course_levels={'MAT': 2}), *base['instructors']])
assert result.sessions[0].instructors[0].id == 'A'
# A soft assistant can be omitted; a teacher still remains.
result = solve(groups=[replace(group, staffing_roles=(*roles, StaffingRole('assistant', 'ASSISTANT', hard=False)))])
assert len(result.sessions[0].instructors) == 1
# Room staffing thresholds use actual attendance, not room capacity.
result = solve(rooms=[Room('R', 'Room', 30, (StaffingRole('assistant', 'ASSISTANT', minimum_student_count=20),))])
assert len(result.sessions[0].instructors) == 1
# Expired qualification prevents use after expiry, even inside one week.
instructor = replace(base['instructors'][0], qualification_levels={'Q': 3}, qualification_validity={'Q': [None, '2026-09-16']})
result = solve(occurrences=[MultiDayOccurrence('O', 'G', 45, ('2026-09-16', DATE))], groups=[replace(group, staffing_roles=(StaffingRole('lead', 'LEAD', required_qualification_id='Q'),))], instructors=[instructor])
assert result.sessions[0].date == '2026-09-16'
# Accessible room requirement is hard even when the other room is earlier/cheaper.
result = solve(rooms=[*base['rooms'], Room('X', 'Inaccessible', 30)], groups=[replace(group, allowed_rooms=frozenset({'R','X'}))], placement_rules=[rule(roomId='X', startMinute=0, endMinute=1440, hard=True)])
assert result.sessions[0].room.id == 'R'
print('Preferences 1.4 behavioural tests: PASS')
