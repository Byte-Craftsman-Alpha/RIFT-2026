"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzeResponse, FraudRing, GraphEdge, GraphNode, TxRow } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type UiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AnalyzeResponse; parseErrors: string[] };

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function nodeColor(n: GraphNode) {
  if (n.flags.cycle) return "#ef4444";
  if (n.flags.layering) return "#a855f7";
  if (n.flags.smurfing) return "#f59e0b";
  return "#94a3b8";
}

export default function Dashboard() {
  const [state, setState] = useState<UiState>({ status: "idle" });
  const [selectedRingId, setSelectedRingId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const [graphSize, setGraphSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const [focusMode, setFocusMode] = useState(false);
  const [timeValue, setTimeValue] = useState(100);

  const ready = state.status === "ready" ? state.data : null;
  const rings: FraudRing[] = useMemo(() => ready?.report.fraud_rings ?? [], [ready]);
  const timeline: TxRow[] = useMemo(() => ready?.timeline ?? [], [ready]);

  const timelineRange = useMemo(() => {
    if (!timeline.length) return null;
    const minTs = timeline[0]!.timestamp;
    const maxTs = timeline[timeline.length - 1]!.timestamp;
    return { minTs, maxTs };
  }, [timeline]);

  const selectedTs = useMemo(() => {
    if (!timelineRange) return null;
    const t = timeValue / 100;
    return Math.round(timelineRange.minTs + (timelineRange.maxTs - timelineRange.minTs) * t);
  }, [timelineRange, timeValue]);

  const ringMembers = useMemo(() => {
    const ring = rings.find((r) => r.id === selectedRingId);
    return ring ? new Set(ring.members) : null;
  }, [rings, selectedRingId]);

  const activeTx = useMemo(() => {
    if (!selectedTs) return timeline;
    return timeline.filter((t) => t.timestamp <= selectedTs);
  }, [timeline, selectedTs]);

  const nodeStats = useMemo(() => {
    const inCount = new Map<string, number>();
    const outCount = new Map<string, number>();
    const inSum = new Map<string, number>();
    const outSum = new Map<string, number>();
    const counterparts = new Map<string, Map<string, number>>();

    for (const tx of activeTx) {
      outCount.set(tx.sender_id, (outCount.get(tx.sender_id) ?? 0) + 1);
      inCount.set(tx.receiver_id, (inCount.get(tx.receiver_id) ?? 0) + 1);
      outSum.set(tx.sender_id, (outSum.get(tx.sender_id) ?? 0) + tx.amount);
      inSum.set(tx.receiver_id, (inSum.get(tx.receiver_id) ?? 0) + tx.amount);

      const sMap = counterparts.get(tx.sender_id) ?? new Map<string, number>();
      sMap.set(tx.receiver_id, (sMap.get(tx.receiver_id) ?? 0) + 1);
      counterparts.set(tx.sender_id, sMap);

      const rMap = counterparts.get(tx.receiver_id) ?? new Map<string, number>();
      rMap.set(tx.sender_id, (rMap.get(tx.sender_id) ?? 0) + 1);
      counterparts.set(tx.receiver_id, rMap);
    }

    return { inCount, outCount, inSum, outSum, counterparts };
  }, [activeTx]);

  const handleFile = async (file: File) => {
    setSelectedRingId(null);
    setSelectedNodeId(null);
    setState({ status: "loading" });

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok) {
        const msg = typeof json?.error === "string" ? json.error : "Analysis failed";
        setState({ status: "error", message: msg });
        return;
      }

      const parseErrors = Array.isArray(json?.meta?.parse_errors) ? json.meta.parse_errors : [];
      const data: AnalyzeResponse = {
        graph: json.graph,
        report: json.report,
        timeline: json.timeline,
        export_json: json.export_json,
      };
      setTimeValue(100);
      setState({ status: "ready", data, parseErrors });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setState({ status: "error", message: msg });
    }
  };

  useEffect(() => {
    const el = graphWrapRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const height = Math.max(0, Math.floor(rect.height));
      setGraphSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, []);

  const renderGraph = () => {
    if (!ready) return null;

    const allowedNodeIds = new Set<string>();
    for (const tx of activeTx) {
      allowedNodeIds.add(tx.sender_id);
      allowedNodeIds.add(tx.receiver_id);
    }

    const baseNodes = ready.graph.nodes as GraphNode[];
    const nodes = baseNodes.filter((n) => allowedNodeIds.has(n.id));

    const edgeAgg = new Map<string, { source: string; target: string; amount: number; count: number }>();
    for (const tx of activeTx) {
      const k = `${tx.sender_id}::${tx.receiver_id}`;
      const e = edgeAgg.get(k) ?? { source: tx.sender_id, target: tx.receiver_id, amount: 0, count: 0 };
      e.amount += tx.amount;
      e.count += 1;
      edgeAgg.set(k, e);
    }

    const edges = Array.from(edgeAgg.values());

    const visibleNodes = focusMode ? nodes.filter((n) => n.score > 0 || ringMembers?.has(n.id)) : nodes;
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

    const graphData = {
      nodes: visibleNodes,
      links: visibleEdges.map((e: GraphEdge) => ({
        source: e.source,
        target: e.target,
        amount: e.amount,
        count: e.count,
      })),
    };

    return (
      <div className="rounded-xl border border-zinc-200">
        <div className="flex items-center justify-between border-b border-zinc-200 p-3">
          <div className="text-sm font-medium text-zinc-900">Transaction Graph</div>
          <div className="text-xs text-zinc-500">
            Nodes: {graphData.nodes.length} | Edges: {graphData.links.length}
          </div>
        </div>
        <div ref={graphWrapRef} className="relative h-[560px] overflow-hidden">
          <ForceGraph2D
            graphData={graphData}
            width={graphSize.width || undefined}
            height={graphSize.height || undefined}
            nodeId="id"
            nodeRelSize={4}
            onNodeClick={(n: unknown) => {
              const nn = n as { id?: unknown };
              const id = typeof nn.id === "string" ? nn.id : String(nn.id);
              setSelectedNodeId(id);
            }}
            nodeLabel={(n: unknown) => {
              const nn = n as Partial<GraphNode> & { id?: unknown; score?: unknown };
              const id = typeof nn.id === "string" ? nn.id : String(nn.id);
              const score = typeof nn.score === "number" ? nn.score : 0;
              return `${id} (score: ${score})`;
            }}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={0.9}
            linkLabel={(l: unknown) => {
              const ll = l as { count?: unknown; amount?: unknown };
              const count = typeof ll.count === "number" ? ll.count : 0;
              const amount = typeof ll.amount === "number" ? ll.amount : 0;
              return `count=${count}, amount=${Math.round(amount)}`;
            }}
            nodeCanvasObject={(node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const n = node as Partial<GraphNode> & { id?: unknown; x?: number; y?: number };
              const label = typeof n.id === "string" ? n.id : String(n.id);
              const fontSize = 10 / globalScale;
              ctx.font = `${fontSize}px sans-serif`;

              const isInRing = ringMembers ? ringMembers.has(label) : false;
              const isSelected = selectedNodeId ? selectedNodeId === label : false;
              const fill = isInRing ? "#22c55e" : nodeColor(n as GraphNode);
              const r = isSelected ? 9 : isInRing ? 7 : 4;

              ctx.beginPath();
              ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI, false);
              ctx.fillStyle = fill;
              ctx.fill();

              if (isInRing || globalScale > 1.5) {
                ctx.fillStyle = "#0f172a";
                ctx.fillText(label, (n.x ?? 0) + r + 2, (n.y ?? 0) + r + 2);
              }
            }}
          />
        </div>
      </div>
    );
  };

  const renderInvestigatorPanel = () => {
    if (state.status !== "ready") return null;

    const nodeId = selectedNodeId;
    const inDeg = nodeId ? nodeStats.inCount.get(nodeId) ?? 0 : 0;
    const outDeg = nodeId ? nodeStats.outCount.get(nodeId) ?? 0 : 0;
    const inTotal = nodeId ? Math.round(nodeStats.inSum.get(nodeId) ?? 0) : 0;
    const outTotal = nodeId ? Math.round(nodeStats.outSum.get(nodeId) ?? 0) : 0;

    const cp = nodeId ? nodeStats.counterparts.get(nodeId) : undefined;
    const top = cp
      ? Array.from(cp.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
      : [];

    return (
      <div className="rounded-xl border border-zinc-200 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-900">Investigator Panel</div>
          {nodeId && (
            <button className="text-xs text-zinc-600 hover:text-zinc-900" onClick={() => setSelectedNodeId(null)}>
              Clear
            </button>
          )}
        </div>

        {!nodeId ? (
          <div className="mt-2 text-xs text-zinc-600">Click a node in the graph to inspect account behavior.</div>
        ) : (
          <div className="mt-3 space-y-2 text-xs">
            <div className="font-medium text-zinc-900">Account: {nodeId}</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-zinc-50 p-2">
                <div className="text-zinc-600">In-degree</div>
                <div className="text-sm font-semibold text-zinc-900">{inDeg}</div>
                <div className="text-zinc-600">In total</div>
                <div className="text-sm font-semibold text-zinc-900">{inTotal}</div>
              </div>
              <div className="rounded-lg bg-zinc-50 p-2">
                <div className="text-zinc-600">Out-degree</div>
                <div className="text-sm font-semibold text-zinc-900">{outDeg}</div>
                <div className="text-zinc-600">Out total</div>
                <div className="text-sm font-semibold text-zinc-900">{outTotal}</div>
              </div>
            </div>

            <div>
              <div className="text-zinc-600">Top counterparties (by tx count)</div>
              {top.length === 0 ? (
                <div className="mt-1 text-zinc-500">No counterparties in the selected time window.</div>
              ) : (
                <div className="mt-1 space-y-1">
                  {top.map(([id, c]) => (
                    <div key={id} className="flex items-center justify-between rounded-lg bg-white px-2 py-1">
                      <div className="font-medium text-zinc-900">{id}</div>
                      <div className="text-zinc-600">{c} tx</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <section className="lg:col-span-4">
        <div className="rounded-xl border border-zinc-200 p-4">
          <div className="text-sm font-medium text-zinc-900">Upload CSV</div>
          <p className="mt-1 text-xs text-zinc-600">
            Required columns: transaction_id, sender_id, receiver_id, amount, timestamp
          </p>

          <input
            className="mt-3 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />

          {state.status === "loading" && (
            <div className="mt-3 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-700">Analyzing...</div>
          )}
          {state.status === "error" && (
            <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{state.message}</div>
          )}
          {state.status === "ready" && (
            <div className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">
              Done. Suspicious accounts: {state.data.report.suspicious_accounts.length}, Rings: {state.data.report.fraud_rings.length}
            </div>
          )}

          {state.status === "ready" && (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-2 text-xs">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={focusMode} onChange={(e) => setFocusMode(e.target.checked)} />
                  Focus Mode (hide benign)
                </label>
                {timelineRange && selectedTs && (
                  <div className="text-zinc-600">{new Date(selectedTs).toLocaleString()}</div>
                )}
              </div>

              {timelineRange && (
                <div className="rounded-lg border border-zinc-200 bg-white p-2">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <div className="font-medium text-zinc-900">Temporal Playback</div>
                    <div className="text-zinc-600">{timeValue}%</div>
                  </div>
                  <input
                    className="w-full"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={timeValue}
                    onChange={(e) => setTimeValue(Number(e.target.value))}
                  />
                </div>
              )}

              <button
                className="h-10 rounded-lg bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800"
                onClick={() =>
                  downloadJson(
                    "money-muling-report.json",
                    (state.data as AnalyzeResponse).export_json ?? state.data.report,
                  )
                }
              >
                Download JSON Report
              </button>
              {state.parseErrors.length > 0 && (
                <details className="rounded-lg border border-zinc-200 p-2 text-xs text-zinc-700">
                  <summary className="cursor-pointer font-medium">
                    Parse warnings ({Math.min(state.parseErrors.length, 200)})
                  </summary>
                  <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">
                    {state.parseErrors.slice(0, 200).join("\n")}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        {renderInvestigatorPanel()}

        {state.status === "ready" && (
          <div className="mt-6 rounded-xl border border-zinc-200 p-4">
            <div className="text-sm font-medium text-zinc-900">Top Suspicious Accounts</div>
            <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-zinc-100">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.report.suspicious_accounts.slice(0, 50).map((a) => (
                    <tr key={a.account_id} className="border-t border-zinc-100">
                      <td className="px-3 py-2 font-medium text-zinc-900">{a.account_id}</td>
                      <td className="px-3 py-2">{a.suspicion_score}</td>
                      <td className="px-3 py-2 text-zinc-600">
                        {a.flags.cycle ? "cycle " : ""}
                        {a.flags.smurfing ? "smurf " : ""}
                        {a.flags.layering ? "layer " : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="lg:col-span-8">
        {renderGraph()}

        {state.status === "ready" && (
          <div className="mt-6 rounded-xl border border-zinc-200">
            <div className="flex items-center justify-between border-b border-zinc-200 p-3">
              <div className="text-sm font-medium text-zinc-900">Fraud Summary</div>
              <div className="text-xs text-zinc-500">Click a row to highlight members on the graph.</div>
            </div>

            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-3 py-2">Ring ID</th>
                    <th className="px-3 py-2">Pattern Type</th>
                    <th className="px-3 py-2">Member Count</th>
                    <th className="px-3 py-2">Risk Score</th>
                    <th className="px-3 py-2">Member Account IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.report.fraud_rings.map((r) => {
                    const active = r.id === selectedRingId;
                    return (
                      <tr
                        key={r.id}
                        className={`cursor-pointer border-t border-zinc-100 ${active ? "bg-emerald-50" : "hover:bg-zinc-50"}`}
                        onClick={() => setSelectedRingId((prev) => (prev === r.id ? null : r.id))}
                      >
                        <td className="px-3 py-2 font-medium text-zinc-900">{r.id}</td>
                        <td className="px-3 py-2">{r.pattern_type}</td>
                        <td className="px-3 py-2">{r.member_count}</td>
                        <td className="px-3 py-2">{Math.round(r.risk_score)}</td>
                        <td className="px-3 py-2 text-zinc-600">{r.members.join(", ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
