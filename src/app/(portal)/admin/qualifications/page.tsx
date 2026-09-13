import Link from "next/link";
import { BadgeCheck } from "lucide-react";

import {
  CheckboxField,
  Field,
  TextArea,
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
  saveQualification,
  toggleQualificationActive,
} from "@/lib/masterdata/actions";
import { requireInstitutionAdmin } from "@/lib/access/tenant-context";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    id?: string;
    new?: string;
  }>;
};

export default async function QualificationsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const { tenant } = await requireInstitutionAdmin();

  const qualifications = await prisma.qualification.findMany({
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
      _count: {
        select: {
          instructorQualifications: true,
          staffingRequirements: true,
        },
      },
    },
    orderBy: [
      { active: "desc" },
      { code: "asc" },
    ],
  });

  const selected = params.id
    ? qualifications.find((item) => item.id === params.id) ??
      (await prisma.qualification.findFirst({
        where: {
          id: params.id,
          tenantId: tenant.id,
        },
        include: {
          _count: {
            select: {
              instructorQualifications: true,
              staffingRequirements: true,
            },
          },
        },
      }))
    : null;

  const creating = params.new === "1";

  return (
    <div className="page-container">
      <PageHeader
        title="Formal qualifications"
        description="Institution-controlled qualification and credential catalogue used for staffing and instructor eligibility."
        actions={
          <Badge tone="info">
            {qualifications.length} qualifications
          </Badge>
        }
      />

      <MasterDataToolbar
        newHref="/admin/qualifications?new=1"
        newLabel="New qualification"
        query={params.q}
        placeholder="Search code or name"
      />

      <div
        className="master-workspace"
        data-detail-open={Boolean(selected || creating)}
      >
        <Card className="master-list-card">
          <CardContent className="master-list-content">
            <MasterDataList
              selectedId={selected?.id}
              emptyText="No qualifications match the current search."
              items={qualifications.map((qualification) => ({
                id: qualification.id,
                href: `/admin/qualifications?id=${qualification.id}`,
                title: qualification.code,
                subtitle: qualification.name,
                status: qualification.active ? "ACTIVE" : "INACTIVE",
                tone: qualification.active ? "success" : "warning",
                meta:
                  `${qualification._count.instructorQualifications} instructor links` +
                  ` · ${qualification._count.staffingRequirements} staffing rules`,
              }))}
            />
          </CardContent>
        </Card>

        {creating || selected ? (
          <Card className="master-detail-card">
            <CardHeader>
              <div>
                <span className="eyebrow">
                  {creating ? "Create" : "Qualification"}
                </span>
                <h2>
                  {creating ? "New qualification" : selected!.code}
                </h2>
              </div>

              <Link
                href="/admin/qualifications"
                className="master-close"
              >
                Close
              </Link>
            </CardHeader>

            <CardContent>
              <form
                action={saveQualification}
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
                      required
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

                  <div className="master-grid-full">
                    <Field label="Description">
                      <TextArea
                        name="description"
                        rows={3}
                        defaultValue={selected?.description ?? ""}
                      />
                    </Field>
                  </div>
                </div>

                <CheckboxField
                  name="active"
                  label="Active"
                  defaultChecked={selected?.active ?? true}
                />

                <div className="master-form-actions">
                  <Button type="submit" variant="primary">
                    {creating ? "Create qualification" : "Save changes"}
                  </Button>
                </div>
              </form>

              {selected ? (
                <section className="master-subsection master-danger-zone">
                  <div>
                    <span className="eyebrow">
                      Lifecycle
                    </span>
                    <h3>
                      {selected.active
                        ? "Deactivate qualification"
                        : "Reactivate qualification"}
                    </h3>
                    <p className="master-muted">
                      Existing historical links are preserved.
                    </p>
                  </div>

                  <form action={toggleQualificationActive}>
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
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card className="master-detail-card master-empty-detail">
            <EmptyState
              icon={<BadgeCheck size={20} />}
              title="Select a formal qualification"
              description="Open an entry to edit the institution-controlled catalogue."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
