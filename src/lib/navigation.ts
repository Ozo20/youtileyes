import {
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  DoorOpen,
  FileClock,
  GraduationCap,
  LayoutDashboard,
  MapPin,
  Settings,
  SlidersHorizontal,
  Users,
  UsersRound,
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
    label: "Cohorts",
    href: "/cohorts",
    icon: UsersRound,
  },
  {
    label: "Instructors",
    href: "/instructors",
    icon: Users,
  },
  {
    label: "Courses",
    href: "/courses",
    icon: BookOpenCheck,
  },
  {
    label: "Rooms",
    href: "/rooms",
    icon: DoorOpen,
  },
  {
    label: "Qualifications",
    href: "/qualifications",
    icon: BadgeCheck,
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
