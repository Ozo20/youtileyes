import {
  Bell,
  ChevronDown,
  CircleCheck,
  Database,
  MapPin,
} from "lucide-react";

export function TopBar() {
  return (
    <header className="top-bar">
      <div className="top-bar-context">
        <div className="top-context-item">
          <Database size={15} />

          <span className="top-context-label">
            Institution
          </span>

          <strong>
            Demo University
          </strong>

          <ChevronDown size={14} />
        </div>

        <div className="top-context-divider" />

        <div className="top-context-item top-context-location">
          <MapPin size={15} />

          <span className="top-context-label">
            Location
          </span>

          <strong>Campus A</strong>
        </div>
      </div>

      <div className="top-bar-actions">
        <button
          type="button"
          className="top-status"
        >
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

        <button
          type="button"
          className="user-menu"
        >
          <span className="user-avatar">OS</span>

          <span className="user-details">
            <strong>Ola Solem</strong>
            <small>Administrator</small>
          </span>

          <ChevronDown size={14} />
        </button>
      </div>
    </header>
  );
}
