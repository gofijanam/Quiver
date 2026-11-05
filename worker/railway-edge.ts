import { attestEdge, withEdgeLocation } from "../lib/edge-attestation";

type Environment = {
  QUIVER_PUBLIC_ORIGIN: string;
  QUIVER_RAILWAY_ORIGIN: string;
  QUIVER_EDGE_SIGNING_KEY: string;
};

export default {
  async fetch(request: Request & { cf?: { country?: string } }, env: Environment): Promise<Response> {
    const site = new URL(env.QUIVER_PUBLIC_ORIGIN);
    const upstream = new URL(env.QUIVER_RAILWAY_ORIGIN);
    const incoming = new URL(request.url);
    if (site.protocol !== "https:" || incoming.origin !== site.origin ||
        upstream.protocol !== "https:" ||
        !/^[a-z0-9-]+\.up\.railway\.app$/.test(upstream.hostname) ||
        upstream.origin === site.origin || upstream.username || upstream.password) {
      return new Response("Quiver edge origin is unavailable.", { status: 503 });
    }

    // Set pathname rather than resolving a potentially protocol-relative input.
    upstream.pathname = incoming.pathname;
    upstream.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("x-quiver-origin-proof");
    if (incoming.pathname.startsWith("/v1/")) {
      await withEdgeLocation(request.cf?.country, env.QUIVER_EDGE_SIGNING_KEY,
        () => attestEdge(headers, upstream, request.method, site.origin));
    }
    return fetch(upstream, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });
  },
};
