import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config.js";
import type { Macros, ManualLog } from "../lib/types.js";

const client = new Anthropic();

export interface Recipe {
  name: string;
  timeMin: number;
  ingredients: string[];
  steps: string[];
  macros: { kcal: number; proteinG: number; fatG: number; carbsG: number };
}

const recipeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recipes"],
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "timeMin", "ingredients", "steps", "macros"],
        properties: {
          name: { type: "string" },
          timeMin: { type: "integer" },
          ingredients: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          macros: {
            type: "object",
            additionalProperties: false,
            required: ["kcal", "proteinG", "fatG", "carbsG"],
            properties: {
              kcal: { type: "integer" },
              proteinG: { type: "integer" },
              fatG: { type: "integer" },
              carbsG: { type: "integer" },
            },
          },
        },
      },
    },
  },
} as const;

const logSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "description", "kcal", "alcoholG", "carbsG"],
        properties: {
          kind: { type: "string", enum: ["alcohol", "dessert", "food", "note"] },
          description: { type: "string" },
          kcal: { type: "integer" },
          alcoholG: { type: "number" },
          carbsG: { type: "integer" },
        },
      },
    },
  },
} as const;

async function askJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  const res = await client.beta.messages.create({
    model: config.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude відмовив у запиті");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Порожня відповідь Claude");
  return JSON.parse(text.text) as T;
}

const SYSTEM_RECIPES = `Ти — спортивний дієтолог для тріатлетів (плавання, велосипед, біг).
Мета спортсмена — стабільна вага, НЕ набір м'язової маси.
Пиши українською. Рецепти прості, з продуктів, доступних в Україні, приготування до 15 хв, якщо не сказано інше.
Макроси кожного рецепта мають бути в межах ±10% від цільових.`;

export async function generateRecipes(opts: {
  meal: string;
  macros: Macros;
  count: number;
  context: string;
  preferences: string;
  allergies: string;
}): Promise<Recipe[]> {
  const user = `Прийом їжі: ${opts.meal}
Ціль: ${opts.macros.kcal} ккал, білки ${opts.macros.proteinG} г, жири ${opts.macros.fatG} г, вуглеводи ${opts.macros.carbsG} г.
Контекст: ${opts.context}
Вподобання: ${opts.preferences || "немає"}
Алергії/виключити: ${opts.allergies || "немає"}
Дай ${opts.count} різних рецептів.`;
  try {
    const out = await askJson<{ recipes: Recipe[] }>(SYSTEM_RECIPES, user, recipeSchema);
    return out.recipes.slice(0, opts.count);
  } catch (e) {
    console.error("generateRecipes failed", e);
    return [];
  }
}

export async function parseManualLog(text: string, date: string): Promise<ManualLog[]> {
  const system = `Розбери запис спортсмена про їжу/напої українською. Оціни калорії, грами етанолу (келих вина 150 мл ≈ 14 г, пиво 0.5 л ≈ 20 г, 50 мл міцного ≈ 16 г) та вуглеводи.
kind: alcohol — алкоголь; dessert — солодке/десерт; food — інша їжа; note — самопочуття, шлунок, без калорій.`;
  const out = await askJson<{ entries: Omit<ManualLog, "date">[] }>(system, text, logSchema);
  return out.entries.map((e) => ({ ...e, date }));
}

export async function weeklyNarrative(summaryJson: string): Promise<string> {
  try {
    const res = await client.beta.messages.create({
      model: config.model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: `${SYSTEM_RECIPES}\nНапиши короткий (до 150 слів) тижневий висновок і 3 конкретні поради на наступний тиждень. Без markdown-заголовків.`,
      messages: [{ role: "user", content: summaryJson }],
    });
    const t = res.content.find((b) => b.type === "text");
    return t && t.type === "text" ? t.text : "";
  } catch (e) {
    console.error("weeklyNarrative failed", e);
    return "";
  }
}
