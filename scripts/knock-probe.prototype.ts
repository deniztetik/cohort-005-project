// PROTOTYPE: throwaway probe for "Does Knock hold up against Cadence?" (issue 32).
// Run: npx tsx --env-file=.env scripts/knock-probe.prototype.ts
import Knock, { signUserToken } from "@knocklabs/node";

const knock = new Knock({ apiKey: process.env.KNOCK_API_KEY });
const base = "https://api.knock.app/v1";
const feedId = process.env.KNOCK_FEED_CHANNEL_ID!;
const pub = process.env.KNOCK_PUBLIC_API_KEY!;

async function asUser(userId: string, path: string, init: RequestInit = {}) {
  const token = await signUserToken(userId);
  const res = await fetch(base + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${pub}`,
      "X-Knock-User-Token": token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 600) };
}

const a = "probe-a";
const b = "probe-b";
await knock.users.update(a, { name: "Probe A", email: "probe-a@example.com" });
await knock.users.update(b, { name: "Probe B", email: "probe-b@example.com" });

console.log("feed A with A's token:", await asUser(a, `/users/${a}/feeds/${feedId}`));
// Cross-user: A's token asking for B's feed must be refused.
const tokenA = await signUserToken(a);
const cross = await fetch(`${base}/users/${b}/feeds/${feedId}`, {
  headers: { Authorization: `Bearer ${pub}`, "X-Knock-User-Token": tokenA },
});
console.log("feed B with A's token:", cross.status);
const none = await fetch(`${base}/users/${a}/feeds/${feedId}`, {
  headers: { Authorization: `Bearer ${pub}` },
});
console.log("feed A with no token:", none.status);

try {
  const r = await knock.workflows.trigger("discussion-reply", {
    recipients: [a],
    actor: b,
    data: { probe: true },
  });
  console.log("trigger discussion-reply:", r);
} catch (e) {
  console.log("trigger discussion-reply failed:", (e as Error).message);
}

console.log("prefs A (as A):", await asUser(a, `/users/${a}/preferences/default`));
