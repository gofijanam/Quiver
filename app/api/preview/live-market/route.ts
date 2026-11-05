import {
  spotObservation,
  wrappedSol,
} from "@/services/backend/src/venues/solana-price";
import { marketJson } from "@/services/backend/src/compile/markets";
import { robinhoodReference } from "@/services/backend/src/venues/stock-reference";
import { hyperliquidBook } from "@/lib/live-market-data";
import { previewJson } from "@/lib/preview/server";
const positive = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;
function distance(t: number) {
  return Date.now() - t;
}
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams,
    venue = q.get("venue") ?? "hyperliquid",
    symbol = (
      q.get("symbol") ??
      (venue === "robinhood" ? "NVDA" : venue === "solana" ? "SOL" : "BTC")
    ).toUpperCase();
  try {
    if (venue === "hyperliquid") {
      if (!["BTC", "ETH", "SOL", "XMR"].includes(symbol))
        return previewJson({ message: "Unknown perpetual." }, 422);
      const b = (await marketJson(
        "https://api.hyperliquid.xyz/info",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "l2Book", coin: symbol }),
        },
        4000,
      )) as {
        coin: string;
        time: number;
        levels: { px: string; sz: string }[][];
      };
      const book = hyperliquidBook(b, symbol);
      if (!book) throw Error("Invalid venue order book");
      return previewJson({ venue, ...book });
    }
    if (venue === "solana") {
      if (symbol !== "SOL")
        return previewJson({ message: "Unknown spot market." }, 422);
      const observation = await spotObservation(wrappedSol, (url, init) =>
        marketJson(url, init, 8000),
      ).catch(async () => {
        // A labeled external reference is only for the watch panel. It cannot trigger or settle a trade.
        const ticker = (await marketJson(
          "https://api.exchange.coinbase.com/products/SOL-USD/ticker",
          undefined,
          6000,
        )) as { price: string; time: string; trade_id: number };
        const at = Date.parse(ticker.time);
        if (
          !positive(ticker.price) ||
          !(ticker.trade_id > 0) ||
          !Number.isFinite(at) ||
          distance(at) > 90000 ||
          distance(at) < -3000
        )
          throw Error("Stale reference");
        return {
          price: Number(ticker.price),
          at,
          source: "Coinbase SOL/USD reference",
          referencePair: "SOL/USD",
        };
      });
      return previewJson({
        venue,
        symbol,
        address: wrappedSol,
        ...observation,
      });
    }
    if (venue === "robinhood") {
      if (!["NVDA", "AAPL", "TSLA", "SPY"].includes(symbol))
        return previewJson({ message: "Unknown equity." }, 422);
      const reference = await robinhoodReference(symbol, (url, init) =>
        marketJson(url, init, 8000),
      );
      return previewJson({ venue, symbol, ...reference });
    }
    return previewJson({ message: "Unknown venue." }, 422);
  } catch {
    return previewJson(
      { message: "A current venue observation is unavailable." },
      503,
    );
  }
}
