// PROTOTYPE — throwaway spike for "Does Knock hold up against Cadence?" (issue 32).
// Lives on branch prototype/knock-spike only. Never merge.
//
// Run: npm run dev, then open /prototype/knock-spike and switch users in the DevUI panel.
// Each section maps to one of the ticket's four checks, and every response is shown raw.
import { useCallback, useEffect, useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import Knock, { signUserToken } from "@knocklabs/node";
import { alias } from "drizzle-orm/sqlite-core";
import { and, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { Route } from "./+types/prototype.knock-spike";
import { db } from "~/db";
import {
  comments,
  courses,
  enrollments,
  lessons,
  modules,
  users,
} from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";

const knock = new Knock({ apiKey: process.env.KNOCK_API_KEY });

function knockUser(u: { id: number; name: string; email: string }) {
  return { id: String(u.id), name: u.name, email: u.email };
}

function recentReplies() {
  const question = alias(comments, "question");
  const asker = alias(users, "asker");
  const replier = alias(users, "replier");
  return db
    .select({
      replyId: comments.id,
      askerId: asker.id,
      askerName: asker.name,
      replierName: replier.name,
      lessonTitle: lessons.title,
    })
    .from(comments)
    .innerJoin(question, eq(question.id, comments.parentId))
    .innerJoin(asker, eq(asker.id, question.userId))
    .innerJoin(replier, eq(replier.id, comments.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .where(
      and(
        isNotNull(comments.parentId),
        isNull(comments.deletedAt),
        ne(comments.userId, question.userId)
      )
    )
    .orderBy(desc(comments.id))
    .limit(8)
    .all();
}

function recentEnrollments() {
  const student = alias(users, "student");
  const instructor = alias(users, "instructor");
  return db
    .select({
      enrollmentId: enrollments.id,
      studentName: student.name,
      instructorId: instructor.id,
      instructorName: instructor.name,
      courseTitle: courses.title,
    })
    .from(enrollments)
    .innerJoin(student, eq(student.id, enrollments.userId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(instructor, eq(instructor.id, courses.instructorId))
    .orderBy(desc(enrollments.id))
    .limit(8)
    .all();
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  const replies = recentReplies();
  const enrolls = recentEnrollments();
  if (!userId) return { user: null, replies, enrolls };

  const user = db.select().from(users).where(eq(users.id, userId)).get()!;
  // Identify on every load: the spike's stand-in for real user sync.
  await knock.users.update(String(user.id), {
    name: user.name,
    email: user.email,
  });
  const token = await signUserToken(String(user.id), {
    expiresInSeconds: 3600,
  });
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString()
  );
  const header = JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString()
  );
  return {
    user: { id: user.id, name: user.name, role: user.role },
    token,
    header,
    claims,
    publicKey: process.env.KNOCK_PUBLIC_API_KEY!,
    feedId: process.env.KNOCK_FEED_CHANNEL_ID!,
    replies,
    enrolls,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "reply") {
      const replyId = Number(form.get("replyId"));
      const reply = db.select().from(comments).where(eq(comments.id, replyId)).get()!;
      const question = db.select().from(comments).where(eq(comments.id, reply.parentId!)).get()!;
      const asker = db.select().from(users).where(eq(users.id, question.userId)).get()!;
      const replier = db.select().from(users).where(eq(users.id, reply.userId)).get()!;
      const ctx = db
        .select({ lessonTitle: lessons.title, slug: courses.slug })
        .from(lessons)
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .innerJoin(courses, eq(courses.id, modules.courseId))
        .where(eq(lessons.id, reply.lessonId))
        .get()!;
      const res = await knock.workflows.trigger("discussion-reply", {
        recipients: [knockUser(asker)],
        actor: knockUser(replier),
        data: {
          lesson_title: ctx.lessonTitle,
          reply_excerpt: reply.body.slice(0, 140),
          url: `/courses/${ctx.slug}/lessons/${reply.lessonId}#comment-${reply.id}`,
        },
      });
      return { intent, ok: true, recipient: asker.name, res };
    }
    if (intent === "enrollment") {
      const enrollmentId = Number(form.get("enrollmentId"));
      const e = db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).get()!;
      const course = db.select().from(courses).where(eq(courses.id, e.courseId)).get()!;
      const instructor = db.select().from(users).where(eq(users.id, course.instructorId)).get()!;
      const student = db.select().from(users).where(eq(users.id, e.userId)).get()!;
      const res = await knock.workflows.trigger("new-enrollment", {
        recipients: [knockUser(instructor)],
        actor: knockUser(student),
        data: { course_title: course.title, url: `/instructor/${course.id}/students` },
      });
      return { intent, ok: true, recipient: instructor.name, res };
    }
  } catch (err) {
    return { intent, ok: false, error: (err as Error).message };
  }
  return { intent, ok: false, error: "unknown intent" };
}

type Call = { label: string; status: number; body: unknown };

export default function KnockSpike({ loaderData }: Route.ComponentProps) {
  const data = loaderData;
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [feed, setFeed] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>(null);
  const [log, setLog] = useState<Call[]>([]);

  // Every Knock call below runs in the browser with the public key + signed user token.
  const call = useCallback(
    async (label: string, path: string, init: RequestInit = {}) => {
      if (!data.user) return null;
      const res = await fetch(`https://api.knock.app/v1${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${data.publicKey}`,
          "X-Knock-User-Token": data.token!,
          "Content-Type": "application/json",
        },
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      setLog((l) => [{ label, status: res.status, body }, ...l].slice(0, 12));
      return { status: res.status, body: body as any };
    },
    [data]
  );

  const uid = data.user ? String(data.user.id) : "";
  const loadFeed = useCallback(async () => {
    const r = await call("list feed", `/users/${uid}/feeds/${data.feedId}`);
    if (r) setFeed(r.body);
  }, [call, uid, data.feedId]);
  const loadPrefs = useCallback(async () => {
    const r = await call("get prefs", `/users/${uid}/preferences/default`);
    if (r) setPrefs(r.body);
  }, [call, uid]);

  useEffect(() => {
    setFeed(null);
    setPrefs(null);
    setLog([]);
    loadFeed();
    loadPrefs();
  }, [loadFeed, loadPrefs]);
  useEffect(() => {
    if (actionData?.ok) setTimeout(loadFeed, 1500);
  }, [actionData, loadFeed]);

  async function markMessages(status: string, ids: string[]) {
    await call(`batch ${status}`, `/messages/batch/${status}`, {
      method: "POST",
      body: JSON.stringify({ message_ids: ids }),
    });
    await loadFeed();
  }
  async function markAll(status: string) {
    await call(`bulk ${status}`, `/channels/${data.feedId}/messages/bulk/${status}`, {
      method: "POST",
      body: JSON.stringify({ user_ids: [uid] }),
    });
    setTimeout(loadFeed, 1500);
  }
  async function setEnrollmentPref(value: boolean | null) {
    const categories = { ...(prefs?.categories ?? {}) };
    if (value === null) delete categories["new-enrollment"];
    else categories["new-enrollment"] = { channel_types: { in_app_feed: value } };
    await call(`set new-enrollment=${value}`, `/users/${uid}/preferences/default`, {
      method: "PUT",
      body: JSON.stringify({ ...prefs, categories }),
    });
    await loadPrefs();
  }

  const pre = "text-xs bg-muted p-2 rounded overflow-auto max-h-64 whitespace-pre-wrap";
  const btn = "border rounded px-2 py-1 text-sm hover:bg-muted disabled:opacity-50";

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="rounded border-2 border-dashed border-amber-500 p-3 text-sm">
        <strong>PROTOTYPE</strong>: Knock spike for “Does Knock hold up against Cadence?”. Switch
        users in the DevUI panel, and the whole page re-runs as that user.
      </div>

      {!data.user ? (
        <p>No user selected. Pick one in the DevUI panel.</p>
      ) : (
        <>
          <section>
            <h2 className="font-bold">1 · Signed user token</h2>
            <p className="text-sm">
              {data.user.name} (#{data.user.id}, {data.user.role})
            </p>
            <pre className={pre}>{JSON.stringify({ header: data.header, claims: data.claims }, null, 2)}</pre>
            <button
              className={btn}
              onClick={() => call("cross-user feed (expect 403)", `/users/${data.user!.id === 1 ? 2 : 1}/feeds/${data.feedId}`)}
            >
              Try reading another user's feed with this token
            </button>
          </section>

          <section>
            <h2 className="font-bold">2 · Trigger (Node SDK, server-side)</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-semibold">Discussion Reply → question author</p>
                {data.replies.map((r) => (
                  <Form method="post" key={r.replyId}>
                    <input type="hidden" name="intent" value="reply" />
                    <input type="hidden" name="replyId" value={r.replyId} />
                    <button className={btn + " w-full text-left mt-1"} disabled={nav.state !== "idle"}>
                      {r.replierName} replied in “{r.lessonTitle}” → <b>{r.askerName}</b> (#{r.askerId})
                    </button>
                  </Form>
                ))}
              </div>
              <div>
                <p className="font-semibold">New Enrollment → Instructor (opt-in)</p>
                {data.enrolls.map((e) => (
                  <Form method="post" key={e.enrollmentId}>
                    <input type="hidden" name="intent" value="enrollment" />
                    <input type="hidden" name="enrollmentId" value={e.enrollmentId} />
                    <button className={btn + " w-full text-left mt-1"} disabled={nav.state !== "idle"}>
                      {e.studentName} enrolled in “{e.courseTitle}” → <b>{e.instructorName}</b> (#{e.instructorId})
                    </button>
                  </Form>
                ))}
              </div>
            </div>
            {actionData && <pre className={pre}>{JSON.stringify(actionData, null, 2)}</pre>}
          </section>

          <section>
            <h2 className="font-bold">3 · Headless feed (browser → Knock)</h2>
            <div className="flex gap-2 my-2">
              <button className={btn} onClick={loadFeed}>Refresh</button>
              <button className={btn} onClick={() => markAll("seen")}>Mark all seen</button>
              <button className={btn} onClick={() => markAll("read")}>Mark all read</button>
            </div>
            <p className="text-sm">
              unread: <b>{feed?.meta?.unread_count ?? "?"}</b> · unseen: <b>{feed?.meta?.unseen_count ?? "?"}</b> ·
              total: {feed?.meta?.total_count ?? "?"}
            </p>
            <ul className="text-sm space-y-1 mt-2">
              {(feed?.entries ?? []).map((m: any) => (
                <li key={m.id} className="border rounded p-2">
                  <div>
                    <b>{m.source?.key}</b> · {m.inserted_at} · seen:{String(!!m.seen_at)} read:{String(!!m.read_at)}
                  </div>
                  <div className="text-muted-foreground">
                    {(m.blocks ?? []).map((b: any) => b.rendered).join(" ").replace(/<[^>]+>/g, "")}
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button className={btn} onClick={() => markMessages("seen", [m.id])}>seen</button>
                    <button className={btn} onClick={() => markMessages("read", [m.id])}>read</button>
                    <button className={btn} onClick={() => markMessages("unread", [m.id])}>unread</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-bold">4 · Preferences (browser → Knock)</h2>
            <div className="flex gap-2 my-2">
              <button className={btn} onClick={() => setEnrollmentPref(true)}>Opt in to New Enrollment</button>
              <button className={btn} onClick={() => setEnrollmentPref(false)}>Opt out</button>
              <button className={btn} onClick={() => setEnrollmentPref(null)}>Clear (fall back to default)</button>
            </div>
            <pre className={pre}>{JSON.stringify(prefs, null, 2)}</pre>
          </section>

          <section>
            <h2 className="font-bold">Raw call log</h2>
            <pre className={pre}>{JSON.stringify(log, null, 2)}</pre>
          </section>
        </>
      )}
    </div>
  );
}
