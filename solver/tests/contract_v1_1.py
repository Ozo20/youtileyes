from pathlib import Path

from solver.src.io import load_solver_input
from solver.src.runner import run_solver


def main() -> None:
    fixture = Path("solver/tests/fixtures/solver_input_v1_1.json")
    payload = load_solver_input(fixture)

    if payload.schema_version != "1.1":
        raise SystemExit("Expected schema version 1.1")

    result = run_solver(payload)

    if result.status not in ("OPTIMAL", "FEASIBLE"):
        raise SystemExit(f"Unexpected solver status: {result.status}")

    if len(result.sessions) != 1:
        raise SystemExit("Expected one session")

    session = result.sessions[0]

    if session.instructor_id != "T1" or session.room_id != "A10":
        raise SystemExit(
            "Contract 1.1 preferences did not select the expected assignment"
        )

    print("Solver contract 1.1 test: PASS")


if __name__ == "__main__":
    main()
