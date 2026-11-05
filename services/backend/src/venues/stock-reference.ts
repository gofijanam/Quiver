import { robinhoodIssuerCandidate, ROBINHOOD_ISSUER_ASSETS } from "../compile/robinhood-assets";
import pins from "../../config/verified/4663-readonly.json";

type Get = (url: string, init?: RequestInit) => Promise<unknown>;
export async function robinhoodReference(symbol: string, get: Get) {
  const issuer = robinhoodIssuerCandidate(await get(ROBINHOOD_ISSUER_ASSETS), symbol);
  if (!issuer) throw new Error("Unverified Robinhood stock token.");
  const base = { address: issuer.address, at: Date.now(), source: "Robinhood issuer registry", price: null };
  const pin = pins.feeds.find((f) => f.symbol === symbol && f.chainId === 4663);
  if (!pin) return base;
  const rpc = async (method: string, params: unknown[]) => {
    const response = await get("https://rpc.mainnet.chain.robinhood.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }) as { result?: string };
    return response.result;
  };
  try {
    const [chain, round] = await Promise.all([
      rpc("eth_chainId", []),
      rpc("eth_call", [{ to: pin.proxy, data: "0xfeaf968c" }, "latest"]),
    ]);
    if (!chain || BigInt(chain) !== 4663n || !round || !/^0x[0-9a-fA-F]{320}$/.test(round))
      return base;
    const word = (i: number) => BigInt("0x" + round.slice(2 + i * 64, 66 + i * 64));
    const raw = BigInt.asIntN(256, word(1));
    const at = Number(word(3)) * 1000;
    const age = Date.now() - at;
    if (raw <= 0n || word(4) < word(0) || age > pin.heartbeatSec * 1000 || age < -3000)
      return base;
    return { ...base, price: Number(raw) / 10 ** pin.decimals, at, source: "Chainlink underlying reference · chain 4663" };
  } catch {
    return base;
  }
}
