import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { Button } from "@/components/ui/button";
import {
  saveCourseCompetence,
  saveTimePreference,
  saveBreakPreference,
  saveRoomFeature,
  saveRoomInventory,
  saveRoomRequirement,
  togglePreference,
} from "@/lib/masterdata/preference-actions";

type Option = { id: string; name: string };
function Select({ name, options }: { name: string; options: Option[] }) {
  return (
    <SelectInput name={name} required defaultValue="">
      <option value="" disabled>
        Select…
      </option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </SelectInput>
  );
}
function Validity() {
  return (
    <>
      <Field label="Valid from (optional)">
        <TextInput name="validFrom" type="date" />
      </Field>
      <Field label="Valid through (optional)">
        <TextInput name="validTo" type="date" />
      </Field>
    </>
  );
}
function Strength() {
  return (
    <>
      <Field label="Priority">
        <SelectInput name="weight" defaultValue="100">
          <option value="10">Low</option>
          <option value="100">Normal</option>
          <option value="1000">High</option>
        </SelectInput>
      </Field>
      <label>
        <input name="hard" type="checkbox" /> Mandatory (hard requirement)
      </label>
    </>
  );
}
function Toggle({
  id,
  kind,
  active,
}: {
  id: string;
  kind: string;
  active: boolean;
}) {
  return (
    <form action={togglePreference}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <Button type="submit" variant="ghost">
        {active ? "Deactivate" : "Reactivate"}
      </Button>
    </form>
  );
}
const clock = (minute: number | null) =>
  minute == null
    ? ""
    : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export default async function PreferencesPage() {
  await connection();
  const tenant = await prisma.tenant.findUnique({ where: { code: "DEMO" } });
  if (!tenant)
    return (
      <PageHeader
        title="Requirements & preferences"
        description="No tenant found."
      />
    );
  const where = { tenantId: tenant.id };
  const latestRun = await prisma.solverRun.findFirst({
    where: { ...where, status: { in: ["OPTIMAL", "FEASIBLE"] } },
    orderBy: { startedAt: "desc" },
    include: {
      solverJob: {
        include: {
          planScenario: { select: { name: true, objectiveSummary: true } },
        },
      },
    },
  });
  const summary = latestRun?.solverJob.planScenario.objectiveSummary as {
    diagnostics?: unknown;
  } | null;
  const diagnostics = summary?.diagnostics as {
    weekDiagnostics?: Record<
      string,
      {
        preferenceViolations?: Array<{
          name: string;
          date: string;
          groupId: string;
          minutes: number;
          penalty: number;
        }>;
      }
    >;
  } | null;
  const violations = Object.values(diagnostics?.weekDiagnostics ?? {}).flatMap(
    (week) => week.preferenceViolations ?? [],
  );
  const [
    instructors,
    students,
    courses,
    rooms,
    cohorts,
    groups,
    features,
    competences,
    times,
    breaks,
    requirements,
  ] = await Promise.all([
    prisma.instructor.findMany({ where, orderBy: { lastName: "asc" } }),
    prisma.student.findMany({ where, orderBy: { lastName: "asc" } }),
    prisma.course.findMany({ where, orderBy: { name: "asc" } }),
    prisma.room.findMany({
      where,
      include: { features: { include: { feature: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.studentCohort.findMany({ where }),
    prisma.teachingGroup.findMany({ where }),
    prisma.roomFeature.findMany({ where, orderBy: { name: "asc" } }),
    prisma.instructorCourse.findMany({
      where,
      include: { instructor: true, course: true },
    }),
    prisma.planningRule.findMany({
      where: { ...where, ruleType: "AVOID_TIME_WINDOW" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.planningRule.findMany({
      where: { ...where, ruleType: "MIN_BREAK_MINUTES" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.roomRequirement.findMany({
      where,
      include: { feature: true, course: true, student: true, instructor: true },
    }),
  ]);
  const people = (items: typeof students) =>
    items.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }));
  const teacherOptions = instructors.map((p) => ({
    id: p.id,
    name: `${p.firstName} ${p.lastName}`,
  }));
  const targets = [
    ...courses.map((c) => ({
      id: `course:${c.id}`,
      name: `Course: ${c.name}`,
    })),
    ...people(students).map((p) => ({
      id: `student:${p.id}`,
      name: `Student: ${p.name}`,
    })),
    ...teacherOptions.map((p) => ({
      id: `instructor:${p.id}`,
      name: `Instructor: ${p.name}`,
    })),
  ];
  const timeTargets = [
    { id: "all", name: "All students and instructors" },
    { id: "students", name: "All students" },
    { id: "instructors", name: "All instructors" },
    ...cohorts.map((c) => ({
      id: `cohort:${c.id}`,
      name: `Cohort: ${c.name}`,
    })),
    ...groups.map((g) => ({
      id: `group:${g.id}`,
      name: `Teaching group: ${g.name}`,
    })),
    ...targets,
  ];
  return (
    <div className="page-container">
      <PageHeader
        title="Requirements & preferences"
        description="Mandatory requirements restrict the schedule. Preferences guide it and may be exceeded when necessary."
      />
      <Card>
        <CardHeader>
          <h2>Course competence</h2>
        </CardHeader>
        <CardContent>
          <p>
            Record a numeric level per course. Set minimum and preferred levels
            under the course’s staffing requirements. Existing links without a
            level remain unspecified.
          </p>
          <form action={saveCourseCompetence} className="master-inline-form">
            <Field label="Instructor">
              <Select name="instructorId" options={teacherOptions} />
            </Field>
            <Field label="Course">
              <Select name="courseId" options={courses} />
            </Field>
            <Field label="Competence level">
              <TextInput
                name="competenceLevel"
                type="number"
                min={1}
                max={100}
                defaultValue={1}
                required
              />
            </Field>
            <Field label="Teaching preference">
              <SelectInput name="preference" defaultValue="NEUTRAL">
                <option value="PREFER">Preferred</option>
                <option value="NEUTRAL">Neutral</option>
                <option value="AVOID">Avoid if possible</option>
              </SelectInput>
            </Field>
            <Field label="Preference priority">
              <SelectInput name="preferenceWeight" defaultValue="100">
                <option value="10">Low</option>
                <option value="100">Normal</option>
                <option value="1000">High</option>
              </SelectInput>
            </Field>
            <Validity />
            <Button type="submit">Assign / update</Button>
          </form>
          {competences.map((c) => (
            <div key={c.id} className="qualification-assignment-row">
              <span>
                {c.instructor.firstName} {c.instructor.lastName} ·{" "}
                {c.course.name} · level {c.competenceLevel ?? "unspecified"} ·{" "}
                {c.preference === "PREFER"
                  ? `preferred (${c.preferenceWeight})`
                  : c.preference === "AVOID"
                    ? `avoid (${c.preferenceWeight})`
                    : "neutral"}
                {!c.active && " · inactive"} ·{" "}
                {c.validFrom?.toISOString().slice(0, 10) ?? "any date"} –{" "}
                {c.validTo?.toISOString().slice(0, 10) ?? "no expiry"}
              </span>
              <Toggle id={c.id} kind="competence" active={c.active} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2>Recurring time preferences</h2>
        </CardHeader>
        <CardContent>
          <p>
            Choose a period to keep free. Examples: lunch 11:30–12:00, Thursday
            00:00–12:00, or Friday 14:00–23:59. Common wishes count once per
            affected lesson; individual wishes add together.
          </p>
          <form action={saveTimePreference} className="master-inline-form">
            <Field label="Name">
              <TextInput name="name" required placeholder="Lunch" />
            </Field>
            <Field label="Applies to">
              <Select name="target" options={timeTargets} />
            </Field>
            <fieldset>
              <legend>Weekdays</legend>
              {days.map((day, i) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={i + 1}
                    defaultChecked={i < 5}
                  />
                  {day}{" "}
                </label>
              ))}
            </fieldset>
            <Field label="Keep free from">
              <TextInput
                type="time"
                name="startMinute"
                defaultValue="11:30"
                required
              />
            </Field>
            <Field label="Until">
              <TextInput
                type="time"
                name="endMinute"
                defaultValue="12:00"
                required
              />
            </Field>
            <Strength />
            <Validity />
            <Button type="submit">Add preference</Button>
          </form>
          {times.map((r) => {
            const target = r.instructorId
              ? `instructor:${r.instructorId}`
              : r.studentId
                ? `student:${r.studentId}`
                : r.studentCohortId
                  ? `cohort:${r.studentCohortId}`
                  : r.teachingGroupId
                    ? `group:${r.teachingGroupId}`
                    : r.courseId
                      ? `course:${r.courseId}`
                      : r.audience === "ALL"
                        ? "all"
                        : r.audience.toLowerCase();
            return (
              <div key={r.id} className="qualification-assignment-row">
                <span>
                  <strong>{r.name}</strong> ·{" "}
                  {timeTargets.find((t) => t.id === target)?.name} ·{" "}
                  {r.weekdays.map((d) => days[d - 1]).join(", ")} ·{" "}
                  {clock(r.startMinute)}–{clock(r.endMinute)} ·{" "}
                  {r.constraintType} · priority {r.weight}
                  {!r.active && " · inactive"} ·{" "}
                  {r.validFrom?.toISOString().slice(0, 10) ?? "any date"} –{" "}
                  {r.validTo?.toISOString().slice(0, 10) ?? "no expiry"}
                </span>
                <Toggle id={r.id} kind="time" active={r.active} />
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2>Break preferences</h2>
        </CardHeader>
        <CardContent>
          <p>
            Set a minimum desired or mandatory break between lessons. Travel
            time is handled by the solver separately, so the effective break
            remains real free time.
          </p>
          <form action={saveBreakPreference} className="master-inline-form">
            <Field label="Name">
              <TextInput name="name" required placeholder="Preferred break" />
            </Field>
            <Field label="Applies to">
              <Select name="target" options={timeTargets} />
            </Field>
            <fieldset>
              <legend>Weekdays</legend>
              {days.map((day, i) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={i + 1}
                    defaultChecked={i < 5}
                  />
                  {day}{" "}
                </label>
              ))}
            </fieldset>
            <Field label="Minimum break (minutes)">
              <TextInput
                name="minBreakMinutes"
                type="number"
                min={0}
                max={240}
                defaultValue={15}
                required
              />
            </Field>
            <Strength />
            <Validity />
            <Button type="submit">Add break preference</Button>
          </form>
          {breaks.map((r) => {
            const target = r.instructorId
              ? `instructor:${r.instructorId}`
              : r.studentId
                ? `student:${r.studentId}`
                : r.studentCohortId
                  ? `cohort:${r.studentCohortId}`
                  : r.teachingGroupId
                    ? `group:${r.teachingGroupId}`
                    : r.courseId
                      ? `course:${r.courseId}`
                      : r.audience === "ALL"
                        ? "all"
                        : r.audience.toLowerCase();

            return (
              <div key={r.id} className="qualification-assignment-row">
                <span>
                  <strong>{r.name}</strong> ·{" "}
                  {timeTargets.find((t) => t.id === target)?.name} ·{" "}
                  {r.valueInt ?? 0} min ·{" "}
                  {r.weekdays.map((d) => days[d - 1]).join(", ")} ·{" "}
                  {r.constraintType} · priority {r.weight}
                  {!r.active && " · inactive"} ·{" "}
                  {r.validFrom?.toISOString().slice(0, 10) ?? "any date"} –{" "}
                  {r.validTo?.toISOString().slice(0, 10) ?? "no expiry"}
                </span>
                <Toggle id={r.id} kind="time" active={r.active} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2>Room features & inventory</h2>
        </CardHeader>
        <CardContent>
          <p>
            Create specific features such as projector, lab station, step-free
            access or hearing loop. Use quantity 1 for a feature that is
            present, and 0 to remove it.
          </p>
          <form action={saveRoomFeature} className="master-inline-form">
            <Field label="Type">
              <Select
                name="type"
                options={[
                  { id: "EQUIPMENT", name: "Equipment" },
                  { id: "FEATURE", name: "Feature" },
                ]}
              />
            </Field>
            <Field label="Name">
              <TextInput name="name" required placeholder="Projector" />
            </Field>
            <Button type="submit">Create</Button>
          </form>
          <form action={saveRoomInventory} className="master-inline-form">
            <Field label="Room">
              <Select name="roomId" options={rooms} />
            </Field>
            <Field label="Feature">
              <Select name="featureId" options={features} />
            </Field>
            <Field label="Quantity">
              <TextInput
                name="quantity"
                type="number"
                min={0}
                defaultValue={1}
                required
              />
            </Field>
            <Button type="submit">Set inventory</Button>
          </form>
          {rooms.map((r) => (
            <p key={r.id}>
              <strong>{r.name}</strong>:{" "}
              {r.features
                .filter((f) => f.quantity > 0)
                .map((f) => `${f.feature.name} × ${f.quantity}`)
                .join(", ") || "No features registered"}
            </p>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2>Room requirements & accessibility</h2>
        </CardHeader>
        <CardContent>
          <p>
            Course requirements can be mandatory or preferred. Personal
            accessibility needs are always mandatory. Record the functional
            need, without diagnoses.
          </p>
          <form action={saveRoomRequirement} className="master-inline-form">
            <Field label="Applies to">
              <Select name="target" options={targets} />
            </Field>
            <Field label="Required feature">
              <Select name="featureId" options={features} />
            </Field>
            <Field label="Quantity">
              <TextInput
                name="quantity"
                type="number"
                min={1}
                defaultValue={1}
                required
              />
            </Field>
            <label>
              <input type="checkbox" name="perStudent" /> Per student (courses
              only)
            </label>
            <Strength />
            <Button type="submit">Add requirement</Button>
          </form>
          {requirements.map((r) => (
            <div key={r.id} className="qualification-assignment-row">
              <span>
                {r.course?.name ??
                  (r.student
                    ? `${r.student.firstName} ${r.student.lastName}`
                    : `${r.instructor?.firstName} ${r.instructor?.lastName}`)}{" "}
                · {r.feature.name} × {r.quantity}
                {r.perStudent && " per student"} ·{" "}
                {r.hard ? "HARD" : `SOFT · priority ${r.weight}`}
                {!r.active && " · inactive"}
              </span>
              <Toggle id={r.id} kind="room" active={r.active} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2>Latest planning result</h2>
        </CardHeader>
        <CardContent>
          <p>
            {latestRun
              ? `${latestRun.solverJob.planScenario.name} · ${latestRun.startedAt.toISOString().slice(0, 10)}`
              : "Generate a plan to evaluate your preferences."}
          </p>
          <p>
            Results reflect the requirements at generation time. Generate again
            after changing requirements.
          </p>
          {violations.length ? (
            <table>
              <thead>
                <tr>
                  <th>Preference</th>
                  <th>Date</th>
                  <th>Group</th>
                  <th>Minutes affected</th>
                  <th>Penalty</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v, i) => (
                  <tr key={i}>
                    <td>{v.name}</td>
                    <td>{v.date}</td>
                    <td>
                      {groups.find((g) => g.id === v.groupId)?.name ??
                        v.groupId}
                    </td>
                    <td>{v.minutes}</td>
                    <td>{v.penalty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No time or dated room preference violations reported.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
