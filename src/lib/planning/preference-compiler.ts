/** Pure compilation shared by solver input and tests. Times are local school minutes. */
export type PlacementRule = {
  ruleId: string; name: string; date: string; groupId?: string;
  instructorId?: string; roomId?: string; startMinute: number; endMinute: number;
  hard: boolean; weight: number;
};
type Validity = { validFrom: Date | null; validTo: Date | null };
export function validOn(rule: Validity, date: string) {
  return (!rule.validFrom || rule.validFrom.toISOString().slice(0, 10) <= date)
    && (!rule.validTo || rule.validTo.toISOString().slice(0, 10) >= date);
}
export type TimeRule = Validity & {
  id: string; name: string; weekdays: number[]; startMinute: number | null; endMinute: number | null;
  audience: string; scopeType: string; constraintType: string; weight: number;
  studentId: string | null; instructorId: string | null; teachingGroupId: string | null;
  studentCohortId: string | null; courseId: string | null;
};
export function compileTimeRules(rules: TimeRule[], dates: string[], groups: {
  id: string; courseId: string; studentCohortId: string | null; studentIds: string[];
}[], instructorIds: string[]): PlacementRule[] {
  const result: PlacementRule[] = [];
  for (const rule of rules) {
    if (rule.startMinute == null || rule.endMinute == null || rule.endMinute <= rule.startMinute) {
      throw new Error(`Invalid time interval for ${rule.name}`);
    }
    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
      if (!validOn(rule, date) || (rule.weekdays.length && !rule.weekdays.includes(weekday))) continue;
      const base = { ruleId: rule.id, name: rule.name, date, startMinute: rule.startMinute,
        endMinute: rule.endMinute, hard: rule.constraintType === 'HARD', weight: rule.weight };
      if (rule.instructorId) {
        result.push({ ...base, instructorId: rule.instructorId });
      } else if (rule.audience === 'INSTRUCTORS') {
        for (const instructorId of instructorIds) result.push({ ...base, instructorId });
      } else if (rule.scopeType === 'TENANT' && rule.audience === 'ALL') {
        result.push(base); // A common lunch counts once per session, not once per attendee.
      } else {
        for (const group of groups) {
          if (rule.studentId && !group.studentIds.includes(rule.studentId)) continue;
          if (rule.teachingGroupId && rule.teachingGroupId !== group.id) continue;
          if (rule.studentCohortId && rule.studentCohortId !== group.studentCohortId) continue;
          if (rule.courseId && rule.courseId !== group.courseId) continue;
          if (group.studentIds.length) result.push({ ...base, groupId: group.id });
        }
      }
    }
  }
  return result;
}
export type StudentBreakRule = {
  ruleId: string;
  name: string;
  date: string;
  minBreakMinutes: number;
  hard: boolean;
  weight: number;
  studentId?: string;
  groupId?: string;
  courseId?: string;
};

export type BreakRule = Validity & {
  id: string;
  name: string;
  weekdays: number[];
  audience: string;
  scopeType: string;
  constraintType: string;
  weight: number;
  valueInt: number | null;
  studentId: string | null;
  instructorId: string | null;
  teachingGroupId: string | null;
  studentCohortId: string | null;
  courseId: string | null;
};

export function compileStudentBreakRules(
  rules: BreakRule[],
  dates: string[],
  groups: {
    id: string;
    courseId: string;
    studentCohortId: string | null;
    studentIds: string[];
  }[],
): StudentBreakRule[] {
  const result: StudentBreakRule[] = [];

  for (const rule of rules) {
    if (rule.valueInt == null || !Number.isInteger(rule.valueInt) || rule.valueInt < 0) {
      throw new Error(`Invalid minimum break for ${rule.name}`);
    }

    // Instructor break rules use a different solver mechanism because
    // instructors are assigned dynamically. They are compiled separately.
    if (rule.instructorId || rule.audience === 'INSTRUCTORS') continue;

    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
      if (
        !validOn(rule, date) ||
        (rule.weekdays.length && !rule.weekdays.includes(weekday))
      ) {
        continue;
      }

      const base = {
        ruleId: rule.id,
        name: rule.name,
        date,
        minBreakMinutes: rule.valueInt,
        hard: rule.constraintType === 'HARD',
        weight: rule.weight,
      };

      if (rule.studentId) {
        result.push({ ...base, studentId: rule.studentId });
        continue;
      }

      if (rule.teachingGroupId) {
        result.push({ ...base, groupId: rule.teachingGroupId });
        continue;
      }

      if (rule.courseId) {
        result.push({ ...base, courseId: rule.courseId });
        continue;
      }

      if (rule.studentCohortId) {
        for (const group of groups) {
          if (group.studentCohortId === rule.studentCohortId) {
            result.push({ ...base, groupId: group.id });
          }
        }
        continue;
      }

      if (rule.scopeType === 'TENANT' && rule.audience !== 'INSTRUCTORS') {
        result.push(base);
      }
    }
  }

  return result;
}

export type InstructorBreakRule = {
  ruleId: string;
  name: string;
  date: string;
  minBreakMinutes: number;
  hard: boolean;
  weight: number;
  instructorId: string;
};

export function compileInstructorBreakRules(
  rules: BreakRule[],
  dates: string[],
  instructorIds: string[],
): InstructorBreakRule[] {
  const result: InstructorBreakRule[] = [];

  for (const rule of rules) {
    if (rule.valueInt == null || !Number.isInteger(rule.valueInt) || rule.valueInt < 0) {
      throw new Error(`Invalid minimum break for ${rule.name}`);
    }

    const targets =
      rule.instructorId
        ? [rule.instructorId]
        : rule.audience === 'INSTRUCTORS'
          ? instructorIds
          : [];

    if (!targets.length) continue;

    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;

      if (
        !validOn(rule, date) ||
        (rule.weekdays.length && !rule.weekdays.includes(weekday))
      ) {
        continue;
      }

      for (const instructorId of targets) {
        result.push({
          ruleId: rule.id,
          name: rule.name,
          date,
          minBreakMinutes: rule.valueInt,
          hard: rule.constraintType === 'HARD',
          weight: rule.weight,
          instructorId,
        });
      }
    }
  }

  return result;
}

export type FeatureRequirement = {
  id: string; featureId: string; quantity: number; perStudent: boolean;
  hard: boolean; weight: number; courseId: string | null; studentId: string | null;
  instructorId: string | null;
};
export function roomRequirementCost(requirements: FeatureRequirement[], quantities: Map<string, number>, studentCount: number) {
  let penalty = 0;
  const missing: string[] = [];
  for (const rule of requirements) {
    const deficit = Math.max(0, rule.quantity * (rule.perStudent ? studentCount : 1) - (quantities.get(rule.featureId) ?? 0));
    if (deficit && rule.hard) missing.push(rule.featureId);
    if (!rule.hard) penalty += deficit * rule.weight;
  }
  return { allowed: missing.length === 0, penalty, missing };
}
