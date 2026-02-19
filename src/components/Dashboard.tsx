"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzeResponse, FraudRing, GraphEdge, GraphNode } from "@/lib/types";

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
  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const [graphSize, setGraphSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const ready = state.status === "ready" ? state.data : null;
  const rings: FraudRing[] = useMemo(() => ready?.report.fraud_rings ?? [], [ready]);

  const ringMembers = useMemo(() => {
    const ring = rings.find((r) => r.id === selectedRingId);
    return ring ? new Set(ring.members) : null;
  }, [rings, selectedRingId]);

  const handleFile = async (file: File) => {
    setSelectedRingId(null);
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
      const data: AnalyzeResponse = { graph: json.graph, report: json.report, export_json: json.export_json };
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

    const graphData = {
      nodes: ready.graph.nodes as GraphNode[],
      links: ready.graph.edges.map((e: GraphEdge) => ({
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
            Nodes: {ready.graph.nodes.length} | Edges: {ready.graph.edges.length}
          </div>
        </div>
        <div ref={graphWrapRef} className="relative h-[560px] overflow-hidden">
          <ForceGraph2D
            graphData={graphData}
            width={graphSize.width || undefined}
            height={graphSize.height || undefined}
            nodeId="id"
            nodeRelSize={4}
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
              const fill = isInRing ? "#22c55e" : nodeColor(n as GraphNode);
              const r = isInRing ? 7 : 4;

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
                    <th className="px-3 py-2">Pattern</th>
                    <th className="px-3 py-2">Members</th>
                    <th className="px-3 py-2">Risk</th>
                    <th className="px-3 py-2">Evidence</th>
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
                        <td className="px-3 py-2 font-medium text-zinc-900">{r.pattern_type}</td>
                        <td className="px-3 py-2">{r.member_count}</td>
                        <td className="px-3 py-2">{Math.round(r.risk_score)}</td>
                        <td className="px-3 py-2 text-zinc-600">
                          tx={r.evidence.transaction_ids.length}
                          {typeof r.evidence.hops === "number" ? `, hops=${r.evidence.hops}` : ""}
                        </td>
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
