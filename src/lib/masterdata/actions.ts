"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CourseDeliveryMode,
  PersonStatus,
  StaffingRequirementSource,
  StaffingRoleType,
} from "../../generated/prisma/client";
import type { Prisma } from "../../generated/prisma/client";

import { requireInstitutionAdmin, requireTenantRole } from "@/lib/access/tenant-context";
import { writeAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

function requiredText(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function optionalText(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalInt(formData: FormData, key: string) {
  const value = optionalText(formData, key);

  if (value === null) return null;

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a whole number.`);
  }

  return parsed;
}

function positiveInt(formData: FormData, key: string, fallback = 1) {
  const value = optionalInt(formData, key) ?? fallback;

  if (value < 1) {
    throw new Error(`${key} must be at least 1.`);
  }

  return value;
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

async function mutationContext() {
  return requireTenantRole("PLANNER");
}

function refreshAndRedirect(path: string) {
  revalidatePath(path);
  revalidatePath("/");
  revalidatePath("/history");
  redirect(path);
}

export async function saveInstructor(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const firstName = requiredText(formData, "firstName");
  const lastName = requiredText(formData, "lastName");
  const externalId = optionalText(formData, "externalId");
  const statusValue = requiredText(formData, "status");

  if (!Object.values(PersonStatus).includes(statusValue as PersonStatus)) {
    throw new Error("Invalid instructor status.");
  }

  const status = statusValue as PersonStatus;
  const maxTeachingMinutesPerWeek = optionalInt(
    formData,
    "maxTeachingMinutesPerWeek",
  );
  const primaryLocationId = optionalText(formData, "primaryLocationId");

  const saved = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.instructor.findFirst({
        where: {
          id,
          tenantId: tenant.id,
        },
      });

      if (!before) {
        throw new Error("Instructor not found.");
      }

      const after = await tx.instructor.update({
        where: { id },
        data: {
          firstName,
          lastName,
          externalId,
          status,
          maxTeachingMinutesPerWeek,
          primaryLocationId,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: tenant.id,
        eventType: "UPDATED",
        entityType: "Instructor",
        entityId: after.id,
        actor,
        description: `Instructor updated: ${after.firstName} ${after.lastName}.`,
        source: "masterdata.instructors",
        correlationId,
        beforeState: before,
        afterState: after,
      });

      return after;
    }

    const after = await tx.instructor.create({
      data: {
        tenantId: tenant.id,
        firstName,
        lastName,
        externalId,
        status,
        maxTeachingMinutesPerWeek,
        primaryLocationId,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "Instructor",
      entityId: after.id,
      actor,
      description: `Instructor created: ${after.firstName} ${after.lastName}.`,
      source: "masterdata.instructors",
      correlationId,
      afterState: after,
    });

    return after;
  });

  refreshAndRedirect(`/instructors?id=${saved.id}`);
}

export async function toggleInstructorStatus(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = requiredText(formData, "id");
  const nextStatus =
    requiredText(formData, "nextStatus") === "ACTIVE"
      ? PersonStatus.ACTIVE
      : PersonStatus.INACTIVE;
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.instructor.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!before) {
      throw new Error("Instructor not found.");
    }

    const after = await tx.instructor.update({
      where: { id },
      data: { status: nextStatus },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType:
        nextStatus === PersonStatus.ACTIVE ? "REACTIVATED" : "DEACTIVATED",
      entityType: "Instructor",
      entityId: after.id,
      actor,
      description:
        nextStatus === PersonStatus.ACTIVE
          ? `Instructor reactivated: ${after.firstName} ${after.lastName}.`
          : `Instructor deactivated: ${after.firstName} ${after.lastName}.`,
      source: "masterdata.instructors",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(`/instructors?id=${id}`);
}

export async function saveQualification(formData: FormData) {
  const { tenant, actor } = await requireInstitutionAdmin();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const code = requiredText(formData, "code").toUpperCase();
  const name = requiredText(formData, "name");
  const description = optionalText(formData, "description");
  const active = checked(formData, "active");

  const saved = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.qualification.findFirst({
        where: {
          id,
          tenantId: tenant.id,
        },
      });

      if (!before) {
        throw new Error("Qualification not found.");
      }

      const after = await tx.qualification.update({
        where: { id },
        data: {
          code,
          name,
          description,
          active,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: tenant.id,
        eventType: "UPDATED",
        entityType: "Qualification",
        entityId: after.id,
        actor,
        description: `Qualification updated: ${after.code} · ${after.name}.`,
        source: "masterdata.qualifications",
        correlationId,
        beforeState: before,
        afterState: after,
      });

      return after;
    }

    const after = await tx.qualification.create({
      data: {
        tenantId: tenant.id,
        code,
        name,
        description,
        active,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "Qualification",
      entityId: after.id,
      actor,
      description: `Qualification created: ${after.code} · ${after.name}.`,
      source: "masterdata.qualifications",
      correlationId,
      afterState: after,
    });

    return after;
  });

  refreshAndRedirect(`/admin/qualifications?id=${saved.id}`);
}

export async function toggleQualificationActive(formData: FormData) {
  const { tenant, actor } = await requireInstitutionAdmin();
  const id = requiredText(formData, "id");
  const active = requiredText(formData, "active") === "true";
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.qualification.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!before) {
      throw new Error("Qualification not found.");
    }

    const after = await tx.qualification.update({
      where: { id },
      data: { active },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: active ? "REACTIVATED" : "DEACTIVATED",
      entityType: "Qualification",
      entityId: after.id,
      actor,
      description: active
        ? `Qualification reactivated: ${after.code} · ${after.name}.`
        : `Qualification deactivated: ${after.code} · ${after.name}.`,
      source: "masterdata.qualifications",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(`/admin/qualifications?id=${id}`);
}

export async function assignInstructorQualification(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const instructorId = requiredText(formData, "instructorId");
  const qualificationId = requiredText(formData, "qualificationId");
  const level = positiveInt(formData, "level");
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const instructor = await tx.instructor.findFirst({
      where: {
        id: instructorId,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    const qualification = await tx.qualification.findFirst({
      where: {
        id: qualificationId,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    if (!instructor || !qualification) {
      throw new Error("Instructor or qualification not found.");
    }

    const before = await tx.instructorQualification.findUnique({
      where: {
        tenantId_instructorId_qualificationId: {
          tenantId: tenant.id,
          instructorId,
          qualificationId,
        },
      },
    });

    const after = await tx.instructorQualification.upsert({
      where: {
        tenantId_instructorId_qualificationId: {
          tenantId: tenant.id,
          instructorId,
          qualificationId,
        },
      },
      update: {
        level,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        instructorId,
        qualificationId,
        level,
        active: true,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: before ? "UPDATED" : "CREATED",
      entityType: "InstructorQualification",
      entityId: after.id,
      actor,
      description:
        `${qualification.code} level ${level} assigned to ` +
        `${instructor.firstName} ${instructor.lastName}.`,
      source: "masterdata.instructors.qualifications",
      correlationId,
      beforeState: before,
      afterState: after,
      context: {
        instructorId,
        qualificationId,
      },
    });
  });

  refreshAndRedirect(`/instructors?id=${instructorId}`);
}

export async function toggleInstructorQualification(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = requiredText(formData, "id");
  const instructorId = requiredText(formData, "instructorId");
  const active = requiredText(formData, "active") === "true";
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.instructorQualification.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
      include: {
        qualification: true,
        instructor: true,
      },
    });

    if (!before) {
      throw new Error("Instructor qualification not found.");
    }

    const after = await tx.instructorQualification.update({
      where: { id },
      data: { active },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: active ? "REACTIVATED" : "DEACTIVATED",
      entityType: "InstructorQualification",
      entityId: after.id,
      actor,
      description:
        `${before.qualification.code} ${active ? "reactivated" : "deactivated"} ` +
        `for ${before.instructor.firstName} ${before.instructor.lastName}.`,
      source: "masterdata.instructors.qualifications",
      correlationId,
      beforeState: before,
      afterState: after,
      context: {
        instructorId,
        qualificationId: before.qualificationId,
      },
    });
  });

  refreshAndRedirect(`/instructors?id=${instructorId}`);
}

export async function saveCourse(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const code = optionalText(formData, "code")?.toUpperCase() ?? null;
  const name = requiredText(formData, "name");
  const deliveryModeValue = requiredText(formData, "deliveryMode");

  if (
    !Object.values(CourseDeliveryMode).includes(
      deliveryModeValue as CourseDeliveryMode,
    )
  ) {
    throw new Error("Invalid delivery mode.");
  }

  const data = {
    code,
    name,
    deliveryMode: deliveryModeValue as CourseDeliveryMode,
    standardGroupSize: optionalInt(formData, "standardGroupSize"),
    maxGroupSize: optionalInt(formData, "maxGroupSize"),
    minSessionMinutes: optionalInt(formData, "minSessionMinutes"),
    preferredSessionMinutes: optionalInt(formData, "preferredSessionMinutes"),
    maxSessionMinutes: optionalInt(formData, "maxSessionMinutes"),
    allowDoubleSession: checked(formData, "allowDoubleSession"),
    maxSessionsPerDay: optionalInt(formData, "maxSessionsPerDay"),
    active: checked(formData, "active"),
  };

  const saved = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.course.findFirst({
        where: {
          id,
          tenantId: tenant.id,
        },
      });

      if (!before) {
        throw new Error("Course not found.");
      }

      const after = await tx.course.update({
        where: { id },
        data,
      });

      await writeAuditEvent(tx, {
        tenantId: tenant.id,
        eventType: "UPDATED",
        entityType: "Course",
        entityId: after.id,
        actor,
        description: `Course updated: ${after.code ?? "—"} · ${after.name}.`,
        source: "masterdata.courses",
        correlationId,
        beforeState: before,
        afterState: after,
      });

      return after;
    }

    const after = await tx.course.create({
      data: {
        tenantId: tenant.id,
        ...data,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "Course",
      entityId: after.id,
      actor,
      description: `Course created: ${after.code ?? "—"} · ${after.name}.`,
      source: "masterdata.courses",
      correlationId,
      afterState: after,
    });

    return after;
  });

  refreshAndRedirect(`/courses?id=${saved.id}`);
}

export async function toggleCourseActive(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = requiredText(formData, "id");
  const active = requiredText(formData, "active") === "true";
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.course.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!before) {
      throw new Error("Course not found.");
    }

    const after = await tx.course.update({
      where: { id },
      data: { active },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: active ? "REACTIVATED" : "DEACTIVATED",
      entityType: "Course",
      entityId: after.id,
      actor,
      description: active
        ? `Course reactivated: ${after.code ?? "—"} · ${after.name}.`
        : `Course deactivated: ${after.code ?? "—"} · ${after.name}.`,
      source: "masterdata.courses",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(`/courses?id=${id}`);
}

function normalizeCodePart(value: string) {
  return value
    .toUpperCase()
    .replaceAll("Æ", "AE")
    .replaceAll("Ø", "O")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

async function generateRoomCode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  locationCode: string | null,
  locationName: string,
  roomName: string,
) {
  const locationPart =
    normalizeCodePart(locationCode ?? "").slice(0, 4) ||
    normalizeCodePart(locationName)
      .split(/(?=[A-Z])/)
      .join("")
      .slice(0, 4) ||
    "LOC";

  const roomPart = normalizeCodePart(roomName) || "ROOM";

  const base = `${locationPart}-${roomPart}`;
  let candidate = base;
  let suffix = 2;

  while (
    await tx.room.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: candidate,
        },
      },
      select: { id: true },
    })
  ) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export async function saveRoom(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const name = requiredText(formData, "name");
  const capacity = positiveInt(formData, "capacity");
  const locationId = requiredText(formData, "locationId");
  const active = checked(formData, "active");

  const location = await prisma.location.findFirst({
    where: {
      id: locationId,
      tenantId: tenant.id,
    },
    select: {
      id: true,
      name: true,
      code: true,
    },
  });

  if (!location) {
    throw new Error("Location not found.");
  }

  const saved = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.room.findFirst({
        where: {
          id,
          tenantId: tenant.id,
        },
      });

      if (!before) {
        throw new Error("Room not found.");
      }

      const after = await tx.room.update({
        where: { id },
        data: {
          name,
          capacity,
          locationId,
          active,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: tenant.id,
        eventType: "UPDATED",
        entityType: "Room",
        entityId: after.id,
        actor,
        description: `Room updated: ${after.code ?? "—"} · ${after.name}.`,
        source: "masterdata.rooms",
        correlationId,
        beforeState: before,
        afterState: after,
      });

      return after;
    }

    const code = await generateRoomCode(
      tx,
      tenant.id,
      location.code,
      location.name,
      name,
    );

    const after = await tx.room.create({
      data: {
        tenantId: tenant.id,
        name,
        code,
        capacity,
        locationId,
        active,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "Room",
      entityId: after.id,
      actor,
      description: `Room created: ${after.code ?? "—"} · ${after.name}.`,
      source: "masterdata.rooms",
      correlationId,
      afterState: after,
    });

    return after;
  });

  refreshAndRedirect(`/rooms?id=${saved.id}`);
}

export async function toggleRoomActive(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = requiredText(formData, "id");
  const active = requiredText(formData, "active") === "true";
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.room.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!before) {
      throw new Error("Room not found.");
    }

    const after = await tx.room.update({
      where: { id },
      data: { active },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: active ? "REACTIVATED" : "DEACTIVATED",
      entityType: "Room",
      entityId: after.id,
      actor,
      description: active
        ? `Room reactivated: ${after.code ?? "—"} · ${after.name}.`
        : `Room deactivated: ${after.code ?? "—"} · ${after.name}.`,
      source: "masterdata.rooms",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(`/rooms?id=${id}`);
}

export async function createStaffingRequirement(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const sourceValue = requiredText(formData, "source");

  if (
    !Object.values(StaffingRequirementSource).includes(
      sourceValue as StaffingRequirementSource,
    )
  ) {
    throw new Error("Invalid staffing source.");
  }

  const source = sourceValue as StaffingRequirementSource;
  const roleValue = requiredText(formData, "role");

  if (
    !Object.values(StaffingRoleType).includes(roleValue as StaffingRoleType)
  ) {
    throw new Error("Invalid staffing role.");
  }

  const role = roleValue as StaffingRoleType;
  const courseId = optionalText(formData, "courseId");
  const roomId = optionalText(formData, "roomId");
  const teachingGroupId = optionalText(formData, "teachingGroupId");

  if (
    (source === StaffingRequirementSource.COURSE && !courseId) ||
    (source === StaffingRequirementSource.ROOM && !roomId) ||
    (source === StaffingRequirementSource.TEACHING_GROUP && !teachingGroupId)
  ) {
    throw new Error("Staffing source target is missing.");
  }

  const requiredQualificationId = optionalText(
    formData,
    "requiredQualificationId",
  );

  const minimumCourseQualificationLevelRaw = optionalText(
    formData,
    "minimumCourseQualificationLevel",
  );

  if (
    minimumCourseQualificationLevelRaw !== null &&
    !["PRIMARY", "SECONDARY", "SUPPORT"].includes(
      minimumCourseQualificationLevelRaw,
    )
  ) {
    throw new Error("Invalid minimum subject role.");
  }

  const minimumCourseQualificationLevel = minimumCourseQualificationLevelRaw as
    "PRIMARY" | "SECONDARY" | "SUPPORT" | null;

  const count = positiveInt(formData, "count");
  const minimumCourseLevel = optionalInt(formData, "minimumCourseLevel");
  const preferredCourseLevel = optionalInt(formData, "preferredCourseLevel");
  for (const level of [minimumCourseLevel, preferredCourseLevel]) {
    if (
      level !== null &&
      (!Number.isInteger(level) || level < 1 || level > 100)
    )
      throw new Error("Course level must be 1–100.");
  }
  if (
    minimumCourseLevel !== null &&
    preferredCourseLevel !== null &&
    preferredCourseLevel < minimumCourseLevel
  )
    throw new Error("Preferred level cannot be below minimum.");
  const minimumQualificationLevel = optionalInt(
    formData,
    "minimumQualificationLevel",
  );
  const minimumStudentCount = optionalInt(formData, "minimumStudentCount");
  const hard = checked(formData, "hard");
  const correlationId = randomUUID();

  const created = await prisma.$transaction(async (tx) => {
    const after = await tx.staffingRequirement.create({
      data: {
        tenantId: tenant.id,
        source,
        courseId,
        roomId,
        teachingGroupId,
        role,
        count,
        requiredQualificationId,
        minimumQualificationLevel,
        minimumCourseQualificationLevel,
        minimumCourseLevel,
        preferredCourseLevel,
        minimumStudentCount,
        hard,
        active: true,
      },
      include: {
        requiredQualification: true,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "StaffingRequirement",
      entityId: after.id,
      actor,
      description:
        `${source} staffing rule created: ${count} × ${role}` +
        (minimumCourseQualificationLevel
          ? ` · subject role >= ${minimumCourseQualificationLevel}`
          : "") +
        (after.requiredQualification
          ? ` · ${after.requiredQualification.code} >= ${minimumQualificationLevel ?? 1}`
          : ""),
      source: "masterdata.staffing",
      correlationId,
      afterState: after,
      context: {
        source,
        courseId,
        roomId,
        teachingGroupId,
      },
    });

    return after;
  });

  if (source === StaffingRequirementSource.COURSE && courseId) {
    refreshAndRedirect(`/courses?id=${courseId}`);
  }

  if (source === StaffingRequirementSource.ROOM && roomId) {
    refreshAndRedirect(`/rooms?id=${roomId}`);
  }

  refreshAndRedirect("/planning");
}

export async function toggleStaffingRequirement(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = requiredText(formData, "id");
  const active = requiredText(formData, "active") === "true";
  const returnPath = requiredText(formData, "returnPath");
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.staffingRequirement.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
      include: {
        requiredQualification: true,
      },
    });

    if (!before) {
      throw new Error("Staffing requirement not found.");
    }

    const after = await tx.staffingRequirement.update({
      where: { id },
      data: { active },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: active ? "REACTIVATED" : "DEACTIVATED",
      entityType: "StaffingRequirement",
      entityId: after.id,
      actor,
      description:
        `${before.source} staffing rule ${active ? "reactivated" : "deactivated"}: ` +
        `${before.count} × ${before.role}.`,
      source: "masterdata.staffing",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(returnPath);
}
