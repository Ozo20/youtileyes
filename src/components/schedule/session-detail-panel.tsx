import Link from "next/link";
import {
 CalendarDays,
 Clock3,
 Lock,
 LockOpen,
 MapPin,
 UserRound,
 UsersRound,
 WandSparkles,
 X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

type SessionStudent = {
 id: string;
 name: string;
};

type SessionDetailPanelProps = {
 session: {
   id: string;
   courseCode: string | null;
   courseName: string;
   groupName: string;
   dateLabel: string;
   startTime: string;
   endTime: string;
   roomName: string | null;
   instructorName: string | null;
   students: SessionStudent[];
   origin: string;
   locked: boolean;
   changeReason: string | null;
 };
 closeHref: string;
};

function originLabel(origin: string) {
 switch (origin) {
   case "GENERATED":
     return "Solver generated";
   case "MANUAL":
     return "Manual";
   case "IMPORTED":
     return "Imported";
   default:
     return origin;
 }
}

function initials(name: string) {
 return name
   .split(" ")
   .filter(Boolean)
   .map((part) => part[0])
   .join("")
   .slice(0, 2)
   .toUpperCase();
}

export function SessionDetailPanel({ session, closeHref }: SessionDetailPanelProps) {
 return (
   <aside className="session-detail-panel">
     <header className="session-detail-header">
       <div>
         <span className="eyebrow">Session details</span>

         <div className="session-detail-title-row">
           <h2>{session.courseName}</h2>
           {session.courseCode ? <Badge>{session.courseCode}</Badge> : null}
         </div>
       </div>

       <Link href={closeHref} className="session-detail-close" aria-label="Close session details">
         <X size={18} />
       </Link>
     </header>

     <div className="session-detail-content">
       <div className="session-detail-status-row">
         <Badge tone="info">
           <WandSparkles size={12} />
           {originLabel(session.origin)}
         </Badge>

         <Badge tone={session.locked ? "warning" : "neutral"}>
           {session.locked ? <Lock size={12} /> : <LockOpen size={12} />}
           {session.locked ? "Locked" : "Not locked"}
         </Badge>
       </div>

       <dl className="session-detail-grid">
         <div className="session-detail-field">
           <dt>
             <CalendarDays size={15} />
             Date
           </dt>
           <dd>{session.dateLabel}</dd>
         </div>

         <div className="session-detail-field">
           <dt>
             <Clock3 size={15} />
             Time
           </dt>
           <dd>
             {session.startTime}–{session.endTime}
           </dd>
         </div>

         <div className="session-detail-field">
           <dt>
             <UserRound size={15} />
             Instructor
           </dt>
           <dd>{session.instructorName ?? "Not assigned"}</dd>
         </div>

         <div className="session-detail-field">
           <dt>
             <MapPin size={15} />
             Room
           </dt>
           <dd>{session.roomName ?? "Not assigned"}</dd>
         </div>

         <div className="session-detail-field">
           <dt>
             <UsersRound size={15} />
             Teaching group
           </dt>
           <dd>{session.groupName}</dd>
         </div>
       </dl>

       <section className="session-detail-section">
         <div className="session-detail-section-heading">
           <div>
             <span className="eyebrow">Students</span>
             <h3>Participants</h3>
           </div>

           <Badge>{session.students.length}</Badge>
         </div>

         {session.students.length === 0 ? (
           <p className="session-detail-empty">No students assigned.</p>
         ) : (
           <div className="session-student-list">
             {session.students.map((student) => (
               <div key={student.id} className="session-student">
                 <span className="session-student-avatar">{initials(student.name)}</span>
                 <span>{student.name}</span>
               </div>
             ))}
           </div>
         )}
       </section>

       {session.changeReason ? (
         <section className="session-detail-section">
           <span className="eyebrow">Change reason</span>
           <p className="session-change-reason">{session.changeReason}</p>
         </section>
       ) : null}

       <footer className="session-detail-footer">
         <span>Editing actions will be added in a later planning step.</span>
       </footer>
     </div>
   </aside>
 );
}
