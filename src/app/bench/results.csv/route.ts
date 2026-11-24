import { readCsv } from "@/server/bench";

export const dynamic = "force-dynamic";

export function GET() {
  const csv = readCsv();
  if (!csv) return new Response("aucun résultat : lancez npm run bench\n", { status: 404 });
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="results.csv"' } });
}
