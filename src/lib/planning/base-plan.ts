export type WeekCapacity = {
  weekStartDate: Date;
  calendarTeachingDays: number;
  availableTeachingDays: number;
  adjustmentReason: string | null;
};

export type WeekAllocation = WeekCapacity & {
  targetMinutes: number;
};

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function startOfUtcMonday(date: Date): Date {
  const result = new Date(`${dateKey(date)}T00:00:00.000Z`);
  const day = result.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  result.setUTCDate(result.getUTCDate() + offset);
  return result;
}

export function endOfUtcDay(date: Date): Date {
  const result = new Date(`${dateKey(date)}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

export function overlapsDay(startAt: Date, endAt: Date, date: Date): boolean {
  const dayStart = new Date(`${dateKey(date)}T00:00:00.000Z`);
  const dayEnd = endOfUtcDay(date);
  return startAt < dayEnd && endAt > dayStart;
}

export function isoWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function distributeMinutes(args: {
  totalMinutes: number;
  quantumMinutes: number;
  minWeeklyMinutes: number | null;
  preferredWeeklyMinutes: number | null;
  maxWeeklyMinutes: number | null;
  mode: "EVEN_BY_TEACHING_CAPACITY" | "EVEN_BY_WEEK" | "FLEXIBLE";
  weeks: WeekCapacity[];
}): WeekAllocation[] {
  const {
    totalMinutes,
    quantumMinutes,
    minWeeklyMinutes,
    preferredWeeklyMinutes,
    maxWeeklyMinutes,
    mode,
    weeks,
  } = args;

  if (totalMinutes < 0) {
    throw new Error("Teaching requirement total cannot be negative.");
  }

  const eligible = weeks.filter((week) => week.availableTeachingDays > 0);

  if (totalMinutes > 0 && eligible.length === 0) {
    throw new Error("No teaching capacity is available for this requirement.");
  }

  const minimum = minWeeklyMinutes ?? 0;
  const maximum = maxWeeklyMinutes;

  if (maximum !== null && minimum > maximum) {
    throw new Error("Minimum weekly hours cannot exceed maximum weekly hours.");
  }

  const minimumRequired = minimum * eligible.length;
  if (totalMinutes < minimumRequired) {
    throw new Error(
      `The period total is too low for the weekly minimum. ` +
      `${eligible.length} teaching weeks × ${minimum} minutes requires at least ${minimumRequired} minutes.`,
    );
  }

  if (maximum !== null) {
    const maximumCapacity = maximum * eligible.length;
    if (totalMinutes > maximumCapacity) {
      throw new Error(
        `The period total is too high for the weekly maximum. ` +
        `${eligible.length} teaching weeks × ${maximum} minutes allows at most ${maximumCapacity} minutes.`,
      );
    }
  }

  const weightFor = (week: WeekCapacity) => {
    if (week.availableTeachingDays === 0) return 0;
    if (mode === "EVEN_BY_WEEK") return 1;
    return week.availableTeachingDays;
  };

  const targets = new Map<string, number>();
  for (const week of weeks) {
    targets.set(
      dateKey(week.weekStartDate),
      week.availableTeachingDays > 0 ? minimum : 0,
    );
  }

  let remaining = totalMinutes - minimumRequired;

  const distributePass = (softCeiling: number | null) => {
    while (remaining > 0) {
      const candidates = eligible
        .map((week) => {
          const key = dateKey(week.weekStartDate);
          const current = targets.get(key) ?? 0;
          const hardRemaining =
            maximum === null ? Number.POSITIVE_INFINITY : maximum - current;
          const softRemaining =
            softCeiling === null ? hardRemaining : softCeiling - current;
          const room = Math.min(hardRemaining, softRemaining);

          return {
            key,
            weight: weightFor(week),
            room,
            current,
          };
        })
        .filter((item) => item.room > 0)
        .sort(
          (left, right) =>
            left.current - right.current ||
            right.weight - left.weight ||
            left.key.localeCompare(right.key),
        );

      if (candidates.length === 0) return;

      let placed = false;

      for (const candidate of candidates) {
        const amount = Math.min(
          quantumMinutes,
          remaining,
          candidate.room,
        );

        if (amount <= 0) continue;

        targets.set(
          candidate.key,
          (targets.get(candidate.key) ?? 0) + amount,
        );
        remaining -= amount;
        placed = true;

        if (remaining <= 0) return;
      }

      if (!placed) return;
    }
  };

  // Preferred weekly hours are a soft target: try to keep all active teaching
  // weeks at or below that level first. If the period total requires more,
  // spill above preferred up to the hard weekly maximum.
  if (preferredWeeklyMinutes !== null && preferredWeeklyMinutes >= minimum) {
    distributePass(preferredWeeklyMinutes);
  }

  distributePass(maximum);

  if (remaining > 0) {
    throw new Error(
      `Unable to allocate the final ${remaining} minutes within the weekly limits.`,
    );
  }

  const allocated = Array.from(targets.values()).reduce(
    (sum, value) => sum + value,
    0,
  );

  if (allocated !== totalMinutes) {
    throw new Error(`Allocation mismatch: ${allocated} != ${totalMinutes}.`);
  }

  return weeks.map((week) => ({
    ...week,
    targetMinutes: targets.get(dateKey(week.weekStartDate)) ?? 0,
  }));
}
