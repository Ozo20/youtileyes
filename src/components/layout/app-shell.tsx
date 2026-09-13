import type { ReactNode } from "react";

import { SideNav } from "./side-nav";
import { TopBar } from "./top-bar";

import { getTenantContext, roleAtLeast } from "@/lib/access/tenant-context";

type AppShellProps = {
  children: ReactNode;
};

export async function AppShell({ children }: AppShellProps) {
  const context = await getTenantContext();
  const showAdmin = roleAtLeast(context.role, "ADMIN");

  return (
    <div className="app-shell">
      <TopBar
        institutionName={context.tenant.name}
        userName={context.user.name}
        role={context.role}
      />
      <SideNav showAdmin={showAdmin} />

      <main className="app-content">{children}</main>
    </div>
  );
}
