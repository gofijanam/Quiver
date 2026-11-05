import { z } from "zod";
import type { Config } from "../config";
import type { User } from "../store";

const WINDOW = 86_400_000;
const HOLDER_MIN = 50_000n;
const TokenAccounts = z.object({ result: z.object({ value: z.array(z.object({
  pubkey: z.string(),
  account: z.object({
    owner: z.enum(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]),
    data: z.object({ parsed: z.object({ type: z.literal("account"), info: z.object({
      mint: z.string(), owner: z.string(),
      tokenAmount: z.object({ amount: z.string().regex(/^\d{1,20}$/), decimals: z.number().int().min(0).max(255) }),
    }) }) }),
  }),
})) }) });

export async function draftLimit(user: Pick<User, "solanaWallets">, config: Config): Promise<number> {
  const mint = config.QUIVER_DRAFT_TOKEN_MINT;
  if (!mint || !user.solanaWallets?.length) return 1;
  const rpc = config.SOLANA_READ_RPC ?? "https://api.mainnet-beta.solana.com";
  const qualified = await Promise.all(user.solanaWallets.map(async (wallet) => {
    try {
      const response = await fetch(rpc, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(4000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [wallet, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }] }),
      });
      if (!response.ok) return false;
      const { result } = TokenAccounts.parse(await response.json());
      const seen = new Set<string>();
      const decimals = result.value[0]?.account.data.parsed.info.tokenAmount.decimals ?? 0;
      let amount = 0n;
      for (const { pubkey, account } of result.value) {
        const info = account.data.parsed.info;
        if (seen.has(pubkey) || info.owner !== wallet || info.mint !== mint || info.tokenAmount.decimals !== decimals) return false;
        seen.add(pubkey);
        amount += BigInt(info.tokenAmount.amount);
      }
      return amount >= HOLDER_MIN * 10n ** BigInt(decimals);
    } catch { return false; }
  }));
  return qualified.some(Boolean) ? config.QUIVER_DRAFT_HOLDER_LIMIT : 1;
}

export function draftUsage(user: User, limit: number, now: number) {
  const timestamps = (user.draftCreations ?? []).map(({ at }) => at).filter((at) => at > now - WINDOW).sort((a, b) => a - b);
  return {
    limit, remaining: Math.max(0, limit - timestamps.length),
    resetsAt: timestamps.length >= limit ? new Date(timestamps[timestamps.length - limit] + WINDOW).toISOString() : null,
  };
}

export function recordDraft(user: User, at: number, compileId?: string) {
  const entry = { at, compileId };
  // Unsaved drafts keep their receipt so a later save can reuse the original creation.
  user.draftCreations = [...(user.draftCreations ?? []).filter((row) => row.compileId || row.at > at - WINDOW), entry];
  return entry;
}
