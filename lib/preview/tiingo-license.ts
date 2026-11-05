export function sharedTiingoKey(): string | undefined {
  if (process.env.NODE_ENV === "production" &&
      process.env.QUIVER_TIINGO_REDISTRIBUTION_LICENSED !== "true") {
    return undefined;
  }
  return process.env.TIINGO_API_KEY;
}
