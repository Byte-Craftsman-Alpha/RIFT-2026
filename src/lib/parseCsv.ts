import Papa from "papaparse";
import { z } from "zod";
import type { TxRow } from "@/lib/types";
import { safeNumber, toEpochMs } from "@/lib/utils";

const RawRowSchema = z.object({
  transaction_id: z.union([z.string(), z.number()]).transform(String),
  sender_id: z.union([z.string(), z.number()]).transform(String),
  receiver_id: z.union([z.string(), z.number()]).transform(String),
  amount: z.union([z.string(), z.number()]),
  timestamp: z.union([z.string(), z.number()]),
});

export function parseTransactionsCsv(csvText: string): { rows: TxRow[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const errors: string[] = [];
  if (parsed.errors?.length) {
    for (const e of parsed.errors) errors.push(`${e.code}: ${e.message}`);
  }

  const rows: TxRow[] = [];
  const data = parsed.data ?? [];

  for (let i = 0; i < data.length; i++) {
    const raw = data[i];
    const res = RawRowSchema.safeParse(raw);
    if (!res.success) {
      errors.push(`Row ${i + 2}: invalid columns/values`);
      continue;
    }

    const amt = safeNumber(res.data.amount);
    const ts = toEpochMs(res.data.timestamp);
    if (amt === null || ts === null) {
      errors.push(`Row ${i + 2}: invalid amount or timestamp`);
      continue;
    }

    rows.push({
      transaction_id: res.data.transaction_id,
      sender_id: res.data.sender_id,
      receiver_id: res.data.receiver_id,
      amount: amt,
      timestamp: ts,
    });
  }

  return { rows, errors };
}
