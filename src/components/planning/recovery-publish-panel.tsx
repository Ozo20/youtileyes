import {
  CheckCircle2,
  FileOutput,
  LockKeyhole,
  Send,
} from "lucide-react";

import {
  Field,
  TextInput,
} from "@/components/masterdata/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { publishRecoveryCase } from "@/lib/planning/publish-actions";

export function RecoveryPublishPanel({
  recoveryCaseId,
  proposalAccepted,
  baselineFresh,
  approvalSatisfied,
  currentPlanVersion,
  minimumEffectiveFrom,
  defaultEffectiveFrom,
  maximumEffectiveFrom,
}: {
  recoveryCaseId: string | null;
  proposalAccepted: boolean;
  baselineFresh: boolean;
  approvalSatisfied: boolean;
  currentPlanVersion: number;
  minimumEffectiveFrom: string | null;
  defaultEffectiveFrom: string | null;
  maximumEffectiveFrom: string | null;
}) {
  const ready =
    Boolean(recoveryCaseId) &&
    proposalAccepted &&
    baselineFresh &&
    approvalSatisfied &&
    Boolean(defaultEffectiveFrom);

  return (
    <section
      id="change-publish"
      className="planning-anchor-section"
    >
      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">
              Step 5 · Publish
            </span>
            <h2>Publish & distribute</h2>
          </div>

          <Badge tone={ready ? "success" : "neutral"}>
            {ready ? "READY" : "LOCKED"}
          </Badge>
        </CardHeader>

        <CardContent>
          <div className="planning-publish-checks">
            <div data-ok={proposalAccepted}>
              {proposalAccepted ? (
                <CheckCircle2 size={15} />
              ) : (
                <LockKeyhole size={14} />
              )}
              <span>Proposal accepted</span>
            </div>

            <div data-ok={baselineFresh}>
              {baselineFresh ? (
                <CheckCircle2 size={15} />
              ) : (
                <LockKeyhole size={14} />
              )}
              <span>Baseline still current</span>
            </div>

            <div data-ok={approvalSatisfied}>
              {approvalSatisfied ? (
                <CheckCircle2 size={15} />
              ) : (
                <LockKeyhole size={14} />
              )}
              <span>
                Approval requirement satisfied
              </span>
            </div>
          </div>

          <div className="planning-workflow-message">
            <FileOutput size={16} />
            <div>
              <strong>
                Publish as Plan v{currentPlanVersion + 1}
              </strong>
              <span>
                Publishing creates a new controlled plan revision.
                The current revision is retained as history and is
                never overwritten.
              </span>
            </div>
          </div>

          {recoveryCaseId ? (
            <form
              action={publishRecoveryCase}
              className="planning-publish-form"
            >
              <input
                type="hidden"
                name="recoveryCaseId"
                value={recoveryCaseId}
              />

              <Field
                label="Effective from"
                hint="The new revision becomes authoritative from this date. Frozen dates cannot be changed."
              >
                <TextInput
                  type="date"
                  name="effectiveFrom"
                  required
                  min={minimumEffectiveFrom ?? undefined}
                  max={maximumEffectiveFrom ?? undefined}
                  defaultValue={
                    defaultEffectiveFrom ?? undefined
                  }
                  disabled={!ready}
                />
              </Field>

              <div className="planning-publish-action">
                <Button
                  type="submit"
                  variant={ready ? "primary" : "secondary"}
                  disabled={!ready}
                  aria-disabled={!ready}
                >
                  <Send size={14} />
                  {ready
                    ? "Publish new revision"
                    : approvalSatisfied
                      ? "Publish unavailable"
                      : "Waiting for approval"}
                </Button>
              </div>
            </form>
          ) : (
            <p className="planning-muted">
              Complete the Recovery Case before publishing.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
