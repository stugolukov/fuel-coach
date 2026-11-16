import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "../lib/config.js";
import type { ManualLog, Profile } from "../lib/types.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Публічний URL Railway Postgres (postgres-ssl) використовує самопідписаний сертифікат
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

export async function migrate(): Promise<void> {
  const sql = readFileSync(new URL("../../src/db/schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

export async function getProfile(chatId: number): Promise<Profile> {
  await pool.query("INSERT INTO profiles(chat_id) VALUES ($1) ON CONFLICT DO NOTHING", [chatId]);
  const { rows } = await pool.query(
    "SELECT height_cm, to_char(birth_date,'YYYY-MM-DD') AS birth_date, sex, preferences, allergies FROM profiles WHERE chat_id=$1",
    [chatId],
  );
  const r = rows[0];
  return { chatId, heightCm: r.height_cm, birthDate: r.birth_date, sex: r.sex, preferences: r.preferences, allergies: r.allergies };
}

export async function updateProfile(chatId: number, patch: Partial<Omit<Profile, "chatId">>): Promise<void> {
  await getProfile(chatId);
  const cols: Record<string, string> = { heightCm: "height_cm", birthDate: "birth_date", sex: "sex", preferences: "preferences", allergies: "allergies" };
  for (const [k, v] of Object.entries(patch)) {
    const col = cols[k];
    if (col && v !== undefined) await pool.query(`UPDATE profiles SET ${col}=$2 WHERE chat_id=$1`, [chatId, v]);
  }
}

export async function processedIds(chatId: number, date: string): Promise<Set<string>> {
  const { rows } = await pool.query("SELECT activity_id FROM processed_activities WHERE chat_id=$1 AND date=$2", [chatId, date]);
  return new Set(rows.map((r: { activity_id: string }) => r.activity_id));
}

export async function markProcessed(chatId: number, date: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    await pool.query("INSERT INTO processed_activities(activity_id, chat_id, date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [id, chatId, date]);
  }
}

export async function addLogs(chatId: number, logs: ManualLog[]): Promise<void> {
  for (const l of logs) {
    await pool.query(
      "INSERT INTO manual_logs(chat_id, date, kind, description, kcal, alcohol_g, carbs_g) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [chatId, l.date, l.kind, l.description, l.kcal, l.alcoholG, l.carbsG],
    );
  }
}

export async function logsBetween(chatId: number, from: string, to: string): Promise<ManualLog[]> {
  const { rows } = await pool.query(
    "SELECT to_char(date,'YYYY-MM-DD') AS date, kind, description, kcal, alcohol_g, carbs_g FROM manual_logs WHERE chat_id=$1 AND date BETWEEN $2 AND $3 ORDER BY created_at",
    [chatId, from, to],
  );
  return rows.map((r) => ({ date: r.date, kind: r.kind, description: r.description, kcal: r.kcal, alcoholG: r.alcohol_g, carbsG: r.carbs_g }));
}

export async function saveRecommendation(chatId: number, date: string, kind: string, payload: unknown): Promise<void> {
  await pool.query("INSERT INTO recommendations(chat_id, date, kind, payload) VALUES ($1,$2,$3,$4)", [chatId, date, kind, JSON.stringify(payload)]);
}

export async function hasRecommendation(chatId: number, date: string, kind: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM recommendations WHERE chat_id=$1 AND date=$2 AND kind=$3 LIMIT 1", [chatId, date, kind]);
  return rows.length > 0;
}

export async function addFeedback(chatId: number, recipe: string, rating: number): Promise<void> {
  await pool.query("INSERT INTO feedback(chat_id, recipe_name, rating) VALUES ($1,$2,$3)", [chatId, recipe, rating]);
}

export async function dislikedRecipes(chatId: number): Promise<string[]> {
  const { rows } = await pool.query("SELECT DISTINCT recipe_name FROM feedback WHERE chat_id=$1 AND rating<0 ORDER BY 1 LIMIT 30", [chatId]);
  return rows.map((r: { recipe_name: string }) => r.recipe_name);
}
