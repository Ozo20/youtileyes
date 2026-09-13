import Link from "next/link";
import { UserRoundCog } from "lucide-react";

import { PersonStatus } from "@/generated/prisma/client";

import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { InstructorCourseCompetence } from "@/components/masterdata/instructor-course-competence";
import { InstructorQualifications } from "@/components/masterdata/instructor-qualifications";
import { MasterDataList } from "@/components/masterdata/master-data-list";
import { MasterDataToolbar } from "@/components/masterdata/master-data-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  saveInstructor,
  toggleInstructorStatus,
} from "@/lib/masterdata/actions";
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

export default async function InstructorsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { tenant } = await getTenantContext();

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader title="Instructors" description="No tenant found." />
      </div>
    );
  }

  const instructors = await prisma.instructor.findMany({
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
      courses: {
        include: {
          course: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      qualifications: {
        include: {
          qualification: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      _count: {
        select: {
          courses: true,
          scenarioSessionLinks: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
  });

  const [locations, qualifications, courses] = await Promise.all([
    prisma.location.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
    prisma.qualification.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
      },
      orderBy: [{ code: "asc" }, { name: "asc" }],
    }),
    prisma.course.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: [{ code: "asc" }, { name: "asc" }],
    }),
  ]);

  const selected = params.id
    ? (instructors.find((item) => item.id === params.id) ??
      (await prisma.instructor.findFirst({
        where: {
          id: params.id,
          tenantId: tenant.id,
        },
        include: {
          primaryLocation: true,
          courses: {
            include: {
              course: true,
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          qualifications: {
            include: {
              qualification: true,
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          _count: {
            select: {
              courses: true,
              scenarioSessionLinks: true,
            },
          },
        },
      })))
    : null;

  const creating = params.new === "1";

  return (
    <div className="page-container">
      <PageHeader
        title="Instructors"
        description="Teaching capacity, qualifications and operational availability."
        actions={<Badge tone="info">{instructors.length} instructors</Badge>}
      />

      <MasterDataToolbar
        newHref="/instructors?new=1"
        newLabel="New instructor"
        query={params.q}
        placeholder="Search instructor"
      />

      <div
        className="master-workspace"
        data-detail-open={Boolean(selected || creating)}
      >
        <Card className="master-list-card">
          <CardContent className="master-list-content">
            <MasterDataList
              selectedId={selected?.id}
              emptyText="No instructors match the current search."
              items={instructors.map((instructor) => ({
                id: instructor.id,
                href: `/instructors?id=${instructor.id}`,
                title: `${instructor.firstName} ${instructor.lastName}`,
                subtitle:
                  instructor.primaryLocation?.name ??
                  instructor.externalId ??
                  "No primary location",
                status: instructor.status,
                tone: statusTone(instructor.status),
                meta:
                  `${instructor.qualifications.filter((item) => item.active).length} qualifications` +
                  ` · ${instructor._count.courses} courses`,
              }))}
            />
          </CardContent>
        </Card>

        {creating || selected ? (
          <Card className="master-detail-card">
            <CardHeader>
              <div>
                <span className="eyebrow">
                  {creating ? "Create" : "Instructor"}
                </span>
                <h2>
                  {creating
                    ? "New instructor"
                    : `${selected!.firstName} ${selected!.lastName}`}
                </h2>
              </div>

              <Link href="/instructors" className="master-close">
                Close
              </Link>
            </CardHeader>

            <CardContent>
              <form action={saveInstructor} className="master-form">
                {selected ? (
                  <input type="hidden" name="id" value={selected.id} />
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

                  <Field label="Status">
                    <SelectInput
                      name="status"
                      defaultValue={selected?.status ?? PersonStatus.ACTIVE}
                    >
                      {Object.values(PersonStatus).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>

                  <Field label="Primary location">
                    <SelectInput
                      name="primaryLocationId"
                      defaultValue={selected?.primaryLocationId ?? ""}
                    >
                      <option value="">No primary location</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>

                  <Field
                    label="Max teaching min/week"
                    hint="Optional hard personal limit"
                  >
                    <TextInput
                      name="maxTeachingMinutesPerWeek"
                      type="number"
                      min={0}
                      defaultValue={selected?.maxTeachingMinutesPerWeek ?? ""}
                    />
                  </Field>
                </div>

                <div className="master-form-actions">
                  <Button type="submit" variant="primary">
                    {creating ? "Create instructor" : "Save changes"}
                  </Button>
                </div>
              </form>

              {selected ? (
                <>
                  <InstructorCourseCompetence
                    instructorId={selected.id}
                    assigned={selected.courses}
                    courses={courses}
                  />

                  <InstructorQualifications
                    instructorId={selected.id}
                    assigned={selected.qualifications}
                    available={qualifications}
                  />

                  <section className="master-subsection master-danger-zone">
                    <div>
                      <span className="eyebrow">Lifecycle</span>
                      <h3>
                        {selected.status === PersonStatus.ACTIVE
                          ? "Deactivate instructor"
                          : "Reactivate instructor"}
                      </h3>
                      <p className="master-muted">
                        Historical schedule links remain intact.
                      </p>
                    </div>

                    <form action={toggleInstructorStatus}>
                      <input type="hidden" name="id" value={selected.id} />
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
              icon={<UserRoundCog size={20} />}
              title="Select an instructor"
              description="Open a record to inspect qualifications and edit operational master data."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
