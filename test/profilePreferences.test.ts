import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import { errorHandlingMiddleware } from "../src/middlewares/errorHandlingMiddleware.js";
import type { UserDocument, UserPreferences } from "../src/models/user.js";
import { createUserProfileRouter } from "../src/routes/profileRoute.js";
import {
    createUserProfileService,
    type PreferencesInput,
    type ProfileSource,
    type UserProfileRepository,
} from "../src/services/profile.service.js";

const USER_ID = "507f1f77bcf86cd799439011";
// 10:00 ngày 2026-11-08 giờ Việt Nam
const NOW = new Date("2026-11-08T10:00:00+07:00");

// Kho giả giữ mục tiêu trong bộ nhớ, ghi lại mỗi lần được gọi
const makeRepository = (initial: Partial<UserPreferences> = {}) => {
    const user: ProfileSource & { preferences: Partial<UserPreferences> } = {
        username: "Player",
        preferences: { ...initial },
    };
    const saved: PreferencesInput[] = [];
    const repository: UserProfileRepository = {
        updateUsername: async () => user,
        savePreferences: async (userId, preferences, answeredAt) => {
            assert.equal(userId, USER_ID);
            saved.push(preferences);
            Object.assign(user.preferences, preferences, { answeredAt });
            return user;
        },
        skipPreferences: async (userId, skippedAt) => {
            assert.equal(userId, USER_ID);
            user.preferences.skippedAt = skippedAt;
            return user;
        },
    };
    return { repository, saved };
};

test("a new account has no preferences and is asked once", () => {
    const { getProfile } = createUserProfileService();
    const profile = getProfile({ username: "Player" });
    assert.deepEqual(profile.preferences, { goals: [], dailyMinutes: null, targetDate: null, status: "unset" });
});

test("saving preferences normalises goals and keeps the exam date only for the exam goal", async () => {
    const { repository, saved } = makeRepository();
    const service = createUserProfileService(repository);

    const profile = await service.savePreferences(
        USER_ID,
        { goals: ["exam", "language", "exam"], dailyMinutes: 15, targetDate: "2027-03-15" },
        NOW,
    );
    assert.deepEqual(profile.preferences, {
        goals: ["language", "exam"],
        dailyMinutes: 15,
        targetDate: "2027-03-15",
        status: "answered",
    });

    await service.savePreferences(USER_ID, { goals: ["brain"], dailyMinutes: 5, targetDate: "2027-03-15" }, NOW);
    assert.equal(saved.at(-1)?.targetDate, null);
});

test("skipping is remembered, and skipping after answering keeps the answer", async () => {
    const fresh = makeRepository();
    const skipped = await createUserProfileService(fresh.repository).skipPreferences(USER_ID, NOW);
    assert.equal(skipped.preferences.status, "skipped");

    const answered = makeRepository({ goals: ["names"], dailyMinutes: 30, answeredAt: NOW });
    const afterSkip = await createUserProfileService(answered.repository).skipPreferences(USER_ID, NOW);
    assert.equal(afterSkip.preferences.status, "answered");
    assert.deepEqual(afterSkip.preferences.goals, ["names"]);
});

test("invalid preferences are rejected before anything is stored", async () => {
    const { repository, saved } = makeRepository();
    const service = createUserProfileService(repository);
    const invalidBodies: [unknown, RegExp][] = [
        [null, /JSON object/],
        [{ goals: [], dailyMinutes: 15 }, /goals/],
        [{ goals: ["cooking"], dailyMinutes: 15 }, /goals/],
        [{ goals: "language", dailyMinutes: 15 }, /goals/],
        [{ goals: ["language"], dailyMinutes: 20 }, /dailyMinutes/],
        [{ goals: ["language"] }, /dailyMinutes/],
        [{ goals: ["exam"], dailyMinutes: 15, targetDate: "2027-02-30" }, /YYYY-MM-DD/],
        [{ goals: ["exam"], dailyMinutes: 15, targetDate: "15/03/2027" }, /YYYY-MM-DD/],
        [{ goals: ["exam"], dailyMinutes: 15, targetDate: "2026-11-07" }, /between today/],
        [{ goals: ["exam"], dailyMinutes: 15, targetDate: "2029-11-09" }, /between today/],
        [{ goals: ["language"], dailyMinutes: 15, answeredAt: "2020-01-01" }, /Unsupported preference field\(s\): answeredAt/],
    ];

    for (const [body, message] of invalidBodies) {
        await assert.rejects(service.savePreferences(USER_ID, body, NOW), (error: Error) => {
            assert.match(error.message, message);
            return true;
        });
    }
    assert.equal(saved.length, 0);

    // Hôm nay và đúng 3 năm sau vẫn hợp lệ
    await service.savePreferences(USER_ID, { goals: ["exam"], dailyMinutes: 15, targetDate: "2026-11-08" }, NOW);
    await service.savePreferences(USER_ID, { goals: ["exam"], dailyMinutes: 15, targetDate: "2029-11-08" }, NOW);
    assert.equal(saved.length, 2);
});

test("preference routes save, skip and report a missing owner", async () => {
    const { repository } = makeRepository();
    const authentication: RequestHandler = (request, _response, next) => {
        request.user = { _id: { toString: () => USER_ID }, username: "Player" } as unknown as UserDocument;
        next();
    };
    const missing: UserProfileRepository = { ...repository, skipPreferences: async () => null };

    const app = express();
    app.use(express.json());
    app.use("/api/profile", createUserProfileRouter(authentication, createUserProfileService(repository)));
    app.use("/api/missing", createUserProfileRouter(authentication, createUserProfileService(missing)));
    app.use(errorHandlingMiddleware);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

    try {
        const saveResponse = await fetch(`${base}/profile/preferences`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goals: ["numbers"], dailyMinutes: 30 }),
        });
        const saveBody = await saveResponse.json() as { data: { profile: { preferences: { status: string } } } };
        assert.equal(saveResponse.status, 200);
        assert.equal(saveBody.data.profile.preferences.status, "answered");

        const invalidResponse = await fetch(`${base}/profile/preferences`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goals: [], dailyMinutes: 30 }),
        });
        assert.equal(invalidResponse.status, 400);

        const skipResponse = await fetch(`${base}/profile/preferences/skip`, { method: "POST" });
        assert.equal(skipResponse.status, 200);

        const missingResponse = await fetch(`${base}/missing/preferences/skip`, { method: "POST" });
        assert.equal(missingResponse.status, 404);
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
