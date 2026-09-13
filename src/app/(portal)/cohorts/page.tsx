import Link from "next/link";
import { UsersRound } from "lucide-react";

import { StudentCohortType } from "@/generated/prisma/client";

import { CohortMembership } from "@/components/masterdata/cohort-membership";
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "@/components/masterdata/form-field";
import { MasterDataList } from "@/components/masterdata/master-data-list";
import { MasterDataToolbar } from "@/components/masterdata/master-data-toolbar";
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
  saveCohort,
  toggleCohortActive,
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

export default async function CohortsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  const { tenant } = await getTenantContext();

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader title="Cohorts" description="No tenant found." />
      </div>
    );
  }

  const cohorts = await prisma.studentCohort.findMany({
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
      academicPeriod: true,
      organisationUnit: true,
      members: true,
      _count: {
        select: {
          teachingGroups: true,
        },
      },
    },
    orderBy: [
      { active: "desc" },
      { code: "asc" },
      { name: "asc" },
    ],
  });

  const [academicPeriods, organisationUnits, students] =
    await Promise.all([
      prisma.academicPeriod.findMany({
        where: {
          tenantId: tenant.id,
          active: true,
        },
        orderBy: {
          startDate: "desc",
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
      prisma.student.findMany({
        where: {
          tenantId: tenant.id,
          status: "ACTIVE",
        },
        orderBy: [
          { lastName: "asc" },
          { firstName: "asc" },
        ],
      }),
    ]);

  const selected = params.id
    ? await prisma.studentCohort.findFirst({
        where: {
          id: params.id,
          tenantId: tenant.id,
        },
        include: {
          academicPeriod: true,
          organisationUnit: true,
          members: {
            include: {
              student: true,
            },
            orderBy: {
              student: {
                lastName: "asc",
              },
            },
          },
          _count: {
            select: {
              teachingGroups: true,
            },
          },
        },
      })
    : null;

  const creating = params.new === "1";

  const memberStudentIds = new Set(
    selected?.members.map((member) => member.studentId) ?? [],
  );

  const availableStudents = students.filter(
    (student) => !memberStudentIds.has(student.id),
  );

  return (
    <div className="page-container">
      <PageHeader
        title="Cohorts / Classes"
        description="Class and cohort membership used by teaching groups and planning."
        actions={
          <Badge tone="info">
            {cohorts.length} cohorts
          </Badge>
        }
      />

      <MasterDataToolbar
        newHref="/cohorts?new=1"
        newLabel="New cohort"
        query={params.q}
        placeholder="Search cohort or class"
      />

      <div
        className="master-workspace"
        data-detail-open={Boolean(selected || creating)}
      >
        <Card className="master-list-card">
          <CardContent className="master-list-content">
            <MasterDataList
              selectedId={selected?.id}
              emptyText="No cohorts match the current search."
              items={cohorts.map((cohort) => ({
                id: cohort.id,
                href: `/cohorts?id=${cohort.id}`,
                title: cohort.code ?? cohort.name,
                subtitle:
                  cohort.code
                    ? cohort.name
                    : cohort.type,
                status: cohort.active ? "ACTIVE" : "INACTIVE",
                tone: cohort.active ? "success" : "warning",
                meta:
                  `${cohort.members.length} students` +
                  ` · ${cohort._count.teachingGroups} teaching groups`,
              }))}
            />
          </CardContent>
        </Card>

        {creating || selected ? (
          <Card className="master-detail-card">
            <CardHeader>
              <div>
                <span className="eyebrow">
                  {creating ? "Create" : "Cohort"}
                </span>
                <h2>
                  {creating
                    ? "New cohort / class"
                    : `${selected!.code ?? "—"} · ${selected!.name}`}
                </h2>
              </div>

              <Link href="/cohorts" className="master-close">
                Close
              </Link>
            </CardHeader>

            <CardContent>
              <form action={saveCohort} className="master-form">
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

                  <Field label="Type">
                    <SelectInput
                      name="type"
                      defaultValue={
                        selected?.type ?? StudentCohortType.CLASS
                      }
                    >
                      {Object.values(StudentCohortType).map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>

                  <Field label="Academic period">
                    <SelectInput
                      name="academicPeriodId"
                      defaultValue={selected?.academicPeriodId ?? ""}
                    >
                      <option value="">No academic period</option>
                      {academicPeriods.map((period) => (
                        <option key={period.id} value={period.id}>
                          {period.name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>

                  <Field label="Organisation unit">
                    <SelectInput
                      name="organisationUnitId"
                      defaultValue={selected?.organisationUnitId ?? ""}
                    >
                      <option value="">No organisation unit</option>
                      {organisationUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>

                <CheckboxField
                  name="active"
                  label="Active"
                  defaultChecked={selected?.active ?? true}
                />

                <div className="master-form-actions">
                  <Button type="submit" variant="primary">
                    {creating ? "Create cohort" : "Save changes"}
                  </Button>
                </div>
              </form>

              {selected ? (
                <>
                  <CohortMembership
                    cohortId={selected.id}
                    members={selected.members}
                    availableStudents={availableStudents}
                  />

                  <section className="master-subsection master-danger-zone">
                    <div>
                      <span className="eyebrow">Lifecycle</span>
                      <h3>
                        {selected.active
                          ? "Deactivate cohort"
                          : "Reactivate cohort"}
                      </h3>
                      <p className="master-muted">
                        Membership and historical teaching groups are retained.
                      </p>
                    </div>

                    <form action={toggleCohortActive}>
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
              icon={<UsersRound size={20} />}
              title="Select a cohort"
              description="Open a cohort or class to manage membership and planning context."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
