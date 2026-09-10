import { Prisma } from "../../generated/prisma/client";

export type RecoveryScenarioSession = {
  occurrenceId: string;
  teachingGroupId: string;
  date: string;
  startMinute: number;
  endMinute: number;
  instructorId: string;
  roomId: string;
};

export type RecoveryScenarioChange = {
  occurrenceId: string;
  teachingGroupId: string | null;
  direct: boolean;
  before: {
    date: string | null;
    startMinute: number | null;
    endMinute: number | null;
    instructorId: string | null;
    roomId: string | null;
  } | null;
  after: {
    date: string | null;
    startMinute: number | null;
    endMinute: number | null;
    instructorId: string | null;
    roomId: string | null;
  } | null;
  changedFields: string[];
};

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function scenarioChangeType(
  changedFields: string[],
):
  | "CREATED"
  | "MOVED"
  | "ROOM_CHANGED"
  | "INSTRUCTOR_CHANGED"
  | "OTHER" {
  if (changedFields.includes("presence")) return "CREATED";

  if (
    changedFields.includes("date") ||
    changedFields.includes("startMinute") ||
    changedFields.includes("endMinute")
  ) {
    return "MOVED";
  }

  if (
    changedFields.includes("instructorId") &&
    !changedFields.includes("roomId")
  ) {
    return "INSTRUCTOR_CHANGED";
  }

  if (
    changedFields.includes("roomId") &&
    !changedFields.includes("instructorId")
  ) {
    return "ROOM_CHANGED";
  }

  return "OTHER";
}

export function buildScenarioName(
  resourceLabel: string,
  dateFrom: string,
  dateTo: string,
) {
  const range = dateFrom === dateTo ? dateFrom : `${dateFrom}–${dateTo}`;
  return `Recovery · ${resourceLabel} · ${range}`;
}
