import type { AnalysisReport, FraudRing } from "@/lib/types";

export type ExportSuspiciousAccount = {
  account_id: string;
  suspicion_score: number;
  detected_patterns: string[];
  ring_id: string;
};

export type ExportFraudRing = {
  ring_id: string;
  member_accounts: string[];
  pattern_type: string;
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

function mapPatternType(r: FraudRing): string {
  return r.pattern_type;
}

function mapDetectedPattern(r: FraudRing): string {
  if (r.pattern_type === "circular_routing") return "cycle";
  if (r.pattern_type === "smurfing") return "smurfing";
  if (r.pattern_type === "dispersal") return "dispersal";
  if (r.pattern_type === "layered_shell") return "layered_shell";
  return r.pattern_type;
}

function scoreFloat(n: number): number {
  const x = Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(x * 10) / 10));
}

export function buildExportJson(params: {
  report: AnalysisReport;
  totalAccountsAnalyzed: number;
  processingTimeSeconds: number;
}): ExportJson {
  const { report, totalAccountsAnalyzed, processingTimeSeconds } = params;

  const accountToRings = new Map<string, FraudRing[]>();
  for (const ring of report.fraud_rings) {
    for (const acc of ring.members) {
      const arr = accountToRings.get(acc) ?? [];
      arr.push(ring);
      accountToRings.set(acc, arr);
    }
  }

  const fraud_rings: ExportFraudRing[] = report.fraud_rings.map((r) => ({
    ring_id: r.id,
    member_accounts: r.members,
    pattern_type: mapPatternType(r),
    risk_score: scoreFloat(r.risk_score),
  }));

  const suspicious_accounts: ExportSuspiciousAccount[] = report.suspicious_accounts
    .map((a) => {
      const rings = (accountToRings.get(a.account_id) ?? []).slice().sort((x, y) => y.risk_score - x.risk_score);
      const ring_id = rings[0]?.id ?? "";

      const patterns = new Set<string>();
      for (const r of rings) patterns.add(mapDetectedPattern(r));
      if (patterns.size === 0) {
        if (a.flags.cycle) patterns.add("cycle");
        if (a.flags.smurfing) patterns.add("smurfing");
        if (a.flags.layering) patterns.add("layered_shell");
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
