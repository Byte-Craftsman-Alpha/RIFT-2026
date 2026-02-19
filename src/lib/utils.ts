export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function safeNumber(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function toEpochMs(ts: unknown): number | null {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    if (ts > 1e12) return Math.trunc(ts);
    if (ts > 1e9) return Math.trunc(ts * 1000);
    return Math.trunc(ts);
  }
  if (typeof ts === "string") {
    const s = ts.trim();

    // Support non-ISO formats commonly found in CSVs, e.g. "19-02-2026 10:00" (DD-MM-YYYY HH:mm[:ss])
    // Parsed as local time to match typical analyst CSV expectations.
    const m = s.match(
      /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yyyy = Number(m[3]);
      const hh = m[4] ? Number(m[4]) : 0;
      const min = m[5] ? Number(m[5]) : 0;
      const ss = m[6] ? Number(m[6]) : 0;
      if (
        Number.isFinite(dd) &&
        Number.isFinite(mm) &&
        Number.isFinite(yyyy) &&
        Number.isFinite(hh) &&
        Number.isFinite(min) &&
        Number.isFinite(ss)
      ) {
        const d = new Date(yyyy, mm - 1, dd, hh, min, ss);
        const ms = d.getTime();
        if (Number.isFinite(ms)) return ms;
      }
    }

    const d = new Date(ts);
    const ms = d.getTime();
    if (Number.isFinite(ms)) return ms;
    const n = Number(ts);
    if (Number.isFinite(n)) return toEpochMs(n);
  }
  return null;
}

export function ringId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function canonicalCycle(nodes: string[]): string {
  if (nodes.length === 0) return "";
  const unique = nodes.slice(0, -1);
  let minIdx = 0;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] < unique[minIdx]) minIdx = i;
  }
  const rotated = unique.slice(minIdx).concat(unique.slice(0, minIdx));
  return rotated.join("->");
}
