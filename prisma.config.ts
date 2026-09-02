import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env then override with .env.local if present
config({ path: ".env" });
config({ path: ".env.local", override: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7 reads the seed command from here only. The Prisma 6 location
    // (package.json#prisma.seed) is silently ignored, which is why
    // `npx prisma db seed` reported "No seed command configured".
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  }
});
