import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

import "@/styles/master-data.css";
import "@/styles/schedule.css";

export default function PortalLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return <AppShell>{children}</AppShell>;
}
