from ortools.sat.python import cp_model


def main():
   model = cp_model.CpModel()

   # Three possible start slots.
   start = model.new_int_var(0, 2, "start")

   # Prefer the middle slot.
   penalty = model.new_int_var(0, 2, "penalty")
   model.add_abs_equality(penalty, start - 1)

   model.minimize(penalty)

   solver = cp_model.CpSolver()
   status = solver.solve(model)

   print("Status:", solver.status_name(status))
   print("Selected slot:", solver.value(start))
   print("Penalty:", solver.value(penalty))

   if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
       raise SystemExit("Solver did not find a solution")

   if solver.value(start) != 1:
       raise SystemExit("Unexpected solution")

   print("Smoke test: PASS")


if __name__ == "__main__":
   main()
