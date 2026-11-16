import { describe, expect, it } from "vitest";
import type { Profile, RecoveryStatus, WellnessDay, Workout } from "../src/lib/types.js";
import { dailyPlan, duringWorkoutCarbsPerHour, groupSessions, hydration, recoveryBreakfast, summarize, workoutKcal } from "../src/services/nutrition.js";
import { assessRecovery } from "../src/services/recovery.js";
import { weightCorrectionKcal, weightTrend } from "../src/services/weight.js";
import { mapActivity } from "../src/services/intervals.js";

const w = (o: Partial<Workout>): Workout => ({
  id: "1", name: "x", sport: "run", start: new Date("2026-11-16T06:00:00Z"), durationMin: 60,
  load: 60, intensity: 0.75, kcal: null, kj: null, distanceKm: null, avgHr: null, ...o,
});
const good: RecoveryStatus = { level: "good", reasons: [], hrv: null, hrvBaseline: null, restingHr: null, restingHrBaseline: null, sleepHours: null };
const profile: Profile = { chatId: 1, heightCm: 180, age: 36, sex: "m", preferences: "", allergies: "" };
const day = (date: string, o: Partial<WellnessDay> = {}): WellnessDay => ({
  date, weightKg: null, bodyFatPct: null, musclePct: null, waterPct: null, bmi: null, restingHr: null, hrv: null, sleepHours: null, ...o,
});

describe("groupSessions", () => {
  it("об'єднує тренування з перервою < 60 хв (brick)", () => {
    const bike = w({ id: "b", sport: "bike", start: new Date("2026-11-16T05:00:00Z"), durationMin: 90 });
    const run = w({ id: "r", start: new Date("2026-11-16T06:40:00Z"), durationMin: 30 });
    expect(groupSessions([run, bike])).toEqual([[bike, run]]);
  });
  it("розділяє, якщо перерва ≥ 60 хв", () => {
    const swim = w({ id: "s", sport: "swim", start: new Date("2026-11-16T05:00:00Z"), durationMin: 45 });
    const run = w({ id: "r", start: new Date("2026-11-16T07:00:00Z") });
    expect(groupSessions([swim, run])).toHaveLength(2);
  });
});

describe("workoutKcal", () => {
  it("для велосипеда бере кДж", () => expect(workoutKcal(w({ sport: "bike", kj: 850, kcal: 1000 }), 70)).toBe(850));
  it("інакше калорії з годинника", () => expect(workoutKcal(w({ kcal: 700 }), 70)).toBe(700));
  it("фолбек на MET", () => expect(workoutKcal(w({ durationMin: 60, intensity: 0.75 }), 70)).toBe(700));
});

describe("recoveryBreakfast", () => {
  it("легке тренування: ~0.7 г/кг вуглеводів", () => {
    const m = recoveryBreakfast(summarize([w({ load: 30, durationMin: 45 })], 70), 70, good);
    expect(m.carbsG).toBe(50);
    expect(m.proteinG).toBe(25);
  });
  it("важке: 1.2 г/кг вуглеводів і 0.4 г/кг білка", () => {
    const m = recoveryBreakfast(summarize([w({ load: 150, durationMin: 150 })], 70), 70, good);
    expect(m.carbsG).toBe(85);
    expect(m.proteinG).toBe(30);
  });
});

describe("dailyPlan", () => {
  it("вуглеводи масштабуються з навантаженням", () => {
    const rest = dailyPlan({ profile, weightKg: 70, sessions: [], recovery: good, trend: { current: 70, trend: 70, weeklyChange: 0 }, logs: [], breakfast: null });
    const hard = dailyPlan({ profile, weightKg: 70, sessions: [summarize([w({ load: 180, durationMin: 180, kcal: 2000 })], 70)], recovery: good, trend: { current: 70, trend: 70, weeklyChange: 0 }, logs: [], breakfast: null });
    expect(rest.target.carbsG).toBe(210);
    expect(hard.target.carbsG).toBeGreaterThan(400);
    expect(hard.target.proteinG).toBe(125);
  });
  it("ручні записи зменшують залишок дня та додають пораду про алкоголь", () => {
    const base = { profile, weightKg: 70, sessions: [], recovery: good, trend: { current: 70, trend: 70, weeklyChange: 0 }, breakfast: null };
    const a = dailyPlan({ ...base, logs: [] });
    const b = dailyPlan({ ...base, logs: [{ date: "x", kind: "alcohol", description: "вино", kcal: 250, alcoholG: 28, carbsG: 8 }] });
    const carbs = (p: typeof a) => p.meals.reduce((s, m) => s + m.macros.carbsG, 0);
    expect(carbs(b)).toBeLessThan(carbs(a));
    expect(b.notes.join(" ")).toMatch(/Алкоголь/);
  });
});

describe("weight", () => {
  it("корекція протилежна дрейфу ваги", () => {
    const days = Array.from({ length: 21 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, { weightKg: 70 + i * 0.1 }));
    const t = weightTrend(days);
    expect(t.weeklyChange!).toBeGreaterThan(0.15);
    expect(weightCorrectionKcal(t)).toBeLessThan(0);
  });
  it("стабільна вага — без корекції", () => {
    expect(weightCorrectionKcal({ current: 70, trend: 70, weeklyChange: 0.05 })).toBe(0);
  });
});

describe("recovery", () => {
  const hist = Array.from({ length: 14 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, "0")}`, { hrv: 60 + (i % 3), restingHr: 48 }));
  it("низький HRV + поганий сон = poor", () => {
    expect(assessRecovery(day("2026-11-15", { hrv: 45, sleepHours: 5.5, restingHr: 48 }), hist).level).toBe("poor");
  });
  it("нормальні показники = good", () => {
    expect(assessRecovery(day("2026-11-15", { hrv: 61, sleepHours: 8, restingHr: 47 }), hist).level).toBe("good");
  });
  it("без даних = unknown", () => expect(assessRecovery(undefined, []).level).toBe("unknown"));
});

describe("misc", () => {
  it("вуглеводи під час тренування", () => {
    expect(duringWorkoutCarbsPerHour(45, 0.9)).toBe(0);
    expect(duringWorkoutCarbsPerHour(120, 0.7)).toBe(60);
    expect(duringWorkoutCarbsPerHour(200, 0.7)).toBe(80);
  });
  it("гідратація з електролітами для довгих сесій", () => {
    expect(hydration(summarize([w({ durationMin: 120 })], 70)).electrolytes).toBe(true);
  });
  it("мапінг активності intervals.icu", () => {
    const a = mapActivity({ id: 5, type: "VirtualRide", start_date: "2026-11-16T05:00:00Z", moving_time: 3600, icu_training_load: 70, icu_intensity: 78.5, icu_joules: 720000 });
    expect(a).toMatchObject({ sport: "bike", durationMin: 60, intensity: 0.785, kj: 720 });
  });
});
