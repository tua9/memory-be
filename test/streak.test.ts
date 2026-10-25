import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createEmptyStreak,
    getStreakStatus,
    recordPlayDay,
    type StreakState,
} from "../src/services/streak.service.js";
import { addDaysToDateKey, toDateKey } from "../src/utils/date.js";

// Mốc thời gian viết theo giờ Việt Nam cho dễ đọc
const vn = (dateTime: string) => new Date(`${dateTime}+07:00`);

test("date keys follow the Vietnam calendar day, not UTC", () => {
    // 06:30 sáng 24/10 ở Việt Nam vẫn là 23:30 ngày 23/10 theo UTC
    assert.equal(toDateKey(new Date("2026-10-23T23:30:00Z"), "Asia/Ho_Chi_Minh"), "2026-10-24");
    assert.equal(toDateKey(vn("2026-10-24T23:59:59"), "Asia/Ho_Chi_Minh"), "2026-10-24");
});

test("date keys can move across month and year boundaries", () => {
    assert.equal(addDaysToDateKey("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysToDateKey("2028-03-01", -1), "2028-02-29");
    assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
    assert.throws(() => addDaysToDateKey("24/10/2026", 1), RangeError);
});

test("the first game starts a streak of one", () => {
    const { streak, isFirstGameOfDay } = recordPlayDay(createEmptyStreak(), vn("2026-10-24T08:00:00"));
    assert.deepEqual(streak, { currentStreak: 1, longestStreak: 1, lastPlayedDate: "2026-10-24" });
    assert.equal(isFirstGameOfDay, true);
});

test("more games on the same day keep the streak unchanged", () => {
    const state: StreakState = { currentStreak: 3, longestStreak: 5, lastPlayedDate: "2026-10-24" };
    const { streak, isFirstGameOfDay } = recordPlayDay(state, vn("2026-10-24T21:00:00"));
    assert.deepEqual(streak, state);
    assert.equal(isFirstGameOfDay, false);
});

test("playing on the next day extends the streak", () => {
    const state: StreakState = { currentStreak: 5, longestStreak: 5, lastPlayedDate: "2026-10-23" };
    const { streak } = recordPlayDay(state, vn("2026-10-24T00:05:00"));
    assert.deepEqual(streak, { currentStreak: 6, longestStreak: 6, lastPlayedDate: "2026-10-24" });
});

test("skipping a day restarts the streak but keeps the longest one", () => {
    const state: StreakState = { currentStreak: 7, longestStreak: 7, lastPlayedDate: "2026-10-22" };
    const { streak, isFirstGameOfDay } = recordPlayDay(state, vn("2026-10-24T10:00:00"));
    assert.deepEqual(streak, { currentStreak: 1, longestStreak: 7, lastPlayedDate: "2026-10-24" });
    assert.equal(isFirstGameOfDay, true);
});

test("a game dated before the last played day does not change the streak", () => {
    const state: StreakState = { currentStreak: 2, longestStreak: 4, lastPlayedDate: "2026-10-24" };
    assert.deepEqual(recordPlayDay(state, vn("2026-10-23T10:00:00")).streak, state);
});

test("the displayed streak drops to zero once a whole day is missed", () => {
    const state: StreakState = { currentStreak: 4, longestStreak: 9, lastPlayedDate: "2026-10-23" };

    assert.deepEqual(getStreakStatus(state, vn("2026-10-23T20:00:00")), {
        currentStreak: 4,
        longestStreak: 9,
        playedToday: true,
    });
    assert.deepEqual(getStreakStatus(state, vn("2026-10-24T20:00:00")), {
        currentStreak: 4,
        longestStreak: 9,
        playedToday: false,
    });
    assert.deepEqual(getStreakStatus(state, vn("2026-10-25T00:00:01")), {
        currentStreak: 0,
        longestStreak: 9,
        playedToday: false,
    });
    assert.equal(getStreakStatus(createEmptyStreak(), vn("2026-10-24T08:00:00")).currentStreak, 0);
});
