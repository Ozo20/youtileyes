from dataclasses import dataclass
from ortools.sat.python import cp_model


# All times are represented as minutes after midnight.
def clock(hour: int, minute: int) -> int:
   return hour * 60 + minute


def display_time(value: int) -> str:
   return f"{value // 60:02d}:{value % 60:02d}"


@dataclass(frozen=True)
class Teacher:
   id: str
   name: str
   courses: frozenset[str]


@dataclass(frozen=True)
class Room:
   id: str
   name: str
   capacity: int


@dataclass(frozen=True)
class TeachingGroup:
   id: str
   course: str
   students: tuple[str, ...]
   duration_minutes: int
   allowed_rooms: frozenset[str]


@dataclass(frozen=True)
class Candidate:
   group_id: str
   start: int
   end: int
   teacher_id: str
   room_id: str


START_TIMES = [
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


teachers = [
   Teacher("T1", "Hansen", frozenset({"MAT", "FYS"})),
   Teacher("T2", "Olsen", frozenset({"ENG", "MAT"})),
]

rooms = [
   Room("A10", "A10", 6),
   Room("B14", "B14", 6),
]

groups = [
   TeachingGroup(
       id="G1",
       course="MAT",
       students=("S1", "S2", "S3", "S4"),
       duration_minutes=90,  # Real double session.
       allowed_rooms=frozenset({"A10"}),
   ),
   TeachingGroup(
       id="G2",
       course="ENG",
       students=("S1", "S2", "S5"),
       duration_minutes=45,
       allowed_rooms=frozenset({"B14"}),
   ),
   TeachingGroup(
       id="G3",
       course="FYS",
       students=("S3", "S4", "S6"),
       duration_minutes=45,
       allowed_rooms=frozenset({"B14"}),
   ),
]


# Minimum physical travel time between rooms.
TRAVEL_MINUTES = {
   ("A10", "A10"): 0,
   ("B14", "B14"): 0,
   ("A10", "B14"): 12,
   ("B14", "A10"): 12,
}

MIN_REAL_BREAK = 15
MIN_REAL_BREAK_AFTER_DOUBLE = 20


def overlaps(a: Candidate, b: Candidate) -> bool:
   return a.start < b.end and b.start < a.end


def real_break(first: Candidate, second: Candidate) -> int:
   if first.end > second.start:
       return -1

   calendar_gap = second.start - first.end
   travel = TRAVEL_MINUTES[(first.room_id, second.room_id)]
   return calendar_gap - travel


def required_break(group: TeachingGroup) -> int:
   if group.duration_minutes >= 90:
       return MIN_REAL_BREAK_AFTER_DOUBLE

   return MIN_REAL_BREAK


def main() -> None:
   model = cp_model.CpModel()

   group_by_id = {group.id: group for group in groups}
   teacher_by_id = {teacher.id: teacher for teacher in teachers}
   room_by_id = {room.id: room for room in rooms}

   candidates: list[Candidate] = []
   variables: list[cp_model.IntVar] = []

   # Generate all valid candidate assignments.
   for group in groups:
       for start in START_TIMES:
           end = start + group.duration_minutes

           for teacher in teachers:
               if group.course not in teacher.courses:
                   continue

               for room in rooms:
                   if room.id not in group.allowed_rooms:
                       continue

                   if len(group.students) > room.capacity:
                       continue

                   candidate = Candidate(
                       group_id=group.id,
                       start=start,
                       end=end,
                       teacher_id=teacher.id,
                       room_id=room.id,
                   )

                   candidates.append(candidate)
                   variables.append(
                       model.new_bool_var(
                           f"{group.id}_{start}_{teacher.id}_{room.id}"
                       )
                   )

   # Each teaching group must be scheduled exactly once.
   for group in groups:
       group_vars = [
           variables[index]
           for index, candidate in enumerate(candidates)
           if candidate.group_id == group.id
       ]
       model.add(sum(group_vars) == 1)

   # Compare candidate pairs and forbid combinations that violate
   # rooms, teachers, students, travel time or real-break rules.
   for left_index in range(len(candidates)):
       left = candidates[left_index]
       left_group = group_by_id[left.group_id]

       for right_index in range(left_index + 1, len(candidates)):
           right = candidates[right_index]
           right_group = group_by_id[right.group_id]

           if left.group_id == right.group_id:
               continue

           incompatible = False

           # Same room cannot contain overlapping sessions.
           if left.room_id == right.room_id and overlaps(left, right):
               incompatible = True

           # Same teacher cannot teach overlapping sessions.
           if left.teacher_id == right.teacher_id and overlaps(left, right):
               incompatible = True

           shared_students = set(left_group.students) & set(right_group.students)

           if shared_students:
               # Students cannot attend overlapping sessions.
               if overlaps(left, right):
                   incompatible = True

               # If sessions do not overlap, check the actual usable break.
               elif left.end <= right.start:
                   actual_break = real_break(left, right)
                   minimum_break = required_break(left_group)

                   if actual_break < minimum_break:
                       incompatible = True

               elif right.end <= left.start:
                   actual_break = real_break(right, left)
                   minimum_break = required_break(right_group)

                   if actual_break < minimum_break:
                       incompatible = True

           # Teacher also needs enough time to physically change rooms.
           if left.teacher_id == right.teacher_id and not overlaps(left, right):
               if left.end <= right.start:
                   travel = TRAVEL_MINUTES[(left.room_id, right.room_id)]
                   if right.start - left.end < travel:
                       incompatible = True

               elif right.end <= left.start:
                   travel = TRAVEL_MINUTES[(right.room_id, left.room_id)]
                   if left.start - right.end < travel:
                       incompatible = True

           if incompatible:
               model.add(
                   variables[left_index] + variables[right_index] <= 1
               )

   # Prefer earlier teaching while retaining feasibility.
   objective_terms = []

   beginning = min(START_TIMES)

   for index, candidate in enumerate(candidates):
       start_penalty = candidate.start - beginning
       objective_terms.append(start_penalty * variables[index])

   model.minimize(sum(objective_terms))

   solver = cp_model.CpSolver()
   solver.parameters.max_time_in_seconds = 10
   solver.parameters.num_workers = 8

   status = solver.solve(model)

   print()
   print("=== YOUTILEYES TRAVEL + BREAK TEST ===")
   print("Status:", solver.status_name(status))
   print("Objective:", solver.objective_value)
   print()

   if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
       raise SystemExit("No feasible timetable found.")

   selected: list[Candidate] = [
       candidate
       for index, candidate in enumerate(candidates)
       if solver.value(variables[index]) == 1
   ]

   selected.sort(key=lambda candidate: (candidate.start, candidate.group_id))

   for candidate in selected:
       group = group_by_id[candidate.group_id]
       teacher = teacher_by_id[candidate.teacher_id]
       room = room_by_id[candidate.room_id]

       print(
           f"{group.id} {group.course:<3} | "
           f"{display_time(candidate.start)}-{display_time(candidate.end)} | "
           f"{teacher.name:<7} | "
           f"{room.name:<3} | "
           f"{group.duration_minutes} min"
       )

   print()
   print("=== STUDENT BREAK ANALYSIS ===")

   students = sorted(
       {student for group in groups for student in group.students}
   )

   for student in students:
       student_sessions = [
           candidate
           for candidate in selected
           if student in group_by_id[candidate.group_id].students
       ]

       student_sessions.sort(key=lambda candidate: candidate.start)

       print(f"{student}:")

       if len(student_sessions) < 2:
           print("  One session only.")
           continue

       for first, second in zip(
           student_sessions,
           student_sessions[1:],
           strict=False,
       ):
           first_group = group_by_id[first.group_id]

           calendar_gap = second.start - first.end
           travel = TRAVEL_MINUTES[(first.room_id, second.room_id)]
           actual_break = calendar_gap - travel
           minimum = required_break(first_group)

           print(
               f"  {first_group.course} -> "
               f"{group_by_id[second.group_id].course}: "
               f"gap={calendar_gap} min, "
               f"travel={travel} min, "
               f"real break={actual_break} min, "
               f"required={minimum} min"
           )

           if actual_break < minimum:
               raise SystemExit(
                   f"Invalid break found for {student}: "
                   f"{actual_break} < {minimum}"
               )

   print()
   print("Travel + real-break constraints: PASS")


if __name__ == "__main__":
   main()
