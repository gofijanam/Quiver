import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const text = (value) => (typeof value === "string" ? value.trim() : "");
const flag = (value, expected) => text(value) === String(expected);
const checked = (label, condition) => ({ label, ok: Boolean(condition) });
const validOutput = (rows) => rows.every((r) => r.ok);
function origin(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/"
      ? u.origin
      : null;
  } catch {
    return null;
  }
}
function vaultKey(value) {
  const s = text(value);
  return (
    /^[0-9a-fA-F]{64}$/.test(s) ||
    (/^[A-Za-z0-9+/_-]{43}=?$/.test(s) &&
      Buffer.from(s, "base64").length === 32)
  );
}
function edgeKey(value) {
  try {
    const raw = Buffer.from(text(value), "base64");
    if (!raw.length || raw.toString("base64") !== text(value)) return false;
    return (
      createPublicKey({ key: raw, format: "der", type: "spki" })
        .asymmetricKeyType === "ed25519"
    );
  } catch {
    return false;
  }
}
function dbUrl(value) {
  try {
    const u = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(u.protocol) &&
      u.hostname &&
      u.pathname.length > 1
    );
  } catch {
    return false;
  }
}
function required(value, min = 1) {
  const v = text(value);
  return (
    v.length >= min &&
    !/^(?:change[-_]?me|example|placeholder|todo|undefined|null|<[^>]*>)$/i.test(
      v,
    )
  );
}
function profileOf(env) {
  if (env.LIVE_EXECUTION_PROFILE && !["legacy", "venue-wallets"].includes(env.LIVE_EXECUTION_PROFILE))
    return null;
  const mainnet = env.QUIVR_MAINNET_ENABLED === "true" ||
    env.CHAIN_ID === "4663" ||
    env.QUIVR_MODE === "mainnet";
  if (!mainnet) return "paper";
  return env.LIVE_EXECUTION_PROFILE === "venue-wallets" ? "live" : null;
}
function profileChecks(env, expected) {
  const actual = profileOf(env);
  const out = [
    checked(
      "Execution profile matches the selected release",
      actual === expected,
    ),
    checked(
      "Production authentication and durable storage profile",
      text(env.NODE_ENV).toLowerCase() === "production" &&
        flag(env.DEV_LOGIN_ENABLED, false) &&
        env.QUIVR_DEV_PERSIST === "0",
    ),
  ];
  if (expected === "live") {
    out.push(
      checked(
        "Venue wallets on mainnet chain 4663",
        actual === "live" &&
          env.QUIVR_MODE === "mainnet" &&
          flag(env.QUIVR_MAINNET_ENABLED, true) &&
          env.CHAIN_ID === "4663",
      ),
      checked(
        "Fresh verified mainnet price source",
        env.PRICE_SOURCE === "mainnet-readonly",
      ),
      checked(
        "Public Ed25519 key for site location",
        edgeKey(env.QUIVER_EDGE_PUBLIC_KEY),
      ),
      checked(
        "Versioned live disclosures",
        required(env.TERMS_VERSION) &&
          !text(env.TERMS_VERSION).startsWith("draft-"),
      ),
    );
  } else
    out.push(
      checked(
        "Paper deployment has mainnet writes closed",
        actual === "paper" &&
          ["mock", "testnet"].includes(env.QUIVR_MODE) &&
          flag(env.QUIVR_MAINNET_ENABLED, false) &&
          (!env.CHAIN_ID || env.CHAIN_ID === "46630"),
      ),
    );
  return out;
}
export function environmentChecks(env, profile, expectedPublicKey) {
  const allowed = text(env.CORS_ORIGINS)
      .split(",")
      .map((s) => s.trim()),
    site = origin(text(env.SIWE_ORIGIN));
  const checks = [
    ...profileChecks(env, profile),
    checked("Database connection profile", dbUrl(env.DATABASE_URL)),
    checked(
      "Stable JWT and operations secrets",
      required(env.QUIVR_JWT_SECRET, 32) &&
        required(env.OPS_TOKEN, 32) &&
        env.QUIVR_JWT_SECRET !== env.OPS_TOKEN,
    ),
    checked(
      "Dedicated 32-byte signer vault key",
      vaultKey(env.SECRETS_MASTER_KEY) &&
        env.SECRETS_MASTER_KEY !== env.OPS_TOKEN &&
        env.SECRETS_MASTER_KEY !== env.QUIVR_JWT_SECRET,
    ),
    checked(
      "Privy app credentials configured",
      required(env.PRIVY_APP_ID) && required(env.PRIVY_APP_SECRET),
    ),
    checked(
      "Existing model-provider configuration",
      required(env.OPENROUTER_API_KEY),
    ),
    checked(
      "Approved wallet and browser origins",
      site &&
        allowed.every((s) => s && origin(s) === s) &&
        allowed.includes(site) &&
        text(env.SIWE_ORIGIN) === site,
    ),
    checked(
      "Daily hosted AI budget of at most USD 5",
      +env.LLM_DAILY_BUDGET_USD > 0 && +env.LLM_DAILY_BUDGET_USD <= 5,
    ),
  ];
  if (profile === "live" && expectedPublicKey)
    checks.push(
      checked(
        "Origin verifier matches release public key",
        text(env.QUIVER_EDGE_PUBLIC_KEY) === expectedPublicKey,
      ),
    );
  return checks;
}

// Read the small subset of Render's Blueprint format used here. All checks are scoped to
// the chosen API service, its env block and its own database. Unsupported forms fail closed.
const depth = (s) => s.length - s.trimStart().length;
const unquote = (s) =>
  s.length >= 2 &&
  ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))
    ? s.slice(1, -1)
    : s;
function chunk(lines, start) {
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && depth(lines[end]) > depth(lines[start])) end++;
  return lines.slice(start + 1, end);
}
function section(lines, key, level) {
  const points = lines.flatMap((s, i) =>
    depth(s) === level && s.trim() === key + ":" ? [i] : [],
  );
  return points.length === 1 ? chunk(lines, points[0]) : [];
}
function entries(lines, level) {
  return lines.flatMap((s, i) =>
    depth(s) === level && s.trimStart().startsWith("- ")
      ? [[s.replace(/^(\s*)- /, "$1  "), ...chunk(lines, i)]]
      : [],
  );
}
function prop(lines, key, level) {
  const values = lines
    .filter((s) => depth(s) === level && s.trimStart().startsWith(key + ": "))
    .map((s) =>
      unquote(
        s
          .trim()
          .slice(key.length + 2)
          .trim(),
      ),
    );
  return values.length === 1 ? values[0] : undefined;
}
export function blueprintChecks(blueprint, { hasBackup = true } = {}) {
  const lines = blueprint
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+#.*$/, "").trimEnd())
    .filter((s) => s.trim() && !s.trimStart().startsWith("#"));
  const services = entries(section(lines, "services", 0), 2);
  const [api, ...other] = services.filter(
    (s) =>
      prop(s, "type", 4) === "web" &&
      prop(s, "dockerContext", 4) === "./services/backend",
  );
  const service = api ?? [],
    blocks = entries(section(service, "envVars", 4), 6);
  const map = new Map(),
    env = {};
  let unique = true;
  for (const block of blocks) {
    const name = prop(block, "key", 8);
    if (!name || map.has(name)) {
      unique = false;
      continue;
    }
    map.set(name, block);
    const value = prop(block, "value", 8);
    if (value !== undefined) env[name] = value;
  }
  const db = section(map.get("DATABASE_URL") ?? [], "fromDatabase", 8),
    dbName = prop(db, "name", 10),
    database = entries(section(lines, "databases", 0), 2).find(
      (s) => prop(s, "name", 4) === dbName,
    );
  const disk = section(service, "disk", 4),
    profile =
      profileOf(env) ?? (env.QUIVR_MODE === "mainnet" ? "live" : "paper");
  const checks = [
    checked(
      "One wallet API service and unambiguous env keys",
      api && !other.length && unique,
    ),
    checked(
      "Single API writer with persistent replay disk",
      prop(service, "numInstances", 4) === "1" &&
        prop(disk, "mountPath", 6) === "/var/data/quiver" &&
        Number(prop(disk, "sizeGB", 6)) >= 1,
    ),
    checked(
      "Operator-controlled deployment and readiness probe",
      prop(service, "healthCheckPath", 4) === "/v1/ready" &&
        prop(service, "autoDeployTrigger", 4) === "off",
    ),
    checked(
      "Internal PostgreSQL connection and private database",
      database &&
        dbName &&
        prop(db, "property", 10) === "connectionString" &&
        prop(database, "ipAllowList", 4) === "[]",
    ),
    checked(
      "Generated JWT, vault and operations credentials",
      ["QUIVR_JWT_SECRET", "SECRETS_MASTER_KEY", "OPS_TOKEN"].every(
        (n) => prop(map.get(n) ?? [], "generateValue", 8) === "true" && !env[n],
      ),
    ),
    checked(
      "Privy and existing provider secrets are deployment inputs",
      ["PRIVY_APP_ID", "PRIVY_APP_SECRET", "OPENROUTER_API_KEY"].every(
        (n) => prop(map.get(n) ?? [], "sync", 8) === "false" && !env[n],
      ),
    ),
    checked("Backup and recovery command", hasBackup),
    ...profileChecks(env, profile),
  ];
  return { profile, env, checks };
}
export async function apiChecks(endpoint, profile, fetcher = fetch) {
  let base;
  try {
    const u = new URL(endpoint);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !["/", "/v1", "/v1/"].includes(u.pathname)
    )
      throw Error();
    base = u.origin;
  } catch {
    return [checked("Valid HTTPS API origin", false)];
  }
  const queries = [
    [
      "/v1/ready",
      (d) =>
        d.ready === true &&
        d.storage === "postgres" &&
        d.execution === (profile === "live" ? "paper_and_mainnet" : "paper"),
    ],
    [
      "/v1/auth/config",
      (d) =>
        d.privy?.enabled === true &&
        required(d.privy.appId) &&
        d.devLogin === false,
    ],
  ];
  if (profile === "live")
    queries.push([
      "/v1/live/status",
      (d) =>
        d.enabled === true &&
        d.network === "mainnet" &&
        Array.isArray(d.venues) &&
        ["hyperliquid", "solana", "robinhood"].every((v) =>
          d.venues.includes(v),
        ),
    ]);
  const rows = [];
  for (const [path, test] of queries) {
    try {
      const r = await fetcher(new URL(path, base), {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: { accept: "application/json" },
      });
      rows.push(checked(path, r.ok && test(await r.json())));
    } catch {
      rows.push(checked(path, false));
    }
  }
  if (profile === "live") {
    const path = "/v1/live/account";
    try {
      const r = await fetcher(new URL(path, base), {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: { accept: "application/json" },
      });
      await r.body?.cancel();
      rows.push(
        checked(
          path + " rejects unsigned callers",
          r.status === 401 || r.status === 403,
        ),
      );
    } catch {
      rows.push(checked(path + " rejects unsigned callers", false));
    }
  }
  return rows;
}
export async function siteChecks(endpoint, profile, fetcher = fetch) {
  const site = origin(endpoint);
  if (!site) return [checked("Valid HTTPS Site origin", false)];
  if (profile !== "live") return apiChecks(site, "paper", fetcher);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetcher(new URL("/v1/live/status", site), {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (attempt === 0 && [502, 503, 504].includes(r.status)) {
        await r.body?.cancel();
        await new Promise((done) => setTimeout(done, 250));
        continue;
      }
      const v = await r.json();
      return [
        checked(
          "Website forwards to the mainnet API",
          r.ok && v.network === "mainnet" && v.enabled === true,
        ),
        checked(
          "Website production origin and venue location attest successfully",
          r.ok && v.originVerified === true,
        ),
      ];
    } catch {
      if (attempt === 0) continue;
    }
  }
  return [checked("Website to mainnet API with verified location", false)];
}
export async function railwayEdgeChecks(siteEndpoint, directEndpoint, profile, fetcher = fetch) {
  const site = origin(siteEndpoint), direct = origin(directEndpoint);
  if (!site || !direct || site === direct)
    return [checked("Separate HTTPS public and Railway origins", false)];
  const read = async (base, headers = {}) => {
    try {
      const response = await fetcher(new URL("/v1/live/status", base), {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { accept: "application/json", ...headers },
      });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  const [edge, bypass] = await Promise.all([
    read(site),
    read(direct, { origin: site, "cf-ipcountry": "DE", "x-quiver-origin-proof": "forged-release-probe" }),
  ]);
  const expectedEnabled = profile === "live";
  return [
    checked("Public domain proves location at the selected execution mode",
      edge?.network === "mainnet" && edge.enabled === expectedEnabled && edge.originVerified === true),
    checked("Direct Railway rejects forged location proof",
      bypass?.network === "mainnet" && bypass.enabled === expectedEnabled && bypass.originVerified === false),
  ];
}
export async function main(
  args,
  env,
  base = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."),
) {
  if (
    args.some(
      (a) =>
        a !== "--env" &&
        a !== "--railway" &&
        !a.startsWith("--api=") &&
        !a.startsWith("--profile=") &&
        !a.startsWith("--site=") &&
        !a.startsWith("--direct-origin="),
    ) ||
    args.filter((a) => a.startsWith("--api=")).length > 1 ||
    args.filter((a) => a.startsWith("--profile=")).length > 1 ||
    args.filter((a) => a.startsWith("--site=")).length > 1 ||
    args.filter((a) => a.startsWith("--direct-origin=")).length > 1
  ) {
    console.error(
      "Usage: node scripts/ops/preflight.mjs [--railway] [--env] [--profile=paper|live] [--api=https://host] [--site=https://website] [--direct-origin=https://railway]",
    );
    return 2;
  }
  const railway = args.includes("--railway");
  const api = args.find((a) => a.startsWith("--api="));
  const site = args.find((a) => a.startsWith("--site="));
  const direct = args.find((a) => a.startsWith("--direct-origin="));
  if ((direct && (!railway || !site)) || (railway && !api && !site && !args.includes("--env"))) {
    console.error("Select the Railway environment or a site to verify. A direct origin requires the public site.");
    return 2;
  }
  let spec;
  if (!railway) {
    try {
      spec = blueprintChecks(readFileSync(resolve(base, "render.yaml"), "utf8"), {
        hasBackup: existsSync(
          resolve(base, "services/backend/scripts/ops/database-backup.sh"),
        ),
      });
    } catch {
      console.error("FAIL Read release Blueprint");
      return 1;
    }
  }
  const explicit = args.find((a) => a.startsWith("--profile="))?.slice(10),
    profile = explicit ?? spec?.profile ?? "paper";
  if (!["paper", "live"].includes(profile)) {
    console.error("Select paper or live profile.");
    return 2;
  }
  const checks = spec ? [
    ...spec.checks,
    checked("Blueprint matches requested profile", profile === spec.profile),
  ] : [];
  if (args.includes("--env")) {
    checks.push(...environmentChecks(env, profile, spec?.env.QUIVER_EDGE_PUBLIC_KEY));
    if (railway && profile === "live") {
      const rpc = (value, publicHostname) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password && !url.hash && url.hostname !== publicHostname;
        } catch { return false; }
      };
      checks.push(
        checked("Jupiter server key", required(env.JUPITER_API_KEY)),
        checked("Dedicated Solana mainnet RPC", rpc(env.SOLANA_READ_RPC, "api.mainnet-beta.solana.com")),
        checked("Dedicated Robinhood mainnet RPC", rpc(env.MAINNET_READONLY_RPC_URL, "rpc.mainnet.chain.robinhood.com")),
      );
    }
  }
  if (api) checks.push(...(await apiChecks(api.slice(6), profile)));
  if (site) checks.push(...(await siteChecks(site.slice(7), profile)));
  if (site && direct) checks.push(...(await railwayEdgeChecks(site.slice(7), direct.slice(16), profile)));
  if (railway && profile === "live" && site && !direct)
    checks.push(checked("Direct Railway origin supplied for spoof protection check", false));
  for (const c of checks) console.log((c.ok ? "PASS " : "FAIL ") + c.label);
  return validOutput(checks) ? 0 : 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main(process.argv.slice(2), process.env);
