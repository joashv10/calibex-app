"use client";
// Small hand-drawn SVG charts for Progress and Insights. Thin marks, recessive
// grid, one accent. The value you're on shows in a readout line above the plot
// (latest point until you touch). While a finger is down, a tip in that line
// floats over the held day (above the plot, so the finger never covers it).
// touch-action: pan-y keeps vertical scrolling; a sideways drag scrubs.
// Missing days are gaps (the line breaks), never zeros.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type Pt = { key: string; label: string; value: number | null; n?: number; of?: number };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// Index nearest the pointer, from its x within the plot.
function scrub(e: React.PointerEvent<SVGSVGElement>, count: number, x0: number, step: number, set: (i: number) => void) {
  const r = e.currentTarget.getBoundingClientRect();
  const i = Math.round((e.clientX - r.left - x0) / (step || 1));
  set(Math.max(0, Math.min(count - 1, i)));
}

// A held selection belongs to one span of data: when the span changes (range
// switch, another measure), drop it so the chart rests on the latest point again.
function useSel(items: { key: string }[]) {
  const span = `${items[0]?.key}|${items[items.length - 1]?.key}|${items.length}`;
  const [sel, setSel] = useState<number | null>(null);
  const [seen, setSeen] = useState(span);
  if (seen !== span) { setSeen(span); setSel(null); }
  return [seen === span ? sel : null, setSel] as const;
}

// Pointer handlers shared by every chart. `held` is true while a finger is down
// (or a mouse is over the plot); release keeps the picked day in the readout.
// A vertical scroll cancels the hold (pointercancel), so scrolling stays free.
type SvgPtr = React.PointerEvent<SVGSVGElement>;
function press(setHeld: (b: boolean) => void, pick: (e: SvgPtr) => void, clear: () => void) {
  return {
    onPointerDown: (e: SvgPtr) => { setHeld(true); pick(e); },
    onPointerMove: (e: SvgPtr) => { if (e.buttons || e.pointerType === "mouse") pick(e); },
    onPointerEnter: (e: SvgPtr) => { if (e.pointerType === "mouse") setHeld(true); },
    onPointerUp: (e: SvgPtr) => { if (e.pointerType !== "mouse") setHeld(false); },
    onPointerCancel: () => setHeld(false),
    onPointerLeave: (e: SvgPtr) => { if (e.pointerType === "mouse") { setHeld(false); clear(); } },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

// The held day's value, centred over its x and kept inside the chart.
function Tip({ x, w, value, label }: { x: number; w: number; value: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(0);
  useLayoutEffect(() => { setTw(ref.current?.offsetWidth ?? 0); }, [value, label]);
  const left = Math.max(0, Math.min(w - tw, x - tw / 2));
  return <div ref={ref} className="ch-tip" style={{ left }} aria-hidden><b>{value}</b><span>{label}</span></div>;
}

const lastIndex = (pts: Pt[]) => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i].value != null) return i; return pts.length - 1; };

function Readout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ch-read" aria-live="polite">
      <b>{value}</b><span>{label}{sub ? ` · ${sub}` : ""}</span>
    </div>
  );
}

function SrTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    // Wrapped: a table ignores a 1 px height, a div clips it.
    <div className="sr-only">
      <table>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const PAD = { l: 4, r: 40, t: 8, b: 20 };

// Single-series line. `normal` draws a labelled hairline (your normal); `under`
// is an optional faint dot layer (e.g. daily values under a rolling mean).
export function Line({ points, fmt, unit, height = 120, normal: refV, refLabel = "normal", under, underName, name, bridge }: {
  points: Pt[]; fmt: (v: number) => string; unit?: string; height?: number;
  normal?: number | null; refLabel?: string; under?: Pt[]; underName?: string; name?: string; bridge?: boolean;
}) {
  const [box, w] = useWidth();
  const [sel, setSel] = useSel(points);
  const [held, setHeld] = useState(false);
  const all = [...points, ...(under ?? [])].map((p) => p.value).filter((v): v is number => v != null);
  if (refV != null) all.push(refV);
  const has = all.length > 0;
  let lo = has ? Math.min(...all) : 0, hi = has ? Math.max(...all) : 1;
  const padY = (hi - lo || Math.abs(hi) || 1) * 0.12; lo -= padY; hi += padY;
  const iw = Math.max(1, w - PAD.l - PAD.r), ih = height - PAD.t - PAD.b;
  const step = points.length > 1 ? iw / (points.length - 1) : 0;
  const x = (i: number) => PAD.l + (points.length > 1 ? i * step : iw / 2);
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  // Path broken at nulls: each run of consecutive values is its own segment.
  // With `bridge`, sparse readings join up and every reading gets a dot.
  let d = "", started = false;
  points.forEach((p, i) => {
    if (p.value == null) { if (!bridge) started = false; return; }
    d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    started = true;
  });
  const lone = points.map((p, i) => (p.value != null && (bridge || (points[i - 1]?.value == null && points[i + 1]?.value == null)) ? i : -1)).filter((i) => i >= 0);

  // Sparse series: a scrub lands on the nearest reading, not an empty day.
  const snap = (k: number) => {
    if (!bridge) return setSel(k);
    let best = k, bd = Infinity;
    points.forEach((p, j) => { if (p.value != null && Math.abs(j - k) < bd) { bd = Math.abs(j - k); best = j; } });
    setSel(best);
  };
  const i = sel ?? lastIndex(points);
  const cur = points[i];
  const ticks = has ? [hi - padY, lo + padY] : [];
  const sub = under && sel != null && under[i]?.value != null ? `${underName ?? "day"} ${fmt(under[i].value!)}` : undefined;
  const shownV = cur?.value != null ? `${fmt(cur.value)}${unit ?? ""}` : "no data";
  return (
    <div className={`ch${held ? " held" : ""}`} ref={box}>
      <Readout label={cur?.label ?? ""} value={shownV} sub={sub} />
      {held && w > 0 && <Tip x={x(i)} w={w} value={shownV} label={sub ? `${cur?.label} · ${sub}` : cur?.label ?? ""} />}
      {w > 0 && (
        <svg width={w} height={height} className="ch-svg" role="img" aria-label={name ?? "trend"}
          {...press(setHeld, (e) => scrub(e, points.length, PAD.l, step, snap), () => setSel(null))}>
          {ticks.map((t, k) => (
            <g key={k}>
              <line x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} className="ch-grid" />
              <text x={w - 2} y={y(t) + 3.5} textAnchor="end" className="ch-tick">{fmt(t)}</text>
            </g>
          ))}
          {refV != null && (
            <g>
              <line x1={PAD.l} x2={PAD.l + iw} y1={y(refV)} y2={y(refV)} className="ch-ref" />
              <text x={w - 2} y={y(refV) + 3.5} textAnchor="end" className="ch-tick ref">{refLabel}</text>
            </g>
          )}
          {under?.map((p, k) => p.value != null && <circle key={p.key} cx={x(k)} cy={y(p.value)} r={1.8} className="ch-under" />)}
          <path d={d} className="ch-line" />
          {lone.map((k) => <circle key={k} cx={x(k)} cy={y(points[k].value!)} r={2.5} className="ch-dot" />)}
          {cur?.value != null && (
            <g>
              {sel != null && <line x1={x(i)} x2={x(i)} y1={PAD.t} y2={PAD.t + ih} className="ch-cross" />}
              <circle cx={x(i)} cy={y(cur.value)} r={4} className="ch-end" />
            </g>
          )}
          <text x={PAD.l} y={height - 4} className="ch-tick">{points[0]?.label}</text>
          <text x={PAD.l + iw} y={height - 4} textAnchor="end" className="ch-tick">{points[points.length - 1]?.label}</text>
        </svg>
      )}
      <SrTable head={["Day", name ?? "Value"]} rows={points.map((p) => [p.label, p.value != null ? fmt(p.value) : "no data"])} />
    </div>
  );
}

// Columns, one series or two stacked (bottom first). 2px surface gap between
// stacked segments, rounded top only, a hairline baseline. `dim` marks a bar
// built on few data days.
export type Col = { key: string; label: string; values: number[]; dim?: boolean; note?: string; missing?: boolean };
export function Columns({ bars, names, colors, fmt, unit, height = 120, name }: {
  bars: Col[]; names: string[]; colors: string[]; fmt: (v: number) => string; unit?: string; height?: number; name?: string;
}) {
  const [box, w] = useWidth();
  const [sel, setSel] = useSel(bars);
  const [held, setHeld] = useState(false);
  const totals = bars.map((b) => b.values.reduce((a, v) => a + v, 0));
  const max = Math.max(1, ...totals);
  const iw = Math.max(1, w - PAD.l - PAD.r), ih = height - PAD.t - PAD.b;
  const slot = iw / Math.max(1, bars.length);
  const bw = Math.max(3, Math.min(24, slot * 0.62));
  const y = (v: number) => (v / max) * ih;
  const i = sel ?? bars.length - 1;
  const cur = bars[i];
  const r = Math.min(4, bw / 2);
  const shownV = !cur ? "—" : cur.missing ? "no data" : `${fmt(totals[i])}${unit ?? ""}`;
  const note = names.length > 1 ? undefined : cur?.note;
  const cxOf = (k: number) => PAD.l + slot * k + slot / 2;
  return (
    <div className={`ch${held ? " held" : ""}`} ref={box}>
      <Readout label={cur ? cur.label : ""} value={shownV} sub={note} />
      {held && w > 0 && cur && <Tip x={cxOf(i)} w={w} value={shownV} label={note ? `${cur.label} · ${note}` : cur.label} />}
      {w > 0 && (
        <svg width={w} height={height} className="ch-svg" role="img" aria-label={name ?? "columns"}
          {...press(setHeld, (e) => scrub(e, bars.length, PAD.l + slot / 2, slot, setSel), () => setSel(null))}>
          <line x1={PAD.l} x2={PAD.l + iw} y1={PAD.t} y2={PAD.t} className="ch-grid" />
          <text x={w - 2} y={PAD.t + 3.5} textAnchor="end" className="ch-tick">{fmt(max)}</text>
          {held && cur && <line x1={cxOf(i)} x2={cxOf(i)} y1={0} y2={PAD.t + ih - y(totals[i]) - 3} className="ch-cross" />}
          {bars.map((b, k) => {
            const cx = cxOf(k);
            let base = PAD.t + ih;
            const segs = b.values.map((v, s) => ({ v, s })).filter((x) => x.v > 0);
            return (
              <g key={b.key} opacity={b.dim ? 0.45 : 1} className={k === i && sel != null ? "ch-bar ch-on" : "ch-bar"}>
                {segs.map(({ v, s }, j) => {
                  const h = Math.max(1, y(v) - (j > 0 ? 2 : 0));
                  const top = base - h;
                  const last = j === segs.length - 1;
                  const rr = last ? Math.min(r, h) : 0;
                  const x0 = cx - bw / 2;
                  const path = `M${x0},${base}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + bw - rr}Q${x0 + bw},${top} ${x0 + bw},${top + rr}V${base}Z`;
                  base = top - 2;
                  return <path key={s} d={path} fill={colors[s]} />;
                })}
              </g>
            );
          })}
          <line x1={PAD.l} x2={PAD.l + iw} y1={PAD.t + ih + 0.5} y2={PAD.t + ih + 0.5} className="ch-base" />
          <text x={PAD.l} y={height - 4} className="ch-tick">{bars[0]?.label}</text>
          {bars.length > 1 && <text x={PAD.l + iw} y={height - 4} textAnchor="end" className="ch-tick">{bars[bars.length - 1].label}</text>}
        </svg>
      )}
      {names.length > 1 && (
        <div className="ch-legend">{names.map((n, k) => <span key={n}><i style={{ background: colors[k] }} />{n}{cur && <b>{fmt(cur.values[k])}</b>}</span>)}</div>
      )}
      <SrTable head={["Period", ...names]} rows={bars.map((b) => [b.label, ...b.values.map((v) => (b.missing ? "no data" : fmt(v)))])} />
    </div>
  );
}

// One dot per night on a time-of-night axis, the middle half shaded and the
// median ticked. Values are minutes on an evening clock (fmt turns them back).
export function DotStrip({ points, q1, q3, median, fmt, name }: {
  points: Pt[]; q1: number | null; q3: number | null; median: number | null; fmt: (v: number) => string; name?: string;
}) {
  const [box, w] = useWidth();
  const [sel, setSel] = useSel(points);
  const [held, setHeld] = useState(false);
  const vals = points.map((p) => p.value!).filter((v) => v != null);
  const lo = Math.floor((Math.min(...vals, median ?? Infinity) - 30) / 60) * 60;
  const hi = Math.ceil((Math.max(...vals, median ?? -Infinity) + 30) / 60) * 60;
  const iw = Math.max(1, w - 8), H = 64, mid = 26;
  const x = (v: number) => 4 + ((v - lo) / (hi - lo || 1)) * iw;
  // jitter rows so stacked nights stay visible: deterministic by order
  const rows = points.map((_, k) => (k % 3) - 1);
  // Inner hours only (the edges are padding); every other hour when they'd crowd.
  const every = iw / ((hi - lo) / 60 || 1) < 46 ? 120 : 60;
  const hours: number[] = [];
  for (let h = lo + 60; h < hi; h += 60) if ((h - lo) % every === 0 || every === 60) hours.push(h);
  const cur = sel != null ? points[sel] : null;
  const nearest = (e: React.PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0, bd = Infinity;
    points.forEach((p, k) => { const dd = Math.abs(x(p.value!) - px); if (dd < bd) { bd = dd; best = k; } });
    setSel(best);
  };
  return (
    <div className={`ch${held ? " held" : ""}`} ref={box}>
      {held && w > 0 && cur && <Tip x={x(cur.value!)} w={w} value={fmt(cur.value!)} label={cur.label} />}
      <Readout label={cur ? cur.label : `middle half ${q1 != null ? fmt(q1) : "—"}–${q3 != null ? fmt(q3) : "—"}`}
        value={cur ? fmt(cur.value!) : median != null ? fmt(median) : "—"} sub={cur ? undefined : "typical"} />
      {w > 0 && vals.length > 0 && (
        <svg width={w} height={H} className="ch-svg" role="img" aria-label={name ?? "bedtimes"}
          {...press(setHeld, nearest, () => setSel(null))}>
          {q1 != null && q3 != null && <rect x={x(q1)} y={mid - 16} width={Math.max(2, x(q3) - x(q1))} height={32} rx={6} className="ch-band" />}
          {median != null && <line x1={x(median)} x2={x(median)} y1={mid - 18} y2={mid + 18} className="ch-med" />}
          {points.map((p, k) => <circle key={p.key} cx={x(p.value!)} cy={mid + rows[k] * 8} r={k === sel ? 5 : 3.5} className={k === sel ? "ch-end" : "ch-pt"} />)}
          {hours.map((h) => <text key={h} x={x(h)} y={H - 3} textAnchor="middle" className="ch-tick">{fmt(h)}</text>)}
        </svg>
      )}
      <SrTable head={["Night", "Bedtime"]} rows={points.map((p) => [p.label, fmt(p.value!)])} />
    </div>
  );
}
