import {
  CheckCircle2,
  CircleDot,
  Clock3,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  decideRecoveryCaseReviewStep,
  submitRecoveryCaseForReview,
  updateRecoveryApprovalPolicy,
} from "@/lib/planning/recovery-case-actions";

type ReviewStep = {
  id: string;
  caseVersion: number;
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

type RecoveryCaseView = {
  id: string;
  version: number;
  status: string;
  approvalRequired: boolean;
  reviewStatus: string;
  acceptedScenarioId: string | null;
  reviewSteps: ReviewStep[];
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

export function RecoveryApprovalPanel({
  tenantId,
  tenantApprovalRequired,
  recoveryCase,
  baselineFresh,
}: {
  tenantId: string;
  tenantApprovalRequired: boolean;
  recoveryCase: RecoveryCaseView | null;
  baselineFresh: boolean;
}) {
  const currentSteps =
    recoveryCase?.reviewSteps.filter(
      (step) => step.caseVersion === recoveryCase.version,
    ) ?? [];

  const canSubmit =
    recoveryCase?.status === "ACCEPTED" &&
    recoveryCase.approvalRequired &&
    recoveryCase.reviewStatus === "DRAFT" &&
    baselineFresh;

  return (
    <section id="change-approval" className="planning-anchor-section">
      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">Step 4 · Approval</span>
            <h2>Change approval</h2>
          </div>

          <Badge
            tone={
              !recoveryCase
                ? "neutral"
                : recoveryCase.reviewStatus === "APPROVED" ||
                    recoveryCase.reviewStatus === "NOT_REQUIRED"
                  ? "success"
                  : recoveryCase.reviewStatus === "REJECTED" ||
                      recoveryCase.reviewStatus === "RETURNED"
                    ? "danger"
                    : "warning"
            }
          >
            {recoveryCase?.reviewStatus ?? "WAITING"}
          </Badge>
        </CardHeader>

        <CardContent>
          {!recoveryCase ? (
            <p className="planning-muted">
              Define a Recovery Case before approval can be evaluated.
            </p>
          ) : !recoveryCase.acceptedScenarioId ? (
            <div className="planning-workflow-message">
              <CircleDot size={16} />
              <div>
                <strong>Accept a proposal first</strong>
                <span>
                  Approval starts only after the calculated proposal has
                  been reviewed and accepted.
                </span>
              </div>
            </div>
          ) : !baselineFresh ? (
            <div className="planning-workflow-message" data-tone="danger">
              <TriangleAlert size={16} />
              <div>
                <strong>Baseline is no longer current</strong>
                <span>
                  Recalculate this Recovery Case before it can enter
                  approval.
                </span>
              </div>
            </div>
          ) : !recoveryCase.approvalRequired ? (
            <div className="planning-workflow-message" data-tone="success">
              <CheckCircle2 size={16} />
              <div>
                <strong>No additional approval required</strong>
                <span>
                  This case was created under a policy that allows an
                  accepted proposal to proceed directly to publishing.
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="planning-workflow-message">
                <ShieldCheck size={16} />
                <div>
                  <strong>Controlled change approval</strong>
                  <span>
                    The review steps are copied from the plan review
                    workflow when this case is submitted.
                  </span>
                </div>
              </div>

              {canSubmit ? (
                <form
                  action={submitRecoveryCaseForReview}
                  className="planning-workflow-primary-action"
                >
                  <input
                    type="hidden"
                    name="recoveryCaseId"
                    value={recoveryCase.id}
                  />
                  <Button type="submit" variant="primary">
                    Submit change for review
                  </Button>
                </form>
              ) : null}

              {currentSteps.length > 0 ? (
                <div className="planning-review-steps">
                  {currentSteps.map((step) => {
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
                              action={decideRecoveryCaseReviewStep}
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
              ) : null}
            </>
          )}

          <details className="planning-policy-settings">
            <summary>Admin policy</summary>
            <div>
              <p>
                Applies to newly created Recovery Cases. Existing cases
                keep the approval requirement they were created with.
              </p>

              <form action={updateRecoveryApprovalPolicy}>
                <input type="hidden" name="tenantId" value={tenantId} />

                <Button
                  type="submit"
                  name="approvalRequired"
                  value={tenantApprovalRequired ? "false" : "true"}
                  variant="secondary"
                >
                  {tenantApprovalRequired
                    ? "Disable approval for new changes"
                    : "Require approval for new changes"}
                </Button>
              </form>
            </div>
          </details>
        </CardContent>
      </Card>
    </section>
  );
}
