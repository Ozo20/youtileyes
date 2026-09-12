import { DistributionFormat } from "@/generated/prisma/client";
import { recordPlanDistribution } from "@/lib/planning/distribution";
import {
  exportFileBaseName,
  getPublishedPlanExport,
  planCsv,
} from "@/lib/planning/plan-export";

export async function GET(
  _request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  const { planId } = await context.params;
  const data = await getPublishedPlanExport(planId);
  if (!data) return new Response("Published plan not found.", { status: 404 });

  const body = planCsv(data);
  const bytes = new TextEncoder().encode(body);
  const fileName = `${exportFileBaseName(data)}.csv`;

  await recordPlanDistribution({
    planId,
    format: DistributionFormat.CSV,
    fileName,
    contentType: "text/csv; charset=utf-8",
    bytes,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
