import {
 CalendarDays,
 Clock3,
} from "lucide-react";

import { DaySchedule } from "@/components/schedule/day-schedule";
import { ScheduleToolbar } from "@/components/schedule/schedule-toolbar";
import { WeekSchedule } from "@/components/schedule/week-schedule";
import { Badge } from "@/components/ui/badge";
import {
 Card,
 CardContent,
 CardHeader,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/prisma";

type PageProps = {
 searchParams: Promise<{
   view?: string;
 }>;
};

function dateKey(date: Date) {
 return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
 const result = new Date(date);
 result.setUTCDate(result.getUTCDate() + days);
 return result;
}

function startOfMonday(date: Date) {
 const result = new Date(date);

 const day = result.getUTCDay();
 const offset = day === 0 ? -6 : 1 - day;

 result.setUTCDate(result.getUTCDate() + offset);

 return result;
}

const dayFormatter = new Intl.DateTimeFormat(
 "en-GB",
 {
   weekday: "long",
   timeZone: "UTC",
 },
);

const dateFormatter = new Intl.DateTimeFormat(
 "en-GB",
 {
   day: "numeric",
   month: "short",
   timeZone: "UTC",
 },
);

const fullDateFormatter = new Intl.DateTimeFormat(
 "en-GB",
 {
   weekday: "long",
   day: "numeric",
   month: "long",
   timeZone: "UTC",
 },
);

export default async function SchedulePage({
 searchParams,
}: PageProps) {
 const params = await searchParams;

 const currentView =
   params.view === "week" ? "week" : "day";

 const scenario =
   await prisma.planScenario.findFirst({
     where: {
       name: "Initial solver scenario",
     },
     orderBy: {
       generatedAt: "desc",
     },
     include: {
       plan: {
         include: {
           planningScope: true,
         },
       },
       sessions: {
         include: {
           teachingGroup: {
             include: {
               course: true,
             },
           },
           room: true,
           instructors: {
             include: {
               instructor: true,
             },
           },
           students: true,
         },
         orderBy: [
           {
             date: "asc",
           },
           {
             startMinute: "asc",
           },
         ],
       },
     },
   });

 if (!scenario) {
   return (
     <div className="page-container">
       <PageHeader
         title="Schedule"
         description="No generated scenario is available."
       />

       <Card>
         <CardContent>
           Run the solver to generate the first
           schedule.
         </CardContent>
       </Card>
     </div>
   );
 }

 const firstDate =
   scenario.sessions[0]?.date ??
   new Date("2026-09-10T00:00:00.000Z");

 const weekStart = startOfMonday(firstDate);

 const weekDays = Array.from(
   {
     length: 5,
   },
   (_, index) => {
     const date = addDays(weekStart, index);

     return {
       key: dateKey(date),
       label: dayFormatter.format(date),
       dateLabel: dateFormatter.format(date),
     };
   },
 );

 const sessions = scenario.sessions.map(
   (session) => {
     const instructor =
       session.instructors[0]?.instructor;

     return {
       id: session.id,
       dateKey: dateKey(session.date),
       startMinute: session.startMinute,
       endMinute: session.endMinute,
       studentCount: session.students.length,
       courseCode:
         session.teachingGroup.course.code,
       courseName:
         session.teachingGroup.course.name,
       roomName: session.room?.name ?? null,
       instructorName: instructor
         ? `${instructor.firstName} ${instructor.lastName}`
         : null,
     };
   },
 );

 const selectedDayKey = dateKey(firstDate);

 const daySessions = sessions.filter(
   (session) =>
     session.dateKey === selectedDayKey,
 );

 return (
   <div className="page-container">
     <PageHeader
       title="Schedule"
       description={
         scenario.plan.planningScope.name
       }
       actions={
         <div className="header-badges">
           <Badge tone="success">
             {scenario.status}
           </Badge>

           {scenario.solverScore !== null ? (
             <Badge>
               Score {scenario.solverScore}
             </Badge>
           ) : null}
         </div>
       }
     />

     <ScheduleToolbar
       currentView={currentView}
     />

     <div className="schedule-summary">
       <Card>
         <CardContent className="summary-card">
           <CalendarDays size={18} />

           <div>
             <span className="summary-label">
               Scenario
             </span>

             <strong>{scenario.name}</strong>
           </div>
         </CardContent>
       </Card>

       <Card>
         <CardContent className="summary-card">
           <Clock3 size={18} />

           <div>
             <span className="summary-label">
               Sessions
             </span>

             <strong>
               {scenario.sessions.length}
             </strong>
           </div>
         </CardContent>
       </Card>
     </div>

     <Card className="schedule-card">
       <CardHeader>
         <div>
           <span className="eyebrow">
             Generated timetable
           </span>

           <h2>
             {currentView === "day"
               ? fullDateFormatter.format(
                   firstDate,
                 )
               : `Week of ${dateFormatter.format(
                   weekStart,
                 )}`}
           </h2>
         </div>

         <Badge tone="info">
           Solver proposal
         </Badge>
       </CardHeader>

       <CardContent>
         {currentView === "day" ? (
           <DaySchedule
             sessions={daySessions}
           />
         ) : (
           <WeekSchedule
             days={weekDays}
             sessions={sessions}
           />
         )}
       </CardContent>
     </Card>
   </div>
 );
}
