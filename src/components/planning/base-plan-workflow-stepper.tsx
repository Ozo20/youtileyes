import { CheckCircle2, CircleDot, LockKeyhole } from "lucide-react";

type StepState = "complete" | "current" | "locked";

const STEPS = [
  { key: "define", label: "Define", anchor: "#base-plan-define" },
  { key: "calculate", label: "Calculate", anchor: "#base-plan-calculate" },
  { key: "review", label: "Review proposal", anchor: "#base-plan-review" },
  { key: "approval", label: "Approval", anchor: "#base-plan-approval" },
  { key: "publish", label: "Publish", anchor: "#base-plan-publish" },
] as const;

function iconFor(state: StepState) {
  if (state === "complete") return <CheckCircle2 size={14} />;
  if (state === "current") return <CircleDot size={14} />;
  return <LockKeyhole size={13} />;
}

export function BasePlanWorkflowStepper({
  planStatus,
  hasRequirements,
  hasProposal,
  proposalAccepted,
}: {
  planStatus: string;
  hasRequirements: boolean;
  hasProposal: boolean;
  proposalAccepted: boolean;
}) {
  const submitted = ["SUBMITTED", "IN_REVIEW", "REVIEWED", "APPROVED", "PUBLISHED"].includes(planStatus);
  const approvalComplete = ["APPROVED", "PUBLISHED"].includes(planStatus);
  const published = planStatus === "PUBLISHED";
  const reviewComplete = proposalAccepted || submitted;

  const states: Record<(typeof STEPS)[number]["key"], StepState> = {
    define: hasRequirements ? "complete" : "current",
    calculate: !hasRequirements ? "locked" : hasProposal ? "complete" : "current",
    review: !hasProposal ? "locked" : reviewComplete ? "complete" : "current",
    approval: !reviewComplete ? "locked" : approvalComplete ? "complete" : "current",
    publish: !approvalComplete ? "locked" : published ? "complete" : "current",
  };

  return (
    <nav className="planning-workflow-stepper" aria-label="Base Plan workflow">
      {STEPS.map((step, index) => {
        const state = states[step.key];
        const accessible = state !== "locked";
        return (
          <div key={step.key} className="planning-workflow-step" data-state={state}>
            {accessible ? (
              <a href={step.anchor}>
                <span>{iconFor(state)}</span><strong>{index + 1}</strong><em>{step.label}</em>
              </a>
            ) : (
              <div>
                <span>{iconFor(state)}</span><strong>{index + 1}</strong><em>{step.label}</em>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
