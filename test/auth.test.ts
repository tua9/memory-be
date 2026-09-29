import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import Session from "../src/models/sessions.js";
import User from "../src/models/user.js";
import { env } from "../src/config/env.js";
import { JwtProvider } from "../src/providers/JwtProvider.js";
import { authService } from "../src/services/user.service.js";
import authRoute from "../src/routes/authRoute.js";

test("auth lifecycle with real bcrypt/JWT and an in-memory persistence stub", async (t) => {
    env.ACCESS_TOKEN_SECRET = "test-only-access-secret-not-for-deployment";
    env.REFRESH_TOKEN_SECRET = "test-only-refresh-secret-not-for-deployment";
    env.ACCESS_TOKEN_TTL = "15m";
    env.REFRESH_TOKEN_TTL = "14d";
    const users: Array<Record<string, any>> = [];
    const sessions: Array<Record<string, any>> = [];

    t.mock.method(User, "findOne", async ({ email }: { email: string }) =>
        users.find((user) => user.email === email) ?? null);
    t.mock.method(User, "findById", async (id: string) =>
        users.find((user) => user._id === id) ?? null);
    t.mock.method(User, "create", async (data: Record<string, any>) => {
        const user = { ...data, _id: "0123456789abcdef01234567" };
        users.push(user);
        return user;
    });
    t.mock.method(Session, "create", async (data: Record<string, any>) => {
        sessions.push({ ...data });
        return data;
    });
    t.mock.method(Session, "findOneAndUpdate", async (filter: any, update: any) => {
        const session = sessions.find((entry) => entry.userId === filter.userId &&
            entry.refreshToken === filter.refreshToken && entry.expiresAt > filter.expiresAt.$gt);
        if (!session) return null;
        Object.assign(session, update.$set);
        return session;
    });
    t.mock.method(Session, "deleteOne", async ({ refreshToken }: { refreshToken: string }) => {
        const index = sessions.findIndex((session) => session.refreshToken === refreshToken);
        if (index !== -1) sessions.splice(index, 1);
    });

    const body = { fullName: " Test User ", email: " TEST@example.com ", password: "password123" };
    const rejectsStatus = (operation: Promise<unknown>, status: number) =>
        assert.rejects(operation, (error: { statusCode: number }) => error.statusCode === status);

    await t.test("register validates input and ignores supplied privilege fields", async () => {
        await rejectsStatus(authService.signUp({}), 400);
        await rejectsStatus(authService.signUp({ ...body, password: "short" }), 400);
        const user = await authService.signUp({ ...body, role: "admin", status: "banned" });
        assert.equal(user.email, "test@example.com");
        assert.equal(user.fullName, "Test User");
        assert.equal(user.role, "user");
        assert.equal(user.status, "active");
        assert.equal("passwordHash" in user, false);
        assert.notEqual(users[0].passwordHash, body.password);
        await rejectsStatus(authService.signUp(body), 409);
    });

    await t.test("login rejects bad credentials and inactive accounts", async () => {
        await rejectsStatus(authService.signIn({ ...body, password: "wrong" }), 401);
        await rejectsStatus(authService.signIn({ ...body, email: "missing@example.com" }), 401);
        for (const status of ["inactive", "banned"]) {
            users[0].status = status;
            await rejectsStatus(authService.signIn(body), 403);
        }
        users[0].status = "active";
        assert.equal(sessions.length, 0);
    });

    await t.test("login signs distinct tokens and persists only a refresh hash", async () => {
        const first = await authService.signIn(body);
        const second = await authService.signIn(body);
        assert.notEqual(first.refreshToken, second.refreshToken);
        const payload = await JwtProvider.verifyToken(first.accessToken, env.ACCESS_TOKEN_SECRET);
        assert.equal(payload.sub, users[0]._id);
        assert.equal(payload.tokenType, "access");
        assert.equal(payload.passwordHash, undefined);
        assert.equal(sessions[0].refreshToken, createHash("sha256").update(first.refreshToken).digest("hex"));
        assert.ok(first.accessExpiresAt < first.refreshExpiresAt);
    });

    await t.test("refresh rotates once and logout revokes only its session", async () => {
        const tokens = await authService.signIn(body);
        const rotated = await authService.refreshToken(tokens.refreshToken);
        await rejectsStatus(authService.refreshToken(tokens.refreshToken), 401);
        await rejectsStatus(authService.refreshToken(tokens.accessToken), 401);
        const before = sessions.length;
        await authService.signOut(rotated.refreshToken);
        assert.equal(sessions.length, before - 1);
        await rejectsStatus(authService.refreshToken(rotated.refreshToken), 401);
        await authService.signOut(rotated.refreshToken);
        await authService.signOut();
    });

    await t.test("refresh rejects expired JWTs and expired database sessions", async () => {
        const tokens = await authService.signIn(body);
        sessions.at(-1)!.expiresAt = new Date(0);
        await rejectsStatus(authService.refreshToken(tokens.refreshToken), 401);
        const expired = await JwtProvider.generateToken(
            { sub: users[0]._id, tokenType: "refresh" }, env.REFRESH_TOKEN_SECRET, -1,
        );
        await rejectsStatus(authService.refreshToken(expired), 401);
    });

    await t.test("HTTP login keeps JWTs out of JSON and logout clears both cookies", async () => {
        const app = express();
        app.use(express.json());
        app.use(cookieParser());
        app.use("/api/auth", authRoute);
        const server = app.listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => server.once("listening", resolve));
        try {
            const address = server.address();
            assert.ok(address && typeof address !== "string");
            const base = `http://127.0.0.1:${address.port}/api/auth`;
            const response = await fetch(`${base}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            assert.equal(response.status, 200);
            const json = await response.json();
            assert.deepEqual(Object.keys(json.data), ["userInfo"]);
            const cookies = response.headers.getSetCookie();
            assert.equal(cookies.length, 2);
            assert.ok(cookies.every((cookie) => cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax")));
            const logout = await fetch(`${base}/logout`, {
                method: "POST",
                headers: { Cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; ") },
            });
            assert.equal(logout.status, 200);
            assert.ok(logout.headers.getSetCookie().every((cookie) => cookie.includes("Expires=Thu, 01 Jan 1970")));
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((error) => error ? reject(error) : resolve()));
        }
    });
});