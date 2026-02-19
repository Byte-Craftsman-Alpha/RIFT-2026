import { NextResponse } from "next/server";
import { parseTransactionsCsv } from "@/lib/parseCsv";
import { analyzeTransactions } from "@/lib/analyze";
import { buildExportJson } from "@/lib/exportJson";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const t0 = performance.now();
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field 'file'" }, { status: 400 });
    }

    const csvText = await file.text();
    const { rows, errors } = parseTransactionsCsv(csvText);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid transactions parsed", parse_errors: errors.slice(0, 50) },
        { status: 400 },
      );
    }

    const result = analyzeTransactions(rows);

    const timeline = rows.slice().sort((a, b) => a.timestamp - b.timestamp);

    const txAmountById = new Map<string, number>();
    for (const r of rows) txAmountById.set(r.transaction_id, r.amount);

    const processingTimeSeconds = (performance.now() - t0) / 1000;
    const export_json = buildExportJson({
      report: result.report,
      totalAccountsAnalyzed: result.graph.nodes.length,
      processingTimeSeconds,
      txAmountById,
    });

    return NextResponse.json(
      {
        ...result,
        timeline,
        export_json,
        meta: {
          parsed_transactions: rows.length,
          parse_errors: errors.slice(0, 200),
        },
      },
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
