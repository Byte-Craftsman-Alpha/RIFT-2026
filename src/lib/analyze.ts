import { canonicalCycle, ringId } from "@/lib/utils";
import type { AnalysisReport, FraudRing, GraphEdge, GraphNode, TxRow } from "@/lib/types";

type AdjTx = {
  to: string;
  txId: string;
  amount: number;
  ts: number;
};

type AccountStats = {
  inCount: number;
  outCount: number;
  totalCount: number;
  inSum: number;
  outSum: number;
};

export function analyzeTransactions(rows: TxRow[]) {
  const outAdj = new Map<string, AdjTx[]>();
  const inAdj = new Map<string, AdjTx[]>();
  const accountStats = new Map<string, AccountStats>();
  const edgeAgg = new Map<string, { source: string; target: string; amount: number; count: number }>();

  function touch(id: string) {
    if (!accountStats.has(id)) {
      accountStats.set(id, { inCount: 0, outCount: 0, totalCount: 0, inSum: 0, outSum: 0 });
    }
    return accountStats.get(id)!;
  }

  for (const tx of rows) {
    const s = tx.sender_id;
    const r = tx.receiver_id;
    const st = touch(s);
    const rt = touch(r);

    st.outCount += 1;
    st.totalCount += 1;
    st.outSum += tx.amount;

    rt.inCount += 1;
    rt.totalCount += 1;
    rt.inSum += tx.amount;

    if (!outAdj.has(s)) outAdj.set(s, []);
    if (!inAdj.has(r)) inAdj.set(r, []);

    outAdj.get(s)!.push({ to: r, txId: tx.transaction_id, amount: tx.amount, ts: tx.timestamp });
    inAdj.get(r)!.push({ to: s, txId: tx.transaction_id, amount: tx.amount, ts: tx.timestamp });

    const k = `${s}::${r}`;
    const e = edgeAgg.get(k) ?? { source: s, target: r, amount: 0, count: 0 };
    e.amount += tx.amount;
    e.count += 1;
    edgeAgg.set(k, e);
  }

  for (const v of outAdj.values()) v.sort((a, b) => a.ts - b.ts);
  for (const v of inAdj.values()) v.sort((a, b) => a.ts - b.ts);

  const cycleRings = detectCycles(outAdj);
  const smurfRings = detectSmurfing(outAdj, inAdj);
  const layerRings = detectLayering(outAdj, accountStats);

  const allRings = [...cycleRings, ...smurfRings, ...layerRings];

  const accountFlags = new Map<string, { cycle: boolean; smurfing: boolean; layering: boolean }>();
  for (const st of accountStats.keys()) {
    accountFlags.set(st, { cycle: false, smurfing: false, layering: false });
  }
  for (const ring of allRings) {
    for (const m of ring.members) {
      const f = accountFlags.get(m) ?? { cycle: false, smurfing: false, layering: false };
      if (ring.pattern_type === "circular_routing") f.cycle = true;
      if (ring.pattern_type === "smurfing") f.smurfing = true;
      if (ring.pattern_type === "layered_shell") f.layering = true;
      accountFlags.set(m, f);
    }
  }

  const accountScores = new Map<string, number>();
  for (const [id, f] of accountFlags.entries()) {
    const s = (f.cycle ? 45 : 0) + (f.smurfing ? 35 : 0) + (f.layering ? 40 : 0);
    accountScores.set(id, s);
  }

  const suspicious_accounts: AnalysisReport["suspicious_accounts"] = Array.from(accountScores.entries())
    .filter(([, score]) => score > 0)
    .map(([account_id, suspicion_score]) => ({
      account_id,
      suspicion_score,
      flags: accountFlags.get(account_id)!,
    }))
    .sort((a, b) => b.suspicion_score - a.suspicion_score);

  const fraud_rings = allRings.sort((a, b) => b.risk_score - a.risk_score);

  const nodes: GraphNode[] = Array.from(accountStats.keys()).map((id) => ({
    id,
    score: accountScores.get(id) ?? 0,
    flags: accountFlags.get(id) ?? { cycle: false, smurfing: false, layering: false },
  }));

  const edges: GraphEdge[] = Array.from(edgeAgg.values());

  return {
    graph: { nodes, edges },
    report: { suspicious_accounts, fraud_rings },
  };
}

function detectCycles(outAdj: Map<string, AdjTx[]>) {
  const rings: FraudRing[] = [];
  const seen = new Set<string>();

  const nodes = Array.from(outAdj.keys());

  for (const start of nodes) {
    const path: string[] = [start];
    const txPath: string[] = [];

    const dfs = (current: string, depth: number) => {
      if (depth > 5) return;
      const outs = outAdj.get(current);
      if (!outs) return;

      for (const e of outs) {
        const next = e.to;
        if (next === start && depth >= 3 && depth <= 5) {
          const cycleNodes = [...path, start];
          const sig = canonicalCycle(cycleNodes);
          if (sig && !seen.has(sig)) {
            seen.add(sig);
            rings.push({
              id: ringId("cycle"),
              pattern_type: "circular_routing",
              members: cycleNodes.slice(0, -1),
              member_count: cycleNodes.length - 1,
              risk_score: 70 + (cycleNodes.length - 1) * 5,
              evidence: {
                transaction_ids: [...txPath, e.txId],
                hops: cycleNodes.length - 1,
              },
            });
          }
          continue;
        }

        if (path.includes(next)) continue;
        if (depth === 5) continue;

        path.push(next);
        txPath.push(e.txId);
        dfs(next, depth + 1);
        path.pop();
        txPath.pop();
      }
    };

    dfs(start, 1);
  }

  return rings;
}

function detectSmurfing(outAdj: Map<string, AdjTx[]>, inAdj: Map<string, AdjTx[]>) {
  const WINDOW_MS = 72 * 60 * 60 * 1000;
  const THRESH = 10;
  const rings: FraudRing[] = [];

  const detect = (account: string, list: AdjTx[], mode: "fan_out" | "fan_in") => {
    let left = 0;
    const freq = new Map<string, number>();
    const txIds: string[] = [];

    for (let right = 0; right < list.length; right++) {
      const tx = list[right];
      const counterparty = tx.to;
      freq.set(counterparty, (freq.get(counterparty) ?? 0) + 1);
      txIds.push(tx.txId);

      while (list[right].ts - list[left].ts > WINDOW_MS) {
        const old = list[left];
        const oldCp = old.to;
        const n = (freq.get(oldCp) ?? 0) - 1;
        if (n <= 0) freq.delete(oldCp);
        else freq.set(oldCp, n);
        left += 1;
      }

      if (freq.size >= THRESH) {
        const members = mode === "fan_out" ? [account, ...Array.from(freq.keys()).slice(0, THRESH)] : [...Array.from(freq.keys()).slice(0, THRESH), account];
        rings.push({
          id: ringId("smurf"),
          pattern_type: "smurfing",
          members,
          member_count: members.length,
          risk_score: 60 + Math.min(20, freq.size),
          evidence: {
            transaction_ids: list.slice(left, right + 1).map((t) => t.txId),
            start_timestamp: list[left].ts,
            end_timestamp: list[right].ts,
          },
        });
        return;
      }
    }
  };

  for (const [sender, list] of outAdj.entries()) {
    if (list.length >= THRESH) detect(sender, list, "fan_out");
  }
  for (const [receiver, list] of inAdj.entries()) {
    if (list.length >= THRESH) detect(receiver, list, "fan_in");
  }

  return rings;
}

function detectLayering(outAdj: Map<string, AdjTx[]>, stats: Map<string, { totalCount: number }>) {
  const rings: FraudRing[] = [];
  const low = new Set<string>();
  for (const [id, s] of stats.entries()) {
    if (s.totalCount === 2 || s.totalCount === 3) low.add(id);
  }

  const MAX_DEPTH = 6;
  const seen = new Set<string>();

  for (const start of outAdj.keys()) {
    const path: string[] = [start];
    const txIds: string[] = [];

    const dfs = (current: string, depth: number) => {
      if (depth > MAX_DEPTH) return;
      const outs = outAdj.get(current);
      if (!outs) return;

      for (const e of outs) {
        const next = e.to;
        const isIntermediate = depth >= 1;
        if (isIntermediate && !low.has(current) && current !== start) continue;
        if (path.includes(next)) continue;

        path.push(next);
        txIds.push(e.txId);

        const hops = path.length - 1;
        const intermediates = path.slice(1, -1);
        const okIntermediates = intermediates.length >= 2 && intermediates.every((x) => low.has(x));

        if (hops >= 3 && okIntermediates) {
          const sig = `${start}::${next}::${intermediates.join(",")}`;
          if (!seen.has(sig)) {
            seen.add(sig);
            rings.push({
              id: ringId("layer"),
              pattern_type: "layered_shell",
              members: path.slice(),
              member_count: path.length,
              risk_score: 65 + Math.min(25, intermediates.length * 5),
              evidence: {
                transaction_ids: txIds.slice(),
                hops,
              },
            });
          }
        }

        dfs(next, depth + 1);

        path.pop();
        txIds.pop();
      }
    };

    dfs(start, 1);
  }

  return rings;
}
