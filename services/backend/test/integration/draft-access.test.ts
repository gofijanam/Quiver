import { afterEach, expect, it, vi } from "vitest";
import { CompileEvent, type CompileEvent as Frame } from "../../contracts/src/events";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { draftLimit } from "../../src/workflows/draft-access";
import { btcStrategy, T0 } from "../helpers";

const mint = "So11111111111111111111111111111111111111112";
const thesis = `Buy $25 of ${mint} on Solana now, once, with a $100 starting paper balance.`;
const day = 86_400_000;

afterEach(() => vi.unstubAllGlobals());

it("shares the rolling limit between compilation and saving without charging failed or repeated work", async () => {
  vi.stubGlobal("fetch", async () => Response.json([]));
  const clock = new ManualClock(T0);
  const q = createApp({ config: loadConfig({ DEV_LOGIN_ENABLED: "true", STRATEGY_DRAFT_ACCESS: "true" }), clock, autoTimers: false });
  const request = (path: string, data?: unknown, token?: string, method = data === undefined ? "GET" : "POST") =>
    q.app.request("/v1" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  const login = async (name: string) => (await (await request("/auth/exchange", { provider: "privy", idToken: `dev:quota-access-test-${name}` })).json() as { accessToken: string }).accessToken;
  const frames = async (r: Response): Promise<Frame[]> => (await r.text()).trim().split("\n").map((line) => CompileEvent.parse(JSON.parse(line)));
  try {
    expect((await request("/compile?workflow=1", { thesis })).status).toBe(401);
    expect((await request("/compile/image?workflow=1", {})).status).toBe(401);
    let token = await login("first");
    const quota = async () => (await request("/draft-access", undefined, token)).json();
    const compile = (data: unknown) => request("/compile?workflow=1", data, token);
    expect(await quota()).toMatchObject({ limit: 1, remaining: 1 });
    expect((await frames(await compile({ thesis: "hello" }))).at(-1)?.type).toBe("error");
    expect(await quota()).toMatchObject({ remaining: 1 });

    const first = await compile({ thesis });
    const concurrent = await compile({ thesis });
    expect([409, 429]).toContain(concurrent.status);
    const result = (await frames(first)).find((frame) => frame.type === "result");
    expect(result?.type).toBe("result");
    if (!result) throw new Error("Missing draft result");
    expect(await quota()).toMatchObject({ remaining: 0, resetsAt: new Date(T0 + day).toISOString() });
    expect((await compile({ thesis })).status).toBe(429);
    expect((await request("/strategies", { strategy: btcStrategy() }, token)).status).toBe(429);

    const edited = (await frames(await compile({ thesis, draftTarget: { compileId: result.compileId } }))).find((frame) => frame.type === "result");
    expect(edited?.compileId).toBe(result.compileId);
    const save = { strategy: result.strategy, compileId: result.compileId };
    const other = await login("other");
    expect((await request("/strategies", save, other)).status).toBe(404);
    const saved = await request("/strategies", save, token);
    expect(saved.status).toBe(201);
    const record = await saved.json() as { id: string; version: number };
    const retry = await request("/strategies", save, token);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: record.id });
    expect((await request(`/strategies/${record.id}`, { strategy: result.strategy, expectedVersion: record.version }, token, "PUT")).status).toBe(200);
    expect(await quota()).toMatchObject({ remaining: 0 });

    clock.advance(day);
    token = await login("first");
    expect(await quota()).toMatchObject({ remaining: 1, resetsAt: null });
  } finally { q.runs.shutdown(); }
});

it("qualifies only a verified wallet with at least 50,000 units of the configured mint", async () => {
  const wallet = "11111111111111111111111111111111";
  const user = { solanaWallets: [wallet] };
  let amount = "49999999999";
  let owner = wallet;
  const rpc = vi.fn(async () => Response.json({ result: { value: [{
    pubkey: "token-account",
    account: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { type: "account", info: { mint, owner, tokenAmount: { amount, decimals: 6 } } } } },
  }] } }));
  vi.stubGlobal("fetch", rpc);
  const config = loadConfig({ QUIVER_DRAFT_TOKEN_MINT: mint });
  expect(await draftLimit(user, loadConfig({}))).toBe(1);
  expect(rpc).not.toHaveBeenCalled();
  expect(await draftLimit(user, config)).toBe(1);
  amount = "50000000000";
  expect(await draftLimit(user, config)).toBe(5);
  expect(await draftLimit(user, loadConfig({ QUIVER_DRAFT_TOKEN_MINT: mint, QUIVER_DRAFT_HOLDER_LIMIT: "10" }))).toBe(10);
  owner = mint;
  expect(await draftLimit(user, config)).toBe(1);
});
