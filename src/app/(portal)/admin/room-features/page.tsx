import { Boxes } from "lucide-react";

import { Field, SelectInput, TextInput } from "@/components/masterdata/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireInstitutionAdmin } from "@/lib/access/tenant-context";
import { saveRoomFeature } from "@/lib/masterdata/preference-actions";
import { prisma } from "@/lib/prisma";

export default async function AdminRoomFeaturesPage() {
  const { tenant } = await requireInstitutionAdmin();

  const features = await prisma.roomFeature.findMany({
    where: { tenantId: tenant.id },
    include: {
      _count: {
        select: {
          values: true,
          requirements: true,
        },
      },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return (
    <div className="page-container">
      <PageHeader
        title="Room equipment & features"
        description="Institution-controlled catalogue used by rooms and room requirements."
        actions={<Badge tone="info">{features.length} entries</Badge>}
      />

      <div className="master-workspace" data-detail-open="true">
        <Card className="master-list-card">
          <CardHeader>
            <h2>Catalogue</h2>
          </CardHeader>
          <CardContent className="master-list-content">
            {features.length === 0 ? (
              <EmptyState
                icon={<Boxes size={20} />}
                title="No room catalogue entries"
                description="Create the first equipment or room feature for this institution."
              />
            ) : (
              <div className="qualification-assignment-list">
                {features.map((feature) => (
                  <div className="qualification-assignment-row" key={feature.id}>
                    <div>
                      <strong>{feature.name}</strong>
                      <span>
                        {feature.code} · {feature.type === "EQUIPMENT" ? "Equipment" : "Feature"}
                      </span>
                    </div>
                    <span className="master-muted">
                      {feature._count.values} room links · {feature._count.requirements} requirements
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="master-detail-card">
          <CardHeader>
            <div>
              <span className="eyebrow">Create</span>
              <h2>New catalogue entry</h2>
            </div>
          </CardHeader>
          <CardContent>
            <form action={saveRoomFeature} className="master-form">
              <div className="master-form-grid">
                <Field label="Type">
                  <SelectInput name="type" defaultValue="EQUIPMENT" required>
                    <option value="EQUIPMENT">Equipment</option>
                    <option value="FEATURE">Feature</option>
                  </SelectInput>
                </Field>

                <Field label="Name">
                  <TextInput name="name" required placeholder="Projector" />
                </Field>
              </div>

              <div className="master-form-actions">
                <Button type="submit" variant="primary">
                  Create catalogue entry
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
