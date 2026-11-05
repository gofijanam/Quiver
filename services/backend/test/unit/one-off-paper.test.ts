import { expect, it } from "vitest";
import { Workflow } from "../../contracts/src/workflow";
import { oneOffPaperDraft } from "../../src/compile/one-off-paper";

it("preserves the exact market, order and budget of an immediate Paper buy", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const prompt = `Buy $25 of ${mint} on Solana now, once, with a $100 starting paper balance.`;
  const draft = Workflow.parse(oneOffPaperDraft(prompt));
  expect(draft.assets[0]).toMatchObject({ query: mint, venue: "solana" });
  expect(draft.budgetUsd).toBe(100);
  expect(draft.stages[0]).toMatchObject({ amount: { unit: "usd", value: 25 }, when: null, repeat: null });
  expect(oneOffPaperDraft(prompt + " Sell at a 5% loss.")).toBeNull();
});
