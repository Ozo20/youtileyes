from dataclasses import dataclass
from ortools.sat.python import cp_model


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
   duration_slots: int


# 45-minute slots with 15-minute breaks represented by slot boundaries.
SLOTS = [
   ("Mon 08:15", 0),
   ("Mon 09:15", 1),
   ("Mon 10:15", 2),
   ("Mon 11:15", 3),
   ("Mon 12:15", 4),
   ("Mon 13:15", 5),
]

teachers = [
   Teacher("T1", "Hansen", frozenset({"MAT", "FYS"})),
   Teacher("T2", "Olsen", frozenset({"ENG", "MAT"})),
]

rooms = [
   Room("R1", "A10", 6),
   Room("R2", "B14", 4),
]

groups = [
   TeachingGroup(
       "G1",
       "MAT",
       ("S1", "S2", "S3", "S4"),
       2,  # double session
   ),
   TeachingGroup(
       "G2",
       "ENG",
       ("S1", "S2", "S5"),
       1,
   ),
   TeachingGroup(
       "G3",
       "FYS",
       ("S3", "S4", "S6"),
       1,
   ),
]


def main():
   model = cp_model.CpModel()

   assignments = {}

   # Create an assignment variable for every valid
   # group/start/teacher/room combination.
   for group in groups:
       latest_start = len(SLOTS) - group.duration_slots

       for start in range(latest_start + 1):
           for teacher in teachers:
               if group.course not in teacher.courses:
                   continue

               for room in rooms:
                   if len(group.students) > room.capacity:
                       continue

                   key = (group.id, start, teacher.id, room.id)
                   assignments[key] = model.new_bool_var(
                       f"{group.id}_{start}_{teacher.id}_{room.id}"
                   )

   # Every teaching group must be scheduled exactly once.
   for group in groups:
       candidates = [
           var
           for (group_id, _, _, _), var in assignments.items()
           if group_id == group.id
       ]
       model.add(sum(candidates) == 1)

   # Prevent teacher conflicts.
   for teacher in teachers:
       for slot in range(len(SLOTS)):
           active = []

           for group in groups:
               for (group_id, start, teacher_id, _), var in assignments.items():
                   if group_id != group.id or teacher_id != teacher.id:
                       continue

                   if start <= slot < start + group.duration_slots:
                       active.append(var)

           if active:
               model.add(sum(active) <= 1)

   # Prevent room conflicts.
   for room in rooms:
       for slot in range(len(SLOTS)):
           active = []

           for group in groups:
               for (group_id, start, _, room_id), var in assignments.items():
                   if group_id != group.id or room_id != room.id:
                       continue

                   if start <= slot < start + group.duration_slots:
                       active.append(var)

           if active:
               model.add(sum(active) <= 1)

   # Prevent students from having overlapping classes.
   students = sorted(
       {student for group in groups for student in group.students}
   )

   for student in students:
       for slot in range(len(SLOTS)):
           active = []

           for group in groups:
               if student not in group.students:
                   continue

               for (group_id, start, _, _), var in assignments.items():
                   if group_id != group.id:
                       continue

                   if start <= slot < start + group.duration_slots:
                       active.append(var)

           if active:
               model.add(sum(active) <= 1)

   # Soft optimisation:
   # Prefer earlier sessions, but strongly discourage the final slot.
   penalties = []

   for (_, start, _, _), var in assignments.items():
       penalty = start

       if start >= 4:
           penalty += 5

       penalties.append(penalty * var)

   model.minimize(sum(penalties))

   solver = cp_model.CpSolver()
   solver.parameters.max_time_in_seconds = 10
   solver.parameters.num_workers = 8

   status = solver.solve(model)

   print()
   print("=== YOUTILEYES DEMO SCHEDULE ===")
   print("Status:", solver.status_name(status))
   print("Objective:", solver.objective_value)
   print()

   if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
       raise SystemExit("No feasible timetable found.")

   selected = []

   for key, var in assignments.items():
       if solver.value(var) != 1:
           continue

       group_id, start, teacher_id, room_id = key
       group = next(g for g in groups if g.id == group_id)
       teacher = next(t for t in teachers if t.id == teacher_id)
       room = next(r for r in rooms if r.id == room_id)

       selected.append((start, group, teacher, room))

   for start, group, teacher, room in sorted(selected, key=lambda item: (item[0], item[1].id)):
       end_slot = start + group.duration_slots - 1

       print(
           f"{group.id} {group.course:<3} | "
           f"{SLOTS[start][0]} -> {SLOTS[end_slot][0]} | "
           f"{teacher.name:<7} | "
           f"{room.name:<3} | "
           f"{len(group.students)} students"
       )

   print()
   print("Students:")
   for student in students:
       student_sessions = [
           (start, group)
           for start, group, _, _ in selected
           if student in group.students
       ]

       labels = [
           f"{group.course}@{SLOTS[start][0]}"
           for start, group in sorted(student_sessions, key=lambda item: (item[0], item[1].id))
       ]

       print(f"  {student}: {', '.join(labels)}")

   print()
   print("Demo solver test: PASS")


if __name__ == "__main__":
   main()
