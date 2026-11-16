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
  if (!id) {
    console.warn("TELEGRAM_CHAT_ID не задано — розклад вимкнено. Напишіть боту /start, щоб дізнатися chat id.");
    return;
  }
  // Нові тренування: кожні 10 хв з 05:00 до 21:59
  cron.schedule("*/10 5-21 * * *", () => run("workouts", async () => {
    const msg = await coach.checkNewWorkouts(id);
    if (msg) await send(msg, mealKeyboard());
  }), { timezone: tz });

  // Ранковий звіт — щойно Garmin синхронізував сон/HRV (05:00–09:59), інакше примусово о 10:00
  cron.schedule("*/10 5-9 * * *", () => run("morning", async () => {
    const msg = await coach.morningReport(id);
    if (msg) await send(msg);
  }), { timezone: tz });
  cron.schedule("0 10 * * *", () => run("morning-fallback", async () => {
    const msg = await coach.morningReport(id, new Date(), true);
    if (msg) await send(msg);
  }), { timezone: tz });

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
