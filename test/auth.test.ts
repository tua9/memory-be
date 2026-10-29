import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import { errorHandlingMiddleware } from "../src/middlewares/errorHandlingMiddleware.js";
import type { UserDocument } from "../src/models/user.js";
import profileRouter, { createUserProfileRouter } from "../src/routes/profileRoute.js";
import {
    createUserProfileService,
    isPlayStreakExpired,
    type UserProfileRepository,
} from "../src/services/profile.service.js";

const USER_ID = "507f1f77bcf86cd799439011";

test("play streak expires only after a missed UTC calendar day", () => {
    const now = new Date("2025-10-19T00:05:00.000Z");

    assert.equal(isPlayStreakExpired(null, now), false);
    assert.equal(isPlayStreakExpired(new Date("2025-10-18T23:59:00.000Z"), now), false);
    assert.equal(isPlayStreakExpired(new Date("2025-10-17T23:59:00.000Z"), now), true);
});

test("profile response marks a stale play streak as expired and zero", () => {
    const service = createUserProfileService({ updateUsername: async () => null });
    const profile = service.getProfile({
        username: "Player",
        exp: 25,
        streaks: 4,
        lastActiveDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    assert.equal(profile.streaks, 0);
    assert.equal(profile.streakExpired, true);
});

const startTestServer = async (router: express.Router) => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/profile", router);
    app.use(errorHandlingMiddleware);

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${address.port}/api/profile`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        }),
    };
};

const makeProfileHarness = (repository: UserProfileRepository) => {
    let currentUsername = "Original Name";
    const recordingRepository: UserProfileRepository = {
        updateUsername: async (userId, username) => {
            const updatedUser = await repository.updateUsername(userId, username);
            if (updatedUser) currentUsername = updatedUser.username;
            return updatedUser;
        },
    };
    const service = createUserProfileService(recordingRepository);
    const authentication: RequestHandler = (request, _response, next) => {
        request.user = {
            _id: { toString: () => USER_ID },
            username: currentUsername,
            exp: 41,
            streaks: 3,
            lastActiveDate: null,
            email: "private@example.com",
            passwordHash: "private-hash",
            role: "admin",
            status: "active",
        } as unknown as UserDocument;
        next();
    };

    return createUserProfileRouter(authentication, service);
};

const withServer = async (
    router: express.Router,
    run: (baseUrl: string) => Promise<void>,
): Promise<void> => {
    const server = await startTestServer(router);
    try {
        await run(server.baseUrl);
    } finally {
        await server.close();
    }
};

test("profile endpoints require the existing authenticated session", async () => {
    await withServer(profileRouter, async (baseUrl) => {
        const response = await fetch(baseUrl);
        const body = await response.json() as { statusCode: number; message: string };

        assert.equal(response.status, 401);
        assert.equal(body.statusCode, 401);
        assert.equal(body.message, "Unauthorized");
    });
});

test("profile reads expose only profile fields and updates persist the allowed username", async () => {
    let storedUsername = "Original Name";
    const router = makeProfileHarness({
        updateUsername: async (userId, username) => {
            assert.equal(userId, USER_ID);
            storedUsername = username;
            return { username: storedUsername, exp: 41, streaks: 3, lastActiveDate: null } as Pick<UserDocument, "username" | "exp" | "streaks" | "lastActiveDate">;
        },
    });

    await withServer(router, async (baseUrl) => {
        const initialResponse = await fetch(baseUrl);
        const initialBody = await initialResponse.json() as {
            data: { profile: Record<string, unknown>; unavailableFields: string[] };
        };

        assert.equal(initialResponse.status, 200);
        // Tài khoản chưa chơi ván nào: tiến độ mặc định
        assert.deepEqual(initialBody.data.profile, {
            username: "Original Name",
            fullname: null,
<<<<<<< HEAD
            exp: 41,
            streaks: 3,
            streakExpired: false,
=======
            exp: 0,
            level: { level: 1, expIntoLevel: 0, expForNextLevel: 100 },
            streaks: 0,
            longestStreak: 0,
            streakExpired: false,
            playedToday: false,
>>>>>>> feature/game-catalog
        });
        assert.deepEqual(initialBody.data.unavailableFields, ["fullname"]);
        assert.equal("email" in initialBody.data.profile, false);
        assert.equal("passwordHash" in initialBody.data.profile, false);
        assert.equal("role" in initialBody.data.profile, false);

        const updateResponse = await fetch(baseUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "  Updated Name  " }),
        });
        const updateBody = await updateResponse.json() as {
            data: { profile: { username: string } };
            message: string;
        };

        assert.equal(updateResponse.status, 200);
        assert.equal(updateBody.message, "Profile updated successfully");
        assert.equal(updateBody.data.profile.username, "Updated Name");
        assert.equal(storedUsername, "Updated Name");

        const persistedResponse = await fetch(baseUrl);
        const persistedBody = await persistedResponse.json() as {
            data: { profile: { username: string } };
        };
        assert.equal(persistedBody.data.profile.username, "Updated Name");
    });
});

test("profile shows EXP, level and streak status from game progress", () => {
    const { getProfile } = createUserProfileService();
    const progress = {
        exp: 350,
        currentStreak: 4,
        longestStreak: 9,
        lastPlayedDate: "2026-10-23",
        totalGames: 20,
        totalPlayTimeSec: 3600,
    };
    const user = { username: "Player", progress } as Pick<UserDocument, "username" | "progress">;
    const at = (dateTime: string) => new Date(`${dateTime}+07:00`);

    const sameDay = getProfile(user, at("2026-10-23T21:00:00"));
    assert.equal(sameDay.exp, 350);
    assert.deepEqual(sameDay.level, { level: 3, expIntoLevel: 50, expForNextLevel: 300 });
    assert.equal(sameDay.streaks, 4);
    assert.equal(sameDay.playedToday, true);
    assert.equal(sameDay.streakExpired, false);

    const nextDay = getProfile(user, at("2026-10-24T08:00:00"));
    assert.equal(nextDay.streaks, 4);
    assert.equal(nextDay.playedToday, false);
    assert.equal(nextDay.streakExpired, false);

    const missedDay = getProfile(user, at("2026-10-25T08:00:00"));
    assert.equal(missedDay.streaks, 0);
    assert.equal(missedDay.longestStreak, 9);
    assert.equal(missedDay.streakExpired, true);
});

test("empty, invalid, and protected-field updates are rejected without persistence", async () => {
    let updateCount = 0;
    const router = makeProfileHarness({
        updateUsername: async (_userId, username) => {
            updateCount += 1;
            return { username, exp: 0, streaks: 0, lastActiveDate: null } as Pick<UserDocument, "username" | "exp" | "streaks" | "lastActiveDate">;
        },
    });
    const invalidBodies = [
        { body: {}, message: "At least one supported profile field is required" },
        { body: { username: "x" }, message: "Username must be 2-100 characters" },
        { body: { username: 5 }, message: "Username must be a string" },
        { body: { exp: 50 }, message: "Unsupported profile field(s): exp" },
        { body: { streaks: 7 }, message: "Unsupported profile field(s): streaks" },
        { body: { role: "admin" }, message: "Unsupported profile field(s): role" },
        { body: { passwordHash: "attacker-value" }, message: "Unsupported profile field(s): passwordHash" },
        { body: { fullname: "New Full Name" }, message: "Unsupported profile field(s): fullname" },
    ];

    await withServer(router, async (baseUrl) => {
        for (const { body, message } of invalidBodies) {
            const response = await fetch(baseUrl, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const responseBody = await response.json() as { statusCode: number; message: string };

            assert.equal(response.status, 400);
            assert.equal(responseBody.statusCode, 400);
            assert.equal(responseBody.message, message);
        }
    });

    assert.equal(updateCount, 0);
});

test("missing profile records and repository failures use centralized error handling", async () => {
    const missingProfileRouter = makeProfileHarness({ updateUsername: async () => null });
    await withServer(missingProfileRouter, async (baseUrl) => {
        const response = await fetch(baseUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "Updated Name" }),
        });
        const body = await response.json() as { statusCode: number; message: string };

        assert.equal(response.status, 404);
        assert.equal(body.statusCode, 404);
        assert.equal(body.message, "Profile owner was not found");
    });

    const failingProfileRouter = makeProfileHarness({
        updateUsername: async () => { throw new Error("repository failure"); },
    });
    await withServer(failingProfileRouter, async (baseUrl) => {
        const response = await fetch(baseUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "Updated Name" }),
        });
        const body = await response.json() as { statusCode: number };

        assert.equal(response.status, 500);
        assert.equal(body.statusCode, 500);
    });
});