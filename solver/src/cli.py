from __future__ import annotations

import argparse
import json
import sys

from .io import load_solver_input, write_solver_output
from .runner import run_solver


def main() -> None:
   parser = argparse.ArgumentParser(
       description="Run the Youtileyes scheduling solver."
   )
   parser.add_argument(
       "--input",
       required=True,
       help="Path to solver input JSON.",
   )
   parser.add_argument(
       "--output",
       required=True,
       help="Path to solver output JSON.",
   )

   args = parser.parse_args()

   try:
       payload = load_solver_input(args.input)
       result = run_solver(payload)
       write_solver_output(result, args.output)

   except Exception as exc:
       print(
           json.dumps(
               {
                   "status": "FAILED",
                   "error": str(exc),
               }
           ),
           file=sys.stderr,
       )
       raise


if __name__ == "__main__":
   main()
