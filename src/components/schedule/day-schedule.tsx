import Link from "next/link";
import { MapPin, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";

type DaySession = {
 id: string;
 href: string;
 selected: boolean;
 startMinute: number;
 endMinute: number;
 studentCount: number;
 courseCode: string | null;
 courseName: string;
 roomName: string | null;
 instructorName: string | null;
};

type DayScheduleProps = {
 sessions: DaySession[];
};

function displayTime(minutes: number) {
 const hours = Math.floor(minutes / 60);
 const mins = minutes % 60;
 return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function DaySchedule({ sessions }: DayScheduleProps) {
 if (sessions.length === 0) {
   return <div className="schedule-empty">No sessions are scheduled for this day.</div>;
 }

 return (
   <div className="schedule-list">
     {sessions.map((session) => (
       <Link key={session.id} href={session.href} className="schedule-session-link">
         <article className="schedule-session" data-selected={session.selected}>
           <div className="schedule-time">
             <strong>{displayTime(session.startMinute)}</strong>
             <span>{displayTime(session.endMinute)}</span>
           </div>

           <div className="schedule-line" />

           <div className="session-body">
             <div className="session-heading">
               <div>
                 <span className="course-code">{session.courseCode ?? "COURSE"}</span>
                 <h3>{session.courseName}</h3>
               </div>

               <Badge>{session.studentCount} students</Badge>
             </div>

             <div className="session-meta">
               <span>
                 <UserRound size={14} />
                 {session.instructorName ?? "No instructor"}
               </span>

               <span>
                 <MapPin size={14} />
                 {session.roomName ?? "No room"}
               </span>
             </div>
           </div>
         </article>
       </Link>
     ))}
   </div>
 );
}
