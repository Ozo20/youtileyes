import Link from "next/link";
import { MapPinned } from "lucide-react";

import { LocationType } from "@/generated/prisma/client";

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
  saveLocation,
  toggleLocationActive,
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

export default async function LocationsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  const { tenant } = await getTenantContext();

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader title="Locations" description="No tenant found." />
      </div>
    );
  }

  const locations = await prisma.location.findMany({
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
              {
                city: {
                  contains: params.q,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },
    include: {
      parent: true,
      _count: {
        select: {
          children: true,
          rooms: true,
          primaryStudents: true,
          primaryInstructors: true,
        },
      },
    },
    orderBy: [
      { active: "desc" },
      { type: "asc" },
      { name: "asc" },
    ],
  });

  const selected = params.id
    ? locations.find((location) => location.id === params.id) ??
      (await prisma.location.findFirst({
        where: {
          id: params.id,
          tenantId: tenant.id,
        },
        include: {
          parent: true,
          _count: {
            select: {
              children: true,
              rooms: true,
              primaryStudents: true,
              primaryInstructors: true,
            },
          },
        },
      }))
    : null;

  const creating = params.new === "1";

  const parentOptions = locations.filter(
    (location) => location.id !== selected?.id && location.active,
  );

  return (
    <div className="page-container">
      <PageHeader
        title="Locations"
        description="Physical location hierarchy used by rooms, people and planning."
        actions={
          <Badge tone="info">
            {locations.length} locations
          </Badge>
        }
      />

      <MasterDataToolbar
        newHref="/locations?new=1"
        newLabel="New location"
        query={params.q}
        placeholder="Search location"
      />

      <div
        className="master-workspace"
        data-detail-open={Boolean(selected || creating)}
      >
        <Card className="master-list-card">
          <CardContent className="master-list-content">
            <MasterDataList
              selectedId={selected?.id}
              emptyText="No locations match the current search."
              items={locations.map((location) => ({
                id: location.id,
                href: `/locations?id=${location.id}`,
                title: location.code ?? location.name,
                subtitle:
                  location.code
                    ? `${location.name} · ${location.type}`
                    : location.type,
                status: location.active ? "ACTIVE" : "INACTIVE",
                tone: location.active ? "success" : "warning",
                meta:
                  `${location._count.rooms} rooms` +
                  ` · ${location._count.children} child locations`,
              }))}
            />
          </CardContent>
        </Card>

        {creating || selected ? (
          <Card className="master-detail-card">
            <CardHeader>
              <div>
                <span className="eyebrow">
                  {creating ? "Create" : "Location"}
                </span>
                <h2>
                  {creating
                    ? "New location"
                    : `${selected!.code ?? "—"} · ${selected!.name}`}
                </h2>
              </div>

              <Link href="/locations" className="master-close">
                Close
              </Link>
            </CardHeader>

            <CardContent>
              <form action={saveLocation} className="master-form">
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
                        selected?.type ?? LocationType.CAMPUS
                      }
                    >
                      {Object.values(LocationType).map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>

                  <Field label="Parent location">
                    <SelectInput
                      name="parentId"
                      defaultValue={selected?.parentId ?? ""}
                    >
                      <option value="">No parent</option>
                      {parentOptions.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>

                  <Field label="Address">
                    <TextInput
                      name="addressLine1"
                      defaultValue={selected?.addressLine1 ?? ""}
                    />
                  </Field>

                  <Field label="Address line 2">
                    <TextInput
                      name="addressLine2"
                      defaultValue={selected?.addressLine2 ?? ""}
                    />
                  </Field>

                  <Field label="Postal code">
                    <TextInput
                      name="postalCode"
                      defaultValue={selected?.postalCode ?? ""}
                    />
                  </Field>

                  <Field label="City">
                    <TextInput
                      name="city"
                      defaultValue={selected?.city ?? ""}
                    />
                  </Field>

                  <Field
                    label="Country code"
                    hint="ISO alpha-2, e.g. NO"
                  >
                    <TextInput
                      name="countryCode"
                      maxLength={2}
                      defaultValue={selected?.countryCode ?? ""}
                    />
                  </Field>

                  <Field label="Timezone">
                    <TextInput
                      name="timezone"
                      placeholder="Europe/Oslo"
                      defaultValue={selected?.timezone ?? ""}
                    />
                  </Field>

                  <Field label="Latitude">
                    <TextInput
                      name="latitude"
                      type="number"
                      step="0.000001"
                      defaultValue={
                        selected?.latitude?.toString() ?? ""
                      }
                    />
                  </Field>

                  <Field label="Longitude">
                    <TextInput
                      name="longitude"
                      type="number"
                      step="0.000001"
                      defaultValue={
                        selected?.longitude?.toString() ?? ""
                      }
                    />
                  </Field>
                </div>

                <CheckboxField
                  name="active"
                  label="Active"
                  defaultChecked={selected?.active ?? true}
                />

                <div className="master-form-actions">
                  <Button type="submit" variant="primary">
                    {creating ? "Create location" : "Save changes"}
                  </Button>
                </div>
              </form>

              {selected ? (
                <section className="master-subsection">
                  <div className="master-subsection-header">
                    <div>
                      <span className="eyebrow">Usage</span>
                      <h3>Connected resources</h3>
                    </div>
                  </div>

                  <div className="master-metric-grid">
                    <div>
                      <strong>{selected._count.rooms}</strong>
                      <span>Rooms</span>
                    </div>
                    <div>
                      <strong>{selected._count.children}</strong>
                      <span>Child locations</span>
                    </div>
                    <div>
                      <strong>{selected._count.primaryStudents}</strong>
                      <span>Students</span>
                    </div>
                    <div>
                      <strong>{selected._count.primaryInstructors}</strong>
                      <span>Instructors</span>
                    </div>
                  </div>
                </section>
              ) : null}

              {selected ? (
                <section className="master-subsection master-danger-zone">
                  <div>
                    <span className="eyebrow">Lifecycle</span>
                    <h3>
                      {selected.active
                        ? "Deactivate location"
                        : "Reactivate location"}
                    </h3>
                    <p className="master-muted">
                      Existing rooms and historical links remain intact.
                    </p>
                  </div>

                  <form action={toggleLocationActive}>
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
              icon={<MapPinned size={20} />}
              title="Select a location"
              description="Open a location to edit hierarchy and physical planning context."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
