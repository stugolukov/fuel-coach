import { readFileSync } from "node:fs";
import { pool } from "./index.js";

const sql = readFileSync(new URL("../../src/db/schema.sql", import.meta.url), "utf8");
await pool.query(sql);
console.log("Міграцію застосовано");
await pool.end();
