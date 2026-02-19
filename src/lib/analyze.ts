import { canonicalCycle, deterministicRingId } from "@/lib/utils";
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

type SmurfRole = "aggregator" | "sender" | "receiver";

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

  const allRings = dedupeRings([...cycleRings, ...smurfRings, ...layerRings]);

  const centrality = computeBetweennessCentrality(outAdj, accountStats.size);

  const accountFlags = new Map<string, { cycle: boolean; smurfing: boolean; layering: boolean }>();
  for (const st of accountStats.keys()) {
    accountFlags.set(st, { cycle: false, smurfing: false, layering: false });
  }
  for (const ring of allRings) {
    for (const m of ring.members) {
      const f = accountFlags.get(m) ?? { cycle: false, smurfing: false, layering: false };
      if (ring.pattern_type === "circular_routing") f.cycle = true;
      if (ring.pattern_type === "smurfing" || ring.pattern_type === "dispersal") f.smurfing = true;
      if (ring.pattern_type === "layered_shell") f.layering = true;
      accountFlags.set(m, f);
    }
  }

  const accountScores = new Map<string, number>();

  const smurfRolesByAccount = new Map<string, Set<SmurfRole>>();
  for (const r of allRings) {
    if (r.pattern_type !== "smurfing") continue;
    const agg = r.members[0];
    const meta = (r.evidence as { roles?: { senders?: string[]; receivers?: string[] } }).roles;
    const senders = meta?.senders ?? [];
    const receivers = meta?.receivers ?? [];

    const addRole = (id: string, role: SmurfRole) => {
      const set = smurfRolesByAccount.get(id) ?? new Set<SmurfRole>();
      set.add(role);
      smurfRolesByAccount.set(id, set);
    };
    if (typeof agg === "string") addRole(agg, "aggregator");
    for (const s of senders) addRole(s, "sender");
    for (const x of receivers) addRole(x, "receiver");
  }

  for (const [id, f] of accountFlags.entries()) {
    let s = (f.cycle ? 45 : 0) + (f.layering ? 40 : 0);
    const roles = smurfRolesByAccount.get(id);
    if (roles?.has("aggregator")) s += 50;
    else if (roles?.has("sender")) s += 25;
    else if (roles?.has("receiver")) s += 10;
    else if (f.smurfing) s += 25;

    const c = centrality.get(id) ?? 0;
    const stats = accountStats.get(id);
    const deg = stats ? stats.inCount + stats.outCount : 0;
    if (deg <= 6) {
      s += Math.min(20, Math.round(c * 100 * 0.2));
    } else {
      s += Math.min(10, Math.round(c * 100 * 0.1));
    }

    accountScores.set(id, Math.max(0, Math.min(100, s)));
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
    centrality: centrality.get(id) ?? 0,
    flags: accountFlags.get(id) ?? { cycle: false, smurfing: false, layering: false },
  }));

  const edges: GraphEdge[] = Array.from(edgeAgg.values());

  return {
    graph: { nodes, edges },
    report: { suspicious_accounts, fraud_rings },
  };
}

function memberSetKey(members: string[]) {
  return members.slice().sort().join("|");
}

function patternPriority(p: FraudRing["pattern_type"]) {
  if (p === "circular_routing") return 4;
  if (p === "smurfing" || p === "dispersal") return 3;
  if (p === "layered_shell") return 2;
  return 1;
}

function dedupeRings(rings: FraudRing[]) {
  const bestByMembers = new Map<string, FraudRing>();
  for (const r of rings) {
    const key = memberSetKey(r.members);
    const prev = bestByMembers.get(key);
    if (!prev) {
      bestByMembers.set(key, r);
      continue;
    }

    const pa = patternPriority(prev.pattern_type);
    const pb = patternPriority(r.pattern_type);
    if (pb > pa || (pb === pa && r.risk_score > prev.risk_score)) {
      bestByMembers.set(key, r);
    }
  }
  return Array.from(bestByMembers.values());
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
              id: deterministicRingId(`cycle|${sig}`),
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

function computeBetweennessCentrality(outAdj: Map<string, AdjTx[]>, nNodes: number) {
  const MAX_NODES = 2000;
  const bc = new Map<string, number>();
  if (nNodes === 0) return bc;
  if (nNodes > MAX_NODES) {
    for (const v of outAdj.keys()) bc.set(v, 0);
    return bc;
  }

  const nodes = new Set<string>();
  for (const [s, outs] of outAdj.entries()) {
    nodes.add(s);
    for (const e of outs) nodes.add(e.to);
  }
  const adj = new Map<string, string[]>();
  for (const v of nodes) adj.set(v, []);
  for (const [s, outs] of outAdj.entries()) {
    const list = adj.get(s) ?? [];
    const seen = new Set<string>();
    for (const e of outs) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        list.push(e.to);
      }
    }
    adj.set(s, list);
  }

  for (const v of nodes) bc.set(v, 0);

  for (const s of nodes) {
    const S: string[] = [];
    const P = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();

    for (const v of nodes) {
      P.set(v, []);
      sigma.set(v, 0);
      dist.set(v, -1);
    }
    sigma.set(s, 1);
    dist.set(s, 0);

    const Q: string[] = [s];
    for (let qh = 0; qh < Q.length; qh++) {
      const v = Q[qh]!;
      S.push(v);
      const vDist = dist.get(v)!;
      for (const w of adj.get(v) ?? []) {
        if (dist.get(w)! < 0) {
          Q.push(w);
          dist.set(w, vDist + 1);
        }
        if (dist.get(w) === vDist + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0));
          (P.get(w) ?? []).push(v);
        }
      }
    }

    const delta = new Map<string, number>();
    for (const v of nodes) delta.set(v, 0);
    for (let i = S.length - 1; i >= 0; i--) {
      const w = S[i]!;
      for (const v of P.get(w) ?? []) {
        const sv = sigma.get(v) ?? 0;
        const sw = sigma.get(w) ?? 0;
        if (sw > 0) {
          delta.set(v, (delta.get(v) ?? 0) + (sv / sw) * (1 + (delta.get(w) ?? 0)));
        }
      }
      if (w !== s) bc.set(w, (bc.get(w) ?? 0) + (delta.get(w) ?? 0));
    }
  }

  let max = 0;
  for (const v of bc.values()) if (v > max) max = v;
  if (max > 0) {
    for (const [k, v] of bc.entries()) bc.set(k, v / max);
  }
  return bc;
}

function detectSmurfing(outAdj: Map<string, AdjTx[]>, inAdj: Map<string, AdjTx[]>) {
  const WINDOW_MS = 72 * 60 * 60 * 1000;
  const IN_UNIQUE_MIN = 10;
  const OUT_UNIQUE_MIN = 5;
  const LAG_MS = 24 * 60 * 60 * 1000;
  const VELOCITY_HOURS = 6;
  const rings: FraudRing[] = [];

  for (const account of new Set<string>([...outAdj.keys(), ...inAdj.keys()])) {
    const ins = (inAdj.get(account) ?? []).slice();
    const outs = (outAdj.get(account) ?? []).slice();
    if (ins.length < IN_UNIQUE_MIN || outs.length < OUT_UNIQUE_MIN) continue;

    let iL = 0;
    let iR = 0;
    const sendersFreq = new Map<string, number>();

    const advanceInR = (idx: number) => {
      const tx = ins[idx]!;
      const cp = tx.to;
      sendersFreq.set(cp, (sendersFreq.get(cp) ?? 0) + 1);
    };
    const retractInL = (idx: number) => {
      const tx = ins[idx]!;
      const cp = tx.to;
      const n = (sendersFreq.get(cp) ?? 0) - 1;
      if (n <= 0) sendersFreq.delete(cp);
      else sendersFreq.set(cp, n);
    };

    while (iL < ins.length) {
      const startTs = ins[iL]!.ts;
      const endTs = startTs + WINDOW_MS;

      while (iR < ins.length && ins[iR]!.ts <= endTs) {
        advanceInR(iR);
        iR += 1;
      }

      const uniqueSenders = Array.from(sendersFreq.keys());
      if (uniqueSenders.length >= IN_UNIQUE_MIN) {
        const outsInWindow = outs.filter((t) => t.ts >= startTs && t.ts <= endTs);
        const receiverSet = new Set<string>(outsInWindow.map((t) => t.to));
        if (receiverSet.size >= OUT_UNIQUE_MIN) {
          const firstIn = startTs;
          const firstOutTx = outsInWindow.find((t) => t.ts >= firstIn);
          if (firstOutTx && firstOutTx.ts - firstIn <= LAG_MS) {
            const receivers = Array.from(receiverSet.values());
            const members = [account, ...uniqueSenders.slice().sort(), ...receivers.slice().sort()];
            const txIds = [...ins.slice(iL, iR).map((t) => t.txId), ...outsInWindow.map((t) => t.txId)];

            const incomingSum = ins.slice(iL, iR).reduce((acc, t) => acc + t.amount, 0);
            const outEnd = outsInWindow.length ? outsInWindow[outsInWindow.length - 1]!.ts : firstOutTx.ts;
            const horizon = outEnd + VELOCITY_HOURS * 60 * 60 * 1000;
            let outFast = 0;
            for (const ot of outs) {
              if (ot.ts >= outEnd && ot.ts <= horizon) outFast += ot.amount;
            }
            const velocityBoost = incomingSum > 0 && outFast / incomingSum >= 0.9 ? 15 : 0;

            rings.push({
              id: deterministicRingId(
                `smurf|${account}|${uniqueSenders.slice().sort().join(",")}|${receivers.slice().sort().join(",")}|${startTs}|${endTs}`,
              ),
              pattern_type: "smurfing",
              members,
              member_count: members.length,
              risk_score: 70 + Math.min(20, uniqueSenders.length) + Math.min(10, receivers.length) + velocityBoost,
              evidence: {
                transaction_ids: Array.from(new Set(txIds)),
                start_timestamp: startTs,
                end_timestamp: endTs,
                roles: { senders: uniqueSenders.slice().sort(), receivers: receivers.slice().sort() },
              } as FraudRing["evidence"] & { roles: { senders: string[]; receivers: string[] } },
            });
          }
        }
      }

      retractInL(iL);
      iL += 1;
    }
  }

  return rings;
}

function detectLayering(outAdj: Map<string, AdjTx[]>, stats: Map<string, { totalCount: number; inCount?: number; outCount?: number }>) {
  const rings: FraudRing[] = [];
  const low = new Set<string>();
  for (const [id, s] of stats.entries()) {
    const inC = typeof s.inCount === "number" ? s.inCount : 0;
    const outC = typeof s.outCount === "number" ? s.outCount : 0;
    const totalDegree = inC + outC;
    if (totalDegree <= 2) low.add(id);
  }

  const MAX_DEPTH = 6;
  const MAX_GAP_MS = 72 * 60 * 60 * 1000;
  const seen = new Set<string>();

  for (const start of outAdj.keys()) {
    const path: string[] = [start];
    const txIds: string[] = [];

    const dfs = (current: string, depth: number, lastTs: number) => {
      if (depth > MAX_DEPTH) return;
      const outs = outAdj.get(current);
      if (!outs) return;

      for (const e of outs) {
        const next = e.to;
        const isIntermediate = depth >= 1;
        if (isIntermediate && !low.has(current) && current !== start) continue;
        if (path.includes(next)) continue;

        if (e.ts < lastTs) continue;
        if (e.ts - lastTs > MAX_GAP_MS) continue;

        path.push(next);
        txIds.push(e.txId);

        const hops = path.length - 1;
        const intermediates = path.slice(1, -1);
        const okIntermediates = intermediates.length >= 2 && intermediates.every((x) => low.has(x));

        if (hops >= 3 && okIntermediates) {
          const sig = memberSetKey(path);
          if (!seen.has(sig)) {
            seen.add(sig);
            rings.push({
              id: deterministicRingId(`layer|${sig}`),
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

        dfs(next, depth + 1, e.ts);

        path.pop();
        txIds.pop();
      }
    };

    dfs(start, 1, Number.NEGATIVE_INFINITY);
  }

  return rings;
}
