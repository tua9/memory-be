import "./helpers/testEnv.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../src/config/env.js";
import authRoute from "../src/routes/authRoute.js";
import { createGameSessionRouter } from "../src/routes/gameSessionRoute.js";
import type { GameSessionService, StartedRoundView } from "../src/services/gameSession.service.js";
import { authService } from "../src/services/user.service.js";
import ApiError from "../src/utils/ApiError.js";
import { readPlayer } from "../src/utils/request.js";
import { startTestServer } from "./helpers/testServer.js";

const MOBILE = { "X-Client": "mobile" };
const GUEST_ID = "abcdefghijklmnopqrstuvwxyz012345";

const post = (url: string, headers: Record<string, string>, body?: unknown) =>
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

const fakeRequest = (cookies: Record<string, string>, headers: Record<string, string>) =>
    ({
        cookies,
        get: (name: string) => headers[name.toLowerCase()],
    }) as unknown as Request;

// ---- Đăng nhập: mobile nhận token trong body, web nhận cookie ----

const withFakeSignIn = async (run: () => Promise<void>) => {
    const original = authService.signIn;
    authService.signIn = async () => ({
        accessToken: "access.jwt",
        refreshToken: "refresh.jwt",
        accessExpiresAt: new Date("2030-01-01T00:15:00Z"),
        refreshExpiresAt: new Date("2030-01-15T00:00:00Z"),
        rememberMe: true,
        userInfo: { _id: "507f1f77bcf86cd799439011", email: "a@b.c", username: "A", status: "active", role: "user" },
    });
    try {
        await run();
    } finally {
        authService.signIn = original;
    }
};

test("mobile login returns the tokens in the body and sets no cookies", async () => {
    await withFakeSignIn(async () => {
        const server = await startTestServer("/api/auth", authRoute);
        try {
            const response = await post(`${server.baseUrl}/login`, MOBILE, {});
            assert.equal(response.status, StatusCodes.OK);
            assert.deepEqual(response.headers.getSetCookie(), []);
            const { data } = await response.json();
            assert.equal(data.accessToken, "access.jwt");
            assert.equal(data.refreshToken, "refresh.jwt");
            assert.equal(data.refreshExpiresAt, "2030-01-15T00:00:00.000Z");
            assert.equal(data.userInfo.email, "a@b.c");
        } finally {
            await server.close();
        }
    });
});

test("web login still uses httpOnly cookies and keeps the tokens out of the body", async () => {
    await withFakeSignIn(async () => {
        const server = await startTestServer("/api/auth", authRoute);
        try {
            const response = await post(`${server.baseUrl}/login`, {}, {});
            const cookies = response.headers.getSetCookie();
            assert.deepEqual(cookies.map((cookie) => cookie.split("=")[0]).sort(), ["accessToken", "refreshToken"]);
            assert(cookies.every((cookie) => /HttpOnly/.test(cookie)));
            const { data } = await response.json();
            assert.deepEqual(Object.keys(data), ["userInfo"]);
        } finally {
            await server.close();
        }
    });
});

// ---- Refresh token: mỗi loại client chỉ đọc đúng một nguồn ----

test("mobile refresh reads the refresh token from the body", async () => {
    const server = await startTestServer("/api/auth", authRoute);
    try {
        const response = await post(`${server.baseUrl}/refresh`, MOBILE, { refreshToken: "not-a-jwt" });
        assert.equal(response.status, StatusCodes.UNAUTHORIZED);
        // Token được đọc và kiểm tra (sai định dạng), không phải bị coi là thiếu
        assert.equal((await response.json()).message, "Invalid or expired refresh token");
    } finally {
        await server.close();
    }
});

test("mobile refresh ignores the refresh token cookie", async () => {
    const server = await startTestServer("/api/auth", authRoute);
    try {
        const response = await post(`${server.baseUrl}/refresh`, { ...MOBILE, Cookie: "refreshToken=not-a-jwt" });
        assert.equal(response.status, StatusCodes.UNAUTHORIZED);
        assert.equal((await response.json()).message, "Refresh token is required");
    } finally {
        await server.close();
    }
});

test("web refresh still ignores a refresh token sent in the body", async () => {
    const server = await startTestServer("/api/auth", authRoute);
    try {
        const response = await post(`${server.baseUrl}/refresh`, {}, { refreshToken: "not-a-jwt" });
        assert.equal(response.status, StatusCodes.UNAUTHORIZED);
        assert.equal((await response.json()).message, "Refresh token is required");
    } finally {
        await server.close();
    }
});

// ---- Khách: web dùng cookie, mobile dùng header ----

test("readPlayer prefers the guest cookie and falls back to the X-Guest-Id header", () => {
    const other = "zyxwvutsrqponmlkjihgfedcba543210";
    assert.deepEqual(readPlayer(fakeRequest({ guestId: GUEST_ID }, { "x-guest-id": other })), { guestId: GUEST_ID });
    assert.deepEqual(readPlayer(fakeRequest({}, { "x-guest-id": other })), { guestId: other });
    assert.equal(readPlayer(fakeRequest({}, { "x-guest-id": "too-short" })), null);
    assert.equal(readPlayer(fakeRequest({}, {})), null);
});

const asGuest: RequestHandler = (_request, _response, next) => next();
const recordingService = () => {
    const players: unknown[] = [];
    const service = {
        startRound: async (player: unknown) => {
            players.push(player);
            return { sessionId: "6719a1b2c3d4e5f6a7b8c9d0", status: "memorizing" } as StartedRoundView;
        },
    } as unknown as GameSessionService;
    return { service, players };
};

test("a new mobile guest receives guestId in the body and no cookie", async () => {
    const { service, players } = recordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(asGuest, service));
    try {
        const response = await post(server.baseUrl, MOBILE, { gameName: "card" });
        assert.equal(response.status, StatusCodes.CREATED);
        assert.deepEqual(response.headers.getSetCookie(), []);
        const { data } = await response.json();
        assert.match(data.guestId, /^[A-Za-z0-9_-]{32}$/);
        assert.deepEqual(players, [{ guestId: data.guestId }]);
    } finally {
        await server.close();
    }
});

test("a returning mobile guest keeps the guestId sent in X-Guest-Id", async () => {
    const { service, players } = recordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(asGuest, service));
    try {
        const response = await post(server.baseUrl, { ...MOBILE, "X-Guest-Id": GUEST_ID }, { gameName: "card" });
        assert.equal((await response.json()).data.guestId, GUEST_ID);
        assert.deepEqual(players, [{ guestId: GUEST_ID }]);
    } finally {
        await server.close();
    }
});

test("a web guest still gets an httpOnly cookie and no guestId in the body", async () => {
    const { service } = recordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(asGuest, service));
    try {
        const response = await post(server.baseUrl, {}, { gameName: "card" });
        const cookies = response.headers.getSetCookie();
        assert.equal(cookies.length, 1);
        assert.match(cookies[0], /^guestId=[A-Za-z0-9_-]{32};.*HttpOnly/);
        assert.equal((await response.json()).data.guestId, undefined);
    } finally {
        await server.close();
    }
});

// ---- Google id token (mobile) ----

const withGoogleTokenInfo = async (claims: Record<string, unknown> | null, run: () => Promise<void>) => {
    const originalFetch = globalThis.fetch;
    const originalClientId = env.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_ID = "web-client-id.apps.googleusercontent.com";
    globalThis.fetch = (async () =>
        claims ? Response.json(claims) : new Response("invalid", { status: 400 })) as typeof fetch;
    try {
        await run();
    } finally {
        globalThis.fetch = originalFetch;
        env.GOOGLE_CLIENT_ID = originalClientId;
    }
};

const rejectsWith = (promise: Promise<unknown>, statusCode: number, message: string) =>
    assert.rejects(promise, (error: unknown) => {
        assert(error instanceof ApiError);
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.message, message);
        return true;
    });

test("googleSignInWithIdToken rejects an empty token", async () => {
    await rejectsWith(authService.googleSignInWithIdToken(""), StatusCodes.BAD_REQUEST, "Google token is required");
});

test("googleSignInWithIdToken rejects a token Google does not accept", async () => {
    await withGoogleTokenInfo(null, () =>
        rejectsWith(authService.googleSignInWithIdToken("bad"), StatusCodes.UNAUTHORIZED, "Google token is invalid or expired"));
});

test("googleSignInWithIdToken rejects a token issued for another app", async () => {
    await withGoogleTokenInfo(
        { aud: "someone-else.apps.googleusercontent.com", iss: "https://accounts.google.com", sub: "1", email: "a@b.c", email_verified: "true" },
        () => rejectsWith(authService.googleSignInWithIdToken("token"), StatusCodes.UNAUTHORIZED, "Google token was not issued for this app"),
    );
});

test("googleSignInWithIdToken rejects an unverified email", async () => {
    await withGoogleTokenInfo(
        { aud: "web-client-id.apps.googleusercontent.com", iss: "accounts.google.com", sub: "1", email: "a@b.c", email_verified: "false" },
        () => rejectsWith(authService.googleSignInWithIdToken("token"), StatusCodes.UNAUTHORIZED, "Google email is not verified"),
    );
});

test("googleSignInWithIdToken needs GOOGLE_CLIENT_ID configured", async () => {
    const originalClientId = env.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_ID = undefined;
    try {
        await rejectsWith(
            authService.googleSignInWithIdToken("token"),
            StatusCodes.INTERNAL_SERVER_ERROR,
            "Google client ID must be configured",
        );
    } finally {
        env.GOOGLE_CLIENT_ID = originalClientId;
    }
});
