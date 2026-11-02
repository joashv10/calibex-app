// Step counts for display: 14.8k from 1000 up, as-is below. Pure (tests import it).
export function fmtSteps(n: number): string {
  const r = Math.round(n);
  if (Math.abs(r) < 1000) return r < 0 ? `−${-r}` : String(r);
  const k = Math.round(Math.abs(r) / 100) / 10; // one decimal of thousands
  return `${r < 0 ? '−' : ''}${k.toFixed(1).replace(/\.0$/, '')}k`;
}

// "vs your normal" for steps: +1.2k / −300 / ±0.
export function fmtStepsDelta(d: number): string {
  const r = Math.round(d);
  if (r === 0) return '±0';
  return `${r > 0 ? '+' : ''}${fmtSteps(r)}`;
}
