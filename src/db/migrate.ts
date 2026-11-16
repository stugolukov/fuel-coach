import { migrate, pool } from "./index.js";

await migrate();
console.log("Міграцію застосовано");
await pool.end();
