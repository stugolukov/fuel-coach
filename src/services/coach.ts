import { config } from "../lib/config.js";
import { addDays, localDate } from "../lib/dates.js";
import type { RecoveryStatus, WellnessDay, Workout } from "../lib/types.js";
import * as db from "../db/index.js";
import { generateRecipes, weeklyNarrative } from "./ai.js";
import * as fmt from "./format.js";
import { IntervalsClient } from "./intervals.js";
import {
  dailyPlan, duringWorkoutCarbsPerHour, groupSessions, hydration, preWorkout,
  recoveryBreakfast, redsWarning, summarize,
} from "./nutrition.js";
import { assessRecovery } from "./recovery.js";
import { weightTrend } from "./weight.js";

/** Різниця між локальним часом і UTC для дати (мс) */
function tzOffsetMs(d: Date): number {
  const local = new Date(d.toLocaleString("en-US", { timeZone: config.timezone }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return local.getTime() - utc.getTime();
}

const intervals = new IntervalsClient(config.intervalsAthleteId, config.intervalsApiKey);
const DEFAULT_WEIGHT = 70;

interface Context {
  today: string;
  wellnessToday: WellnessDay | undefined;
  history: WellnessDay[];
  recovery: RecoveryStatus;
  weightKg: number;
}

async function context(now = new Date()): Promise<Context> {
  const today = localDate(now, config.timezone);
  const days = await intervals.wellness(addDays(today, -45), today);
  const wellnessToday = days.find((d) => d.date === today);
  const history = days.filter((d) => d.date < today);
  const recovery = assessRecovery(wellnessToday, history);
  const lastWeight = [...days].reverse().find((d) => d.weightKg != null)?.weightKg ?? DEFAULT_WEIGHT;
  return { today, wellnessToday, history: days, recovery, weightKg: lastWeight };
}

/**
 * Перевіряє нові тренування за сьогодні. Якщо з'явилося нове — формує сніданок-відновлення
 * для сесії, до якої воно належить (тренування з перервою <60 хв об'єднуються).
 * Повертає повідомлення або null, якщо нового нічого.
 */
export async function checkNewWorkouts(chatId: number, now = new Date()): Promise<string | null> {
  const ctx = await context(now);
  const { workouts, stubs } = await intervals.activitiesWithStubs(ctx.today, ctx.today);
  const seen = await db.processedIds(chatId, ctx.today);

  const freshStubs = stubs.filter((s) => !seen.has(s.id));
  if (freshStubs.length) {
    await db.markProcessed(chatId, ctx.today, freshStubs.map((s) => s.id));
    // Якщо цю ж активність Garmin теж передав — нічого не кажемо
    const covered = (s: (typeof stubs)[number]) =>
      workouts.some((w) => Math.abs(w.start.getTime() - Date.parse(`${s.startLocal}Z`) + tzOffsetMs(w.start)) < 10 * 60_000);
    const unknown = freshStubs.filter((s) => !covered(s));
    if (unknown.length && !workouts.some((w) => !seen.has(w.id))) {
      return `⚠️ Є тренування о ${unknown.map((s) => s.startLocal.slice(11, 16)).join(", ")} (${unknown[0]!.source}), але intervals.icu не передає його дані: це обмеження Strava API.\n` +
        "Щоб бот бачив усі тренування, увімкніть пряму синхронізацію Garmin Connect → intervals.icu (Settings → Connections).";
    }
  }

  if (!workouts.length) return null;
  const fresh = workouts.filter((w) => !seen.has(w.id));
  if (!fresh.length) return null;

  const sessions = groupSessions(workouts);
  const target = sessions.find((g) => g.some((w) => fresh.includes(w)))!;
  const updated = target.some((w) => seen.has(w.id));
  await db.markProcessed(chatId, ctx.today, fresh.map((w) => w.id));
  return buildBreakfastMessage(chatId, ctx, workouts, target, updated);
}

async function buildBreakfastMessage(chatId: number, ctx: Context, all: Workout[], target: Workout[], updated: boolean): Promise<string> {
  const profile = await db.getProfile(chatId);
  const s = summarize(target, ctx.weightKg);
  const breakfast = recoveryBreakfast(s, ctx.weightKg, ctx.recovery);
  const allSessions = groupSessions(all).map((g) => summarize(g, ctx.weightKg));
  const logs = await db.logsBetween(chatId, addDays(ctx.today, -1), ctx.today);
  const trend = weightTrend(ctx.history);
  const plan = dailyPlan({ profile, weightKg: ctx.weightKg, sessions: allSessions, recovery: ctx.recovery, trend, logs, breakfast });
  const disliked = await db.dislikedRecipes(chatId);

  const recipes = await generateRecipes({
    meal: "сніданок одразу після ранкового тренування (відновлення)",
    macros: breakfast,
    count: 3,
    context: `Сесія: ${s.sports.join("+")}, ${s.durationMin} хв, load ${Math.round(s.load)}. Відновлення: ${ctx.recovery.level}.` +
      (disliked.length ? ` Не пропонувати: ${disliked.join(", ")}.` : ""),
    preferences: profile.preferences,
    allergies: profile.allergies,
  });

  const parts = [
    updated ? "🔄 <b>Оновлений сніданок</b> (друге тренування в межах години)" : "✅ <b>Тренування завершено</b>",
    fmt.session(s),
    fmt.recovery(ctx.recovery),
    fmt.hydration(hydration(s), duringWorkoutCarbsPerHour(s.durationMin, s.maxIntensity)),
    `🍳 <b>Сніданок-відновлення (протягом 30–60 хв):</b>\n${fmt.macros(breakfast)}`,
    fmt.recipes(recipes),
    fmt.daily(plan),
  ];
  await db.saveRecommendation(chatId, ctx.today, "breakfast", { breakfast, plan, recipes, workouts: target.map((w) => w.id) });
  return parts.join("\n\n");
}

/**
 * Ранковий звіт: вага, склад тіла, відновлення. Надсилається, щойно Garmin синхронізував
 * сон/HRV за сьогодні (або примусово з `force`). Повертає null, якщо ще рано або вже надіслано.
 */
export async function morningReport(chatId: number, now = new Date(), force = false): Promise<string | null> {
  const ctx = await context(now);
  if (await db.hasRecommendation(chatId, ctx.today, "morning")) return null;
  const synced = ctx.wellnessToday?.hrv != null || ctx.wellnessToday?.sleepHours != null;
  if (!synced && !force) return null;
  await db.saveRecommendation(chatId, ctx.today, "morning", { recovery: ctx.recovery });
  const profile = await db.getProfile(chatId);
  const trend = weightTrend(ctx.history);
  const parts = [`☀️ <b>Доброго ранку!</b>`, fmt.body(ctx.wellnessToday, trend, profile.heightCm), fmt.recovery(ctx.recovery)];
  const recent = ctx.history.slice(-7).map((d, i, arr) => assessRecovery(d, ctx.history.slice(0, ctx.history.length - arr.length + i)));
  const reds = redsWarning(trend, recent);
  if (reds) parts.push(reds);
  const trainedAlready = (await intervals.activities(ctx.today, ctx.today)).length > 0;
  if (!trainedAlready) {
    parts.push(`🍌 <b>Перед тренуванням:</b>\n${preWorkout({ expectedLong: false, recovery: ctx.recovery }).join("\n")}`);
  }
  return parts.join("\n\n");
}

/** Якщо до обіду тренувань немає — план дня відпочинку. */
export async function restDayPlan(chatId: number, now = new Date()): Promise<string | null> {
  const ctx = await context(now);
  const workouts = await intervals.activities(ctx.today, ctx.today);
  if (workouts.length) return null;
  if (await db.hasRecommendation(chatId, ctx.today, "rest_day")) return null;
  const profile = await db.getProfile(chatId);
  const logs = await db.logsBetween(chatId, addDays(ctx.today, -1), ctx.today);
  const plan = dailyPlan({ profile, weightKg: ctx.weightKg, sessions: [], recovery: ctx.recovery, trend: weightTrend(ctx.history), logs, breakfast: null });
  await db.saveRecommendation(chatId, ctx.today, "rest_day", plan);
  return [`😌 <b>День без тренувань</b>`, "Вуглеводів менше (~3 г/кг), білок рівномірно по 25–35 г на прийом.", fmt.daily(plan)].join("\n\n");
}

/** Вечірнє повідомлення: що з'їсти перед ранковим тренуванням + нагадування про ручні записи. */
export async function eveningMessage(chatId: number, now = new Date()): Promise<string> {
  const ctx = await context(now);
  const lastWeek = await intervals.activities(addDays(ctx.today, -7), ctx.today);
  const tomorrowWeekday = new Date(`${addDays(ctx.today, 1)}T12:00:00Z`).getUTCDay();
  // Без плану: якщо минулого тижня в цей день була довга сесія — радимо розширений варіант
  const expectedLong = lastWeek.some((w) => w.start.getUTCDay() === tomorrowWeekday && w.durationMin >= 90);
  return [
    `🌙 <b>На завтрашній ранок</b>`,
    preWorkout({ expectedLong, recovery: ctx.recovery }).join("\n"),
    "Їжте за 30–60 хв до старту. Вечеря сьогодні — з нормальною порцією вуглеводів.",
    "📝 Був алкоголь чи десерт? Просто напишіть, наприклад: «2 келихи вина і шматок торта».",
  ].join("\n\n");
}

/** Тижневий звіт (неділя). */
export async function weeklyReport(chatId: number, now = new Date()): Promise<string> {
  const ctx = await context(now);
  const from = addDays(ctx.today, -6);
  const workouts = await intervals.activities(from, ctx.today);
  const logs = await db.logsBetween(chatId, from, ctx.today);
  const trend = weightTrend(ctx.history);
  const week = ctx.history.filter((d) => d.date >= from);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  const bySport = workouts.reduce<Record<string, { n: number; min: number; load: number }>>((acc, w) => {
    const s = (acc[w.sport] ??= { n: 0, min: 0, load: 0 });
    s.n++; s.min += w.durationMin; s.load += w.load;
    return acc;
  }, {});
  const summary = {
    trainingHours: Math.round(workouts.reduce((a, w) => a + w.durationMin, 0) / 6) / 10,
    totalLoad: Math.round(workouts.reduce((a, w) => a + w.load, 0)),
    bySport,
    weightTrendKgPerWeek: trend.weeklyChange,
    avgWeight: avg(week.map((d) => d.weightKg)),
    avgHrv: avg(week.map((d) => d.hrv)),
    avgSleep: avg(week.map((d) => d.sleepHours)),
    alcoholDays: new Set(logs.filter((l) => l.kind === "alcohol").map((l) => l.date)).size,
    dessertDays: new Set(logs.filter((l) => l.kind === "dessert").map((l) => l.date)).size,
    extraKcal: logs.reduce((a, l) => a + l.kcal, 0),
  };
  const narrative = await weeklyNarrative(JSON.stringify(summary));
  await db.saveRecommendation(chatId, ctx.today, "weekly", summary);
  const sportLines = Object.entries(bySport).map(([k, v]) => `${k}: ${v.n}× · ${Math.round(v.min)} хв · load ${Math.round(v.load)}`);
  return [
    `📅 <b>Тиждень ${from} — ${ctx.today}</b>`,
    `⏱ ${summary.trainingHours} год · load ${summary.totalLoad}\n${sportLines.join("\n")}`,
    fmt.body(ctx.wellnessToday, trend, (await db.getProfile(chatId)).heightCm),
    `HRV сер. ${summary.avgHrv ?? "—"} · сон сер. ${summary.avgSleep ?? "—"} год`,
    `🍷 Днів з алкоголем: ${summary.alcoholDays} · 🍰 з десертами: ${summary.dessertDays} (+${summary.extraKcal} ккал)`,
    fmt.esc(narrative),
  ].filter(Boolean).join("\n\n");
}

/** Стан на зараз: відновлення, вага, план дня з урахуванням сьогоднішніх тренувань і записів. */
export async function todayStatus(chatId: number, now = new Date()): Promise<string> {
  const ctx = await context(now);
  const workouts = await intervals.activities(ctx.today, ctx.today);
  const profile = await db.getProfile(chatId);
  const sessions = groupSessions(workouts).map((g) => summarize(g, ctx.weightKg));
  const logs = await db.logsBetween(chatId, addDays(ctx.today, -1), ctx.today);
  const trend = weightTrend(ctx.history);
  const firstBreakfast = sessions[0] ? recoveryBreakfast(sessions[0], ctx.weightKg, ctx.recovery) : null;
  const plan = dailyPlan({ profile, weightKg: ctx.weightKg, sessions, recovery: ctx.recovery, trend, logs, breakfast: firstBreakfast });
  return [
    fmt.body(ctx.wellnessToday, trend, profile.heightCm),
    fmt.recovery(ctx.recovery),
    sessions.length ? sessions.map(fmt.session).join("\n\n") : "Сьогодні тренувань ще немає.",
    firstBreakfast ? `🍳 Сніданок: ${fmt.macros(firstBreakfast)}` : "",
    fmt.daily(plan),
  ].filter(Boolean).join("\n\n");
}

/** Рецепти для конкретного прийому їжі з сьогоднішнього плану. */
export async function mealRecipes(chatId: number, mealName: string, now = new Date()): Promise<string> {
  const ctx = await context(now);
  const workouts = await intervals.activities(ctx.today, ctx.today);
  const profile = await db.getProfile(chatId);
  const sessions = groupSessions(workouts).map((g) => summarize(g, ctx.weightKg));
  const logs = await db.logsBetween(chatId, addDays(ctx.today, -1), ctx.today);
  const breakfast = sessions[0] ? recoveryBreakfast(sessions[0], ctx.weightKg, ctx.recovery) : null;
  const plan = dailyPlan({ profile, weightKg: ctx.weightKg, sessions, recovery: ctx.recovery, trend: weightTrend(ctx.history), logs, breakfast });
  const meal = plan.meals.find((m) => m.name.toLowerCase() === mealName.toLowerCase()) ?? plan.meals[0]!;
  const list = await generateRecipes({
    meal: meal.name, macros: meal.macros, count: 3,
    context: `Сьогоднішнє навантаження load ${Math.round(sessions.reduce((a, s) => a + s.load, 0))}. Відновлення: ${ctx.recovery.level}.`,
    preferences: profile.preferences, allergies: profile.allergies,
  });
  return `🍽 <b>${meal.name}</b>: ${fmt.macros(meal.macros)}\n\n${fmt.recipes(list)}`;
}

export { localDate };
