"use server";

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { writeAuditEvent } from '@/lib/audit';
import type { Prisma } from '@/generated/prisma/client';

function text(data: FormData, key: string) {
  const value = data.get(key);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}
function integer(data: FormData, key: string, min = 1, max = 10000) {
  const value = Number(text(data, key));
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
}
function date(data: FormData, key: string) {
  const raw = data.get(key);
  if (!raw) return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`Invalid ${key}`);
  const value = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== raw) throw new Error(`Invalid ${key}`);
  return value;
}
function minute(data: FormData, key: string) {
  const raw = text(data, key);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) throw new Error(`Invalid ${key}`);
  const [hour, minute] = raw.split(':').map(Number);
  return hour * 60 + minute;
}
async function tenantId() {
  // Same demo tenant boundary as existing master-data actions; replace with session tenant when auth is introduced.
  return (await prisma.tenant.findUniqueOrThrow({ where: { code: 'DEMO' } })).id;
}
async function requireEntity(tx: Prisma.TransactionClient, tenantId: string, kind: string, id: string) {
  const where = { id, tenantId };
  const entity = kind === 'instructor' ? await tx.instructor.findFirst({ where })
    : kind === 'student' ? await tx.student.findFirst({ where })
    : kind === 'course' ? await tx.course.findFirst({ where })
    : kind === 'room' ? await tx.room.findFirst({ where })
    : kind === 'feature' ? await tx.roomFeature.findFirst({ where })
    : kind === 'cohort' ? await tx.studentCohort.findFirst({ where })
    : kind === 'group' ? await tx.teachingGroup.findFirst({ where }) : null;
  if (!entity) throw new Error('Resource not found in this tenant');
}
async function audit(tx: Prisma.TransactionClient, tenantId: string, entityType: string, after: { id: string }, before?: unknown) {
  await writeAuditEvent(tx, { tenantId, eventType: before ? 'UPDATED' : 'CREATED', entityType,
    entityId: after.id, source: 'masterdata.preferences', description: `${entityType} saved`, beforeState: before, afterState: after });
}
function refresh() { revalidatePath('/preferences'); revalidatePath('/instructors'); revalidatePath('/courses'); revalidatePath('/rooms'); }

export async function saveCourseCompetence(data: FormData) {
  const tid = await tenantId();
  const instructorId = text(data, 'instructorId'), courseId = text(data, 'courseId');
  const competenceLevel = integer(data, 'competenceLevel', 1, 100);

  const preferenceRaw = data.get('preference');
  if (
    typeof preferenceRaw !== 'string' ||
    !['PREFER', 'NEUTRAL', 'AVOID'].includes(preferenceRaw)
  ) {
    throw new Error('Invalid course instructor preference');
  }

  const preference = preferenceRaw as 'PREFER' | 'NEUTRAL' | 'AVOID';
  const preferenceWeight = integer(data, 'preferenceWeight', 1, 10000);

  const validFrom = date(data, 'validFrom'), validTo = date(data, 'validTo');
  if (validFrom && validTo && validTo < validFrom) throw new Error('End date precedes start');
  await prisma.$transaction(async tx => {
    await requireEntity(tx, tid, 'instructor', instructorId); await requireEntity(tx, tid, 'course', courseId);
    const where = { tenantId_instructorId_courseId: { tenantId: tid, instructorId, courseId } };
    const before = await tx.instructorCourse.findUnique({ where });
    const after = await tx.instructorCourse.upsert({
      where,
      create: {
        tenantId: tid,
        instructorId,
        courseId,
        competenceLevel,
        preference,
        preferenceWeight,
        validFrom,
        validTo,
      },
      update: {
        competenceLevel,
        preference,
        preferenceWeight,
        validFrom,
        validTo,
        active: true,
      },
    });
    await audit(tx, tid, 'InstructorCourse', after, before);
  }); refresh();
}
export async function saveTimePreference(data: FormData) {
  const tid = await tenantId(), name = text(data, 'name');
  const target = text(data, 'target'), [kind, id] = target.split(':');
  if (!['all', 'students', 'instructors', 'instructor', 'student', 'cohort', 'group', 'course'].includes(kind)) throw new Error('Invalid target');
  const startMinute = minute(data, 'startMinute'), endMinute = minute(data, 'endMinute');
  if (endMinute <= startMinute) throw new Error('End time must follow start time');
  const weekdays = [...new Set(data.getAll('weekdays').map(Number))];
  if (!weekdays.length || weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7)) throw new Error('Choose weekdays');
  const weight = integer(data, 'weight'), validFrom = date(data, 'validFrom'), validTo = date(data, 'validTo');
  if (validFrom && validTo && validTo < validFrom) throw new Error('End date precedes start');
  await prisma.$transaction(async tx => {
    if (!['all', 'students', 'instructors'].includes(kind)) await requireEntity(tx, tid, kind, id);
    const after = await tx.planningRule.create({ data: { tenantId: tid, name, ruleType: 'AVOID_TIME_WINDOW',
      scopeType: kind === 'instructor' ? 'INSTRUCTOR' : kind === 'student' ? 'STUDENT' : kind === 'cohort' ? 'STUDENT_COHORT' : kind === 'group' ? 'TEACHING_GROUP' : kind === 'course' ? 'COURSE' : 'TENANT',
      audience: kind === 'instructors' ? 'INSTRUCTORS' : kind === 'all' ? 'ALL' : 'STUDENTS',
      instructorId: kind === 'instructor' ? id : null, studentId: kind === 'student' ? id : null,
      studentCohortId: kind === 'cohort' ? id : null, teachingGroupId: kind === 'group' ? id : null, courseId: kind === 'course' ? id : null,
      weekdays, startMinute, endMinute, weight, validFrom, validTo,
      constraintType: data.get('hard') === 'on' ? 'HARD' : 'SOFT', valueUnit: 'MINUTES',
    } }); await audit(tx, tid, 'PlanningRule', after);
  }); refresh();
}
export async function saveBreakPreference(data: FormData) {
  const tid = await tenantId();
  const name = text(data, 'name');
  const target = text(data, 'target');
  const [kind, id] = target.split(':');

  if (
    !['all', 'students', 'instructors', 'instructor', 'student', 'cohort', 'group', 'course'].includes(kind)
  ) {
    throw new Error('Invalid target');
  }

  const minBreakMinutes = integer(data, 'minBreakMinutes', 0, 240);
  const weekdays = [...new Set(data.getAll('weekdays').map(Number))];

  if (
    !weekdays.length ||
    weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    throw new Error('Choose weekdays');
  }

  const weight = integer(data, 'weight');
  const validFrom = date(data, 'validFrom');
  const validTo = date(data, 'validTo');

  if (validFrom && validTo && validTo < validFrom) {
    throw new Error('End date precedes start');
  }

  await prisma.$transaction(async tx => {
    if (!['all', 'students', 'instructors'].includes(kind)) {
      await requireEntity(tx, tid, kind, id);
    }

    const after = await tx.planningRule.create({
      data: {
        tenantId: tid,
        name,
        ruleType: 'MIN_BREAK_MINUTES',
        scopeType:
          kind === 'instructor'
            ? 'INSTRUCTOR'
            : kind === 'student'
              ? 'STUDENT'
              : kind === 'cohort'
                ? 'STUDENT_COHORT'
                : kind === 'group'
                  ? 'TEACHING_GROUP'
                  : kind === 'course'
                    ? 'COURSE'
                    : 'TENANT',
        audience:
          kind === 'instructors'
            ? 'INSTRUCTORS'
            : kind === 'all'
              ? 'ALL'
              : 'STUDENTS',
        instructorId: kind === 'instructor' ? id : null,
        studentId: kind === 'student' ? id : null,
        studentCohortId: kind === 'cohort' ? id : null,
        teachingGroupId: kind === 'group' ? id : null,
        courseId: kind === 'course' ? id : null,
        weekdays,
        valueInt: minBreakMinutes,
        valueUnit: 'MINUTES',
        weight,
        validFrom,
        validTo,
        constraintType: data.get('hard') === 'on' ? 'HARD' : 'SOFT',
      },
    });

    await audit(tx, tid, 'PlanningRule', after);
  });

  refresh();
}

export async function saveRoomFeature(data: FormData) {
  const tid = await tenantId(), code = text(data, 'code').toUpperCase(), name = text(data, 'name');
  await prisma.$transaction(async tx => {
    const where = { tenantId_code: { tenantId: tid, code } };
    const before = await tx.roomFeature.findUnique({ where });
    const after = await tx.roomFeature.upsert({ where, create: { tenantId: tid, code, name }, update: { name } });
    await audit(tx, tid, 'RoomFeature', after, before);
  }); refresh();
}
export async function saveRoomInventory(data: FormData) {
  const tid = await tenantId(), roomId = text(data, 'roomId'), featureId = text(data, 'featureId'), quantity = integer(data, 'quantity', 0);
  await prisma.$transaction(async tx => {
    await requireEntity(tx, tid, 'room', roomId); await requireEntity(tx, tid, 'feature', featureId);
    const where = { tenantId_roomId_featureId: { tenantId: tid, roomId, featureId } };
    const before = await tx.roomFeatureValue.findUnique({ where });
    const after = await tx.roomFeatureValue.upsert({ where, create: { tenantId: tid, roomId, featureId, quantity }, update: { quantity } });
    await audit(tx, tid, 'RoomFeatureValue', after, before);
  }); refresh();
}
export async function saveRoomRequirement(data: FormData) {
  const tid = await tenantId(), [kind, id] = text(data, 'target').split(':'), featureId = text(data, 'featureId');
  if (!['course', 'student', 'instructor'].includes(kind)) throw new Error('Invalid requirement target');
  const quantity = integer(data, 'quantity'), weight = integer(data, 'weight');
  await prisma.$transaction(async tx => {
    await requireEntity(tx, tid, kind, id); await requireEntity(tx, tid, 'feature', featureId);
    const after = await tx.roomRequirement.create({ data: { tenantId: tid, featureId, quantity, weight,
      courseId: kind === 'course' ? id : null, studentId: kind === 'student' ? id : null, instructorId: kind === 'instructor' ? id : null,
      perStudent: kind === 'course' && data.get('perStudent') === 'on',
      hard: kind !== 'course' || data.get('hard') === 'on',
    } }); await audit(tx, tid, 'RoomRequirement', after);
  }); refresh();
}
export async function togglePreference(data: FormData) {
  const tid = await tenantId(), id = text(data, 'id'), kind = text(data, 'kind');
  await prisma.$transaction(async tx => {
    if (kind === 'time') {
      const before = await tx.planningRule.findFirstOrThrow({
        where: {
          tenantId: tid,
          id,
          ruleType: { in: ['AVOID_TIME_WINDOW', 'MIN_BREAK_MINUTES'] },
        },
      });
      const after = await tx.planningRule.update({ where: { id }, data: { active: !before.active } });
      await audit(tx, tid, 'PlanningRule', after, before);
    } else if (kind === 'room') {
      const before = await tx.roomRequirement.findFirstOrThrow({ where: { tenantId: tid, id } });
      const after = await tx.roomRequirement.update({ where: { id }, data: { active: !before.active } });
      await audit(tx, tid, 'RoomRequirement', after, before);
    } else if (kind === 'competence') {
      const before = await tx.instructorCourse.findFirstOrThrow({ where: { tenantId: tid, id } });
      const after = await tx.instructorCourse.update({ where: { id }, data: { active: !before.active } });
      await audit(tx, tid, 'InstructorCourse', after, before);
    } else throw new Error('Invalid preference kind');
  }); refresh();
}
