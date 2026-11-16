import { Bot, InlineKeyboard } from "grammy";
import { config } from "../lib/config.js";
import { localDate } from "../lib/dates.js";
import * as db from "../db/index.js";
import { parseManualLog } from "../services/ai.js";
import * as coach from "../services/coach.js";
import { esc } from "../services/format.js";

export const bot = new Bot(config.telegramToken);

export async function send(text: string, keyboard?: InlineKeyboard): Promise<void> {
  // Telegram обмежує повідомлення 4096 символами
  const chunks: string[] = [];
  let buf = "";
  for (const para of text.split("\n\n")) {
    if ((buf + "\n\n" + para).length > 3900 && buf) { chunks.push(buf); buf = para; }
    else buf = buf ? `${buf}\n\n${para}` : para;
  }
  if (buf) chunks.push(buf);
  for (const [i, c] of chunks.entries()) {
    await bot.api.sendMessage(config.chatId, c, {
      parse_mode: "HTML",
      ...(i === chunks.length - 1 && keyboard ? { reply_markup: keyboard } : {}),
    });
  }
}

export const mealKeyboard = () =>
  new InlineKeyboard().text("🍲 Рецепти на обід", "meal:Обід").text("🍽 На вечерю", "meal:Вечеря").row()
    .text("👍 Рецепти ок", "fb:1").text("👎 Не те", "fb:-1");

// Доступ лише власнику
bot.use(async (ctx, next) => {
  if (ctx.chat?.id !== config.chatId) {
    if (ctx.chat) {
      await ctx.reply(config.chatId
        ? "Це приватний бот."
        : `Ваш chat id: ${ctx.chat.id}\nДодайте його в змінну TELEGRAM_CHAT_ID на Railway і перезапустіть сервіс.`);
    }
    return;
  }
  await next();
});

const HELP = `<b>Fuel Coach</b> — харчування під тріатлон-тренування.

Автоматично:
• ранком — вага, склад тіла, відновлення;
• після тренування — сніданок-відновлення з БЖВ і рецептами, план дня;
• друге тренування протягом години — оновлений сніданок;
• увечері — що з'їсти перед ранковим тренуванням;
• неділя — тижневий звіт.

Команди:
/today — стан і план на сьогодні
/morning — ранковий звіт (якщо ще не приходив)
/check — перевірити нові тренування зараз
/recipes обід|перекус|вечеря — рецепти під план
/week — тижневий звіт
/profile зріст вік стать — напр. <code>/profile 180 36 m</code>
/likes текст — вподобання (напр. «люблю вівсянку, не їм свинину»)
/allergies текст — алергії та виключення

Будь-який інший текст — ручний запис: «2 келихи вина», «шматок торта», «важко в шлунку після гелю».`;

bot.command(["start", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

const guard = async (fn: () => Promise<string | null>, empty = "Нічого нового.") => {
  try {
    const msg = await fn();
    await send(msg ?? empty);
  } catch (e) {
    console.error(e);
    await send(`⚠️ Помилка: ${esc(e instanceof Error ? e.message : String(e))}`);
  }
};

bot.command("morning", () => guard(() => coach.morningReport(config.chatId, new Date(), true), "Ранковий звіт уже надсилався сьогодні. /today — поточний стан."));
bot.command("today", () => guard(() => coach.todayStatus(config.chatId)));
bot.command("check", () => guard(() => coach.checkNewWorkouts(config.chatId), "Нових тренувань немає."));
bot.command("week", () => guard(() => coach.weeklyReport(config.chatId)));
bot.command("recipes", (ctx) => {
  const arg = ctx.match.trim();
  const name = arg ? arg[0]!.toUpperCase() + arg.slice(1).toLowerCase() : "Обід";
  return guard(() => coach.mealRecipes(config.chatId, name));
});

bot.command("profile", async (ctx) => {
  const [h, a, s] = ctx.match.trim().split(/\s+/);
  const heightCm = Number(h), age = Number(a);
  if (!heightCm || !age || (s !== "m" && s !== "f")) {
    const p = await db.getProfile(config.chatId);
    return ctx.reply(`Поточний профіль: ${p.heightCm} см, ${p.age} р., ${p.sex}\nФормат: /profile 180 36 m`);
  }
  await db.updateProfile(config.chatId, { heightCm, age, sex: s });
  return ctx.reply("✅ Профіль оновлено");
});
bot.command("likes", async (ctx) => {
  await db.updateProfile(config.chatId, { preferences: ctx.match.trim() });
  return ctx.reply("✅ Вподобання збережено");
});
bot.command("allergies", async (ctx) => {
  await db.updateProfile(config.chatId, { allergies: ctx.match.trim() });
  return ctx.reply("✅ Збережено");
});

bot.callbackQuery(/^meal:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Готую рецепти…" });
  await guard(() => coach.mealRecipes(config.chatId, ctx.match[1]!));
});

bot.callbackQuery(/^fb:(-?1)$/, async (ctx) => {
  const rating = Number(ctx.match[1]);
  const text = ctx.callbackQuery.message?.text ?? "";
  // назви рецептів — рядки виду «1. Назва (10 хв)»
  const names = [...text.matchAll(/^\d+\. (.+?) \(\d+ хв\)$/gm)].map((m) => m[1]!);
  for (const n of names) await db.addFeedback(config.chatId, n, rating);
  await ctx.answerCallbackQuery({ text: rating > 0 ? "Дякую! 👍" : "Врахую, більше не пропонуватиму" });
});

bot.on("message:text", async (ctx) => {
  try {
    const date = localDate(new Date(), config.timezone);
    const logs = await parseManualLog(ctx.message.text, date);
    if (!logs.length) return ctx.reply("Не зрозумів запис 🤔");
    await db.addLogs(config.chatId, logs);
    const lines = logs.map((l) => {
      const icon = { alcohol: "🍷", dessert: "🍰", food: "🍽", note: "📝" }[l.kind];
      return `${icon} ${esc(l.description)}${l.kcal ? ` — ~${l.kcal} ккал` : ""}${l.alcoholG ? `, ${Math.round(l.alcoholG)} г алкоголю` : ""}`;
    });
    await ctx.reply(`Записав:\n${lines.join("\n")}\n\nВраховую в плані на сьогодні й завтра. /today — оновлений план.`, { parse_mode: "HTML" });
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ Не вдалося зберегти запис");
  }
});
