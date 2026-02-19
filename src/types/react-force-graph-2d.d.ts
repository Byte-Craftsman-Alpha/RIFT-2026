declare module "react-force-graph-2d" {
  import * as React from "react";

  export type ForceGraphProps = {
    graphData?: unknown;
    width?: number;
    height?: number;
    nodeId?: string;
    nodeRelSize?: number;
    nodeLabel?: (node: unknown) => string;
    linkLabel?: (link: unknown) => string;
    linkDirectionalArrowLength?: number;
    linkDirectionalArrowRelPos?: number;
    nodeCanvasObject?: (node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => void;
  } & React.CanvasHTMLAttributes<HTMLCanvasElement>;

  const ForceGraph2D: React.ComponentType<ForceGraphProps>;
  export default ForceGraph2D;
}
