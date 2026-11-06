import assert from "node:assert/strict";

const origin = new URL(process.env.QUIVER_MONITOR_ORIGIN || "https://quiver-web-production-8863.up.railway.app");
const mode = process.env.QUIVER_MONITOR_EXECUTION || "paper";
assert(origin.protocol === "https:" && !origin.username && !origin.password, "Use a public HTTPS origin.");
assert(["paper", "paper_and_mainnet"].includes(mode), "Unknown execution profile.");

async function get(path) {
  const r = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15000), redirect: "error" });
  assert(r.ok, `${path} returned HTTP ${r.status}.`);
  return r.json();
}

const [web, engine, auth, live] = await Promise.all([
  get("/api/health"),
  get("/v1/ready"),
  get("/v1/auth/config"),
  get("/v1/live/status"),
]);
const fresh = (at) => typeof at === "number" && Date.now() - at >= -5000 && Date.now() - at < 180000;
assert(web.ready, "Web readiness failed.");
assert(engine.ready && engine.storage === "postgres", "Durable engine is unavailable.");
assert(engine.execution === mode && engine.workflowPrices === "observed", "Unexpected execution or quote profile.");
const last = engine.workflowDriver?.lastCycleAt;
const age = Date.now() - last;
assert(fresh(last), "Paper driver heartbeat is stale.");
assert(auth.privy?.enabled && !auth.devLogin, "Production authentication check failed.");
assert(mode === "paper" ? live.enabled === false : live.enabled && live.originVerified, "Live access gate disagrees with the release profile.");
if (mode === "paper_and_mainnet") assert(fresh(live.lastCycle), "Live order reconciliation heartbeat is stale.");
console.log(`Quiver ready. Profile ${mode}. Paper driver heartbeat ${Math.round(age / 1000)}s ago.`);
