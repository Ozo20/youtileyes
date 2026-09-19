"use client";

import { useEffect, useState } from "react";

export function LocalTime({
  value,
}: {
  value: string;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);

  useEffect(() => {
    const date = new Date(value);

    const formatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    setLabel(formatter.format(date));
    setTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  }, [value]);

  return (
    <span title={timeZone ?? undefined}>
      {label ?? "…"}
    </span>
  );
}
