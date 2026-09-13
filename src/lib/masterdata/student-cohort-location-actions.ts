"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  LocationType,
  PersonStatus,
  StudentCohortType,
} from "../../generated/prisma/client";

import { requireTenantRole } from "@/lib/access/tenant-context";
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

function optionalNumber(formData: FormData, key: string) {
  const value = optionalText(formData, key);

  if (value === null) return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a valid number.`);
  }

  return parsed;
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
  revalidatePath("/students");
  revalidatePath("/cohorts");
  revalidatePath("/locations");
  redirect(path);
}

export async function saveStudent(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const firstName = requiredText(formData, "firstName");
  const lastName = requiredText(formData, "lastName");
  const externalId = optionalText(formData, "externalId");
  const sourceSystem = optionalText(formData, "sourceSystem");
  const primaryOrganisationUnitId = optionalText(
    formData,
    "primaryOrganisationUnitId",
  );
  const primaryLocationId = optionalText(
    formData,
    "primaryLocationId",
  );

  const statusValue = requiredText(formData, "status");

  if (!Object.values(PersonStatus).includes(statusValue as PersonStatus)) {
    throw new Error("Invalid student status.");
  }

  const status = statusValue as PersonStatus;

  const saved = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.student.findFirst({
        where: {
          id,
          tenantId: tenant.id,
        },
      });

      if (!before) {
        throw new Error("Student not found.");
      }

      const after = await tx.student.update({
        where: { id },
        data: {
          firstName,
          lastName,
          externalId,
          sourceSystem,
          status,
          primaryOrganisationUnitId,
          primaryLocationId,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: tenant.id,
        eventType: "UPDATED",
        entityType: "Student",
        entityId: after.id,
        actor,
        description: `Student updated: ${after.firstName} ${after.lastName}.`,
        source: "masterdata.students",
        correlationId,
        beforeState: before,
        afterState: after,
      });

      return after;
    }

    const after = await tx.student.create({
      data: {
        tenantId: tenant.id,
        firstName,
        lastName,
        externalId,
        sourceSystem,
        status,
        primaryOrganisationUnitId,
        primaryLocationId,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "Student",
      entityId: after.id,
      actor,
      description: `Student created: ${after.firstName} ${after.lastName}.`,
      source: "masterdata.students",
      correlationId,
      afterState: after,
    });

    return after;
  });

  refreshAndRedirect(`/students?id=${saved.id}`);
}

export async function toggleStudentStatus(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = requiredText(formData, "id");
  const nextStatus =
    requiredText(formData, "nextStatus") === "ACTIVE"
      ? PersonStatus.ACTIVE
      : PersonStatus.INACTIVE;
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.student.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!before) {
      throw new Error("Student not found.");
    }

    const after = await tx.student.update({
      where: { id },
      data: { status: nextStatus },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType:
        nextStatus === PersonStatus.ACTIVE
          ? "REACTIVATED"
          : "DEACTIVATED",
      entityType: "Student",
      entityId: after.id,
      actor,
      description:
        nextStatus === PersonStatus.ACTIVE
          ? `Student reactivated: ${after.firstName} ${after.lastName}.`
          : `Student deactivated: ${after.firstName} ${after.lastName}.`,
      source: "masterdata.students",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(`/students?id=${id}`);
}

export async function saveCohort(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const name = requiredText(formData, "name");
  const code = optionalText(formData, "code")?.toUpperCase() ?? null;
  const academicPeriodId = optionalText(formData, "academicPeriodId");
  const organisationUnitId = optionalText(
    formData,
    "organisationUnitId",
  );
  const active = checked(formData, "active");

  const typeValue = requiredText(formData, "type");

  if (
    !Object.values(StudentCohortType).includes(
      typeValue as StudentCohortType,
    )
  ) {
    throw new Error("Invalid cohort type.");
  }

  const type = typeValue as StudentCohortType;

  const saved = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.studentCohort.findFirst({
        where: {
          id,
          tenantId: tenant.id,
        },
      });

      if (!before) {
        throw new Error("Cohort not found.");
      }

      const after = await tx.studentCohort.update({
        where: { id },
        data: {
          name,
          code,
          type,
          academicPeriodId,
          organisationUnitId,
          active,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: tenant.id,
        eventType: "UPDATED",
        entityType: "StudentCohort",
        entityId: after.id,
        actor,
        description: `Cohort updated: ${after.code ?? "—"} · ${after.name}.`,
        source: "masterdata.cohorts",
        correlationId,
        beforeState: before,
        afterState: after,
      });

      return after;
    }

    const after = await tx.studentCohort.create({
      data: {
        tenantId: tenant.id,
        name,
        code,
        type,
        academicPeriodId,
        organisationUnitId,
        active,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "StudentCohort",
      entityId: after.id,
      actor,
      description: `Cohort created: ${after.code ?? "—"} · ${after.name}.`,
      source: "masterdata.cohorts",
      correlationId,
      afterState: after,
    });

    return after;
  });

  refreshAndRedirect(`/cohorts?id=${saved.id}`);
}

export async function toggleCohortActive(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = requiredText(formData, "id");
  const active = requiredText(formData, "active") === "true";
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.studentCohort.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!before) {
      throw new Error("Cohort not found.");
    }

    const after = await tx.studentCohort.update({
      where: { id },
      data: { active },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: active ? "REACTIVATED" : "DEACTIVATED",
      entityType: "StudentCohort",
      entityId: after.id,
      actor,
      description: active
        ? `Cohort reactivated: ${after.code ?? "—"} · ${after.name}.`
        : `Cohort deactivated: ${after.code ?? "—"} · ${after.name}.`,
      source: "masterdata.cohorts",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(`/cohorts?id=${id}`);
}

export async function addStudentToCohort(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const studentCohortId = requiredText(
    formData,
    "studentCohortId",
  );
  const studentId = requiredText(formData, "studentId");
  const returnPath = requiredText(formData, "returnPath");
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const cohort = await tx.studentCohort.findFirst({
      where: {
        id: studentCohortId,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    const student = await tx.student.findFirst({
      where: {
        id: studentId,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!cohort || !student) {
      throw new Error("Student or cohort not found.");
    }

    const existing = await tx.studentCohortMember.findUnique({
      where: {
        tenantId_studentCohortId_studentId: {
          tenantId: tenant.id,
          studentCohortId,
          studentId,
        },
      },
    });

    if (existing) {
      return;
    }

    const after = await tx.studentCohortMember.create({
      data: {
        tenantId: tenant.id,
        studentCohortId,
        studentId,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "StudentCohortMember",
      entityId: after.id,
      actor,
      description:
        `${student.firstName} ${student.lastName} added to cohort ` +
        `${cohort.code ?? "—"} · ${cohort.name}.`,
      source: "masterdata.cohorts.membership",
      correlationId,
      afterState: after,
      context: {
        studentId,
        studentCohortId,
      },
    });
  });

  refreshAndRedirect(returnPath);
}

export async function removeStudentFromCohort(
  formData: FormData,
) {
  const { tenant, actor } = await mutationContext();
  const membershipId = requiredText(formData, "membershipId");
  const returnPath = requiredText(formData, "returnPath");
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.studentCohortMember.findFirst({
      where: {
        id: membershipId,
        tenantId: tenant.id,
      },
      include: {
        student: true,
        studentCohort: true,
      },
    });

    if (!before) {
      throw new Error("Cohort membership not found.");
    }

    await tx.studentCohortMember.delete({
      where: {
        id: membershipId,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "DEACTIVATED",
      entityType: "StudentCohortMember",
      entityId: membershipId,
      actor,
      description:
        `${before.student.firstName} ${before.student.lastName} removed from cohort ` +
        `${before.studentCohort.code ?? "—"} · ${before.studentCohort.name}.`,
      source: "masterdata.cohorts.membership",
      correlationId,
      beforeState: before,
      context: {
        studentId: before.studentId,
        studentCohortId: before.studentCohortId,
      },
    });
  });

  refreshAndRedirect(returnPath);
}

export async function saveLocation(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = optionalText(formData, "id");
  const correlationId = randomUUID();

  const name = requiredText(formData, "name");
  const code = optionalText(formData, "code")?.toUpperCase() ?? null;
  const parentId = optionalText(formData, "parentId");
  const addressLine1 = optionalText(formData, "addressLine1");
  const addressLine2 = optionalText(formData, "addressLine2");
  const postalCode = optionalText(formData, "postalCode");
  const city = optionalText(formData, "city");
  const countryCode =
    optionalText(formData, "countryCode")?.toUpperCase() ?? null;
  const timezone = optionalText(formData, "timezone");
  const latitude = optionalNumber(formData, "latitude");
  const longitude = optionalNumber(formData, "longitude");
  const active = checked(formData, "active");

  const typeValue = requiredText(formData, "type");

  if (!Object.values(LocationType).includes(typeValue as LocationType)) {
    throw new Error("Invalid location type.");
  }

  const type = typeValue as LocationType;

  if (id && parentId === id) {
    throw new Error("A location cannot be its own parent.");
  }

  const saved = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.location.findFirst({
        where: {
          id,
          tenantId: tenant.id,
        },
      });

      if (!before) {
        throw new Error("Location not found.");
      }

      const after = await tx.location.update({
        where: { id },
        data: {
          name,
          code,
          type,
          parentId,
          addressLine1,
          addressLine2,
          postalCode,
          city,
          countryCode,
          timezone,
          latitude,
          longitude,
          active,
        },
      });

      await writeAuditEvent(tx, {
        tenantId: tenant.id,
        eventType: "UPDATED",
        entityType: "Location",
        entityId: after.id,
        actor,
        description: `Location updated: ${after.code ?? "—"} · ${after.name}.`,
        source: "masterdata.locations",
        correlationId,
        beforeState: before,
        afterState: after,
      });

      return after;
    }

    const after = await tx.location.create({
      data: {
        tenantId: tenant.id,
        name,
        code,
        type,
        parentId,
        addressLine1,
        addressLine2,
        postalCode,
        city,
        countryCode,
        timezone,
        latitude,
        longitude,
        active,
      },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: "CREATED",
      entityType: "Location",
      entityId: after.id,
      actor,
      description: `Location created: ${after.code ?? "—"} · ${after.name}.`,
      source: "masterdata.locations",
      correlationId,
      afterState: after,
    });

    return after;
  });

  refreshAndRedirect(`/locations?id=${saved.id}`);
}

export async function toggleLocationActive(formData: FormData) {
  const { tenant, actor } = await mutationContext();
  const id = requiredText(formData, "id");
  const active = requiredText(formData, "active") === "true";
  const correlationId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const before = await tx.location.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!before) {
      throw new Error("Location not found.");
    }

    const after = await tx.location.update({
      where: { id },
      data: { active },
    });

    await writeAuditEvent(tx, {
      tenantId: tenant.id,
      eventType: active ? "REACTIVATED" : "DEACTIVATED",
      entityType: "Location",
      entityId: after.id,
      actor,
      description: active
        ? `Location reactivated: ${after.code ?? "—"} · ${after.name}.`
        : `Location deactivated: ${after.code ?? "—"} · ${after.name}.`,
      source: "masterdata.locations",
      correlationId,
      beforeState: before,
      afterState: after,
    });
  });

  refreshAndRedirect(`/locations?id=${id}`);
}
