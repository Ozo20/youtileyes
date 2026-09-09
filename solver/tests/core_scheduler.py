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
           frozenset({"ENG", "MAT"}),
       ),
   ]

   rooms = [
       Room("A10", "A10", 6),
       Room("B14", "B14", 6),
   ]

   groups = [
       TeachingGroup(
           "G1",
           "MAT",
           ("S1", "S2", "S3", "S4"),
           90,
           frozenset({"A10"}),
       ),
       TeachingGroup(
           "G2",
           "ENG",
           ("S1", "S2", "S5"),
           45,
           frozenset({"B14"}),
       ),
       TeachingGroup(
           "G3",
           "FYS",
           ("S3", "S4", "S6"),
           45,
           frozenset({"B14"}),
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
   ]

   travel_matrix = {
       ("A10", "A10"): 0,
       ("B14", "B14"): 0,
       ("A10", "B14"): 12,
       ("B14", "A10"): 12,
   }

   profile = LoadProfile(
       max_teaching_minutes_per_day=240,
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
   print("=== YOUTILEYES CORE SCHEDULER ===")
   print("Status:", result.status)
   print("Objective:", result.objective_value)
   print()

   if result.status not in ("OPTIMAL", "FEASIBLE"):
       raise SystemExit("Core scheduler found no solution.")

   for session in result.sessions:
       print(
           f"{session.group.course:<3} | "
           f"{display_time(session.start)}-"
           f"{display_time(session.end)} | "
           f"{session.instructor.name:<7} | "
           f"{session.room.name}"
       )

   if len(result.sessions) != len(groups):
       raise SystemExit(
           "Not all teaching groups were scheduled."
       )

   print()
   print("Core scheduler test: PASS")


if __name__ == "__main__":
   main()
