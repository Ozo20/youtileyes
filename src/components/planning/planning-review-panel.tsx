import {
  CheckCircle2,
  CircleDot,
  Clock3,
  RotateCcw,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  decidePlanReviewStep,
  submitPlanForReview,
} from "@/lib/planning/workspace-actions";

type ReviewStep = {
  id: string;
  stage: number;
  position: number;
  name: string;
  reviewerRole: string | null;
  reviewerName: string | null;
  required: boolean;
  status: string;
  decisions: Array<{
    id: string;
    decision: string;
    actorName: string | null;
    comment: string | null;
    decidedAt: Date;
  }>;
};

type Workflow = {
  id: string;
  name: string;
  status: string;
  steps: ReviewStep[];
};

function StepIcon({ status }: { status: string }) {
  if (status === "APPROVED") return <CheckCircle2 size={16} />;
  if (status === "REJECTED") return <XCircle size={16} />;
  if (status === "RETURNED") return <RotateCcw size={16} />;
  if (status === "READY" || status === "IN_REVIEW") {
    return <CircleDot size={16} />;
  }

  return <Clock3 size={16} />;
}

export function PlanningReviewPanel({
  planId,
  planStatus,
  workflow,
}: {
  planId: string;
  planStatus: string;
  workflow: Workflow | null;
}) {
  const canSubmit =
    planStatus === "DRAFT" ||
    planStatus === "GENERATED" ||
    planStatus === "REVIEWED";

  return (
    <Card>
      <CardHeader>
        <div>
          <span className="eyebrow">Review</span>
          <h2>{workflow?.name ?? "No review workflow"}</h2>
        </div>

        {canSubmit && workflow ? (
          <form action={submitPlanForReview}>
            <input type="hidden" name="planId" value={planId} />
            <Button type="submit" variant="primary">
              Submit for review
            </Button>
          </form>
        ) : null}
      </CardHeader>

      <CardContent>
        {!workflow ? (
          <p className="planning-muted">
            Configure a review workflow before submitting the plan.
          </p>
        ) : (
          <div className="planning-review-steps">
            {workflow.steps.map((step) => {
              const actionable =
                step.status === "READY" ||
                step.status === "IN_REVIEW";
              const latestDecision = step.decisions[0];

              return (
                <div
                  key={step.id}
                  className="planning-review-step"
                  data-status={step.status}
                >
                  <div className="planning-review-icon">
                    <StepIcon status={step.status} />
                  </div>

                  <div className="planning-review-body">
                    <div className="planning-review-title">
                      <strong>
                        Stage {step.stage} · {step.name}
                      </strong>
                      <span>{step.status}</span>
                    </div>

                    <p>
                      {step.reviewerRole ?? "No reviewer role"}
                      {step.reviewerName
                        ? ` · ${step.reviewerName}`
                        : ""}
                    </p>

                    {latestDecision ? (
                      <small>
                        {latestDecision.decision}
                        {latestDecision.actorName
                          ? ` by ${latestDecision.actorName}`
                          : ""}
                        {latestDecision.comment
                          ? ` · ${latestDecision.comment}`
                          : ""}
                      </small>
                    ) : null}

                    {actionable ? (
                      <form
                        action={decidePlanReviewStep}
                        className="planning-review-actions"
                      >
                        <input
                          type="hidden"
                          name="stepId"
                          value={step.id}
                        />

                        <input
                          className="planning-review-comment"
                          name="comment"
                          placeholder="Optional review comment"
                        />

                        <div>
                          <Button
                            type="submit"
                            name="decision"
                            value="APPROVE"
                            variant="primary"
                          >
                            Approve
                          </Button>

                          <Button
                            type="submit"
                            name="decision"
                            value="RETURN_FOR_CHANGES"
                            variant="secondary"
                          >
                            Return
                          </Button>

                          <Button
                            type="submit"
                            name="decision"
                            value="REJECT"
                            variant="ghost"
                          >
                            Reject
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
