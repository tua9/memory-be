import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildTimeline,
    getTimelineRanges,
    summarizeSessions,
    type TimelineSession,
} from "../src/services/timeline.service.js";

// Mốc thời gian viết theo giờ Việt Nam cho dễ đọc
const vn = (dateTime: string) => new Date(`${dateTime}+07:00`);
const iso = (dateTime: string) => vn(dateTime).toISOString();

const session = (overrides: Partial<TimelineSession>): TimelineSession => ({
    gameName: "card",
    completedAt: vn("2026-10-21T10:00:00"),
    gameLevel: 1,
    totalItems: 10,
    correctItems: 10,
    result: "perfect",
    durationSec: 60,
    ...overrides,
});

test("weekly ranges cover the 8 weeks up to the current one, starting on Monday in Vietnam time", () => {
    const { buckets, range, previousRange } = getTimelineRanges("week", vn("2026-10-21T10:00:00"));
    assert.equal(buckets.length, 8);
    assert.equal(range.start.toISOString(), iso("2026-08-31T00:00:00"));
    assert.equal(range.end.toISOString(), iso("2026-10-26T00:00:00"));
    assert.equal(buckets[7].start.toISOString(), iso("2026-10-19T00:00:00"));
    assert.deepEqual(previousRange, { start: vn("2026-07-06T00:00:00"), end: range.start });
    buckets.slice(1).forEach((bucket, index) => assert.deepEqual(bucket.start, buckets[index].end));
});

test("the current week follows the Vietnam calendar on Sunday night and Monday morning", () => {
    assert.equal(
        getTimelineRanges("week", vn("2026-10-25T23:30:00")).buckets[7].start.toISOString(),
        iso("2026-10-19T00:00:00"),
    );
    // 00:30 thứ Hai ở Việt Nam vẫn là Chủ nhật theo UTC
    assert.equal(
        getTimelineRanges("week", new Date("2026-10-25T17:30:00Z")).buckets[7].start.toISOString(),
        iso("2026-10-26T00:00:00"),
    );
});

test("monthly ranges cover the 6 months up to the current one, across year boundaries", () => {
    const october = getTimelineRanges("month", vn("2026-10-24T10:00:00"));
    assert.equal(october.buckets.length, 6);
    assert.equal(october.range.start.toISOString(), iso("2026-05-01T00:00:00"));
    assert.equal(october.range.end.toISOString(), iso("2026-11-01T00:00:00"));
    assert.equal(october.previousRange.start.toISOString(), iso("2025-11-01T00:00:00"));

    const february = getTimelineRanges("month", vn("2026-02-10T10:00:00"));
    assert.equal(february.range.start.toISOString(), iso("2025-09-01T00:00:00"));
    assert.equal(february.buckets[5].start.toISOString(), iso("2026-02-01T00:00:00"));
});

test("summary weighs accuracy by item count and ignores custom rounds for the best level", () => {
    assert.deepEqual(
        summarizeSessions([
            session({ totalItems: 10, correctItems: 10, gameLevel: 2, durationSec: 50 }),
            session({ totalItems: 30, correctItems: 15, gameLevel: null, result: "fail", durationSec: 100 }),
        ]),
        { played: 2, accuracy: 25 / 40, bestLevel: 2, perfectCount: 1, durationSec: 150 },
    );
    assert.deepEqual(summarizeSessions([]), {
        played: 0,
        accuracy: null,
        bestLevel: null,
        perfectCount: 0,
        durationSec: 0,
    });
});

test("sessions are grouped into weekly buckets per game and compared with the previous period", () => {
    const ranges = getTimelineRanges("week", vn("2026-10-21T10:00:00"));
    const sessions = [
        session({ completedAt: vn("2026-10-19T00:00:00"), correctItems: 8, result: "pass" }),
        session({ completedAt: vn("2026-10-21T09:00:00"), gameName: "image", gameLevel: 3 }),
        session({ completedAt: vn("2026-10-18T23:59:59") }),
        session({ completedAt: vn("2026-08-01T12:00:00"), result: "fail", correctItems: 2 }),
        // Ngoài cả hai khoảng thời gian
        session({ completedAt: vn("2026-06-01T12:00:00") }),
        session({ completedAt: vn("2026-10-26T00:00:00") }),
    ];
    const timeline = buildTimeline({ period: "week", game: "all", ranges, sessions });

    assert.equal(timeline.timeZone, "Asia/Ho_Chi_Minh");
    assert.deepEqual(timeline.buckets[7].byGame, {
        card: { played: 1, accuracy: 0.8 },
        image: { played: 1, accuracy: 1 },
    });
    assert.deepEqual(timeline.buckets[6].byGame.card, { played: 1, accuracy: 1 });
    assert.deepEqual(timeline.buckets[0].byGame.card, { played: 0, accuracy: null });
    assert.equal(timeline.summary.played, 3);
    assert.equal(timeline.summary.bestLevel, 3);
    assert.equal(timeline.previousSummary.played, 1);
    assert.equal(timeline.previousSummary.accuracy, 0.2);
});

test("a game filter keeps only that game in buckets and summaries", () => {
    const ranges = getTimelineRanges("week", vn("2026-10-21T10:00:00"));
    const timeline = buildTimeline({
        period: "week",
        game: "image",
        ranges,
        sessions: [session({}), session({ gameName: "image", correctItems: 5, result: "fail" })],
    });
    assert.equal(timeline.summary.played, 1);
    assert.equal(timeline.summary.accuracy, 0.5);
    assert.deepEqual(timeline.buckets[7].byGame.card, { played: 0, accuracy: null });
});
