import type { Macros, RecoveryStatus, WellnessDay, WeightTrend } from "../lib/types.js";
import type { Recipe } from "./ai.js";
import type { DailyPlan, Hydration, SessionSummary } from "./nutrition.js";

const SPORT_ICON = { swim: "🏊", bike: "🚴", run: "🏃", strength: "🏋️", other: "⚡" } as const;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const macros = (m: Macros) => `${m.kcal} ккал · Б ${m.proteinG} г · Ж ${m.fatG} г · В ${m.carbsG} г`;

export function session(s: SessionSummary): string {
  const lines = s.workouts.map((w) => {
    const parts = [`${w.durationMin} хв`, `load ${Math.round(w.load)}`];
    if (w.intensity != null) parts.push(`IF ${w.intensity.toFixed(2)}`);
    if (w.distanceKm) parts.push(`${w.distanceKm.toFixed(1)} км`);
    return `${SPORT_ICON[w.sport]} ${esc(w.name)}: ${parts.join(", ")}`;
  });
  if (s.workouts.length > 1) lines.push(`Разом: ${s.durationMin} хв, load ${Math.round(s.load)}, ~${s.kcal} ккал`);
  else lines.push(`Витрати: ~${s.kcal} ккал`);
  return lines.join("\n");
}

export function recovery(r: RecoveryStatus): string {
  const icon = { good: "🟢", ok: "🟡", poor: "🔴", unknown: "⚪" }[r.level];
  const label = { good: "добре", ok: "помірно", poor: "слабке", unknown: "немає даних" }[r.level];
  const parts: string[] = [];
  if (r.hrv != null) parts.push(`HRV ${r.hrv}${r.hrvBaseline ? ` (норма ${r.hrvBaseline.toFixed(0)})` : ""}`);
  if (r.restingHr != null) parts.push(`RHR ${r.restingHr}`);
  if (r.sleepHours != null) parts.push(`сон ${r.sleepHours.toFixed(1)} год`);
  let out = `${icon} Відновлення: <b>${label}</b>${parts.length ? `\n${parts.join(" · ")}` : ""}`;
  if (r.reasons.length) out += `\n${r.reasons.map((x) => `• ${esc(x)}`).join("\n")}`;
  return out;
}

export function body(w: WellnessDay | undefined, t: WeightTrend): string {
  if (!w?.weightKg && t.current == null) return "⚖️ Немає даних зважування";
  const parts = [`⚖️ ${w?.weightKg ?? t.current} кг`];
  if (t.trend != null) parts.push(`тренд ${t.trend.toFixed(1)}`);
  if (t.weeklyChange != null) parts.push(`${t.weeklyChange >= 0 ? "+" : ""}${t.weeklyChange.toFixed(2)} кг/тижд`);
  const comp: string[] = [];
  if (w?.bodyFatPct != null) comp.push(`жир ${w.bodyFatPct}%`);
  if (w?.musclePct != null) comp.push(`м'язи ${w.musclePct}%`);
  if (w?.waterPct != null) comp.push(`вода ${w.waterPct}%`);
  if (w?.bmi != null) comp.push(`ІМТ ${w.bmi}`);
  return parts.join(" · ") + (comp.length ? `\n${comp.join(" · ")}` : "");
}

export function recipes(list: Recipe[]): string {
  if (!list.length) return "<i>Рецепти тимчасово недоступні. Орієнтуйтесь на макроси вище.</i>";
  return list
    .map((r, i) => {
      const m = r.macros;
      return `<b>${i + 1}. ${esc(r.name)}</b> (${r.timeMin} хв)\n${m.kcal} ккал · Б ${m.proteinG} · Ж ${m.fatG} · В ${m.carbsG}\n` +
        `🛒 ${esc(r.ingredients.join(", "))}\n` +
        r.steps.map((s, j) => `${j + 1}) ${esc(s)}`).join("\n");
    })
    .join("\n\n");
}

export function hydration(h: Hydration, carbsPerHour: number): string {
  const lines = [`💧 Втрати рідини ~${h.estimatedLossL} л → випити ${h.rehydrateL} л протягом 2–4 год${h.electrolytes ? " (з електролітами: натрій 500–1000 мг/л)" : ""}`];
  if (carbsPerHour > 0) lines.push(`🍯 Для такої сесії під час тренування: ~${carbsPerHour} г вуглеводів/год (гель ≈ 25 г, 500 мл ізотоніку ≈ 30 г)`);
  return lines.join("\n");
}

export function daily(p: DailyPlan): string {
  const lines = [`📊 <b>Ціль на день:</b> ${macros(p.target)}`];
  if (p.correctionKcal !== 0) lines.push(`(корекція за трендом ваги: ${p.correctionKcal > 0 ? "+" : ""}${p.correctionKcal} ккал)`);
  for (const m of p.meals) lines.push(`• ${m.name}: ${macros(m.macros)}`);
  for (const n of p.notes) lines.push(`ℹ️ ${esc(n)}`);
  return lines.join("\n");
}
