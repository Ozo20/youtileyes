import Link from "next/link";
import { BookOpenCheck } from "lucide-react";

import { CourseDeliveryMode } from "@/generated/prisma/client";

import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { MasterDataList } from "@/components/masterdata/master-data-list";
import { MasterDataToolbar } from "@/components/masterdata/master-data-toolbar";
import { StaffingRequirements } from "@/components/masterdata/staffing-requirements";
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
  saveCourse,
  toggleCourseActive,
} from "@/lib/masterdata/actions";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    id?: string;
    new?: string;
  }>;
};

export default async function CoursesPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
    select: { id: true },
  });

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader title="Courses" description="No tenant found." />
      </div>
    );
  }

  const courses = await prisma.course.findMany({
    where: {
      tenantId: tenant.id,
      ...(params.q
        ? {
            OR: [
              {
                code: {
                  contains: params.q,
                  mode: "insensitive",
                },
              },
              {
                name: {
                  contains: params.q,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },
    include: {
      staffingRequirements: {
        include: {
          requiredQualification: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      _count: {
        select: {
          groups: true,
          instructors: true,
        },
      },
    },
    orderBy: [
      { active: "desc" },
      { code: "asc" },
      { name: "asc" },
    ],
  });

  const qualifications = await prisma.qualification.findMany({
    where: {
      tenantId: tenant.id,
      active: true,
    },
    orderBy: {
      code: "asc",
    },
  });

  const selected = params.id
    ? courses.find((item) => item.id === params.id) ??
      (await prisma.course.findFirst({
        where: {
          id: params.id,
          tenantId: tenant.id,
        },
        include: {
          staffingRequirements: {
            include: {
              requiredQualification: true,
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          _count: {
            select: {
              groups: true,
              instructors: true,
            },
          },
        },
      }))
    : null;

  const creating = params.new === "1";

  return (
    <div className="page-container">
      <PageHeader
        title="Courses"
        description="Teaching configuration, session rules and staffing requirements."
        actions={
          <Badge tone="info">
            {courses.length} courses
          </Badge>
        }
      />

      <MasterDataToolbar
        newHref="/courses?new=1"
        newLabel="New course"
        query={params.q}
        placeholder="Search course"
      />

      <div
        className="master-workspace"
        data-detail-open={Boolean(selected || creating)}
      >
        <Card className="master-list-card">
          <CardContent className="master-list-content">
            <MasterDataList
              selectedId={selected?.id}
              emptyText="No courses match the current search."
              items={courses.map((course) => ({
                id: course.id,
                href: `/courses?id=${course.id}`,
                title: course.code ?? course.name,
                subtitle:
                  course.code ? course.name : course.deliveryMode,
                status: course.active ? "ACTIVE" : "INACTIVE",
                tone: course.active ? "success" : "warning",
                meta:
                  `${course._count.groups} groups` +
                  ` · ${course._count.instructors} instructors` +
                  ` · ${course.staffingRequirements.filter((rule) => rule.active).length} staffing rules`,
              }))}
            />
          </CardContent>
        </Card>

        {creating || selected ? (
          <Card className="master-detail-card">
            <CardHeader>
              <div>
                <span className="eyebrow">
                  {creating ? "Create" : "Course"}
                </span>
                <h2>
                  {creating
                    ? "New course"
                    : `${selected!.code ?? "—"} · ${selected!.name}`}
                </h2>
              </div>

              <Link
                href="/courses"
                className="master-close"
              >
                Close
              </Link>
            </CardHeader>

            <CardContent>
              <form
                action={saveCourse}
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
                  <Field label="Code">
                    <TextInput
                      name="code"
                      defaultValue={selected?.code ?? ""}
                    />
                  </Field>

                  <Field label="Name">
                    <TextInput
                      name="name"
                      required
                      defaultValue={selected?.name ?? ""}
                    />
                  </Field>

                  <Field label="Delivery mode">
                    <SelectInput
                      name="deliveryMode"
                      defaultValue={
                        selected?.deliveryMode ??
                        CourseDeliveryMode.IN_PERSON
                      }
                    >
                      {Object.values(CourseDeliveryMode).map(
                        (mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ),
                      )}
                    </SelectInput>
                  </Field>

                  <Field label="Standard group size">
                    <TextInput
                      name="standardGroupSize"
                      type="number"
                      min={1}
                      defaultValue={
                        selected?.standardGroupSize ?? ""
                      }
                    />
                  </Field>

                  <Field label="Max group size">
                    <TextInput
                      name="maxGroupSize"
                      type="number"
                      min={1}
                      defaultValue={selected?.maxGroupSize ?? ""}
                    />
                  </Field>

                  <Field label="Preferred session min">
                    <TextInput
                      name="preferredSessionMinutes"
                      type="number"
                      min={1}
                      defaultValue={
                        selected?.preferredSessionMinutes ?? ""
                      }
                    />
                  </Field>

                  <Field label="Minimum session min">
                    <TextInput
                      name="minSessionMinutes"
                      type="number"
                      min={1}
                      defaultValue={
                        selected?.minSessionMinutes ?? ""
                      }
                    />
                  </Field>

                  <Field label="Maximum session min">
                    <TextInput
                      name="maxSessionMinutes"
                      type="number"
                      min={1}
                      defaultValue={
                        selected?.maxSessionMinutes ?? ""
                      }
                    />
                  </Field>

                  <Field label="Max sessions/day">
                    <TextInput
                      name="maxSessionsPerDay"
                      type="number"
                      min={1}
                      defaultValue={
                        selected?.maxSessionsPerDay ?? ""
                      }
                    />
                  </Field>
                </div>

                <div className="master-checkbox-row">
                  <CheckboxField
                    name="allowDoubleSession"
                    label="Allow double session"
                    defaultChecked={
                      selected?.allowDoubleSession ?? false
                    }
                  />

                  <CheckboxField
                    name="active"
                    label="Active"
                    defaultChecked={selected?.active ?? true}
                  />
                </div>

                <div className="master-form-actions">
                  <Button type="submit" variant="primary">
                    {creating ? "Create course" : "Save changes"}
                  </Button>
                </div>
              </form>

              {selected ? (
                <>
                  <StaffingRequirements
                    source="COURSE"
                    targetId={selected.id}
                    returnPath={`/courses?id=${selected.id}`}
                    rules={selected.staffingRequirements}
                    qualifications={qualifications}
                  />

                  <section className="master-subsection master-danger-zone">
                    <div>
                      <span className="eyebrow">
                        Lifecycle
                      </span>
                      <h3>
                        {selected.active
                          ? "Deactivate course"
                          : "Reactivate course"}
                      </h3>
                      <p className="master-muted">
                        Existing groups and historical sessions remain intact.
                      </p>
                    </div>

                    <form action={toggleCourseActive}>
                      <input
                        type="hidden"
                        name="id"
                        value={selected.id}
                      />
                      <input
                        type="hidden"
                        name="active"
                        value={String(!selected.active)}
                      />

                      <Button type="submit" variant="secondary">
                        {selected.active ? "Deactivate" : "Reactivate"}
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
              icon={<BookOpenCheck size={20} />}
              title="Select a course"
              description="Open a course to edit teaching and staffing rules."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
