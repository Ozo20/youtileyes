import Link from "next/link";
import { BadgeCheck, Boxes, Building2, ShieldCheck, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireInstitutionAdmin } from "@/lib/access/tenant-context";
import { prisma } from "@/lib/prisma";

export default async function AdminPage() {
  const { tenant } = await requireInstitutionAdmin();

  const [memberships, qualificationCount, roomFeatureCount] = await Promise.all([
    prisma.tenantMembership.findMany({
      where: {
        tenantId: tenant.id,
        active: true,
      },
      include: {
        user: true,
      },
      orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
    }),
    prisma.qualification.count({
      where: { tenantId: tenant.id, active: true },
    }),
    prisma.roomFeature.count({
      where: { tenantId: tenant.id },
    }),
  ]);

  return (
    <div className="page-container">
      <PageHeader
        title="Admin"
        description={`Institution configuration and access for ${tenant.name}.`}
        actions={<Badge tone="info">Institution administrator</Badge>}
      />

      <div className="admin-card-grid">
        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Institution</span>
              <h2>{tenant.name}</h2>
            </div>
            <Building2 size={20} />
          </CardHeader>
          <CardContent>
            <p className="master-muted">
              Tenant code {tenant.code}. Data and configuration in this area are
              scoped to this institution.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Catalogues</span>
              <h2>Formal qualifications</h2>
            </div>
            <BadgeCheck size={20} />
          </CardHeader>
          <CardContent>
            <p className="master-muted">
              {qualificationCount} active entries available to instructor and
              staffing forms.
            </p>
            <Link className="text-link" href="/admin/qualifications">
              Manage qualifications
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Catalogues</span>
              <h2>Room equipment &amp; features</h2>
            </div>
            <Boxes size={20} />
          </CardHeader>
          <CardContent>
            <p className="master-muted">
              {roomFeatureCount} entries available for rooms and room
              requirements.
            </p>
            <Link className="text-link" href="/admin/room-features">
              Manage room catalogue
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <span className="eyebrow">Access</span>
              <h2>Users &amp; roles</h2>
            </div>
            <Users size={20} />
          </CardHeader>
          <CardContent>
            <div className="qualification-assignment-list">
              {memberships.map((membership) => (
                <div className="qualification-assignment-row" key={membership.id}>
                  <div>
                    <strong>{membership.user.name}</strong>
                    <span>{membership.user.email}</span>
                  </div>
                  <Badge tone={membership.role === "ADMIN" ? "info" : "neutral"}>
                    {membership.role}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="master-muted">
              Membership is now institution-scoped. Invitation and role editing
              will be enabled when real authentication is connected.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <span className="eyebrow">Security boundary</span>
            <h2>Institution-scoped administration</h2>
          </div>
          <ShieldCheck size={20} />
        </CardHeader>
        <CardContent>
          <p className="master-muted">
            Admin pages and catalogue mutations resolve the institution from the
            active user membership on the server. Tenant identifiers are not
            accepted from browser form input.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
