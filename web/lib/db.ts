import "server-only";

import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

type GlobalDb = typeof globalThis & {
  __sentenceMiningPool?: pg.Pool;
  __sentenceMiningPglite?: Promise<PGlite>;
};

const g = globalThis as GlobalDb;

export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (databaseUrl !== "") {
    g.__sentenceMiningPool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
    return (await g.__sentenceMiningPool.query(text, params)).rows as T[];
  }
  g.__sentenceMiningPglite ??= startLocal().catch((error: unknown) => {
    g.__sentenceMiningPglite = undefined;
    throw error;
  });
  return (await (await g.__sentenceMiningPglite).query<T>(text, params)).rows;
}

async function startLocal(): Promise<PGlite> {
  const db = new PGlite();
  const files = (await readdir("migrations").catch(() => []))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  return db;
}

export function asJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function readJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}
