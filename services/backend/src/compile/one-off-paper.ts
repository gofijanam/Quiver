import type { Workflow } from "../../contracts/src/workflow";
import { canonicalSymbol } from "./markets";

/** Handles an explicit immediate purchase with its own virtual balance. */
export function oneOffPaperDraft(text: string): Workflow | null {
  const match = /^buy\s+\$\s*(\d+(?:\.\d+)?)\s+(?:of\s+)?([a-z0-9.-]{1,44})\s+on\s+(Solana|Robinhood Chain)\s+now(?:,?\s+once)?,?\s+with\s+(?:a\s+)?\$\s*(\d+(?:\.\d+)?)\s+(?:starting\s+)?(?:paper|virtual)\s+(?:balance|budget)\.?$/i.exec(text.trim());
  if (!match) return null;
  const [, order, asset, venueName, budget] = match;
  const size = Number(order);
  const budgetUsd = Number(budget);
  if (!(size > 0 && budgetUsd > 0 && budgetUsd <= 1e12 && size <= 1e12)) return null;
  const venue = venueName.toLowerCase() === "solana" ? "solana" : "robinhood";
  const isMint = venue === "solana" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(asset);
  const query = isMint ? asset : canonicalSymbol(asset);
  const name = `Buy ${query}`;
  return {
    version: 1,
    name,
    summary: `Buy $${size} of ${query} once with a $${budgetUsd} paper balance.`,
    budgetUsd,
    assets: [{ id: "asset", query, sourceText: asset, venue, kind: "token", outcome: null }],
    signals: [],
    stages: [{
      id: "entry", assetId: "asset", side: "buy", sourceText: text.trim(),
      conditionText: "On start", when: null, after: [], amount: { unit: "usd", value: size },
      leverage: 1, funding: { kind: "budget", from: [] }, repeat: null,
      exits: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null, timeExitHours: null, ladder: [], description: "" },
    }],
    questions: [],
    assumptions: [],
  };
}
