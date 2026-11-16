import type { RecoveryStatus, WellnessDay } from "../lib/types.js";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const vals = (days: WellnessDay[], k: "hrv" | "restingHr") =>
  days.map((d) => d[k]).filter((v): v is number => v != null);

/**
 * Оцінка відновлення: HRV сьогодні проти 7-денної норми (± 0.75 SD за 30 днів),
 * пульс спокою проти 30-денного середнього, тривалість сну.
 * `history` — попередні дні (без сьогоднішнього), від старих до нових.
 */
export function assessRecovery(today: WellnessDay | undefined, history: WellnessDay[]): RecoveryStatus {
  const reasons: string[] = [];
  let penalty = 0;
  let signals = 0;

  const hrvHist = vals(history.slice(-30), "hrv");
  const hrvBaseline = hrvHist.length >= 5 ? mean(hrvHist.slice(-7)) : null;
  if (today?.hrv != null && hrvBaseline != null) {
    signals++;
    const band = Math.max(sd(hrvHist) * 0.75, hrvBaseline * 0.05);
    if (today.hrv < hrvBaseline - band) {
      penalty += 2;
      reasons.push(`HRV ${today.hrv} нижче норми (${hrvBaseline.toFixed(0)})`);
    }
  }

  const rhrHist = vals(history.slice(-30), "restingHr");
  const rhrBaseline = rhrHist.length >= 5 ? mean(rhrHist) : null;
  if (today?.restingHr != null && rhrBaseline != null) {
    signals++;
    if (today.restingHr >= rhrBaseline + 5) {
      penalty += 2;
      reasons.push(`Пульс спокою ${today.restingHr} (норма ~${rhrBaseline.toFixed(0)})`);
    } else if (today.restingHr >= rhrBaseline + 3) {
      penalty += 1;
      reasons.push(`Пульс спокою трохи підвищений: ${today.restingHr}`);
    }
  }

  if (today?.sleepHours != null) {
    signals++;
    if (today.sleepHours < 6) {
      penalty += 2;
      reasons.push(`Сон лише ${today.sleepHours.toFixed(1)} год`);
    } else if (today.sleepHours < 7) {
      penalty += 1;
      reasons.push(`Сон ${today.sleepHours.toFixed(1)} год, менше 7`);
    }
  }

  const level = signals === 0 ? "unknown" : penalty >= 3 ? "poor" : penalty >= 1 ? "ok" : "good";
  return {
    level,
    reasons,
    hrv: today?.hrv ?? null,
    hrvBaseline,
    restingHr: today?.restingHr ?? null,
    restingHrBaseline: rhrBaseline,
    sleepHours: today?.sleepHours ?? null,
  };
}
