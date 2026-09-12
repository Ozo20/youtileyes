import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PlanRevisionTimeline } from "@/components/planning/plan-revision-timeline";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/prisma";
import { getPlanRevisionHistory } from "@/lib/planning/revision-history";

export default async function PlanRevisionsPage() {
  const tenant = await prisma.tenant.findUnique({ where: { code: "DEMO" } });

  if (!tenant) {
    return (
      <div className="page-container">
        <PageHeader title="Plan revisions" description="No active tenant found." />
      </div>
    );
  }

  const latest = await prisma.plan.findFirst({
    where: { tenantId: tenant.id },
    include: { planningScope: true },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
  });

  if (!latest) {
    return (
      <div className="page-container">
        <PageHeader title="Plan revisions" description="No plans found." />
      </div>
    );
  }

  const revisions = await getPlanRevisionHistory({
    tenantId: tenant.id,
    planningScopeId: latest.planningScopeId,
  });

  return (
    <div className="page-container">
      <PageHeader
        title="Plan revisions"
        description={`${latest.planningScope.name} · controlled revision and distribution history`}
        actions={
          <Link href="/planning">
            <Button type="button" variant="secondary">
              <ArrowLeft size={14} /> Back to planning
            </Button>
          </Link>
        }
      />

      <PlanRevisionTimeline revisions={revisions} />
    </div>
  );
}
