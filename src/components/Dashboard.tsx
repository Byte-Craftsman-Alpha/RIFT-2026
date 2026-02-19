"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzeResponse, FraudRing, GraphEdge, GraphNode, TxRow } from "@/lib/types";
import type { ForceGraphRef } from "react-force-graph-2d";

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
  const [searchValue, setSearchValue] = useState<string>("");
  const fgRef = useRef<ForceGraphRef | null>(null);
  const didAutoCenterRef = useRef(false);
  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const [graphSize, setGraphSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const [focusMode, setFocusMode] = useState(false);
  const [timeValue, setTimeValue] = useState(100);

  const ready = state.status === "ready" ? state.data : null;
  const rings: FraudRing[] = useMemo(() => ready?.report.fraud_rings ?? [], [ready]);
  const timeline: TxRow[] = useMemo(() => ready?.timeline ?? [], [ready]);

  const selectedRing = useMemo(() => rings.find((r) => r.id === selectedRingId) ?? null, [rings, selectedRingId]);
  const selectedNode = useMemo(() => {
    if (!ready || !selectedNodeId) return null;
    return (ready.graph.nodes as GraphNode[]).find((n) => n.id === selectedNodeId) ?? null;
  }, [ready, selectedNodeId]);

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
    setSearchValue("");
    didAutoCenterRef.current = false;
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

      const defaultId =
        (Array.isArray(json?.report?.suspicious_accounts) && json.report.suspicious_accounts[0]?.account_id) ||
        (Array.isArray(json?.graph?.nodes) && json.graph.nodes[0]?.id) ||
        null;
      if (typeof defaultId === "string" && defaultId.length) {
        setSelectedNodeId(defaultId);
        setSearchValue(defaultId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setState({ status: "error", message: msg });
    }
  };

  useEffect(() => {
    if (state.status !== "ready") return;
    const fg = fgRef.current;
    if (!fg) return;

    const charge = fg.d3Force?.("charge") as { strength?: (n: number) => void } | undefined;
    if (charge?.strength) charge.strength(-18);
    const link = fg.d3Force?.("link") as { distance?: (n: number) => void } | undefined;
    if (link?.distance) link.distance(38);
  }, [state.status]);

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
      <div className="rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="text-sm font-medium text-zinc-900">Graph Workspace</div>
          <div className="text-xs text-zinc-500">
            Nodes: {graphData.nodes.length} | Edges: {graphData.links.length}
          </div>
        </div>
        <div
          ref={graphWrapRef}
          className="relative h-[620px] overflow-hidden bg-[radial-gradient(circle_at_10%_10%,rgba(59,130,246,0.08),transparent_40%),radial-gradient(circle_at_90%_40%,rgba(168,85,247,0.06),transparent_45%),linear-gradient(to_bottom,rgba(255,255,255,1),rgba(244,244,245,1))]"
        >
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            width={graphSize.width || undefined}
            height={graphSize.height || undefined}
            nodeId="id"
            nodeRelSize={4}
            cooldownTime={2500}
            d3VelocityDecay={0.25}
            onNodeClick={(n: unknown) => {
              const nn = n as { id?: unknown };
              const id = typeof nn.id === "string" ? nn.id : String(nn.id);
              setSelectedNodeId(id);
              setSearchValue(id);
            }}
            onEngineStop={() => {
              if (didAutoCenterRef.current) return;
              didAutoCenterRef.current = true;
              const fg = fgRef.current;
              if (!fg) return;
              try {
                fg.centerAt?.(0, 0, 0);
                fg.zoomToFit?.(600, 80);
              } catch {
                // ignore
              }
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
                ctx.fillStyle = "rgba(15,23,42,0.9)";
                ctx.fillText(label, (n.x ?? 0) + r + 2, (n.y ?? 0) + r + 2);
              }
            }}
          />
        </div>
      </div>
    );
  };

  const renderAccountInspector = () => {
    if (state.status !== "ready") {
      return (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-medium text-zinc-900">Account Inspector</div>
          <div className="mt-2 text-xs text-zinc-600">Upload a CSV to begin analysis.</div>
        </div>
      );
    }

    const nodeId = selectedNodeId;
    const inDeg = nodeId ? nodeStats.inCount.get(nodeId) ?? 0 : 0;
    const outDeg = nodeId ? nodeStats.outCount.get(nodeId) ?? 0 : 0;
    const inTotal = nodeId ? Math.round(nodeStats.inSum.get(nodeId) ?? 0) : 0;
    const outTotal = nodeId ? Math.round(nodeStats.outSum.get(nodeId) ?? 0) : 0;

    const ringCount = nodeId ? rings.filter((r) => r.members.includes(nodeId)).length : 0;
    const centrality = selectedNode?.centrality ?? 0;
    const velocity = inTotal > 0 ? Math.min(1, outTotal / inTotal) : 0;

    const cp = nodeId ? nodeStats.counterparts.get(nodeId) : undefined;
    const top = cp
      ? Array.from(cp.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
      : [];

    const flags = nodeId ? (ready?.graph.nodes as GraphNode[]).find((n) => n.id === nodeId)?.flags : null;
    const isHighRisk = nodeId ? (ready?.report.suspicious_accounts.find((a) => a.account_id === nodeId)?.suspicion_score ?? 0) >= 80 : false;
    const suspicionScore = nodeId
      ? ready?.report.suspicious_accounts.find((a) => a.account_id === nodeId)?.suspicion_score ?? (selectedNode?.score ?? 0)
      : 0;

    return (
      <div className="rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-zinc-900">Account Inspector</div>
            <div className="text-xs text-zinc-500">Selected Node Details</div>
          </div>
          {nodeId && (
            <button
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
              onClick={() => {
                setSelectedNodeId(null);
                setSearchValue("");
              }}
            >
              Clear
            </button>
          )}
        </div>

        {!nodeId ? (
          <div className="p-4 text-xs text-zinc-600">Click a node in the graph or search by Account ID.</div>
        ) : (
          <div className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-sm font-semibold text-zinc-900">
                {nodeId.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">{nodeId}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      isHighRisk ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {isHighRisk ? "HIGH RISK" : "MONITORED"}
                  </span>
                  <span className="text-[11px] text-zinc-500">Rings: {ringCount}</span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <div>Suspicion Score</div>
                <div className="text-zinc-900">
                  {Math.round(suspicionScore)}<span className="text-slate-500">/100</span>
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-500"
                  style={{ width: `${Math.max(0, Math.min(100, suspicionScore))}%` }}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-[11px] text-zinc-500">In-degree</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">{inDeg}</div>
                <div className="mt-2 text-[11px] text-zinc-500">In total</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">{inTotal}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-[11px] text-zinc-500">Out-degree</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">{outDeg}</div>
                <div className="mt-2 text-[11px] text-zinc-500">Out total</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">{outTotal}</div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-[11px] text-zinc-500">Centrality</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">{centrality.toFixed(3)}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-[11px] text-zinc-500">Velocity</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">{velocity.toFixed(2)}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-[11px] text-zinc-500">Flags</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">
                  {(flags?.cycle ? 1 : 0) + (flags?.smurfing ? 1 : 0) + (flags?.layering ? 1 : 0)}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-900">Active Flags</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {flags?.smurfing && <span className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700">Smurfing</span>}
                {flags?.cycle && <span className="rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700">Cycle</span>}
                {flags?.layering && <span className="rounded-lg bg-purple-50 px-2 py-1 text-[11px] text-purple-700">Layered Shell</span>}
                {!flags?.smurfing && !flags?.cycle && !flags?.layering && (
                  <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600">No active flags</span>
                )}
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-zinc-900">Recent Connections</div>
                <div className="text-[11px] text-zinc-500">Top by tx count</div>
              </div>
              {top.length === 0 ? (
                <div className="mt-2 text-xs text-zinc-500">No counterparties in the selected time window.</div>
              ) : (
                <div className="mt-2 space-y-2">
                  {top.map(([id, c]) => (
                    <button
                      key={id}
                      className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left hover:bg-zinc-50"
                      onClick={() => {
                        setSelectedNodeId(id);
                        setSearchValue(id);
                      }}
                    >
                      <div className="truncate text-xs font-medium text-zinc-900">{id}</div>
                      <div className="text-[11px] text-zinc-500">{c} tx</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderRingSummary = () => {
    if (state.status !== "ready") return null;
    return (
      <div className="rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="text-sm font-medium text-zinc-900">Fraud Ring Summary</div>
          <div className="text-xs text-zinc-500">Click a ring to highlight members</div>
        </div>
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-zinc-50 text-zinc-600">
              <tr className="border-b border-zinc-200">
                <th className="px-4 py-2">Ring ID</th>
                <th className="px-4 py-2">Pattern</th>
                <th className="px-4 py-2">Nodes</th>
                <th className="px-4 py-2">Risk</th>
                <th className="px-4 py-2">Members</th>
              </tr>
            </thead>
            <tbody>
              {state.data.report.fraud_rings.map((r) => {
                const active = r.id === selectedRingId;
                return (
                  <tr
                    key={r.id}
                    className={`cursor-pointer border-b border-zinc-100 ${active ? "bg-emerald-50" : "hover:bg-zinc-50"}`}
                    onClick={() => setSelectedRingId((prev) => (prev === r.id ? null : r.id))}
                  >
                    <td className="px-4 py-2 font-medium text-zinc-900">{r.id}</td>
                    <td className="px-4 py-2 text-zinc-700">{r.pattern_type}</td>
                    <td className="px-4 py-2 text-zinc-700">{r.member_count}</td>
                    <td className="px-4 py-2 text-zinc-700">{Math.round(r.risk_score)}/100</td>
                    <td className="px-4 py-2 text-zinc-600">{r.members.join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const statsCard = (title: string, value: string) => (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="text-[11px] text-zinc-500">{title}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-900">{value}</div>
    </div>
  );

  const renderLeftScope = () => {
    const entities = ready?.graph.nodes.length ?? 0;
    const transactions = timeline.length;
    const totalVol = Math.round(timeline.reduce((acc, t) => acc + t.amount, 0));

    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-medium text-zinc-900">Investigation Scope</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {statsCard("Entities", String(entities))}
            {statsCard("Transactions", String(transactions))}
            {statsCard("Volume", totalVol ? `${totalVol.toLocaleString()}` : "0")}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-sm font-medium text-zinc-900">Workspace</div>
          <div className="mt-2 text-xs text-zinc-600">Upload CSV</div>

          <input
            className="mt-3 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />

          {state.status === "loading" && <div className="mt-3 text-xs text-zinc-700">Analyzing...</div>}
          {state.status === "error" && <div className="mt-3 text-xs text-red-700">{state.message}</div>}
          {state.status === "ready" && (
            <div className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">
              Done. Suspicious accounts: {state.data.report.suspicious_accounts.length}, Rings: {state.data.report.fraud_rings.length}
            </div>
          )}

          {state.status === "ready" && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-2 text-xs">
                <label className="flex items-center gap-2 text-zinc-700">
                  <input
                    type="checkbox"
                    checked={focusMode}
                    onChange={(e) => setFocusMode(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Focus Mode
                </label>
                {timelineRange && selectedTs && <div className="text-zinc-600">{new Date(selectedTs).toLocaleString()}</div>}
              </div>

              {timelineRange && (
                <div className="rounded-lg border border-zinc-200 bg-white p-2">
                  <div className="mb-2 flex items-center justify-between text-xs">
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

              {state.parseErrors.length > 0 && (
                <details className="rounded-lg border border-zinc-200 p-2 text-xs text-zinc-700">
                  <summary className="cursor-pointer font-medium">Parse warnings ({Math.min(state.parseErrors.length, 200)})</summary>
                  <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-zinc-600">
                    {state.parseErrors.slice(0, 200).join("\n")}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        {selectedRing && (
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-zinc-900">Active Ring</div>
              <button
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                onClick={() => setSelectedRingId(null)}
              >
                Clear
              </button>
            </div>
            <div className="mt-3 text-xs text-zinc-600">{selectedRing.id}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700">{selectedRing.pattern_type}</span>
              <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700">Members: {selectedRing.member_count}</span>
              <span className="rounded-lg bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700">Risk: {Math.round(selectedRing.risk_score)}/100</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
      <div className="mx-auto w-full max-w-[1400px]">
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 lg:grid-cols-[280px_minmax(0,1fr)_320px] lg:items-center">
          <div>
            <div className="text-sm font-medium text-zinc-900">Financial Forensics Engine</div>
            <div className="text-xs text-zinc-500">Graph Analysis Workspace</div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <div className="text-xs text-zinc-500">Search</div>
              <input
                className="w-full bg-transparent text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
                placeholder="Search node ID (e.g., ACC_00123)"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const id = searchValue.trim();
                  if (!id || !ready) return;
                  const exists = (ready.graph.nodes as GraphNode[]).some((n) => n.id === id);
                  if (exists) setSelectedNodeId(id);
                }}
              />
              <button
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
                onClick={() => {
                  const id = searchValue.trim();
                  if (!id || !ready) return;
                  const exists = (ready.graph.nodes as GraphNode[]).some((n) => n.id === id);
                  if (exists) setSelectedNodeId(id);
                }}
              >
                Go
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              className="h-10 w-full rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-800 lg:w-auto"
              disabled={state.status !== "ready"}
              onClick={() => {
                if (state.status !== "ready") return;
                downloadJson("money-muling-report.json", (state.data as AnalyzeResponse).export_json ?? state.data.report);
              }}
            >
              Export JSON
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px] lg:items-start">
          <aside className="w-full">{renderLeftScope()}</aside>
          <main className="min-w-0 space-y-4">
            {renderGraph()}
            {renderRingSummary()}
          </main>
          <aside className="w-full">{renderAccountInspector()}</aside>
        </div>
      </div>
    </div>
  );
}
