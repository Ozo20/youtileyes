import {
  CalendarDays,
  Clock3,
  MapPin,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/prisma";

function displayTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(
    mins,
  ).padStart(2, "0")}`;
}

export default async function SchedulePage() {
  const scenario = await prisma.planScenario.findFirst({
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
            Run the solver to generate the first schedule.
          </CardContent>
        </Card>
      </div>
    );
  }

  const tone =
    scenario.status === "GENERATED"
      ? "success"
      : "neutral";

  return (
    <div className="page-container">
      <PageHeader
        title="Schedule"
        description={
          scenario.plan.planningScope.name
        }
        actions={
          <div className="header-badges">
            <Badge tone={tone}>
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
            <h2>Thursday 10 September</h2>
          </div>

          <Badge tone="info">
            Solver proposal
          </Badge>
        </CardHeader>

        <CardContent>
          <div className="schedule-list">
            {scenario.sessions.map((session) => {
              const instructor =
                session.instructors[0]?.instructor;

              return (
                <article
                  key={session.id}
                  className="schedule-session"
                >
                  <div className="schedule-time">
                    <strong>
                      {displayTime(
                        session.startMinute,
                      )}
                    </strong>

                    <span>
                      {displayTime(
                        session.endMinute,
                      )}
                    </span>
                  </div>

                  <div className="schedule-line" />

                  <div className="session-body">
                    <div className="session-heading">
                      <div>
                        <span className="course-code">
                          {
                            session.teachingGroup
                              .course.code
                          }
                        </span>

                        <h3>
                          {
                            session.teachingGroup
                              .course.name
                          }
                        </h3>
                      </div>

                      <Badge>
                        {
                          session.students
                            .length
                        }{" "}
                        students
                      </Badge>
                    </div>

                    <div className="session-meta">
                      <span>
                        <UserRound size={14} />

                        {instructor
                          ? `${instructor.firstName} ${instructor.lastName}`
                          : "No instructor"}
                      </span>

                      <span>
                        <MapPin size={14} />

                        {session.room?.name ??
                          "No room"}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
