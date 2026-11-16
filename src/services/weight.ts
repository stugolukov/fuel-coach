import type { WellnessDay, WeightTrend } from "../lib/types.js";

/**
 * Згладжений тренд ваги (експоненційне середнє, alpha=0.1, як у "Hacker's Diet"),
 * щоб солона вечеря чи зневоднення не викликали паніки.
 */
export function weightTrend(days: WellnessDay[]): WeightTrend {
  const pts = days.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, w: d.weightKg as number }));
  if (pts.length === 0) return { current: null, trend: null, weeklyChange: null };

  const alpha = 0.1;
  let ema = pts[0]!.w;
  const series: { t: number; ema: number }[] = [];
  for (const p of pts) {
    ema = ema + alpha * (p.w - ema);
    series.push({ t: Date.parse(p.date) / 86_400_000, ema });
  }

  const recent = series.filter((s) => s.t >= series[series.length - 1]!.t - 14);
  let weeklyChange: number | null = null;
  if (recent.length >= 5) {
    const mt = recent.reduce((a, s) => a + s.t, 0) / recent.length;
    const me = recent.reduce((a, s) => a + s.ema, 0) / recent.length;
    const num = recent.reduce((a, s) => a + (s.t - mt) * (s.ema - me), 0);
    const den = recent.reduce((a, s) => a + (s.t - mt) ** 2, 0);
    weeklyChange = den > 0 ? (num / den) * 7 : 0;
  }
  return { current: pts[pts.length - 1]!.w, trend: ema, weeklyChange };
}

/** Корекція калорій для утримання стабільної ваги. */
export function weightCorrectionKcal(t: WeightTrend): number {
  if (t.weeklyChange == null) return 0;
  // ~7700 ккал на кг; м'яко компенсуємо половину тижневого дрейфу, макс ±300/день
  const raw = -(t.weeklyChange * 7700) / 7 / 2;
  if (Math.abs(t.weeklyChange) < 0.15) return 0;
  return Math.round(Math.max(-300, Math.min(300, raw)) / 10) * 10;
}
