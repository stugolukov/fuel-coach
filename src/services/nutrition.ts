import type { Macros, ManualLog, Profile, RecoveryStatus, Workout, WeightTrend } from "../lib/types.js";
import { weightCorrectionKcal } from "./weight.js";

const r5 = (x: number) => Math.round(x / 5) * 5;

/** MET-оцінка, коли немає ні калорій, ні кДж. */
const MET: Record<Workout["sport"], number> = { swim: 8, bike: 8, run: 10, strength: 5, other: 6 };

export function workoutKcal(w: Workout, weightKg: number): number {
  // Для велосипеда з потужоміром кДж механічної роботи ≈ ккал витрат (ефективність ~24%)
  if (w.sport === "bike" && w.kj != null && w.kj > 0) return Math.round(w.kj);
  const intensityAdj = w.intensity != null ? Math.max(0.7, Math.min(1.3, w.intensity / 0.75)) : 1;
  const estimate = MET[w.sport] * intensityAdj * weightKg * (w.durationMin / 60);
  if (w.kcal != null && w.kcal > 0) {
    // Годинники помітно завищують калорії плавання (і подекуди інших видів) — обмежуємо реалістичним максимумом
    const cap = estimate * (w.sport === "swim" ? 1.25 : 1.5);
    return Math.round(Math.min(w.kcal, cap));
  }
  return Math.round(estimate);
}

/**
 * Групує тренування в сесії: якщо наступне почалося менш ніж через 60 хв
 * після завершення попереднього (brick, плавання + біг), рахуємо їх разом.
 */
export function groupSessions(workouts: Workout[], gapMin = 60): Workout[][] {
  const sorted = [...workouts].sort((a, b) => a.start.getTime() - b.start.getTime());
  const groups: Workout[][] = [];
  for (const w of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev) {
      const prevEnd = prev.start.getTime() + prev.durationMin * 60_000;
      if ((w.start.getTime() - prevEnd) / 60_000 < gapMin) {
        last.push(w);
        continue;
      }
    }
    groups.push([w]);
  }
  return groups;
}

export interface SessionSummary {
  workouts: Workout[];
  durationMin: number;
  load: number;
  kcal: number;
  maxIntensity: number | null;
  sports: Workout["sport"][];
}

export function summarize(ws: Workout[], weightKg: number): SessionSummary {
  const intens = ws.map((w) => w.intensity).filter((x): x is number => x != null);
  return {
    workouts: ws,
    durationMin: ws.reduce((a, w) => a + w.durationMin, 0),
    load: ws.reduce((a, w) => a + w.load, 0),
    kcal: ws.reduce((a, w) => a + workoutKcal(w, weightKg), 0),
    maxIntensity: intens.length ? Math.max(...intens) : null,
    sports: [...new Set(ws.map((w) => w.sport))],
  };
}

/** Сніданок-відновлення одразу після ранкового тренування. */
export function recoveryBreakfast(s: SessionSummary, weightKg: number, recovery: RecoveryStatus): Macros {
  const hard = s.load >= 100 || s.durationMin >= 120 || (s.maxIntensity ?? 0) >= 0.85;
  const moderate = s.load >= 50 || s.durationMin >= 75;
  const carbPerKg = hard ? 1.2 : moderate ? 1.0 : 0.7;
  let proteinPerKg = 0.35;
  if (recovery.level === "poor" || hard) proteinPerKg = 0.4;
  if (s.sports.includes("strength")) proteinPerKg = 0.4;

  const carbsG = r5(carbPerKg * weightKg);
  const proteinG = r5(proteinPerKg * weightKg);
  const fatG = hard ? 15 : 20;
  return { carbsG, proteinG, fatG, kcal: Math.round(carbsG * 4 + proteinG * 4 + fatG * 9) };
}

export function bmr(p: Profile, weightKg: number): number {
  // Mifflin-St Jeor
  return Math.round(10 * weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "m" ? 5 : -161));
}

export interface DailyPlan {
  target: Macros;
  breakfast: Macros | null;
  /** Решта дня після сніданку, розбита на прийоми */
  meals: { name: string; macros: Macros }[];
  correctionKcal: number;
  notes: string[];
}

/**
 * Добовий план: вуглеводи за навантаженням (g/кг), білок 1.6–1.8 г/кг (підтримка, не набір),
 * жири — решта калорій, але не менше 0.8 г/кг. Калорії = BMR×1.35 + тренування ± корекція за трендом ваги.
 */
export function dailyPlan(args: {
  profile: Profile;
  weightKg: number;
  sessions: SessionSummary[];
  recovery: RecoveryStatus;
  trend: WeightTrend;
  logs: ManualLog[];
  breakfast: Macros | null;
}): DailyPlan {
  const { profile, weightKg, sessions, recovery, trend, logs } = args;
  const load = sessions.reduce((a, s) => a + s.load, 0);
  const exKcal = sessions.reduce((a, s) => a + s.kcal, 0);
  const notes: string[] = [];

  const carbPerKg = load === 0 ? 3 : load < 60 ? 4 : load < 120 ? 5 : load < 200 ? 6.5 : 8;
  const proteinPerKg = recovery.level === "poor" ? 1.9 : load >= 150 ? 1.8 : 1.6;
  const correctionKcal = weightCorrectionKcal(trend);

  let kcal = bmr(profile, weightKg) * 1.35 + exKcal + correctionKcal;
  if (recovery.level === "poor") {
    // при поганому відновленні не тримаємо дефіцит
    kcal = Math.max(kcal, bmr(profile, weightKg) * 1.35 + exKcal);
    notes.push("Відновлення слабке: без дефіциту калорій, більше білка, продукти з омега-3 та антиоксидантами (ягоди, жирна риба, горіхи).");
  }

  // Внесені вручну алкоголь/десерти вже «з'їли» частину бюджету
  const extraKcal = logs.reduce((a, l) => a + l.kcal, 0);
  const extraCarbs = logs.reduce((a, l) => a + l.carbsG, 0);
  const alcoholG = logs.reduce((a, l) => a + l.alcoholG, 0);
  if (alcoholG > 0) {
    notes.push(`Алкоголь (~${Math.round(alcoholG)} г етанолу) гальмує синтез глікогену та білка і знижує HRV вночі. Додатково 500 мл води з електролітами, не пити за 3 год до сну.`);
  }

  // Вуглеводи за навантаженням — це мінімум ("fuel for the work required").
  // Жири 0.8–1.3 г/кг; решта енергії йде у вуглеводи, а не в жири.
  const carbFloor = carbPerKg * weightKg;
  const proteinG = proteinPerKg * weightKg;
  const fatG = Math.min(1.3 * weightKg, Math.max(0.8 * weightKg, (kcal - carbFloor * 4 - proteinG * 4) / 9));
  // Якщо енергії бракує (корекція ваги) — вуглеводи зменшуються, але не нижче 3 г/кг
  const carbsG = Math.max(3 * weightKg, (kcal - proteinG * 4 - fatG * 9) / 4);

  const target: Macros = {
    carbsG: r5(carbsG),
    proteinG: r5(proteinG),
    fatG: r5(fatG),
    kcal: 0,
  };
  target.kcal = Math.round(target.carbsG * 4 + target.proteinG * 4 + target.fatG * 9);

  // Залишок на день мінус сніданок і внесені вручну «зайві»
  const used = args.breakfast ?? { carbsG: 0, proteinG: 0, fatG: 0, kcal: 0 };
  const rest: Macros = {
    carbsG: Math.max(0, target.carbsG - used.carbsG - extraCarbs),
    proteinG: Math.max(0, target.proteinG - used.proteinG),
    fatG: Math.max(0, target.fatG - used.fatG - Math.max(0, (extraKcal - extraCarbs * 4 - alcoholG * 7) / 9)),
    kcal: 0,
  };
  if (extraKcal > 0) notes.push(`Враховано ${Math.round(extraKcal)} ккал із ручних записів: зменшено вуглеводи/жири в решті дня.`);

  const split: [string, number][] = [["Обід", 0.4], ["Перекус", 0.2], ["Вечеря", 0.4]];
  const meals = split.map(([name, k]) => {
    const m: Macros = { carbsG: r5(rest.carbsG * k), proteinG: r5(rest.proteinG * k), fatG: r5(rest.fatG * k), kcal: 0 };
    m.kcal = Math.round(m.carbsG * 4 + m.proteinG * 4 + m.fatG * 9);
    return { name, macros: m };
  });

  return { target, breakfast: args.breakfast, meals, correctionKcal, notes };
}

/** Що варто було/варто їсти під час такої сесії (г вуглеводів на годину). */
export function duringWorkoutCarbsPerHour(durationMin: number, intensity: number | null): number {
  if (durationMin < 60) return 0;
  if (durationMin < 90) return (intensity ?? 0) >= 0.85 ? 45 : 30;
  if (durationMin < 150) return 60;
  return 80;
}

export interface Hydration {
  estimatedLossL: number;
  rehydrateL: number;
  electrolytes: boolean;
}

export function hydration(s: SessionSummary): Hydration {
  const lossPerHour: Record<Workout["sport"], number> = { swim: 0.4, bike: 0.7, run: 0.9, strength: 0.5, other: 0.6 };
  const loss = s.workouts.reduce((a, w) => a + lossPerHour[w.sport] * (w.durationMin / 60), 0);
  return {
    estimatedLossL: Math.round(loss * 10) / 10,
    rehydrateL: Math.round(loss * 1.25 * 10) / 10,
    electrolytes: s.durationMin >= 90 || s.load >= 100,
  };
}

/**
 * Харчування перед ранковим тренуванням. Без плану — базовий варіант;
 * якщо вчора/сьогодні довга сесія — розширений.
 */
export function preWorkout(opts: { expectedLong: boolean; recovery: RecoveryStatus }): string[] {
  const base = ["🍌 Банан", "☕ 50 мл кави", "💧 300–500 мл води"];
  if (opts.expectedLong) base.push("🍞 + тост з медом або рисовий пиріг (~30 г вуглеводів), якщо сесія >90 хв");
  if (opts.recovery.level === "poor") base.push("⚠️ Відновлення слабке — краще легка сесія Z1–Z2");
  return base;
}

/**
 * Попередження про RED-S: стійке падіння ваги разом із пригніченим відновленням.
 */
export function redsWarning(trend: WeightTrend, recentRecovery: RecoveryStatus[]): string | null {
  const poorDays = recentRecovery.filter((r) => r.level === "poor").length;
  if (trend.weeklyChange != null && trend.weeklyChange <= -0.4 && poorDays >= 3) {
    return "⚠️ Вага стабільно падає (>0.4 кг/тиждень) і відновлення погане кілька днів. Це ознаки низької енергодоступності (RED-S). Додайте калорій і порадьтеся з лікарем/дієтологом.";
  }
  return null;
}
