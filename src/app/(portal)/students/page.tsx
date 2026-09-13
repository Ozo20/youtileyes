import Link from "next/link";
import { GraduationCap } from "lucide-react";

import { PersonStatus } from "@/generated/prisma/client";

import {
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { MasterDataList } from "@/components/masterdata/master-data-list";
import { MasterDataToolbar } from "@/components/masterdata/master-data-toolbar";
import { StudentCohorts } from "@/components/masterdata/student-cohorts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  saveStudent,
  toggleStudentStatus,
} from "@/lib/masterdata/student-cohort-location-actions";
import { getTenantContext } from "@/lib/access/tenant-context";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    id?: string;
    new?: string;
  }>;
};

function statusTone(status: PersonStatus) {
  if (status === PersonStatus.ACTIVE) return "success" as const;
  if (status === PersonStatus.INACTIVE) return "warning" as const;
  return "neutral" as const;
}

export default async function StudentsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  const { tenant } = await getTenantContext();

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader title="Students" description="No tenant found." />
      </div>
    );
  }

  const students = await prisma.student.findMany({
    where: {
      tenantId: tenant.id,
      ...(params.q
        ? {
            OR: [
              {
                firstName: {
                  contains: params.q,
                  mode: "insensitive",
                },
              },
              {
                lastName: {
                  contains: params.q,
                  mode: "insensitive",
                },
              },
              {
                externalId: {
                  contains: params.q,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },
    include: {
      primaryLocation: true,
      primaryOrganisationUnit: true,
      cohortMemberships: {
        include: {
          studentCohort: true,
        },
      },
      _count: {
        select: {
          courseRequirements: true,
          groupMemberships: true,
        },
      },
    },
    orderBy: [
      { status: "asc" },
      { lastName: "asc" },
      { firstName: "asc" },
    ],
  });

  const [locations, organisationUnits] = await Promise.all([
    prisma.location.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
    prisma.organisationUnit.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
  ]);

  const selected = params.id
    ? students.find((student) => student.id === params.id) ??
      (await prisma.student.findFirst({
        where: {
          id: params.id,
          tenantId: tenant.id,
        },
        include: {
          primaryLocation: true,
          primaryOrganisationUnit: true,
          cohortMemberships: {
            include: {
              studentCohort: true,
            },
          },
          _count: {
            select: {
              courseRequirements: true,
              groupMemberships: true,
            },
          },
        },
      }))
    : null;

  const creating = params.new === "1";

  return (
    <div className="page-container">
      <PageHeader
        title="Students"
        description="Student master data, organisational placement and cohort membership."
        actions={
          <Badge tone="info">
            {students.length} students
          </Badge>
        }
      />

      <MasterDataToolbar
        newHref="/students?new=1"
        newLabel="New student"
        query={params.q}
        placeholder="Search student"
      />

      <div
        className="master-workspace"
        data-detail-open={Boolean(selected || creating)}
      >
        <Card className="master-list-card">
          <CardContent className="master-list-content">
            <MasterDataList
              selectedId={selected?.id}
              emptyText="No students match the current search."
              items={students.map((student) => ({
                id: student.id,
                href: `/students?id=${student.id}`,
                title: `${student.firstName} ${student.lastName}`,
                subtitle:
                  student.primaryOrganisationUnit?.name ??
                  student.primaryLocation?.name ??
                  student.externalId ??
                  "No organisational placement",
                status: student.status,
                tone: statusTone(student.status),
                meta:
                  `${student.cohortMemberships.length} cohort memberships` +
                  ` · ${student._count.courseRequirements} requirements`,
              }))}
            />
          </CardContent>
        </Card>

        {creating || selected ? (
          <Card className="master-detail-card">
            <CardHeader>
              <div>
                <span className="eyebrow">
                  {creating ? "Create" : "Student"}
                </span>
                <h2>
                  {creating
                    ? "New student"
                    : `${selected!.firstName} ${selected!.lastName}`}
                </h2>
              </div>

              <Link href="/students" className="master-close">
                Close
              </Link>
            </CardHeader>

            <CardContent>
              <form
                action={saveStudent}
                className="master-form"
              >
                {selected ? (
                  <input
                    type="hidden"
                    name="id"
                    value={selected.id}
                  />
                ) : null}

                <div className="master-form-grid">
                  <Field label="First name">
                    <TextInput
                      name="firstName"
                      required
                      defaultValue={selected?.firstName ?? ""}
                    />
                  </Field>

                  <Field label="Last name">
                    <TextInput
                      name="lastName"
                      required
                      defaultValue={selected?.lastName ?? ""}
                    />
                  </Field>

                  <Field label="External ID">
                    <TextInput
                      name="externalId"
                      defaultValue={selected?.externalId ?? ""}
                    />
                  </Field>

                  <Field label="Source system">
                    <TextInput
                      name="sourceSystem"
                      defaultValue={selected?.sourceSystem ?? ""}
                    />
                  </Field>

                  <Field label="Status">
                    <SelectInput
                      name="status"
                      defaultValue={
                        selected?.status ?? PersonStatus.ACTIVE
                      }
                    >
                      {Object.values(PersonStatus).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>

                  <Field label="Organisation unit">
                    <SelectInput
                      name="primaryOrganisationUnitId"
                      defaultValue={
                        selected?.primaryOrganisationUnitId ?? ""
                      }
                    >
                      <option value="">
                        No primary organisation unit
                      </option>
                      {organisationUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>

                  <Field label="Primary location">
                    <SelectInput
                      name="primaryLocationId"
                      defaultValue={
                        selected?.primaryLocationId ?? ""
                      }
                    >
                      <option value="">
                        No primary location
                      </option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>

                <div className="master-form-actions">
                  <Button type="submit" variant="primary">
                    {creating ? "Create student" : "Save changes"}
                  </Button>
                </div>
              </form>

              {selected ? (
                <>
                  <StudentCohorts
                    memberships={selected.cohortMemberships}
                  />

                  <section className="master-subsection master-danger-zone">
                    <div>
                      <span className="eyebrow">Lifecycle</span>
                      <h3>
                        {selected.status === PersonStatus.ACTIVE
                          ? "Deactivate student"
                          : "Reactivate student"}
                      </h3>
                      <p className="master-muted">
                        Historical teaching and schedule links remain intact.
                      </p>
                    </div>

                    <form action={toggleStudentStatus}>
                      <input
                        type="hidden"
                        name="id"
                        value={selected.id}
                      />
                      <input
                        type="hidden"
                        name="nextStatus"
                        value={
                          selected.status === PersonStatus.ACTIVE
                            ? PersonStatus.INACTIVE
                            : PersonStatus.ACTIVE
                        }
                      />

                      <Button type="submit" variant="secondary">
                        {selected.status === PersonStatus.ACTIVE
                          ? "Deactivate"
                          : "Reactivate"}
                      </Button>
                    </form>
                  </section>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card className="master-detail-card master-empty-detail">
            <EmptyState
              icon={<GraduationCap size={20} />}
              title="Select a student"
              description="Open a student to inspect cohort membership and edit master data."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
