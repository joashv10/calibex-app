// Differential test: lib/bodyClock.ts vs an independent Python implementation
// (stress/ref.py, written from the header definitions only) on every wake_date of a long
// export of the cycles table. Slow (~130 s), so it only runs with STRESS=1 and STRESS_DIR set:
//   STRESS=1 STRESS_DIR=/path/to/dir node --test tests/stress-bodyclock-diff.test.ts
// STRESS_DIR holds bodyclock/cycles.json (your own export) and stress/py_out.json (the Python
// reference's output). Neither is in the repo; the reference must model the same SRI (a sleep
// marked in every window it touches) and the circular deviation for this to agree.
// Skipped when they are absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bodyClock } from '../lib/bodyClock.ts';

const DIR = process.env.STRESS_DIR ?? '';
const have = process.env.STRESS === '1' && DIR !== '' && existsSync(`${DIR}/bodyclock/cycles.json`) && existsSync(`${DIR}/stress/py_out.json`);

test('TS equals the Python reference on every as-of date (usual mid, week, word, shift, back on track, window, SRI x3)', { skip: !have && 'set STRESS=1 and STRESS_DIR and provide the outputs' }, () => {
  const rows = JSON.parse(readFileSync(`${DIR}/bodyclock/cycles.json`, 'utf8'));
  const py = JSON.parse(readFileSync(`${DIR}/stress/py_out.json`, 'utf8'));
  const bad: string[] = [];
  const same = (x: unknown, y: unknown) => (x === null || y === null || typeof x === 'string' ? x === y : Math.abs((x as number) - (y as number)) < 1e-6);
  const dates = Object.keys(py);
  assert.ok(dates.length > 400);
  for (const d of dates) {
    const b = bodyClock(rows, d, 'Asia/Calcutta'), p = py[d];
    const got: Record<string, unknown> = {
      usualMid: b.usualMid.value, thisWeek: b.thisWeek.value, usualWeek: b.usualWeek.value, weekWord: b.weekWord, weekendShift: b.weekendShift.value,
      sri28: b.regularity.d28.value, sri7: b.regularity.d7.value, sri28wa: b.regularity.d28WeekAgo.value,
    };
    for (const k of Object.keys(got)) if (!same(got[k], p[k])) bad.push(`${d} ${k}: ts ${got[k]} py ${p[k]}`);
    const bo = b.backOnTrack.value, w = b.naturalWindow.value;
    const bp = bo && [bo.usualWake, bo.within, bo.of], wp = w && [w.start, w.end, w.msfsc];
    if (JSON.stringify(bp === null ? null : bp) !== JSON.stringify(p.back) && !(bp && p.back && bp.every((v, i) => same(v, p.back[i])))) bad.push(`${d} back`);
    if (!((wp === null && p.nw === null) || (wp && p.nw && wp.every((v, i) => same(v, p.nw[i]))))) bad.push(`${d} naturalWindow`);
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} mismatches over ${dates.length} dates`);
});
