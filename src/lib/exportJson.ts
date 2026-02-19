import type { AnalysisReport, FraudRing } from "@/lib/types";

export type ExportSuspiciousAccount = {
  account_id: string;
  suspicion_score: number;
  detected_patterns: string[];
  ring_id: string;
};

export type ExportFraudRing = {
  ring_id: string;
  pattern: string;
  involved_accounts: string[];
  total_amount: number;
  risk_score: number;
};

export type ExportSummary = {
  total_accounts_analyzed: number;
  suspicious_accounts_flagged: number;
  fraud_rings_detected: number;
  processing_time_seconds: number;
};

export type ExportJson = {
  suspicious_accounts: ExportSuspiciousAccount[];
  fraud_rings: ExportFraudRing[];
  summary: ExportSummary;
};

function mapPatternLabel(r: FraudRing): string {
  if (r.pattern_type === "circular_routing") return "Circular Fund Routing";
  if (r.pattern_type === "smurfing") return "Smurfing (Fan-in)";
  if (r.pattern_type === "dispersal") return "Smurfing (Fan-out)";
  if (r.pattern_type === "layered_shell") return "Layered Shell Network";
  return r.pattern_type;
}

function baseSmurfRisk(r: FraudRing) {
  const counterparties = Math.max(0, r.member_count - 1);
  return 60 + Math.min(20, counterparties);
}

function detectedPatternsForRing(r: FraudRing): string[] {
  const p = mapPatternLabel(r);
  void baseSmurfRisk;
  return [p];
}

function scoreFloat(n: number): number {
  const x = Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(x * 10) / 10));
}

export function buildExportJson(params: {
  report: AnalysisReport;
  totalAccountsAnalyzed: number;
  processingTimeSeconds: number;
  txAmountById?: Map<string, number>;
}): ExportJson {
  const { report, totalAccountsAnalyzed, processingTimeSeconds, txAmountById } = params;

  const accountToRings = new Map<string, FraudRing[]>();
  for (const ring of report.fraud_rings) {
    for (const acc of ring.members) {
      const arr = accountToRings.get(acc) ?? [];
      arr.push(ring);
      accountToRings.set(acc, arr);
    }
  }

  const fraud_rings: ExportFraudRing[] = report.fraud_rings.map((r) => {
    let total_amount = 0;
    if (txAmountById) {
      for (const txId of r.evidence.transaction_ids) total_amount += txAmountById.get(txId) ?? 0;
    }
    return {
      ring_id: r.id,
      pattern: mapPatternLabel(r),
      involved_accounts: r.members,
      total_amount: Math.round(total_amount * 100) / 100,
      risk_score: scoreFloat(r.risk_score),
    };
  });

  const suspicious_accounts: ExportSuspiciousAccount[] = report.suspicious_accounts
    .map((a) => {
      const rings = (accountToRings.get(a.account_id) ?? []).slice().sort((x, y) => y.risk_score - x.risk_score);
      const ring_id = rings[0]?.id ?? "";

      const patterns = new Set<string>();
      for (const r of rings) {
        for (const p of detectedPatternsForRing(r)) patterns.add(p);
      }
      if (patterns.size === 0) {
        if (a.flags.cycle) patterns.add("Circular Fund Routing");
        if (a.flags.smurfing) patterns.add("Smurfing (Fan-in)");
        if (a.flags.layering) patterns.add("Layered Shell Network");
      }

      return {
        account_id: a.account_id,
        suspicion_score: scoreFloat(a.suspicion_score),
        detected_patterns: Array.from(patterns),
        ring_id,
      };
    })
    .sort((x, y) => y.suspicion_score - x.suspicion_score);

  const summary: ExportSummary = {
    total_accounts_analyzed: totalAccountsAnalyzed,
    suspicious_accounts_flagged: suspicious_accounts.length,
    fraud_rings_detected: fraud_rings.length,
    processing_time_seconds: Math.round(Math.max(0, processingTimeSeconds) * 1000) / 1000,
  };

  return { suspicious_accounts, fraud_rings, summary };
}
