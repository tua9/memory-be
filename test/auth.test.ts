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
    type UserProfileRepository,
} from "../src/services/profile.service.js";

const USER_ID = "507f1f77bcf86cd799439011";

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
            return { username: storedUsername } as Pick<UserDocument, "username">;
        },
    });

    await withServer(router, async (baseUrl) => {
        const initialResponse = await fetch(baseUrl);
        const initialBody = await initialResponse.json() as {
            data: { profile: Record<string, unknown>; unavailableFields: string[] };
        };

        assert.equal(initialResponse.status, 200);
        assert.deepEqual(initialBody.data.profile, {
            username: "Original Name",
            fullname: null,
            exp: null,
            streaks: null,
        });
        assert.deepEqual(initialBody.data.unavailableFields, ["fullname", "exp", "streaks"]);
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

test("empty, invalid, and protected-field updates are rejected without persistence", async () => {
    let updateCount = 0;
    const router = makeProfileHarness({
        updateUsername: async (_userId, username) => {
            updateCount += 1;
            return { username } as Pick<UserDocument, "username">;
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