import type { TenantRole } from "@/generated/prisma/client";
import {
  Bell,
  ChevronDown,
  CircleCheck,
  Database,
  MapPin,
} from "lucide-react";

type TopBarProps = {
  institutionName: string;
  userName: string;
  role: TenantRole;
};

function roleLabel(role: TenantRole) {
  if (role === "ADMIN") return "Administrator";
  if (role === "PLANNER") return "Planner";
  if (role === "VIEWER") return "Viewer";
  return "Member";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function TopBar({ institutionName, userName, role }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-context">
        <div className="top-context-item">
          <Database size={15} />

          <span className="top-context-label">Institution</span>

          <strong>{institutionName}</strong>

          <ChevronDown size={14} />
        </div>

        <div className="top-context-divider" />

        <div className="top-context-item top-context-location">
          <MapPin size={15} />

          <span className="top-context-label">Location</span>

          <strong>Campus A</strong>
        </div>
      </div>

      <div className="top-bar-actions">
        <button type="button" className="top-status">
          <CircleCheck size={15} />
          <span>No active conflicts</span>
        </button>

        <button
          type="button"
          className="top-icon-button"
          aria-label="Notifications"
        >
          <Bell size={18} />
        </button>

        <button type="button" className="user-menu">
          <span className="user-avatar">{initials(userName)}</span>

          <span className="user-details">
            <strong>{userName}</strong>
            <small>{roleLabel(role)}</small>
          </span>

          <ChevronDown size={14} />
        </button>
      </div>
    </header>
  );
}
