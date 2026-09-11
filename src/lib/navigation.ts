import {
  CalendarDays,
  FileClock,
  GraduationCap,
  LayoutDashboard,
  MapPin,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";

export const portalNavigation = [
  {
    label: "Overview",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Schedule",
    href: "/schedule",
    icon: CalendarDays,
  },
  {
    label: "Students",
    href: "/students",
    icon: GraduationCap,
  },
  {
    label: "Instructors",
    href: "/instructors",
    icon: Users,
  },
  {
    label: "Locations",
    href: "/locations",
    icon: MapPin,
  },
  {
    label: "Planning",
    href: "/planning",
    icon: SlidersHorizontal,
  },
  {
    label: "History",
    href: "/history",
    icon: FileClock,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
  },
] as const;
