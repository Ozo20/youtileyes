import Link from "next/link";

type ScheduleToolbarProps = {
 currentView: "day" | "week";
};

export function ScheduleToolbar({ currentView }: ScheduleToolbarProps) {
 return (
   <div className="schedule-toolbar">
     <div className="schedule-view-switch">
       <Link href="/schedule?view=day" className="schedule-view-button" data-active={currentView === "day"}>
         Day
       </Link>

       <Link href="/schedule?view=week" className="schedule-view-button" data-active={currentView === "week"}>
         Week
       </Link>
     </div>

     <div className="schedule-toolbar-filters">
       <button type="button" className="schedule-filter">
         All students
       </button>

       <button type="button" className="schedule-filter">
         All instructors
       </button>

       <button type="button" className="schedule-filter">
         All courses
       </button>

       <button type="button" className="schedule-filter">
         All rooms
       </button>
     </div>
   </div>
 );
}
