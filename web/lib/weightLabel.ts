// Dumbbell weights are logged as the total moving at once: both dumbbells added together,
// or the one dumbbell for one-arm moves. Load maths (weight × reps) needs the real total.
const ONE_SIDE = /\b(one|single)[- ](arm|leg)\b|concentration|kickback|pronation|supination|external rotation/i;
export function weightLabel(e: { name: string; eq: string | null }): string {
  return e.eq === "dumbbell" && !ONE_SIDE.test(e.name) ? "kg total" : "kg";
}
