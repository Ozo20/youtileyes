import {
  CheckCircle2,
  CircleDot,
  LockKeyhole,
} from "lucide-react";

type StepState = "complete" | "current" | "locked";

const STEPS = [
  { key: "define", label: "Define", anchor: "#change-define" },
  { key: "calculate", label: "Calculate", anchor: "#change-calculate" },
  { key: "review", label: "Review proposal", anchor: "#change-review" },
  { key: "approval", label: "Approval", anchor: "#change-approval" },
  { key: "publish", label: "Publish", anchor: "#change-publish" },
] as const;

function iconFor(state: StepState) {
  if (state === "complete") return <CheckCircle2 size={14} />;
  if (state === "current") return <CircleDot size={14} />;
  return <LockKeyhole size={13} />;
}

export function RecoveryWorkflowStepper({
  hasCase,
  disruptionCount,
  hasProposal,
  proposalAccepted,
  approvalRequired,
  approvalComplete,
  baselineFresh,
}: {
  hasCase: boolean;
  disruptionCount: number;
  hasProposal: boolean;
  proposalAccepted: boolean;
  approvalRequired: boolean;
  approvalComplete: boolean;
  baselineFresh: boolean;
}) {
  const defineComplete = hasCase && disruptionCount > 0;
  const calculateComplete = hasProposal;
  const reviewComplete = proposalAccepted;
  const approvalSatisfied =
    reviewComplete && (!approvalRequired || approvalComplete);

  const states: Record<(typeof STEPS)[number]["key"], StepState> = {
    define: !defineComplete ? "current" : "complete",
    calculate: !defineComplete
      ? "locked"
      : !calculateComplete
        ? "current"
        : "complete",
    review: !calculateComplete
      ? "locked"
      : !reviewComplete
        ? "current"
        : "complete",
    approval: !reviewComplete
      ? "locked"
      : !approvalSatisfied
        ? "current"
        : "complete",
    publish:
      approvalSatisfied && baselineFresh ? "current" : "locked",
  };

  return (
    <nav
      className="planning-workflow-stepper"
      aria-label="Recovery workflow"
    >
      {STEPS.map((step, index) => {
        const state = states[step.key];
        const accessible = state !== "locked";

        return (
          <div
            key={step.key}
            className="planning-workflow-step"
            data-state={state}
          >
            {accessible ? (
              <a href={step.anchor}>
                <span>{iconFor(state)}</span>
                <strong>{index + 1}</strong>
                <em>{step.label}</em>
              </a>
            ) : (
              <div>
                <span>{iconFor(state)}</span>
                <strong>{index + 1}</strong>
                <em>{step.label}</em>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
