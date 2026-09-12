import { prisma } from "@/lib/prisma";

export type PublishedPlanExport = {
  plan: {
    id: string;
    name: string;
    version: number;
    status: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    planningScope: string;
    academicPeriod: string;
    publishedAt: string | null;
    sessionCount: number;
  };
  sessions: Array<{
    date: string;
    startMinute: number;
    endMinute: number;
    courseCode: string | null;
    courseName: string;
    teachingGroupCode: string | null;
    teachingGroupName: string;
    roomCode: string | null;
    roomName: string | null;
    instructors: Array<{
      name: string;
      role: string;
    }>;
    students: Array<{
      id: string;
      name: string;
    }>;
  }>;
};

function dateKey(value: Date | null) {
  return value
    ? value.toISOString().slice(0, 10)
    : null;
}

export function clock(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export async function getPublishedPlanExport(
  planId: string,
): Promise<PublishedPlanExport | null> {
  const plan = await prisma.plan.findUnique({
    where: {
      id: planId,
    },
    include: {
      planningScope: true,
      academicPeriod: true,
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
            orderBy: {
              role: "asc",
            },
          },
          students: {
            include: {
              student: true,
            },
          },
        },
        orderBy: [
          { date: "asc" },
          { startMinute: "asc" },
          { teachingGroupId: "asc" },
        ],
      },
    },
  });

  if (
    !plan ||
    (plan.status !== "PUBLISHED" &&
      plan.status !== "SUPERSEDED")
  ) {
    return null;
  }

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      version: plan.version,
      status: plan.status,
      effectiveFrom: dateKey(plan.effectiveFrom),
      effectiveTo: dateKey(plan.effectiveTo),
      planningScope: plan.planningScope.name,
      academicPeriod: plan.academicPeriod.name,
      publishedAt: plan.publishedAt
        ? plan.publishedAt.toISOString()
        : null,
      sessionCount: plan.sessions.length,
    },
    sessions: plan.sessions.map((session) => ({
      date: dateKey(session.date)!,
      startMinute: session.startMinute,
      endMinute: session.endMinute,
      courseCode:
        session.teachingGroup.course.code,
      courseName:
        session.teachingGroup.course.name,
      teachingGroupCode:
        session.teachingGroup.code,
      teachingGroupName:
        session.teachingGroup.name,
      roomCode: session.room?.code ?? null,
      roomName: session.room?.name ?? null,
      instructors:
        session.instructors.map(
          (membership) => ({
            name:
              `${membership.instructor.firstName} ${membership.instructor.lastName}`,
            role: membership.role,
          }),
        ),
      students: session.students.map(
        (membership) => ({
          id: membership.student.id,
          name:
            `${membership.student.firstName} ${membership.student.lastName}`,
        }),
      ),
    })),
  };
}

export function exportFileBaseName(
  data: PublishedPlanExport,
) {
  const scope = data.plan.planningScope
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `youtileyes-${scope || "plan"}-v${data.plan.version}`;
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);

  return `"${text.replaceAll('"', '""')}"`;
}

export function planCsv(
  data: PublishedPlanExport,
) {
  const rows = [
    [
      "Date",
      "Start",
      "End",
      "Course",
      "Teaching group",
      "Room",
      "Instructors",
      "Students",
    ],
    ...data.sessions.map((session) => [
      session.date,
      clock(session.startMinute),
      clock(session.endMinute),
      session.courseCode
        ? `${session.courseCode} - ${session.courseName}`
        : session.courseName,
      session.teachingGroupCode
        ? `${session.teachingGroupCode} - ${session.teachingGroupName}`
        : session.teachingGroupName,
      session.roomCode
        ? `${session.roomCode} - ${session.roomName ?? ""}`
        : session.roomName ?? "",
      session.instructors
        .map(
          (instructor) =>
            `${instructor.name} (${instructor.role})`,
        )
        .join("; "),
      session.students
        .map((student) => student.name)
        .join("; "),
    ]),
  ];

  return rows
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function pdfText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replace(/[^\x20-\xFF]/g, "?");
}

function truncate(value: string, length: number) {
  return value.length <= length
    ? value
    : `${value.slice(0, Math.max(0, length - 3))}...`;
}

export function planPdf(
  data: PublishedPlanExport,
) {
  const headerLines = [
    "YOUTILEYES",
    "CONTROLLED TIMETABLE REVISION",
    "",
    `${data.plan.name} · Plan v${data.plan.version}`,
    `${data.plan.planningScope} · ${data.plan.academicPeriod}`,
    `Status: ${data.plan.status}`,
    `Effective: ${data.plan.effectiveFrom ?? "-"}${data.plan.effectiveTo ? ` to ${data.plan.effectiveTo}` : " onward"}`,
    `Published: ${data.plan.publishedAt?.slice(0, 19).replace("T", " ") ?? "-"}`,
    `Sessions: ${data.plan.sessionCount}`,
    "",
  ];

  const sessionLines = [
    "Date       Time         Course / group                    Room          Instructor(s)",
    "------------------------------------------------------------------------------------------",
    ...data.sessions.map((session) => {
      const course = session.courseCode
        ? `${session.courseCode} ${session.teachingGroupCode ?? session.teachingGroupName}`
        : `${session.courseName} ${session.teachingGroupCode ?? session.teachingGroupName}`;
      const room = session.roomCode ?? session.roomName ?? "-";
      const instructors =
        session.instructors.map((item) => item.name).join(", ") || "-";

      return [
        session.date.padEnd(10),
        `${clock(session.startMinute)}-${clock(session.endMinute)}`.padEnd(12),
        truncate(course, 31).padEnd(31),
        truncate(room, 12).padEnd(12),
        truncate(instructors, 34),
      ].join(" ");
    }),
  ];

  const linesPerPage = 43;
  const contentPages: string[][] = [];
  for (let index = 0; index < sessionLines.length; index += linesPerPage) {
    contentPages.push(sessionLines.slice(index, index + linesPerPage));
  }
  if (contentPages.length === 0) contentPages.push(["No sessions."]);

  const pages = contentPages.map((content, index) => [
    ...(index === 0
      ? headerLines
      : [
          "YOUTILEYES · CONTROLLED TIMETABLE REVISION",
          `${data.plan.name} · Plan v${data.plan.version} · continued`,
          "",
        ]),
    ...content,
    "",
    `Page ${index + 1} of ${contentPages.length} · Controlled export from Youtileyes`,
  ]);

  const objects: Array<Buffer | null> = [null];
  const pageObjectIds: number[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;

  objects[catalogId] = Buffer.from(
    `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
    "latin1",
  );
  objects[fontId] = Buffer.from(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    "latin1",
  );

  let nextId = 4;
  for (const pageLines of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageObjectIds.push(pageId);

    const commands = [
      "BT",
      "/F1 9 Tf",
      ...pageLines.map((line, lineIndex) => {
        const y = 805 - lineIndex * 16;
        const font = lineIndex === 0 ? "/F1 12 Tf" : "/F1 9 Tf";
        return `${font}\n1 0 0 1 36 ${y} Tm (${pdfText(line)}) Tj`;
      }),
      "ET",
    ].join("\n");

    const content = Buffer.from(commands, "latin1");
    objects[contentId] = Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"),
      content,
      Buffer.from("\nendstream", "latin1"),
    ]);
    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      "latin1",
    );
  }

  objects[pagesId] = Buffer.from(
    `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    "latin1",
  );

  const parts: Buffer[] = [
    Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1"),
  ];
  const offsets: number[] = [0];
  let offset = parts[0].length;

  for (let id = 1; id < objects.length; id++) {
    const object = objects[id];
    if (!object) throw new Error(`Missing PDF object ${id}.`);
    offsets[id] = offset;
    const wrapped = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`, "latin1"),
      object,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(wrapped);
    offset += wrapped.length;
  }

  const xrefOffset = offset;
  const xref = [
    "xref",
    `0 ${objects.length}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map(
      (value) => `${String(value).padStart(10, "0")} 00000 n `,
    ),
    "trailer",
    `<< /Size ${objects.length} /Root ${catalogId} 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");

  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}
