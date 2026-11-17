import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./saved.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";
import { MAX_NOTE_LENGTH } from "./notes";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfter(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];
let otherCourseLessonId: number;

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonIds = [1, 2, 3].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );

  const otherCourse = db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: "Another course.",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
  const otherModule = db
    .insert(schema.modules)
    .values({ courseId: otherCourse.id, title: "Intro", position: 1 })
    .returning()
    .get();
  otherCourseLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: otherModule.id, title: "Other Lesson", position: 1 })
    .returning()
    .get().id;
});

describe("toggling a Bookmark", () => {
  it("bookmarks a Lesson with no Bookmark, and un-bookmarks it on the next press", () => {
    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow();
    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates a Note with the body trimmed", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "  Rewatch 3:10  ", NOW);

    expect(result).toMatchObject({ ok: true });
    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Rewatch 3:10",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First thought", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Second thought", minutesAfter(5));

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Second thought",
      createdAt: NOW.toISOString(),
      updatedAt: minutesAfter(5).toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("keeps the body exactly as typed, Markdown characters included", () => {
    saveNote(db, base.user.id, lessonIds[0], "# not a heading\n*not bold*", NOW);

    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(
      "# not a heading\n*not bold*"
    );
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH),
      NOW
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a Note over 2,000 characters with a message, and stores nothing", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH + 1),
      NOW
    );

    expect(result).toEqual({
      ok: false,
      error: "A note must be 2,000 characters or fewer.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("deletes the Note when saved empty", () => {
    saveNote(db, base.user.id, lessonIds[0], "Something", NOW);

    expect(saveNote(db, base.user.id, lessonIds[0], "   ", minutesAfter(1))).toEqual({
      ok: true,
      note: null,
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
    expect(listNotes(db, base.user.id)).toEqual([]);
  });

  it("does nothing when an empty box is saved with no Note", () => {
    expect(saveNote(db, base.user.id, lessonIds[0], "", NOW)).toEqual({
      ok: true,
      note: null,
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });
});

describe("the Saved lists", () => {
  it("hold only the Student's own rows, newest first, with Lesson and Course", () => {
    const other = addStudent("Olive");
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, otherCourseLessonId, minutesAfter(1));
    toggleBookmark(db, other.id, lessonIds[1], minutesAfter(2));
    saveNote(db, base.user.id, otherCourseLessonId, "Older", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Newer", minutesAfter(1));
    saveNote(db, other.id, lessonIds[1], "Not mine", minutesAfter(2));

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      {
        lessonId: otherCourseLessonId,
        lessonTitle: "Other Lesson",
        courseTitle: "Other Course",
        courseSlug: "other-course",
      },
      {
        lessonId: lessonIds[0],
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
    ]);
    expect(listNotes(db, base.user.id)).toMatchObject([
      { body: "Newer", lessonId: lessonIds[0], courseTitle: "Test Course" },
      { body: "Older", lessonId: otherCourseLessonId, courseTitle: "Other Course" },
    ]);
  });

  it("put a re-saved Note back at the top", () => {
    saveNote(db, base.user.id, lessonIds[0], "First", NOW);
    saveNote(db, base.user.id, lessonIds[1], "Second", minutesAfter(1));
    saveNote(db, base.user.id, lessonIds[0], "First, edited", minutesAfter(2));

    expect(listNotes(db, base.user.id).map((note) => note.body)).toEqual([
      "First, edited",
      "Second",
    ]);
  });
});

describe("approving a Refund", () => {
  it("keeps the Student's Bookmarks and Notes", async () => {
    const platformAdmin = db
      .insert(schema.users)
      .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: NOW.toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    saveNote(db, base.user.id, lessonIds[0], "Keep me", NOW);

    const notifications = fakeNotifications();
    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "Not for me.",
      NOW,
      notifications
    );
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      platformAdmin.id,
      null,
      NOW,
      notifications
    );

    expect(approved.ok).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);
    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe("Keep me");
  });
});
