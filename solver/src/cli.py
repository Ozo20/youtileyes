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
   parser.add_argument(
       "--progress",
       action="store_true",
       help="Emit machine-readable progress lines to stdout.",
   )

   args = parser.parse_args()

   def emit_progress(event: dict[str, object]) -> None:
       if not args.progress:
           return

       print(
           "YOUTILEYES_PROGRESS " + json.dumps(event),
           flush=True,
       )

   try:
       payload = load_solver_input(args.input)
       result = run_solver(
           payload,
           progress_callback=emit_progress if args.progress else None,
       )
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
