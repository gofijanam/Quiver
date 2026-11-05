import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { proxyApi } from "../lib/api-proxy";
import { verifiedEdgeCountry } from "../services/backend/src/execution/live-region";
import edge from "../worker/railway-edge";

const site = "https://quiver.example";
const railway = "https://quiver-web.up.railway.app";
const engine = "http://quiver-engine.railway.internal:10000/v1";
const path = "/v1/live/status?verify=1";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const env = {
  QUIVER_PUBLIC_ORIGIN: site,
  QUIVER_RAILWAY_ORIGIN: railway,
  QUIVER_EDGE_SIGNING_KEY: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
};
const verificationKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
process.env.PUBLIC_BASE_URL = site;
process.env.QUIVER_RAILWAY_PRIVATE = "1";
process.env.QUIVER_EXTERNAL_EDGE_ATTESTATION = "1";

async function engineRequest(request: Request) {
  return proxyApi(request, ["live", "status"], engine, async (url, init) => {
    const received = new Request(url, init);
    const country = verifiedEdgeCountry(received, site, verificationKey, Date.now());
    return Response.json({ country });
  });
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => engineRequest(new Request(input, init));
try {
  const signed = new Request(site + path, { headers: { "x-quiver-origin-proof": "forged", authorization: "Bearer release-check" } });
  Object.defineProperty(signed, "cf", { value: { country: "DE" } });
  assert.deepEqual(await (await edge.fetch(signed, env)).json(), { country: "DE" });
  const unknown = new Request(site + path, { headers: { "x-quiver-origin-proof": "forged" } });
  assert.deepEqual(await (await edge.fetch(unknown, env)).json(), { country: null });
  const direct = new Request(railway + path, { headers: { "x-quiver-origin-proof": "forged", "cf-ipcountry": "DE" } });
  assert.deepEqual(await (await engineRequest(direct)).json(), { country: null });
  assert.equal((await edge.fetch(new Request("https://wrong.example" + path), env)).status, 503);
  console.log("PASS Railway edge signature, scope, unknown country and direct-request rejection.");
} finally {
  globalThis.fetch = nativeFetch;
}
