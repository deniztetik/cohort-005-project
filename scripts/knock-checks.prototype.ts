// PROTOTYPE: runs the four checks of "Does Knock hold up against Cadence?" (issue 32)
// end to end against Knock Development, using real Cadence rows from data.db.
// Run: npx tsx --env-file=.env scripts/knock-checks.prototype.ts
import Database from "better-sqlite3";
import Knock, { signUserToken } from "@knocklabs/node";

const db = new Database("data.db", { readonly: true });
const knock = new Knock({ apiKey: process.env.KNOCK_API_KEY });
const API = "https://api.knock.app/v1";
const FEED = process.env.KNOCK_FEED_CHANNEL_ID!;
const PUB = process.env.KNOCK_PUBLIC_API_KEY!;
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Client-side call: public key + signed user token, exactly what the browser does.
async function asUser(userId: string, path: string, init: RequestInit = {}, token?: string) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${PUB}`,
      "X-Knock-User-Token": token ?? (await signUserToken(userId)),
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}
const feedOf = (id: string) => asUser(id, `/users/${id}/feeds/${FEED}`);
async function waitForFeed(id: string, pred: (f: any) => boolean, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const f = (await feedOf(id)).body;
    if (pred(f)) return f;
    await sleep(1000);
  }
  return (await feedOf(id)).body;
}
type U = { id: number; name: string; email: string };
const ku = (u: U) => ({ id: String(u.id), name: u.name, email: u.email });

// ── Real data ───────────────────────────────────────────────────────────────
const reply = db.prepare(`
  select r.id as replyId, r.body, a.id as askerId, a.name as askerName, a.email as askerEmail,
         p.id as replierId, p.name as replierName, p.email as replierEmail, l.title as lessonTitle
  from comments r join comments q on q.id = r.parent_id
  join users a on a.id = q.user_id join users p on p.id = r.user_id
  join lessons l on l.id = r.lesson_id
  where r.parent_id is not null and r.deleted_at is null and r.user_id != q.user_id
  order by r.id desc limit 1`).get() as any;
const enr = db.prepare(`
  select s.id as sId, s.name as sName, s.email as sEmail, i.id as iId, i.name as iName,
         i.email as iEmail, c.title as courseTitle, c.id as courseId
  from enrollments e join users s on s.id = e.user_id join courses c on c.id = e.course_id
  join users i on i.id = c.instructor_id order by e.id desc limit 1`).get() as any;
const asker: U = { id: reply.askerId, name: reply.askerName, email: reply.askerEmail };
const replier: U = { id: reply.replierId, name: reply.replierName, email: reply.replierEmail };
const instructor: U = { id: enr.iId, name: enr.iName, email: enr.iEmail };
const student: U = { id: enr.sId, name: enr.sName, email: enr.sEmail };
console.log(`Reply #${reply.replyId}: ${replier.name} → ${asker.name} in "${reply.lessonTitle}"`);
console.log(`Enrollment: ${student.name} → "${enr.courseTitle}" (Instructor ${instructor.name})\n`);
for (const u of [asker, replier, instructor, student]) await knock.users.update(String(u.id), ku(u));
const A = String(asker.id), R = String(replier.id), I = String(instructor.id);

// ── 1. Signed user tokens ───────────────────────────────────────────────────
const tokA = await signUserToken(A);
const hdr = JSON.parse(Buffer.from(tokA.split(".")[0], "base64url").toString());
check("1a token is RS256", hdr.alg === "RS256", hdr.alg);
check("1b own token reads own feed", (await feedOf(A)).status === 200);
const cross = await asUser(R, `/users/${R}/feeds/${FEED}`, {}, tokA);
check("1c asker's token refused on replier's feed", cross.status === 403, `HTTP ${cross.status}`);
const noTok = await fetch(`${API}/users/${A}/feeds/${FEED}`, { headers: { Authorization: `Bearer ${PUB}` } });
check("1d no token refused", noTok.status >= 400, `HTTP ${noTok.status}`);

// ── 2. Trigger a real Discussion Reply ──────────────────────────────────────
const before = (await feedOf(A)).body.meta.total_count;
const trig = await knock.workflows.trigger("discussion-reply", {
  recipients: [ku(asker)], actor: ku(replier),
  data: { lesson_title: reply.lessonTitle, url: `/lessons/${reply.replyId}` },
});
const afterFeed = await waitForFeed(A, (f) => f.meta.total_count > before);
const item = afterFeed.entries[0];
check("2a Node SDK trigger accepted", !!trig.workflow_run_id, trig.workflow_run_id);
check("2b reply appears in question author's feed", afterFeed.meta.total_count > before,
  item?.blocks?.[0]?.rendered?.replace(/<[^>]+>/g, "").trim());
const rFeed = (await feedOf(R)).body;
check("2c ...and not in the replier's feed",
  !rFeed.entries.some((e: any) => e.id === item?.id));

// ── 3. Headless feed API ────────────────────────────────────────────────────
check("3a list items", Array.isArray(afterFeed.entries), `${afterFeed.entries.length} entries`);
const unread0 = afterFeed.meta.unread_count, unseen0 = afterFeed.meta.unseen_count;
check("3b unread + unseen counts", typeof unread0 === "number" && typeof unseen0 === "number",
  `unread ${unread0}, unseen ${unseen0}`);
const seen = await asUser(A, `/messages/batch/seen`, { method: "POST", body: JSON.stringify({ message_ids: [item.id] }) });
const read = await asUser(A, `/messages/batch/read`, { method: "POST", body: JSON.stringify({ message_ids: [item.id] }) });
const f3 = (await feedOf(A)).body;
const it3 = f3.entries.find((e: any) => e.id === item.id);
check("3c mark one seen (user token)", seen.status === 200 && !!it3?.seen_at, `HTTP ${seen.status}, unseen now ${f3.meta.unseen_count}`);
check("3d mark one read (user token)", read.status === 200 && !!it3?.read_at, `HTTP ${read.status}, unread now ${f3.meta.unread_count}`);
const unr = await asUser(A, `/messages/batch/unread`, { method: "POST", body: JSON.stringify({ message_ids: [item.id] }) });
check("3e mark unread again", unr.status === 200, `HTTP ${unr.status}`);
const all = await asUser(A, `/channels/${FEED}/messages/bulk/read`, { method: "POST", body: JSON.stringify({ user_ids: [A] }) });
const fAll = await waitForFeed(A, (f) => f.meta.unread_count === 0, 6);
check("3f mark all read (user token)", fAll.meta.unread_count === 0, `HTTP ${all.status}, unread now ${fAll.meta.unread_count}`);
// Batch endpoints answer 200 but silently skip messages the token doesn't own,
// so judge by effect, not status.
await asUser(A, `/messages/batch/unread`, { method: "POST", body: JSON.stringify({ message_ids: [item.id] }) });
const steal = await asUser(R, `/messages/batch/read`, { method: "POST", body: JSON.stringify({ message_ids: [item.id] }) });
await sleep(1500);
const after3g = (await feedOf(A)).body.entries.find((e: any) => e.id === item.id);
check("3g replier can't mark the asker's message", !after3g?.read_at,
  `HTTP ${steal.status}, updated ${JSON.stringify(steal.body)}, still unread`);

// ── 4. Off-by-default, opt-in New Enrollment ────────────────────────────────
const enrData = { course_title: enr.courseTitle, url: `/instructor/${enr.courseId}/students` };
await asUser(I, `/users/${I}/preferences/default`, { method: "PUT", body: JSON.stringify({}) }); // fresh: no choice made
const i0 = (await feedOf(I)).body.meta.total_count;
await knock.workflows.trigger("new-enrollment", { recipients: [ku(instructor)], actor: ku(student), data: enrData });
await sleep(4000);
const i1 = (await feedOf(I)).body.meta.total_count;
check("4a off by default: Instructor gets nothing", i1 === i0, `${i0} → ${i1}`);
const optIn = await asUser(I, `/users/${I}/preferences/default`, {
  method: "PUT", body: JSON.stringify({ categories: { "new-enrollment": true } }),
});
check("4b Instructor opts in with their own token", optIn.status === 200, `HTTP ${optIn.status}`);
await knock.workflows.trigger("new-enrollment", { recipients: [ku(instructor)], actor: ku(student), data: enrData });
const i2f = await waitForFeed(I, (f) => f.meta.total_count > i1);
check("4c after opt-in the Enrollment arrives", i2f.meta.total_count > i1,
  i2f.entries[0]?.blocks?.[0]?.rendered?.replace(/<[^>]+>/g, "").trim());
const optInOther = await asUser(I, `/users/${A}/preferences/default`, {
  method: "PUT", body: JSON.stringify({ categories: { "new-enrollment": true } }),
});
check("4d can't change someone else's preferences", optInOther.status >= 400, `HTTP ${optInOther.status}`);
// Leave the Instructor opted out again so the spike page starts clean.
await asUser(I, `/users/${I}/preferences/default`, { method: "PUT", body: JSON.stringify({}) });

console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
