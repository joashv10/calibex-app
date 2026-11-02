// Day fibre and sugar totals, pure. Unknown is null on a row, never 0, so a partial
// sum must say how many dishes it is missing. Alcohol's carb_g is sugar (lib/alcohol.ts
// drinkKcal treats it that way), so it joins the day's sugar.
export type FibreSugarRow = { fibre_g?: number | null; sugar_g?: number | null };
export type DayFibreSugar = {
  fibre: number; sugar: number;
  unknown: number; // dishes missing fibre or sugar
  show: boolean;   // false when no dish has either value: the line stays hidden
};
const r1 = (v: number) => Math.round(v * 10) / 10;

// A dish's sugar at its grams. Carbs round to whole grams but sugar to 0.1, so cap sugar
// at the carbs shown: sugar is part of carbs, and 3.3 g sugar beside "3 g carbs" can't be.
export function sugarFor(sugar_g: number | null, carb_g: number | null): number | null {
  if (sugar_g == null) return null;
  return carb_g == null ? sugar_g : Math.min(sugar_g, carb_g);
}

export function dayFibreSugar(rows: FibreSugarRow[], alcoholCarbG = 0): DayFibreSugar {
  let fibre = 0, sugar = 0, unknown = 0, known = false;
  for (const r of rows) {
    if (r.fibre_g != null) { fibre += Number(r.fibre_g); known = true; }
    if (r.sugar_g != null) { sugar += Number(r.sugar_g); known = true; }
    if (r.fibre_g == null || r.sugar_g == null) unknown++;
  }
  return { fibre: r1(fibre), sugar: r1(sugar + (Number(alcoholCarbG) || 0)), unknown, show: known };
}

// "fibre 12 g · sugar 30 g", plus "· 2 dishes unknown" when some dishes lack a value.
export function fibreSugarLine(t: DayFibreSugar): string {
  return `fibre ${t.fibre} g · sugar ${t.sugar} g` + (t.unknown > 0 ? ` · ${t.unknown} ${t.unknown === 1 ? "dish" : "dishes"} unknown` : "");
}
