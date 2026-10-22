import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateWorkedTime,
  checkoutRequiresReason,
  getPaidStart,
  isCheckInWindowOpen,
  shortfallFromNormalDay,
} from "../src/domain/attendance-policy.js";

test("on-time check-in pays from scheduled start, not arrival", () => {
  const paidStart = getPaidStart(
    "2026-09-28T07:45:00Z",
    "2026-09-28T08:00:00Z",
  );
  assert.equal(paidStart.toISOString(), "2026-09-28T08:00:00.000Z");
});

test("check-in at 08:00 is on time; 08:01 starts paid time at 08:16", () => {
  assert.equal(
    getPaidStart("2026-09-28T08:00:00Z", "2026-09-28T08:00:00Z").toISOString(),
    "2026-09-28T08:00:00.000Z",
  );
  assert.equal(
    getPaidStart("2026-09-28T08:01:00Z", "2026-09-28T08:00:00Z").toISOString(),
    "2026-09-28T08:16:00.000Z",
  );
});

test("rejects a check-in before the 07:45 window opens, with building-local time", () => {
  assert.equal(
    isCheckInWindowOpen("2026-09-28T02:44:59Z", "2026-09-28", "Asia/Tashkent"),
    false,
  );
  assert.equal(
    isCheckInWindowOpen("2026-09-28T02:45:00Z", "2026-09-28", "Asia/Tashkent"),
    true,
  );
});

test("matches the 09:00 arrival, 18:00 checkout, one-hour lunch example", () => {
  const result = calculateWorkedTime({
    checkInAt: "2026-09-28T09:00:00Z",
    checkOutAt: "2026-09-28T18:00:00Z",
    scheduledStartAt: "2026-09-28T08:00:00Z",
    unpaidIntervals: [
      { startedAt: "2026-09-28T12:00:00Z", endedAt: "2026-09-28T13:00:00Z" },
    ],
  });
  assert.equal(result.paidStartAt.toISOString(), "2026-09-28T09:15:00.000Z");
  assert.equal(result.workedMs, 7 * 60 * 60_000 + 45 * 60_000);
  assert.equal(shortfallFromNormalDay(result.workedMs), 75 * 60_000);
});

test("does not subtract the unpaid changing period twice when a break overlaps it", () => {
  const result = calculateWorkedTime({
    checkInAt: "2026-09-28T09:00:00Z",
    checkOutAt: "2026-09-28T10:00:00Z",
    scheduledStartAt: "2026-09-28T08:00:00Z",
    unpaidIntervals: [
      { startedAt: "2026-09-28T09:10:00Z", endedAt: "2026-09-28T09:25:00Z" },
    ],
  });
  assert.equal(result.workedMs, 35 * 60_000);
  assert.equal(result.unpaidMs, 10 * 60_000);
});

test("checkout reason is not required at the inclusive five-minute boundary", () => {
  assert.equal(
    checkoutRequiresReason("2026-09-28T17:55:00Z", "2026-09-28T18:00:00Z"),
    false,
  );
  assert.equal(
    checkoutRequiresReason("2026-09-28T18:05:00Z", "2026-09-28T18:00:00Z"),
    false,
  );
  assert.equal(
    checkoutRequiresReason("2026-09-28T17:54:59Z", "2026-09-28T18:00:00Z"),
    true,
  );
});
