export type PlanningStatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

export function solverJobStatusLabel(status: string) {
  switch (status) {
    case "QUEUED":
      return "Waiting to start";
    case "RUNNING":
      return "In progress";
    case "SUCCEEDED":
      return "Completed";
    case "FAILED":
      return "Could not complete";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function solverJobStatusTone(
  status: string,
): PlanningStatusTone {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "FAILED":
    case "CANCELLED":
      return "danger";
    case "RUNNING":
      return "warning";
    case "QUEUED":
      return "info";
    default:
      return "neutral";
  }
}

export function scenarioStatusLabel(status: string) {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "GENERATING":
      return "Creating proposal";
    case "GENERATED":
      return "Ready for review";
    case "ACCEPTED":
      return "Selected proposal";
    case "REJECTED":
      return "Rejected";
    case "FAILED":
      return "Could not complete";
    case "CANCELLED":
      return "Cancelled";
    case "SUBMITTED":
      return "Submitted";
    case "IN_REVIEW":
      return "Under review";
    case "REVIEWED":
      return "Reviewed";
    case "APPROVED":
      return "Approved";
    default:
      return status.replaceAll("_", " ");
  }
}

export function recoveryCaseStatusLabel(status: string) {
  switch (status) {
    case "OPEN":
      return "Changes being defined";
    case "GENERATING":
      return "Creating proposal";
    case "READY":
      return "Proposal ready";
    case "ACCEPTED":
      return "Proposal selected";
    case "CLOSED":
      return "Completed";
    case "FAILED":
      return "Could not complete";
    default:
      return status.replaceAll("_", " ");
  }
}

export function solverRunOutcomeLabel(status: string) {
  switch (status) {
    case "STARTED":
      return "Calculation in progress";
    case "OPTIMAL":
    case "FEASIBLE":
      return "Valid timetable found";
    case "INFEASIBLE":
      return "No valid timetable found";
    case "UNKNOWN":
      return "No result";
    case "FAILED":
      return "Calculation failed";
    case "CANCELLED":
      return "Calculation cancelled";
    default:
      return status;
  }
}
