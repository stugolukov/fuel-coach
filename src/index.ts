import { bot } from "./bot/index.js";
import { migrate } from "./db/index.js";
import { startScheduler } from "./scheduler.js";

await migrate();
startScheduler();
bot.catch((err) => console.error("bot error", err));
await bot.api.setMyCommands([
  { command: "today", description: "Стан і план на сьогодні" },
  { command: "morning", description: "Ранковий звіт" },
  { command: "check", description: "Перевірити нові тренування" },
  { command: "recipes", description: "Рецепти: обід / перекус / вечеря" },
  { command: "week", description: "Тижневий звіт" },
  { command: "profile", description: "Профіль: зріст, дата народження, стать" },
  { command: "likes", description: "Харчові вподобання" },
  { command: "allergies", description: "Алергії та виключення" },
  { command: "help", description: "Довідка" },
]);
console.log("Fuel Coach запущено");
await bot.start();
