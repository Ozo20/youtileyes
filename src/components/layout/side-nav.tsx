"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

import { portalNavigation } from "@/lib/navigation";

const STORAGE_KEY = "youtileyes.navigation.pinned";

function getInitialPinnedState() {
  if (typeof window === "undefined") {
    return true;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);

  if (stored === null) {
    return true;
  }

  return stored === "true";
}

export function SideNav() {
  const pathname = usePathname();
  const [pinned, setPinned] = useState(getInitialPinnedState);

  function togglePinned() {
    const next = !pinned;

    setPinned(next);
    window.localStorage.setItem(
      STORAGE_KEY,
      String(next),
    );
  }

  return (
    <aside
      className="side-nav"
      data-pinned={pinned}
    >
      <div className="side-nav-brand">
        <div className="brand-mark">Y</div>

        <span className="brand-name">
          youtileyes
        </span>
      </div>

      <nav className="side-nav-items">
        {portalNavigation.map((item) => {
          const Icon = item.icon;

          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className="side-nav-link"
              data-active={active}
              aria-label={item.label}
            >
              <Icon size={18} />

              <span className="side-nav-label">
                {item.label}
              </span>

              {!pinned ? (
                <span className="side-nav-tooltip">
                  {item.label}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        className="side-nav-toggle"
        onClick={togglePinned}
        aria-label={
          pinned
            ? "Collapse navigation"
            : "Pin navigation"
        }
      >
        {pinned ? (
          <>
            <ChevronLeft size={16} />
            <span>Collapse</span>
          </>
        ) : (
          <ChevronRight size={16} />
        )}
      </button>
    </aside>
  );
}
