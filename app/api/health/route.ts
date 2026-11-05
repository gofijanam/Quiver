import { connection } from "next/server";

export async function GET() {
  await connection();
  if (process.env.QUIVER_WEB_DB_PATH) {
    const { getRawDb } = await import("@/db");
    await getRawDb().prepare("SELECT 1").first();
  }
  return Response.json({ ready: true });
}
