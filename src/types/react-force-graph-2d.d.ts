declare module "react-force-graph-2d" {
  import * as React from "react";

  export type ForceGraphRef = {
    d3Force?: (name: string) => unknown;
    centerAt?: (x: number, y: number, ms?: number) => void;
    zoomToFit?: (ms?: number, padding?: number) => void;
  };

  export type ForceGraphProps = {
    graphData: unknown;
    width?: number;
    height?: number;
    nodeId?: string;
    nodeRelSize?: number;
    nodeLabel?: (node: unknown) => string;
    nodeCanvasObject?: (node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => void;
    onNodeClick?: (node: unknown) => void;
    onEngineStop?: () => void;
    cooldownTime?: number;
    d3VelocityDecay?: number;
    linkDirectionalArrowLength?: number;
    linkDirectionalArrowRelPos?: number;
    linkLabel?: (link: unknown) => string;
  } & React.CanvasHTMLAttributes<HTMLCanvasElement>;

  const ForceGraph2D: React.ForwardRefExoticComponent<ForceGraphProps & React.RefAttributes<ForceGraphRef>>;
  export default ForceGraph2D;
}
