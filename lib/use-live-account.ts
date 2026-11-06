"use client";
import { useEffect } from "react";
import { API_MODE } from "./api";
import { useQ } from "./api/useQ";
import { connected, type Account } from "./live-client";

export function useLiveAccount() {
  const production = API_MODE === "live";
  const account = useQ(
    () => (production ? connected<Account>("/account") : Promise.resolve(null)),
    [production],
  );
  const service = useQ(async () => {
    if (!production) return null;
    const response = await fetch("/v1/live/status", { cache: "no-store" });
    if (!response.ok) throw Error("Live status unavailable.");
    return (await response.json()) as { enabled?: boolean; originVerified?: boolean };
  }, [production]);
  const signedIn = !!account.data;
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(() => {
      account.reload();
      service.reload();
    }, 20000);
    return () => clearInterval(timer);
  }, [signedIn]);
  let activationBlocked: string | null = null;
  if (!production)
    activationBlocked = "Real orders open when production trading is connected.";
  else if (service.error)
    activationBlocked = "Live order status is temporarily unavailable.";
  else if (!service.data)
    activationBlocked = "Checking live order access…";
  else if (service.data.enabled !== true)
    activationBlocked = "This deployment is currently open for paper trading.";
  else if (service.data.originVerified !== true)
    activationBlocked = "Open Quiver on its verified trading domain to authorize real orders.";
  return { account, production, enabled: activationBlocked === null, activationBlocked };
}
