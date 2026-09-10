import type { ReactNode } from "react";

type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
};

export function Badge({
  children,
  tone = "neutral",
}: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge-${tone}`}>
      {children}
    </span>
  );
}
