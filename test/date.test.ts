import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonthsToDateKey, startOfDateKey, weekdayOfDateKey } from "../src/utils/date.js";

test("midnight of a Vietnam calendar day is 17:00 UTC of the day before", () => {
    assert.equal(startOfDateKey("2026-10-24", "Asia/Ho_Chi_Minh").toISOString(), "2026-10-23T17:00:00.000Z");
    assert.equal(startOfDateKey("2026-01-01", "Asia/Ho_Chi_Minh").toISOString(), "2025-12-31T17:00:00.000Z");
    assert.equal(startOfDateKey("2026-10-24", "UTC").toISOString(), "2026-10-24T00:00:00.000Z");
});

test("weekday of a date key starts from Sunday", () => {
    assert.equal(weekdayOfDateKey("2026-10-24"), 6);
    assert.equal(weekdayOfDateKey("2026-10-25"), 0);
    assert.equal(weekdayOfDateKey("2026-10-26"), 1);
});

test("month shifts land on the first day of the month across years", () => {
    assert.equal(addMonthsToDateKey("2026-10-24", 0), "2026-10-01");
    assert.equal(addMonthsToDateKey("2026-01-31", -1), "2025-12-01");
    assert.equal(addMonthsToDateKey("2026-12-15", 1), "2027-01-01");
    assert.throws(() => addMonthsToDateKey("10/2026", 1), RangeError);
});
