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
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
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
        const amount = Math.min(quantumMinutes, remaining, candidate.room);

        if (amount <= 0) continue;

        targets.set(candidate.key, (targets.get(candidate.key) ?? 0) + amount);
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

export type CohortCapacityPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export function canPackSessionsAcrossTeachingDays(input: {
  sessionDurations: number[];
  teachingDays: number;
  maxSessionsPerDay: number | null;
  maxTeachingMinutesPerDay: number | null;
}): boolean {
  const durations = input.sessionDurations
    .filter((duration) => duration > 0)
    .sort((left, right) => right - left);

  if (durations.length === 0) {
    return true;
  }

  if (input.teachingDays <= 0) {
    return false;
  }

  const maxSessions =
    input.maxSessionsPerDay === null
      ? Number.POSITIVE_INFINITY
      : input.maxSessionsPerDay;

  const maxMinutes =
    input.maxTeachingMinutesPerDay === null
      ? Number.POSITIVE_INFINITY
      : input.maxTeachingMinutesPerDay;

  if (
    Number.isFinite(maxSessions) &&
    durations.length > input.teachingDays * maxSessions
  ) {
    return false;
  }

  const totalMinutes = durations.reduce(
    (sum, duration) => sum + duration,
    0,
  );

  if (
    Number.isFinite(maxMinutes) &&
    totalMinutes > input.teachingDays * maxMinutes
  ) {
    return false;
  }

  if (
    Number.isFinite(maxMinutes) &&
    durations.some((duration) => duration > maxMinutes)
  ) {
    return false;
  }

  type DayState = {
    minutes: number;
    sessions: number;
  };

  const initialDays: DayState[] = Array.from(
    { length: input.teachingDays },
    () => ({
      minutes: 0,
      sessions: 0,
    }),
  );

  const memo = new Set<string>();

  const canonicalKey = (
    index: number,
    days: DayState[],
  ): string =>
    `${index}|${days
      .map((day) => `${day.minutes}:${day.sessions}`)
      .sort()
      .join("|")}`;

  const place = (
    index: number,
    days: DayState[],
  ): boolean => {
    if (index >= durations.length) {
      return true;
    }

    const key = canonicalKey(index, days);

    if (memo.has(key)) {
      return false;
    }

    const duration = durations[index];
    const attemptedStates = new Set<string>();

    for (
      let dayIndex = 0;
      dayIndex < days.length;
      dayIndex += 1
    ) {
      const day = days[dayIndex];

      if (
        day.sessions >= maxSessions ||
        day.minutes + duration > maxMinutes
      ) {
        continue;
      }

      const stateKey = `${day.minutes}:${day.sessions}`;

      if (attemptedStates.has(stateKey)) {
        continue;
      }

      attemptedStates.add(stateKey);

      const nextDays = days.map((item, index) =>
        index === dayIndex
          ? {
              minutes: item.minutes + duration,
              sessions: item.sessions + 1,
            }
          : item,
      );

      if (place(index + 1, nextDays)) {
        return true;
      }
    }

    memo.add(key);
    return false;
  };

  return place(0, initialDays);
}

function buildSessionDurations(
  targetMinutes: number,
  sessionMinutes: number,
): number[] {
  const durations: number[] = [];
  let remaining = targetMinutes;

  while (remaining > 0) {
    const duration = Math.min(
      sessionMinutes,
      remaining,
    );

    durations.push(duration);
    remaining -= duration;
  }

  return durations;
}

export type CohortCapacityItem = {
  id: string;
  cohortId: string | null;
  priority: CohortCapacityPriority;
  carryoverAllowed: boolean;
  minWeeklyMinutes: number | null;
  maxWeeklyMinutes: number | null;
  quantumMinutes: number;
  sessionMinutes: number;
  allocations: WeekAllocation[];
};

export type CohortCapacityLimits = {
  maxSessionsPerDay: number | null;
  maxTeachingMinutesPerDay: number | null;
};

function priorityValue(priority: CohortCapacityPriority): number {
  switch (priority) {
    case "CRITICAL":
      return 3;
    case "HIGH":
      return 2;
    case "NORMAL":
      return 1;
    case "LOW":
      return 0;
  }
}

export function rebalanceCohortWeeklyCapacity(args: {
  items: CohortCapacityItem[];
  limits: CohortCapacityLimits;
}): CohortCapacityItem[] {
  const { limits } = args;

  const items = args.items.map((item) => ({
    ...item,
    allocations: item.allocations.map((allocation) => ({
      ...allocation,
    })),
  }));

  const capacityEnabled =
    (limits.maxSessionsPerDay !== null && limits.maxSessionsPerDay > 0) ||
    (limits.maxTeachingMinutesPerDay !== null &&
      limits.maxTeachingMinutesPerDay > 0);

  if (!capacityEnabled) {
    return items;
  }

  const cohortIds = Array.from(
    new Set(
      items
        .map((item) => item.cohortId)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  for (const cohortId of cohortIds) {
    const cohortItems = items.filter((item) => item.cohortId === cohortId);

    const weekKeys = Array.from(
      new Set(
        cohortItems.flatMap((item) =>
          item.allocations.map((allocation) =>
            dateKey(allocation.weekStartDate),
          ),
        ),
      ),
    ).sort();

    const allocationFor = (item: CohortCapacityItem, weekKey: string) =>
      item.allocations.find(
        (allocation) => dateKey(allocation.weekStartDate) === weekKey,
      );

    const getWeekLoad = (
      weekKey: string,
      override?: {
        itemId: string;
        targetMinutes: number;
      },
    ) => {
      let sessions = 0;
      let minutes = 0;
      let availableTeachingDays = 0;
      const sessionDurations: number[] = [];

      for (const item of cohortItems) {
        const allocation = allocationFor(
          item,
          weekKey,
        );

        if (!allocation) continue;

        const targetMinutes =
          override?.itemId === item.id
            ? override.targetMinutes
            : allocation.targetMinutes;

        minutes += targetMinutes;

        const itemDurations =
          buildSessionDurations(
            targetMinutes,
            item.sessionMinutes,
          );

        sessions += itemDurations.length;
        sessionDurations.push(...itemDurations);

        // A cohort/global block reduces this value for every group.
        // A group-specific block must not make the whole cohort appear
        // unavailable on a day that its other groups may still use.
        availableTeachingDays = Math.max(
          availableTeachingDays,
          allocation.availableTeachingDays,
        );
      }

      const sessionCapacity =
        limits.maxSessionsPerDay === null
          ? Number.POSITIVE_INFINITY
          : availableTeachingDays *
            limits.maxSessionsPerDay;

      const minuteCapacity =
        limits.maxTeachingMinutesPerDay === null
          ? Number.POSITIVE_INFINITY
          : availableTeachingDays *
            limits.maxTeachingMinutesPerDay;

      const packable =
        canPackSessionsAcrossTeachingDays({
          sessionDurations,
          teachingDays: availableTeachingDays,
          maxSessionsPerDay:
            limits.maxSessionsPerDay,
          maxTeachingMinutesPerDay:
            limits.maxTeachingMinutesPerDay,
        });

      return {
        sessions,
        minutes,
        sessionDurations,
        availableTeachingDays,
        sessionCapacity,
        minuteCapacity,
        packable,
      };
    };

    for (const sourceWeekKey of weekKeys) {
      let safetyCounter = 0;

      while (true) {
        const sourceLoad = getWeekLoad(sourceWeekKey);

        const sessionOverflow =
          sourceLoad.sessions > sourceLoad.sessionCapacity;

        const minuteOverflow =
          sourceLoad.minutes >
          sourceLoad.minuteCapacity;

        const packingOverflow =
          !sourceLoad.packable;

        if (
          !sessionOverflow &&
          !minuteOverflow &&
          !packingOverflow
        ) {
          break;
        }

        safetyCounter += 1;

        if (safetyCounter > 1000) {
          throw new Error(
            `Unable to rebalance weekly capacity for cohort ${cohortId}.`,
          );
        }

        const sourceItems = [...cohortItems].sort(
          (left, right) =>
            priorityValue(left.priority) - priorityValue(right.priority) ||
            left.id.localeCompare(right.id),
        );

        let moved = false;

        for (const sourceItem of sourceItems) {
          if (!sourceItem.carryoverAllowed) continue;

          const sourceAllocation = allocationFor(sourceItem, sourceWeekKey);

          if (!sourceAllocation || sourceAllocation.targetMinutes <= 0) {
            continue;
          }

          const minimum = sourceItem.minWeeklyMinutes ?? 0;

          const maxMovable = sourceAllocation.targetMinutes - minimum;

          if (maxMovable <= 0) continue;

          const sessionsBefore = Math.ceil(
            sourceAllocation.targetMinutes / sourceItem.sessionMinutes,
          );

          let amount = sourceItem.quantumMinutes;

          // When session count is the binding limit, move enough
          // minutes to remove at least one actual occurrence.
          if (sessionOverflow && sessionsBefore > 0) {
            const targetForOneFewerSession =
              (sessionsBefore - 1) * sourceItem.sessionMinutes;

            const requiredReduction =
              sourceAllocation.targetMinutes - targetForOneFewerSession;

            amount =
              Math.ceil(
                Math.max(requiredReduction, 1) / sourceItem.quantumMinutes,
              ) * sourceItem.quantumMinutes;
          }

          amount = Math.min(amount, maxMovable);

          if (amount <= 0) continue;

          const sourceMinutesAfter = sourceAllocation.targetMinutes - amount;

          const sourceSessionsAfter =
            sourceMinutesAfter > 0
              ? Math.ceil(sourceMinutesAfter / sourceItem.sessionMinutes)
              : 0;

          if (sessionOverflow && sourceSessionsAfter >= sessionsBefore) {
            continue;
          }

          const sourceTime = new Date(
            `${sourceWeekKey}T00:00:00.000Z`,
          ).getTime();

          const destinationWeekKeys = weekKeys
            .filter((weekKey) => weekKey !== sourceWeekKey)
            .sort((left, right) => {
              const leftDistance = Math.abs(
                new Date(`${left}T00:00:00.000Z`).getTime() - sourceTime,
              );

              const rightDistance = Math.abs(
                new Date(`${right}T00:00:00.000Z`).getTime() - sourceTime,
              );

              return leftDistance - rightDistance || left.localeCompare(right);
            });

          for (const destinationWeekKey of destinationWeekKeys) {
            const destinationAllocation = allocationFor(
              sourceItem,
              destinationWeekKey,
            );

            if (
              !destinationAllocation ||
              destinationAllocation.availableTeachingDays <= 0
            ) {
              continue;
            }

            if (
              sourceItem.maxWeeklyMinutes !== null &&
              destinationAllocation.targetMinutes + amount >
                sourceItem.maxWeeklyMinutes
            ) {
              continue;
            }

            const destinationLoad =
              getWeekLoad(
                destinationWeekKey,
                {
                  itemId: sourceItem.id,
                  targetMinutes:
                    destinationAllocation.targetMinutes +
                    amount,
                },
              );

            if (
              destinationLoad.sessions >
                destinationLoad.sessionCapacity ||
              destinationLoad.minutes >
                destinationLoad.minuteCapacity ||
              !destinationLoad.packable
            ) {
              continue;
            }

            sourceAllocation.targetMinutes -= amount;
            destinationAllocation.targetMinutes += amount;

            sourceAllocation.adjustmentReason =
              "Teaching demand moved because cohort weekly capacity was reduced";

            destinationAllocation.adjustmentReason =
              "Teaching demand received from a reduced-capacity week";

            moved = true;
            break;
          }

          if (moved) break;
        }

        if (!moved) {
          const load = getWeekLoad(sourceWeekKey);

          throw new Error(
            `Cohort ${cohortId} requires ${load.sessions} sessions / ` +
              `${load.minutes} minutes in week ${sourceWeekKey}, but the ` +
              `session mix cannot be distributed across ` +
              `${load.availableTeachingDays} teaching day(s) within the ` +
              `configured daily session and teaching-minute limits.`,
          );
        }
      }
    }
  }

  return items;
}
