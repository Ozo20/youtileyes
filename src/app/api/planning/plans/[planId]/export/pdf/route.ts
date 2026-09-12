import { DistributionFormat } from "@/generated/prisma/client";
import { recordPlanDistribution } from "@/lib/planning/distribution";
import {
  exportFileBaseName,
  getPublishedPlanExport,
  planPdf,
} from "@/lib/planning/plan-export";

export async function GET(
  _request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  const { planId } = await context.params;
  const data = await getPublishedPlanExport(planId);
  if (!data) return new Response("Published plan not found.", { status: 404 });

  const body = planPdf(data);
  const bytes = new Uint8Array(body);
  const fileName = `${exportFileBaseName(data)}.pdf`;

  await recordPlanDistribution({
    planId,
    format: DistributionFormat.PDF,
    fileName,
    contentType: "application/pdf",
    bytes,
  });

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
