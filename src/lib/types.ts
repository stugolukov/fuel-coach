export type Sport = "swim" | "bike" | "run" | "strength" | "other";

export interface Workout {
  id: string;
  name: string;
  sport: Sport;
  start: Date;
  durationMin: number;
  /** Training load (TSS-like) з intervals.icu */
  load: number;
  /** Intensity Factor 0..1.5 */
  intensity: number | null;
  kcal: number | null;
  kj: number | null;
  distanceKm: number | null;
  avgHr: number | null;
}

export interface WellnessDay {
  date: string; // YYYY-MM-DD
  weightKg: number | null;
  bodyFatPct: number | null;
  musclePct: number | null;
  waterPct: number | null;
  bmi: number | null;
  restingHr: number | null;
  hrv: number | null;
  sleepHours: number | null;
  sleepScore: number | null;
  /** Фітнес (CTL) і втома (ATL) з intervals.icu; форма TSB = ctl - atl */
  ctl: number | null;
  atl: number | null;
}

export interface Profile {
  chatId: number;
  heightCm: number;
  age: number;
  sex: "m" | "f";
  preferences: string;
  allergies: string;
}

export interface ManualLog {
  date: string;
  kind: "alcohol" | "dessert" | "food" | "note";
  description: string;
  kcal: number;
  alcoholG: number;
  carbsG: number;
}

export interface Macros {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export type RecoveryLevel = "good" | "ok" | "poor" | "unknown";

export interface RecoveryStatus {
  level: RecoveryLevel;
  reasons: string[];
  hrv: number | null;
  hrvBaseline: number | null;
  restingHr: number | null;
  restingHrBaseline: number | null;
  sleepHours: number | null;
  tsb: number | null;
}

export interface WeightTrend {
  current: number | null;
  trend: number | null;
  /** кг/тиждень за згладженим трендом */
  weeklyChange: number | null;
}
