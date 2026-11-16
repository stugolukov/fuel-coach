import type { Sport, WellnessDay, Workout } from "../lib/types.js";

const BASE = "https://intervals.icu/api/v1";

interface RawActivity {
  id: string | number;
  name?: string;
  type?: string;
  start_date?: string;
  start_date_local?: string;
  moving_time?: number;
  elapsed_time?: number;
  icu_training_load?: number | null;
  icu_intensity?: number | null;
  calories?: number | null;
  icu_joules?: number | null;
  distance?: number | null;
  average_heartrate?: number | null;
}

interface RawWellness {
  id: string;
  weight?: number | null;
  bodyFat?: number | null;
  muscleMass?: number | null;
  hydration?: number | null;
  bmi?: number | null;
  restingHR?: number | null;
  hrv?: number | null;
  sleepSecs?: number | null;
  [k: string]: unknown;
}

export function mapSport(type: string | undefined): Sport {
  const t = (type ?? "").toLowerCase();
  if (t.includes("swim")) return "swim";
  if (t.includes("ride") || t.includes("cycl") || t.includes("bike")) return "bike";
  if (t.includes("run")) return "run";
  if (t.includes("weight") || t.includes("strength") || t.includes("workout")) return "strength";
  return "other";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function mapActivity(a: RawActivity): Workout {
  const ifRaw = num(a.icu_intensity);
  const start = a.start_date ?? a.start_date_local ?? new Date().toISOString();
  return {
    id: String(a.id),
    name: a.name ?? a.type ?? "Тренування",
    sport: mapSport(a.type),
    start: new Date(start),
    durationMin: Math.round((a.moving_time ?? a.elapsed_time ?? 0) / 60),
    load: num(a.icu_training_load) ?? 0,
    // intervals.icu віддає IF у відсотках (напр. 78.4)
    intensity: ifRaw == null ? null : ifRaw > 2 ? ifRaw / 100 : ifRaw,
    kcal: num(a.calories),
    kj: num(a.icu_joules) != null ? (a.icu_joules as number) / 1000 : null,
    distanceKm: num(a.distance) != null ? (a.distance as number) / 1000 : null,
    avgHr: num(a.average_heartrate),
  };
}

export function mapWellness(w: RawWellness, weightKg: number | null = null): WellnessDay {
  const weight = num(w.weight) ?? weightKg;
  const muscle = num(w.muscleMass);
  return {
    date: w.id,
    weightKg: weight,
    bodyFatPct: num(w.bodyFat),
    // Garmin Index віддає м'язову масу в кг; переводимо у % для зручності
    musclePct: muscle != null && weight ? Math.round((muscle / weight) * 1000) / 10 : null,
    waterPct: num(w.hydration),
    bmi: num(w.bmi),
    restingHr: num(w.restingHR),
    hrv: num(w.hrv),
    sleepHours: num(w.sleepSecs) != null ? (w.sleepSecs as number) / 3600 : null,
  };
}

export class IntervalsClient {
  constructor(private athleteId: string, private apiKey: string) {}

  private async get<T>(path: string): Promise<T> {
    const auth = Buffer.from(`API_KEY:${this.apiKey}`).toString("base64");
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`intervals.icu ${res.status}: ${await res.text().catch(() => "")}`);
    return (await res.json()) as T;
  }

  async activities(oldest: string, newest: string): Promise<Workout[]> {
    const raw = await this.get<RawActivity[]>(`/athlete/${this.athleteId}/activities?oldest=${oldest}&newest=${newest}`);
    return raw.filter((a) => (a.moving_time ?? a.elapsed_time ?? 0) > 0).map(mapActivity);
  }

  async wellness(oldest: string, newest: string): Promise<WellnessDay[]> {
    const raw = await this.get<RawWellness[]>(`/athlete/${this.athleteId}/wellness?oldest=${oldest}&newest=${newest}`);
    return raw.map((w) => mapWellness(w)).sort((a, b) => a.date.localeCompare(b.date));
  }
}
