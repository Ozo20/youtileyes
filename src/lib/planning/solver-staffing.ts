export type SolverStaffingAssignment = {
  role: "LEAD" | "ASSISTANT" | "SUPPORT" | "OTHER";
  instructorId: string;
};

export type SolverSessionStaffingLike = {
  instructor_id?: string | null;
  instructorId?: string | null;
  instructor_ids?: string[] | null;
  instructorIds?: string[] | null;
  staffing_assignments?: Array<{
    role?: string | null;
    instructor_id?: string | null;
    instructorId?: string | null;
  }> | null;
  staffingAssignments?: Array<{
    role?: string | null;
    instructor_id?: string | null;
    instructorId?: string | null;
  }> | null;
};

const VALID_ROLES = new Set([
  "LEAD",
  "ASSISTANT",
  "SUPPORT",
  "OTHER",
]);

function normalizeRole(
  value: string | null | undefined,
): SolverStaffingAssignment["role"] {
  const role = value?.toUpperCase();

  return role && VALID_ROLES.has(role)
    ? (role as SolverStaffingAssignment["role"])
    : "OTHER";
}

export function normalizeSolverStaffing(
  session: SolverSessionStaffingLike,
): SolverStaffingAssignment[] {
  const rawAssignments =
    session.staffing_assignments ??
    session.staffingAssignments ??
    [];

  const assignments: SolverStaffingAssignment[] = [];
  const seen = new Set<string>();

  for (const raw of rawAssignments) {
    const instructorId =
      raw.instructor_id ?? raw.instructorId ?? null;

    if (!instructorId || seen.has(instructorId)) continue;

    assignments.push({
      role: normalizeRole(raw.role),
      instructorId,
    });
    seen.add(instructorId);
  }

  const rawInstructorIds =
    session.instructor_ids ??
    session.instructorIds ??
    [];

  for (const instructorId of rawInstructorIds) {
    if (!instructorId || seen.has(instructorId)) continue;

    assignments.push({
      role: assignments.length === 0 ? "LEAD" : "OTHER",
      instructorId,
    });
    seen.add(instructorId);
  }

  const legacyInstructorId =
    session.instructor_id ??
    session.instructorId ??
    null;

  if (legacyInstructorId && !seen.has(legacyInstructorId)) {
    assignments.unshift({
      role: "LEAD",
      instructorId: legacyInstructorId,
    });
  }

  if (
    assignments.length > 0 &&
    !assignments.some((assignment) => assignment.role === "LEAD")
  ) {
    assignments[0] = {
      ...assignments[0],
      role: "LEAD",
    };
  }

  return assignments;
}

export function staffingInstructorIds(
  assignments: SolverStaffingAssignment[],
) {
  return assignments.map((assignment) => assignment.instructorId);
}
