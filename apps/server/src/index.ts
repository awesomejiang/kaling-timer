import { readFileSync } from "node:fs";
import { loadMechanics } from "@kaling/mechanics";
import { createApp } from "./server.js";
const mechanics = loadMechanics(
  readFileSync(
    new URL("../../../config/mechanics.yaml", import.meta.url),
    "utf8",
  ),
);
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");
const { http, io } = createApp(mechanics, {
  databasePath: process.env.DATABASE_PATH ?? "data/rooms.sqlite",
  origins: process.env.ALLOWED_ORIGINS?.split(","),
});
http.listen(port, "0.0.0.0", () =>
  console.log(`Kaling server listening on ${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    io.close();
    http.close();
  });
