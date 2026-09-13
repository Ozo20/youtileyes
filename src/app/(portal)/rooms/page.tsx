import Link from "next/link";
import { DoorOpen } from "lucide-react";

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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { saveRoom, toggleRoomActive } from "@/lib/masterdata/actions";
import {
  createAndAssignRoomFeature,
  saveRoomInventory,
} from "@/lib/masterdata/preference-actions";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    id?: string;
    new?: string;
  }>;
};

export default async function RoomsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tenant = await prisma.tenant.findUnique({
    where: { code: "DEMO" },
    select: { id: true },
  });

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader title="Rooms" description="No tenant found." />
      </div>
    );
  }

  const rooms = await prisma.room.findMany({
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
                location: {
                  name: {
                    contains: params.q,
                    mode: "insensitive",
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      location: true,
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
          scenarioSessions: true,
          coursePreferences: true,
        },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const [locations, qualifications, roomFeatures] = await Promise.all([
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
      orderBy: {
        code: "asc",
      },
    }),
    prisma.roomFeature.findMany({
      where: {
        tenantId: tenant.id,
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
    }),
  ]);

  const selected = params.id
    ? (rooms.find((item) => item.id === params.id) ??
      (await prisma.room.findFirst({
        where: {
          id: params.id,
          tenantId: tenant.id,
        },
        include: {
          location: true,
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
              scenarioSessions: true,
              coursePreferences: true,
            },
          },
        },
      })))
    : null;

  const creating = params.new === "1";

  const selectedRoomFeatures = selected
    ? await prisma.roomFeatureValue.findMany({
        where: {
          tenantId: tenant.id,
          roomId: selected.id,
        },
        orderBy: {
          featureId: "asc",
        },
      })
    : [];

  const selectedRoomFeatureById = new Map(
    selectedRoomFeatures.map((item) => [item.featureId, item]),
  );

  const assignedRoomFeatures = roomFeatures
    .map((feature) => ({
      feature,
      value: selectedRoomFeatureById.get(feature.id),
    }))
    .filter(
      (
        item,
      ): item is {
        feature: (typeof roomFeatures)[number];
        value: NonNullable<ReturnType<typeof selectedRoomFeatureById.get>>;
      } => Boolean(item.value && item.value.quantity > 0),
    );

  const availableRoomFeatures = roomFeatures.filter(
    (feature) => !selectedRoomFeatureById.has(feature.id),
  );

  return (
    <div className="page-container">
      <PageHeader
        title="Rooms"
        description="Capacity, location and room-specific supervision requirements."
        actions={<Badge tone="info">{rooms.length} rooms</Badge>}
      />

      <MasterDataToolbar
        newHref="/rooms?new=1"
        newLabel="New room"
        query={params.q}
        placeholder="Search room or location"
      />

      <div
        className="master-workspace"
        data-detail-open={Boolean(selected || creating)}
      >
        <Card className="master-list-card">
          <CardContent className="master-list-content">
            <MasterDataList
              selectedId={selected?.id}
              emptyText="No rooms match the current search."
              items={rooms.map((room) => ({
                id: room.id,
                href: `/rooms?id=${room.id}`,
                title: room.code ?? room.name,
                subtitle: room.location.name,
                status: room.active ? "ACTIVE" : "INACTIVE",
                tone: room.active ? "success" : "warning",
                meta:
                  `Capacity ${room.capacity}` +
                  ` · ${room.staffingRequirements.filter((rule) => rule.active).length} staffing rules`,
              }))}
            />
          </CardContent>
        </Card>

        {creating || selected ? (
          <Card className="master-detail-card">
            <CardHeader>
              <div>
                <span className="eyebrow">{creating ? "Create" : "Room"}</span>
                <h2>
                  {creating ? "New room" : (selected!.code ?? selected!.name)}
                </h2>
              </div>

              <Link href="/rooms" className="master-close">
                Close
              </Link>
            </CardHeader>

            <CardContent>
              <form action={saveRoom} className="master-form">
                {selected ? (
                  <input type="hidden" name="id" value={selected.id} />
                ) : null}

                <div className="master-form-grid">
                  <Field label="Name">
                    <TextInput
                      name="name"
                      required
                      defaultValue={selected?.name ?? ""}
                    />
                  </Field>

                  <Field label="Capacity">
                    <TextInput
                      name="capacity"
                      type="number"
                      min={1}
                      required
                      defaultValue={selected?.capacity ?? 20}
                    />
                  </Field>

                  <Field label="Location">
                    <SelectInput
                      name="locationId"
                      required
                      defaultValue={
                        selected?.locationId ?? locations[0]?.id ?? ""
                      }
                    >
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
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
                    {creating ? "Create room" : "Save changes"}
                  </Button>
                </div>
              </form>

              {selected ? (
                <>
                  <section className="master-subsection">
                    <div>
                      <span className="eyebrow">Equipment &amp; features</span>
                      <h3>Available in this room</h3>
                      <p className="master-muted">
                        Equipment and room features used when evaluating
                        scheduling requirements.
                      </p>
                    </div>

                    <div className="qualification-assignment-list room-feature-list">
                      {assignedRoomFeatures.length === 0 ? (
                        <p className="master-muted">
                          No equipment or features registered for this room.
                        </p>
                      ) : (
                        assignedRoomFeatures.map(({ feature, value }) => (
                          <div
                            key={feature.id}
                            className="qualification-assignment-row room-feature-row"
                          >
                            <div>
                              <strong>{feature.name}</strong>
                              <span>
                                {feature.type === "EQUIPMENT"
                                  ? `Equipment · quantity ${value.quantity}`
                                  : "Feature · present"}
                              </span>
                            </div>

                            <div className="room-feature-actions">
                              {feature.type === "EQUIPMENT" ? (
                                <form
                                  action={saveRoomInventory}
                                  className="room-feature-quantity-form"
                                >
                                  <input
                                    type="hidden"
                                    name="roomId"
                                    value={selected.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="featureId"
                                    value={feature.id}
                                  />
                                  <TextInput
                                    name="quantity"
                                    type="number"
                                    min={1}
                                    required
                                    defaultValue={value.quantity}
                                    aria-label={`${feature.name} quantity`}
                                  />
                                  <Button type="submit" variant="ghost">
                                    Save
                                  </Button>
                                </form>
                              ) : null}

                              <form action={saveRoomInventory}>
                                <input
                                  type="hidden"
                                  name="roomId"
                                  value={selected.id}
                                />
                                <input
                                  type="hidden"
                                  name="featureId"
                                  value={feature.id}
                                />
                                <input
                                  type="hidden"
                                  name="quantity"
                                  value="0"
                                />
                                <Button type="submit" variant="ghost">
                                  Remove
                                </Button>
                              </form>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <details className="room-feature-add">
                      <summary>Add equipment or feature</summary>

                      <div className="room-feature-add-content">
                        {availableRoomFeatures.length > 0 ? (
                          <form
                            action={saveRoomInventory}
                            className="master-inline-form room-feature-add-form"
                          >
                            <input
                              type="hidden"
                              name="roomId"
                              value={selected.id}
                            />

                            <Field label="Equipment or feature">
                              <SelectInput
                                name="featureId"
                                required
                                defaultValue=""
                              >
                                <option value="" disabled>
                                  Select item
                                </option>
                                {availableRoomFeatures.map((feature) => (
                                  <option key={feature.id} value={feature.id}>
                                    {feature.name} ·{" "}
                                    {feature.type === "EQUIPMENT"
                                      ? "Equipment"
                                      : "Feature"}
                                  </option>
                                ))}
                              </SelectInput>
                            </Field>

                            <Field label="Quantity">
                              <TextInput
                                name="quantity"
                                type="number"
                                min={1}
                                required
                                defaultValue={1}
                              />
                            </Field>

                            <Button type="submit" variant="secondary">
                              Add
                            </Button>
                          </form>
                        ) : (
                          <p className="master-muted">
                            All catalogue items are already assigned to this
                            room.
                          </p>
                        )}

                        <details className="room-feature-create-new">
                          <summary>Create new catalogue item</summary>

                          <form
                            action={createAndAssignRoomFeature}
                            className="master-inline-form room-feature-create-form"
                          >
                            <input
                              type="hidden"
                              name="roomId"
                              value={selected.id}
                            />

                            <Field label="Type">
                              <SelectInput
                                name="type"
                                required
                                defaultValue="EQUIPMENT"
                              >
                                <option value="EQUIPMENT">Equipment</option>
                                <option value="FEATURE">Feature</option>
                              </SelectInput>
                            </Field>

                            <Field label="Name">
                              <TextInput
                                name="name"
                                required
                                placeholder="Projector"
                              />
                            </Field>

                            <Field label="Quantity">
                              <TextInput
                                name="quantity"
                                type="number"
                                min={1}
                                required
                                defaultValue={1}
                              />
                            </Field>

                            <Button type="submit" variant="secondary">
                              Create and add
                            </Button>
                          </form>
                        </details>
                      </div>
                    </details>
                  </section>

                  <StaffingRequirements
                    source="ROOM"
                    targetId={selected.id}
                    returnPath={`/rooms?id=${selected.id}`}
                    rules={selected.staffingRequirements}
                    qualifications={qualifications}
                  />

                  <section className="master-subsection master-danger-zone">
                    <div>
                      <span className="eyebrow">Lifecycle</span>
                      <h3>
                        {selected.active
                          ? "Deactivate room"
                          : "Reactivate room"}
                      </h3>
                      <p className="master-muted">
                        Historical schedule use remains available in History.
                      </p>
                    </div>

                    <form action={toggleRoomActive}>
                      <input type="hidden" name="id" value={selected.id} />
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
              icon={<DoorOpen size={20} />}
              title="Select a room"
              description="Open a room to edit capacity and supervision requirements."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
