import cron from "node-cron";
import { config } from "./lib/config.js";
import { localHour } from "./lib/dates.js";
import { mealKeyboard, send } from "./bot/index.js";
import * as coach from "./services/coach.js";

const tz = config.timezone;
const id = config.chatId;

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) { console.error(`[${name}]`, e); }
}

export function startScheduler(): void {
  // Нові тренування: кожні 10 хв з 05:00 до 21:59
  cron.schedule("*/10 5-21 * * *", () => run("workouts", async () => {
    const msg = await coach.checkNewWorkouts(id);
    if (msg) await send(msg, mealKeyboard());
  }), { timezone: tz });

  // Ранковий звіт після синхронізації Garmin (вага, HRV, сон)
  cron.schedule("15 8 * * *", () => run("morning", async () => send(await coach.morningReport(id))), { timezone: tz });

  // Немає тренувань до 13:00 — день відпочинку
  cron.schedule("0 13 * * *", () => run("rest", async () => {
    const msg = await coach.restDayPlan(id);
    if (msg) await send(msg, mealKeyboard());
  }), { timezone: tz });

  // Вечір: підготовка до ранкового тренування
  cron.schedule("0 20 * * *", () => run("evening", async () => send(await coach.eveningMessage(id))), { timezone: tz });

  // Неділя: тижневий звіт
  cron.schedule("30 20 * * 0", () => run("weekly", async () => send(await coach.weeklyReport(id))), { timezone: tz });

  console.log(`Розклад запущено (${tz}, зараз ${localHour(new Date(), tz)}:xx)`);
}
