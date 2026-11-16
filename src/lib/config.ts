import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задано змінну середовища ${name}`);
  return v;
}

export const config = {
  telegramToken: req("TELEGRAM_BOT_TOKEN"),
  /** Дозволений Telegram chat id власника (MVP — один спортсмен) */
  chatId: Number(req("TELEGRAM_CHAT_ID")),
  intervalsAthleteId: req("INTERVALS_ATHLETE_ID"),
  intervalsApiKey: req("INTERVALS_API_KEY"),
  databaseUrl: req("DATABASE_URL"),
  timezone: process.env.TZ_NAME ?? "Europe/Kyiv",
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
};
