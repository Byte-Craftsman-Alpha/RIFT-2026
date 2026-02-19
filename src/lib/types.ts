export type TxRow = {
  transaction_id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  timestamp: number; // epoch ms
};

export type GraphNode = {
  id: string;
  score: number;
  centrality?: number;
  flags: {
    cycle: boolean;
    smurfing: boolean;
    layering: boolean;
  };
};

export type GraphEdge = {
  source: string;
  target: string;
  amount: number;
  count: number;
};

export type FraudRing = {
  id: string;
  pattern_type: "circular_routing" | "smurfing" | "dispersal" | "layered_shell";
  members: string[];
  member_count: number;
  risk_score: number;
  evidence: {
    transaction_ids: string[];
    start_timestamp?: number;
    end_timestamp?: number;
    hops?: number;
  };
};

export type AnalysisReport = {
  suspicious_accounts: Array<{
    account_id: string;
    suspicion_score: number;
    flags: {
      cycle: boolean;
      smurfing: boolean;
      layering: boolean;
    };
  }>;
  fraud_rings: FraudRing[];
};

export type AnalyzeResponse = {
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  report: AnalysisReport;
  timeline?: TxRow[];
  export_json?: unknown;
};
