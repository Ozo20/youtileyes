from collections import defaultdict
from dataclasses import dataclass

from ortools.sat.python import cp_model

from .constraints import (
   overlaps,
   real_break_minutes,
   required_break_after,
   travel_minutes,
)
from .models import (
   Candidate,
   Instructor,
   LoadProfile,
   Room,
   ScheduledSession,
   TeachingGroup,
)


@dataclass
class ScheduleResult:
   status: str
   objective_value: float
   sessions: list[ScheduledSession]


class ScheduleError(RuntimeError):
   pass


def build_candidates(
   groups: list[TeachingGroup],
   instructors: list[Instructor],
   rooms: list[Room],
   start_times: list[int],
) -> list[Candidate]:
   candidates: list[Candidate] = []

   for group in groups:
       for start in start_times:
           end = start + group.duration_minutes

           for instructor in instructors:
               if group.course not in instructor.courses:
                   continue

               for room in rooms:
                   if room.id not in group.allowed_rooms:
                       continue

                   if len(group.students) > room.capacity:
                       continue

                   assignment_penalty = (
                       instructor.course_penalties.get(group.course, 0)
                       + group.room_penalties.get(room.id, 0)
                       + group.instructor_penalties.get(instructor.id, 0)
                   )

                   candidates.append(
                       Candidate(
                           group_id=group.id,
                           start=start,
                           end=end,
                           instructor_id=instructor.id,
                           room_id=room.id,
                           assignment_penalty=assignment_penalty,
                       )
                   )

   return candidates


def solve_schedule(
   *,
   groups: list[TeachingGroup],
   instructors: list[Instructor],
   rooms: list[Room],
   start_times: list[int],
   travel_matrix: dict[tuple[str, str], int],
   student_profile: LoadProfile,
   instructor_profile: LoadProfile | None = None,
   max_time_seconds: float = 10,
) -> ScheduleResult:
   model = cp_model.CpModel()

   instructor_profile = instructor_profile or student_profile

   group_by_id = {group.id: group for group in groups}
   instructor_by_id = {
       instructor.id: instructor
       for instructor in instructors
   }
   room_by_id = {room.id: room for room in rooms}

   candidates = build_candidates(
       groups,
       instructors,
       rooms,
       start_times,
   )

   variables = [
       model.new_bool_var(
           f"{candidate.group_id}_"
           f"{candidate.start}_"
           f"{candidate.instructor_id}_"
           f"{candidate.room_id}"
       )
       for candidate in candidates
   ]

   candidates_by_group: dict[str, list[int]] = defaultdict(list)

   for index, candidate in enumerate(candidates):
       candidates_by_group[candidate.group_id].append(index)

   # Every teaching group must be scheduled exactly once.
   for group in groups:
       group_indices = candidates_by_group[group.id]

       if not group_indices:
           raise ScheduleError(
               f"No valid assignment candidates for group {group.id}"
           )

       model.add(
           sum(variables[index] for index in group_indices) == 1
       )

   # Pairwise incompatibilities.
   for left_index, left in enumerate(candidates):
       left_group = group_by_id[left.group_id]

       for right_index in range(left_index + 1, len(candidates)):
           right = candidates[right_index]
           right_group = group_by_id[right.group_id]

           if left.group_id == right.group_id:
               continue

           incompatible = False

           # Room collision.
           if (
               left.room_id == right.room_id
               and overlaps(left, right)
           ):
               incompatible = True

           # Instructor collision.
           if (
               left.instructor_id == right.instructor_id
               and overlaps(left, right)
           ):
               incompatible = True

           shared_students = (
               set(left_group.students)
               & set(right_group.students)
           )

           if shared_students:
               if overlaps(left, right):
                   incompatible = True

               elif left.end <= right.start:
                   actual_break = real_break_minutes(
                       left,
                       right,
                       travel_matrix,
                       student_profile.travel_consumes_break_time,
                   )
                   minimum_break = required_break_after(
                       left_group,
                       student_profile,
                   )

                   if actual_break < minimum_break:
                       incompatible = True

               elif right.end <= left.start:
                   actual_break = real_break_minutes(
                       right,
                       left,
                       travel_matrix,
                       student_profile.travel_consumes_break_time,
                   )
                   minimum_break = required_break_after(
                       right_group,
                       student_profile,
                   )

                   if actual_break < minimum_break:
                       incompatible = True

           # Instructor travel / break.
           if (
               left.instructor_id == right.instructor_id
               and not overlaps(left, right)
           ):
               if left.end <= right.start:
                   physical_travel = travel_minutes(
                       left.room_id,
                       right.room_id,
                       travel_matrix,
                   )

                   if right.start - left.end < physical_travel:
                       incompatible = True

               elif right.end <= left.start:
                   physical_travel = travel_minutes(
                       right.room_id,
                       left.room_id,
                       travel_matrix,
                   )

                   if left.start - right.end < physical_travel:
                       incompatible = True

           if incompatible:
               model.add(
                   variables[left_index]
                   + variables[right_index]
                   <= 1
               )

   # Maximum sessions per day for students.
   if student_profile.max_sessions_per_day is not None:
       students = {
           student
           for group in groups
           for student in group.students
       }

       for student in students:
           group_ids = {
               group.id
               for group in groups
               if student in group.students
           }

           student_vars = [
               variables[index]
               for index, candidate in enumerate(candidates)
               if candidate.group_id in group_ids
           ]

           model.add(
               sum(student_vars)
               <= student_profile.max_sessions_per_day
           )

   # Maximum teaching minutes per student per day.
   if student_profile.max_teaching_minutes_per_day is not None:
       students = {
           student
           for group in groups
           for student in group.students
       }

       for student in students:
           terms = []

           for index, candidate in enumerate(candidates):
               group = group_by_id[candidate.group_id]

               if student in group.students:
                   terms.append(
                       group.duration_minutes * variables[index]
                   )

           model.add(
               sum(terms)
               <= student_profile.max_teaching_minutes_per_day
           )

   students = {
       student
       for group in groups
       for student in group.students
   }

   # Hard constraint: maximum continuous teaching.
   #
   # For each student, forbid candidate combinations that would create
   # a teaching chain longer than the configured maximum without a
   # sufficient break between sessions.
   if student_profile.max_continuous_teaching_minutes is not None:
       for student in students:
           relevant_indices = [
               index
               for index, candidate in enumerate(candidates)
               if student in group_by_id[candidate.group_id].students
           ]

           for left_pos, left_index in enumerate(relevant_indices):
               left = candidates[left_index]

               for right_index in relevant_indices[left_pos + 1:]:
                   right = candidates[right_index]

                   if left.group_id == right.group_id:
                       continue

                   ordered = sorted(
                       (left, right),
                       key=lambda candidate: candidate.start,
                   )
                   first, second = ordered

                   if overlaps(first, second):
                       continue

                   gap = real_break_minutes(
                       first,
                       second,
                       travel_matrix,
                       student_profile.travel_consumes_break_time,
                   )

                   # If there is no meaningful break, the sessions belong
                   # to the same continuous teaching block.
                   if gap < student_profile.min_break_minutes:
                       continuous_span = second.end - first.start

                       if (
                           continuous_span
                            > student_profile.max_continuous_teaching_minutes
                       ):
                           model.add(
                               variables[left_index]
                               + variables[right_index]
                               <= 1
                           )

   # Hard constraint: lunch opportunity.
   #
   # If lunch is configured, every student must retain at least one
   # uninterrupted lunch interval inside the configured lunch window.
   if (
       student_profile.min_lunch_minutes is not None
       and student_profile.lunch_window_start is not None
       and student_profile.lunch_window_end is not None
   ):
       lunch_start = student_profile.lunch_window_start
       lunch_end = student_profile.lunch_window_end
       lunch_length = student_profile.min_lunch_minutes

       possible_lunch_starts = list(
           range(
               lunch_start,
               lunch_end - lunch_length + 1,
               15,
           )
       )

       for student in students:
           lunch_options = []

           for option_start in possible_lunch_starts:
               option_end = option_start + lunch_length
               lunch_var = model.new_bool_var(
                   f"lunch_{student}_{option_start}"
               )
               lunch_options.append(lunch_var)

               conflicting_indices = []

               for index, candidate in enumerate(candidates):
                   group = group_by_id[candidate.group_id]

                   if student not in group.students:
                       continue

                   if (
                       candidate.start < option_end
                       and option_start < candidate.end
                   ):
                       conflicting_indices.append(index)

               for index in conflicting_indices:
                   model.add(
                       variables[index] + lunch_var <= 1
                   )

           if lunch_options:
               model.add(sum(lunch_options) >= 1)

   # Soft objectives.
   objective_terms = []

   first_start = min(start_times)

   # Mild preference for earlier sessions, plus persisted resource
   # suitability/qualification/preference penalties from the input model.
   for index, candidate in enumerate(candidates):
       objective_terms.append(
           (candidate.start - first_start)
           * variables[index]
       )

       if candidate.assignment_penalty != 0:
           objective_terms.append(
               candidate.assignment_penalty * variables[index]
           )

   # Penalise room changes for students.
   #
   # Pairwise penalty variables are only active if both assignments
   # are selected.
   room_change_penalty = 20

   for student in students:
       relevant_indices = [
           index
           for index, candidate in enumerate(candidates)
           if student in group_by_id[candidate.group_id].students
       ]

       for left_pos, left_index in enumerate(relevant_indices):
           left = candidates[left_index]

           for right_index in relevant_indices[left_pos + 1:]:
               right = candidates[right_index]

               if left.group_id == right.group_id:
                   continue

               if left.room_id == right.room_id:
                   continue

               pair_var = model.new_bool_var(
                   f"room_change_"
                   f"{student}_{left_index}_{right_index}"
               )

               model.add(
                   pair_var <= variables[left_index]
               )
               model.add(
                   pair_var <= variables[right_index]
               )
               model.add(
                   pair_var >= variables[left_index]
                   + variables[right_index]
                   - 1
               )

               objective_terms.append(
                   room_change_penalty * pair_var
               )

   # Penalise long idle gaps for students.
   #
   # This is deliberately a soft criterion. Real breaks remain hard
   # constraints; excess waiting is simply discouraged.
   idle_penalty_per_minute = 1

   for student in students:
       relevant_indices = [
           index
           for index, candidate in enumerate(candidates)
           if student in group_by_id[candidate.group_id].students
       ]

       for left_pos, left_index in enumerate(relevant_indices):
           left = candidates[left_index]

           for right_index in relevant_indices[left_pos + 1:]:
               right = candidates[right_index]

               if left.group_id == right.group_id:
                   continue

               if left.end <= right.start:
                   first, second = left, right
               elif right.end <= left.start:
                   first, second = right, left
               else:
                   continue

               gap = real_break_minutes(
                   first,
                   second,
                   travel_matrix,
                   student_profile.travel_consumes_break_time,
               )

               # Do not penalise the necessary break itself.
               excess_idle = max(
                   0,
                   gap - student_profile.min_break_minutes,
               )

               if excess_idle == 0:
                   continue

               pair_var = model.new_bool_var(
                   f"idle_"
                   f"{student}_{left_index}_{right_index}"
               )

               model.add(
                   pair_var <= variables[left_index]
               )
               model.add(
                   pair_var <= variables[right_index]
               )
               model.add(
                   pair_var
                   >= variables[left_index]
                   + variables[right_index]
                   - 1
               )

               objective_terms.append(
                   idle_penalty_per_minute
                   * excess_idle
                   * pair_var
               )

   model.minimize(sum(objective_terms))

   solver = cp_model.CpSolver()
   solver.parameters.max_time_in_seconds = max_time_seconds
   solver.parameters.num_workers = 8

   status = solver.solve(model)

   if status not in (
       cp_model.OPTIMAL,
       cp_model.FEASIBLE,
   ):
       return ScheduleResult(
           status=solver.status_name(status),
           objective_value=0,
           sessions=[],
       )

   selected: list[ScheduledSession] = []

   for index, candidate in enumerate(candidates):
       if solver.value(variables[index]) != 1:
           continue

       selected.append(
           ScheduledSession(
               group=group_by_id[candidate.group_id],
               start=candidate.start,
               end=candidate.end,
               instructor=instructor_by_id[
                   candidate.instructor_id
               ],
               room=room_by_id[candidate.room_id],
           )
       )

   selected.sort(
       key=lambda session: (
           session.start,
           session.group.id,
       )
   )

   return ScheduleResult(
       status=solver.status_name(status),
       objective_value=solver.objective_value,
       sessions=selected,
   )
