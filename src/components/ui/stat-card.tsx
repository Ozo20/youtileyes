import type { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
};

export function StatCard({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
}: StatCardProps) {
  return (
    <div className="stat-card" data-tone={tone}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {icon ? <span className="stat-card-icon">{icon}</span> : null}
      </div>

      <div className="stat-card-value">{value}</div>

      {detail ? (
        <div className="stat-card-detail">{detail}</div>
      ) : null}
    </div>
  );
}
