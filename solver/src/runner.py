from __future__ import annotations

from .contracts import (
   ScheduledSessionOutput,
   SolverInput,
   SolverMetricOutput,
   SolverOutput,
)
from .models import (
   Instructor,
   LoadProfile,
   Room,
   TeachingGroup,
)
from .scheduler import solve_schedule


def run_solver(payload: SolverInput) -> SolverOutput:
   instructors = [
       Instructor(
           id=item.id,
           name=item.name,
           courses=frozenset(item.course_ids),
       )
       for item in payload.instructors
   ]

   rooms = [
       Room(
           id=item.id,
           name=item.name,
           capacity=item.capacity,
       )
       for item in payload.rooms
   ]

   groups = [
       TeachingGroup(
           id=item.id,
           course=item.course_id,
           students=item.student_ids,
           duration_minutes=item.duration_minutes,
           allowed_rooms=frozenset(item.allowed_room_ids),
       )
       for item in payload.teaching_groups
   ]

   profile = LoadProfile(
       max_teaching_minutes_per_day=(
           payload.student_load_profile.max_teaching_minutes_per_day
       ),
       max_continuous_teaching_minutes=(
           payload.student_load_profile.max_continuous_teaching_minutes
       ),
       min_break_minutes=(
           payload.student_load_profile.min_break_minutes
       ),
       min_break_after_double_minutes=(
           payload.student_load_profile.min_break_after_double_minutes
       ),
       max_sessions_per_day=(
           payload.student_load_profile.max_sessions_per_day
       ),
       min_lunch_minutes=(
           payload.student_load_profile.min_lunch_minutes
       ),
       lunch_window_start=(
           payload.student_load_profile.lunch_window_start
       ),
       lunch_window_end=(
           payload.student_load_profile.lunch_window_end
       ),
       travel_consumes_break_time=(
           payload.student_load_profile.travel_consumes_break_time
       ),
   )

   travel_matrix = {
       (item.from_room_id, item.to_room_id): item.minutes
       for item in payload.travel
   }

   # Same-room movement always costs zero minutes.
   for room in rooms:
       travel_matrix[(room.id, room.id)] = 0

   result = solve_schedule(
       groups=groups,
       instructors=instructors,
       rooms=rooms,
       start_times=list(payload.start_times),
       travel_matrix=travel_matrix,
       student_profile=profile,
   )

   sessions = tuple(
       ScheduledSessionOutput(
           teaching_group_id=session.group.id,
           start_minute=session.start,
           end_minute=session.end,
           instructor_id=session.instructor.id,
           room_id=session.room.id,
       )
       for session in result.sessions
   )

   total_teaching_minutes = sum(
       session.end - session.start
       for session in result.sessions
   )

   metrics = (
       SolverMetricOutput(
           key="scheduledSessionCount",
           value=float(len(result.sessions)),
           unit="count",
       ),
       SolverMetricOutput(
           key="scheduledTeachingMinutes",
           value=float(total_teaching_minutes),
           unit="minutes",
       ),
   )

   return SolverOutput(
       schema_version=payload.schema_version,
       tenant_id=payload.tenant_id,
       plan_scenario_id=payload.plan_scenario_id,
       status=result.status,
       objective_value=result.objective_value,
       sessions=sessions,
       metrics=metrics,
       diagnostics={
           "date": payload.date,
           "inputTeachingGroupCount": len(payload.teaching_groups),
       },
   )
