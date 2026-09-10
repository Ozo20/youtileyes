import type { ReactNode } from "react";

import { SideNav } from "./side-nav";
import { TopBar } from "./top-bar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <TopBar />
      <SideNav />

      <main className="app-content">
        {children}
      </main>
    </div>
  );
}
