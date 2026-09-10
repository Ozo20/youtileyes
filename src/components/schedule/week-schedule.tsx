type WeekSession = {
 id: string;
 dateKey: string;
 startMinute: number;
 endMinute: number;
 courseCode: string | null;
 courseName: string;
 roomName: string | null;
 instructorName: string | null;
};

type WeekDay = {
 key: string;
 label: string;
 dateLabel: string;
};

type WeekScheduleProps = {
 days: WeekDay[];
 sessions: WeekSession[];
};

function displayTime(minutes: number) {
 const hours = Math.floor(minutes / 60);
 const mins = minutes % 60;

 return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function WeekSchedule({ days, sessions }: WeekScheduleProps) {
 return (
   <div className="week-schedule">
     {days.map((day) => {
       const daySessions = sessions.filter(
         (session) => session.dateKey === day.key,
       );

       return (
         <section key={day.key} className="week-day">
           <header className="week-day-header">
             <strong>{day.label}</strong>
             <span>{day.dateLabel}</span>
           </header>

           <div className="week-day-content">
             {daySessions.length === 0 ? (
               <div className="week-day-empty">No sessions</div>
             ) : (
               daySessions.map((session) => (
                 <article key={session.id} className="week-session-card">
                   <div className="week-session-time">
                     {displayTime(session.startMinute)}
                     {" – "}
                     {displayTime(session.endMinute)}
                   </div>

                   <strong>
                     {session.courseCode ?? session.courseName}
                   </strong>

                   <span>
                     {session.instructorName ?? "No instructor"}
                   </span>

                   <span>{session.roomName ?? "No room"}</span>
                 </article>
               ))
             )}
           </div>
         </section>
       );
     })}
   </div>
 );
}
