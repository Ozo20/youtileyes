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

import { writeAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const DEMO_ACTOR = {
  name: "Ola Solem",
};

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

function positiveInt(
  formData: FormData,
  key: string,
  fallback = 1,
) {
  const value = optionalInt(formData, key) ?? fallback;

  if (value < 1) {
    throw new Error(`${key} must be at least 1.`);
  }

  return value;
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

async function demoTenant() {
  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
    select: {
      id: true,
      name: true,
    },
  });

  if (!tenant) {
    throw new Error("Demo tenant was not found.");
  }

  return tenant;
}

function refreshAndRedirect(path: string) {
  revalidatePath(path);
  revalidatePath("/");
  revalidatePath("/history");
  redirect(path);
}

export async function saveInstructor(formData: FormData) {
  const tenant = await demoTenant();
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
  const primaryLocationId = optionalText(
    formData,
    "primaryLocationId",
  );

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
        actor: DEMO_ACTOR,
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
      actor: DEMO_ACTOR,
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
  const tenant = await demoTenant();
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
        nextStatus === PersonStatus.ACTIVE
          ? "REACTIVATED"
          : "DEACTIVATED",
      entityType: "Instructor",
      entityId: after.id,
      actor: DEMO_ACTOR,
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
  const tenant = await demoTenant();
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
        actor: DEMO_ACTOR,
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
      actor: DEMO_ACTOR,
      description: `Qualification created: ${after.code} · ${after.name}.`,
      source: "masterdata.qualifications",
      correlationId,
      afterState: after,
    });

    return after;
  });

  refreshAndRedirect(`/qualifications?id=${saved.id}`);
}

export async function toggleQualificationActive(
  formData: FormData,
) {
  const tenant = await demoTenant();
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
      actor: DEMO_ACTOR,
      description: active
        ? `Qualification reactivated: ${after.code} · ${after.name}.`
        : `Qualification deactivated: ${after.code} · ${after.name}.`,
      source: "masterdata.qualifications",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(`/qualifications?id=${id}`);
}

export async function assignInstructorQualification(
  formData: FormData,
) {
  const tenant = await demoTenant();
  const instructorId = requiredText(formData, "instructorId");
  const qualificationId = requiredText(
    formData,
    "qualificationId",
  );
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
      actor: DEMO_ACTOR,
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

export async function toggleInstructorQualification(
  formData: FormData,
) {
  const tenant = await demoTenant();
  const id = requiredText(formData, "id");
  const instructorId = requiredText(
    formData,
    "instructorId",
  );
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
      actor: DEMO_ACTOR,
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
  const tenant = await demoTenant();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const code = optionalText(formData, "code")?.toUpperCase() ?? null;
  const name = requiredText(formData, "name");
  const deliveryModeValue = requiredText(
    formData,
    "deliveryMode",
  );

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
    minSessionMinutes: optionalInt(
      formData,
      "minSessionMinutes",
    ),
    preferredSessionMinutes: optionalInt(
      formData,
      "preferredSessionMinutes",
    ),
    maxSessionMinutes: optionalInt(
      formData,
      "maxSessionMinutes",
    ),
    allowDoubleSession: checked(
      formData,
      "allowDoubleSession",
    ),
    maxSessionsPerDay: optionalInt(
      formData,
      "maxSessionsPerDay",
    ),
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
        actor: DEMO_ACTOR,
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
      actor: DEMO_ACTOR,
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
  const tenant = await demoTenant();
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
      actor: DEMO_ACTOR,
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

export async function saveRoom(formData: FormData) {
  const tenant = await demoTenant();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const name = requiredText(formData, "name");
  const code = optionalText(formData, "code")?.toUpperCase() ?? null;
  const capacity = positiveInt(formData, "capacity");
  const locationId = requiredText(formData, "locationId");
  const active = checked(formData, "active");

  const location = await prisma.location.findFirst({
    where: {
      id: locationId,
      tenantId: tenant.id,
    },
    select: { id: true },
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
          code,
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
        actor: DEMO_ACTOR,
        description: `Room updated: ${after.code ?? "—"} · ${after.name}.`,
        source: "masterdata.rooms",
        correlationId,
        beforeState: before,
        afterState: after,
      });

      return after;
    }

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
      actor: DEMO_ACTOR,
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
  const tenant = await demoTenant();
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
      actor: DEMO_ACTOR,
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

export async function createStaffingRequirement(
  formData: FormData,
) {
  const tenant = await demoTenant();
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
    !Object.values(StaffingRoleType).includes(
      roleValue as StaffingRoleType,
    )
  ) {
    throw new Error("Invalid staffing role.");
  }

  const role = roleValue as StaffingRoleType;
  const courseId = optionalText(formData, "courseId");
  const roomId = optionalText(formData, "roomId");
  const teachingGroupId = optionalText(
    formData,
    "teachingGroupId",
  );

  if (
    (source === StaffingRequirementSource.COURSE &&
      !courseId) ||
    (source === StaffingRequirementSource.ROOM && !roomId) ||
    (source === StaffingRequirementSource.TEACHING_GROUP &&
      !teachingGroupId)
  ) {
    throw new Error("Staffing source target is missing.");
  }

  const requiredQualificationId = optionalText(
    formData,
    "requiredQualificationId",
  );
  const count = positiveInt(formData, "count");
  const minimumQualificationLevel = optionalInt(
    formData,
    "minimumQualificationLevel",
  );
  const minimumStudentCount = optionalInt(
    formData,
    "minimumStudentCount",
  );
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
      actor: DEMO_ACTOR,
      description:
        `${source} staffing rule created: ${count} × ${role}` +
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

export async function toggleStaffingRequirement(
  formData: FormData,
) {
  const tenant = await demoTenant();
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
      actor: DEMO_ACTOR,
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
