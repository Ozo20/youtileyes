from solver.src.models import (
   Instructor,
   LoadProfile,
   Room,
   TeachingGroup,
)
from solver.src.scheduler import solve_schedule
from solver.src.time_utils import clock, display_time


def main() -> None:
   instructors = [
       Instructor(
           "T1",
           "Hansen",
           frozenset({"MAT", "FYS"}),
       ),
       Instructor(
           "T2",
           "Olsen",
           frozenset({"ENG", "NOR"}),
       ),
   ]

   rooms = [
       Room("A10", "A10", 10),
       Room("A11", "A11", 10),
       Room("B14", "B14", 10),
   ]

   # S1 attends all four courses, so the solver must create
   # a realistic full day for this student.
   groups = [
       TeachingGroup(
           "G1",
           "MAT",
           ("S1", "S2"),
           90,
           frozenset({"A10"}),
       ),
       TeachingGroup(
           "G2",
           "ENG",
           ("S1", "S3"),
           45,
           frozenset({"A11", "B14"}),
       ),
       TeachingGroup(
           "G3",
           "FYS",
           ("S1", "S4"),
           45,
           frozenset({"A10", "B14"}),
       ),
       TeachingGroup(
           "G4",
           "NOR",
           ("S1", "S5"),
           45,
           frozenset({"A11"}),
       ),
   ]

   start_times = [
       clock(8, 15),
       clock(8, 30),
       clock(8, 45),
       clock(9, 0),
       clock(9, 15),
       clock(9, 30),
       clock(9, 45),
       clock(10, 0),
       clock(10, 15),
       clock(10, 30),
       clock(10, 45),
       clock(11, 0),
       clock(11, 15),
       clock(11, 30),
       clock(11, 45),
       clock(12, 0),
       clock(12, 15),
       clock(12, 30),
       clock(12, 45),
       clock(13, 0),
       clock(13, 15),
       clock(13, 30),
       clock(13, 45),
       clock(14, 0),
   ]

   travel_matrix = {
       ("A10", "A10"): 0,
       ("A11", "A11"): 0,
       ("B14", "B14"): 0,
       ("A10", "A11"): 3,
       ("A11", "A10"): 3,
       ("A10", "B14"): 12,
       ("B14", "A10"): 12,
       ("A11", "B14"): 12,
       ("B14", "A11"): 12,
   }

   profile = LoadProfile(
       max_teaching_minutes_per_day=270,
       max_continuous_teaching_minutes=120,
       min_break_minutes=15,
       min_break_after_double_minutes=20,
       max_sessions_per_day=4,
       min_lunch_minutes=30,
       lunch_window_start=clock(11, 0),
       lunch_window_end=clock(13, 30),
       travel_consumes_break_time=True,
   )

   result = solve_schedule(
       groups=groups,
       instructors=instructors,
       rooms=rooms,
       start_times=start_times,
       travel_matrix=travel_matrix,
       student_profile=profile,
   )

   print()
   print("=== YOUTILEYES STUDENT DAY QUALITY ===")
   print("Status:", result.status)
   print("Objective:", result.objective_value)
   print()

   if result.status not in ("OPTIMAL", "FEASIBLE"):
       raise SystemExit("No feasible student day found.")

   for session in result.sessions:
       print(
           f"{session.group.course:<3} | "
           f"{display_time(session.start)}-"
           f"{display_time(session.end)} | "
           f"{session.instructor.name:<7} | "
           f"{session.room.name}"
       )

   s1_sessions = [
       session
       for session in result.sessions
       if "S1" in session.group.students
   ]

   if len(s1_sessions) != 4:
       raise SystemExit(
           f"S1 should have 4 sessions, got {len(s1_sessions)}"
       )

   total_minutes = sum(
       session.end - session.start
       for session in s1_sessions
   )

   if total_minutes > profile.max_teaching_minutes_per_day:
       raise SystemExit(
           "Maximum teaching minutes per day exceeded."
       )

   print()
   print(f"S1 teaching minutes: {total_minutes}")
   print(
       "Required lunch:",
       f"{profile.min_lunch_minutes} min",
       f"between {display_time(profile.lunch_window_start)}",
       f"and {display_time(profile.lunch_window_end)}",
   )

   print()
   print("Student day quality test: PASS")


if __name__ == "__main__":
   main()
