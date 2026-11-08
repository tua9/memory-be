import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import { errorHandlingMiddleware } from "../src/middlewares/errorHandlingMiddleware.js";
import type {
    PasswordResetRepository,
    SendLimitState,
} from "../src/repositories/passwordReset.repository.js";
import { createPasswordResetRouter } from "../src/routes/passwordResetRoute.js";
import type { MailMessage, MailService } from "../src/services/mail.service.js";
import {
    createPasswordResetService,
    type PasswordResetService,
} from "../src/services/passwordReset.service.js";
import ApiError from "../src/utils/ApiError.js";
import { maskEmail } from "../src/utils/password.js";

const USER_ID = "507f1f77bcf86cd799439011";
const EMAIL = "learner@example.com";
const CLIENT_URL = "https://memio.example";
const NEW_PASSWORD = "brand-new-pass-1";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

interface StoredToken { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }

// Kho dữ liệu trong bộ nhớ thay cho MongoDB; các thao tác claim/reserve đồng bộ nên mang tính nguyên tử như bản thật
const makeHarness = async (options: { sendError?: () => Error | null } = {}) => {
    let nowMs = Date.parse("2026-11-08T08:00:00.000Z");
    let tokenSeq = 0;
    const oldHash = await bcrypt.hash("old-password-1", 4);
    const state = {
        passwordHash: oldHash,
        status: "active",
        sessions: ["s1", "s2"],
        tokens: [] as StoredToken[],
        limit: null as SendLimitState | null,
        failUpdate: false,
        failRevoke: false,
    };
    const sent: MailMessage[] = [];

    const repository: PasswordResetRepository = {
        findAccount: async (id) => (id === USER_ID ? { id, email: EMAIL, status: state.status, passwordHash: state.passwordHash } : null),
        findAccountByEmail: async (email) => (email === EMAIL ? { id: USER_ID, email, status: state.status, passwordHash: state.passwordHash } : null),
        getSendLimit: async () => (state.limit ? { ...state.limit } : null),
        reserveSend: async (_id, expected, next) => {
            const current = state.limit;
            const same = expected === null
                ? current === null
                : current !== null &&
                    current.count === expected.count &&
                    current.lastSentAt.getTime() === expected.lastSentAt.getTime() &&
                    current.windowStartedAt.getTime() === expected.windowStartedAt.getTime();
            if (!same) return false;
            state.limit = { ...next };
            return true;
        },
        restoreSendLimit: async (_id, previous) => { state.limit = previous ? { ...previous } : null; },
        createToken: async ({ userId, tokenHash, expiresAt }) => {
            const id = `t${++tokenSeq}`;
            state.tokens.push({ id, userId, tokenHash, expiresAt, usedAt: null });
            return { id, userId };
        },
        deleteToken: async (id) => { state.tokens = state.tokens.filter((token) => token.id !== id); },
        deleteTokensExcept: async (userId, keepId) => {
            state.tokens = state.tokens.filter((token) => token.userId !== userId || token.id === keepId);
        },
        deleteAllTokens: async (userId) => { state.tokens = state.tokens.filter((token) => token.userId !== userId); },
        findActiveToken: async (tokenHash, now) => {
            const token = state.tokens.find((item) =>
                item.tokenHash === tokenHash && item.usedAt === null && item.expiresAt > now);
            return token ? { id: token.id, userId: token.userId } : null;
        },
        claimToken: async (tokenHash, now) => {
            const token = state.tokens.find((item) =>
                item.tokenHash === tokenHash && item.usedAt === null && item.expiresAt > now);
            if (!token) return null;
            token.usedAt = now;
            return { id: token.id, userId: token.userId };
        },
        releaseToken: async (id) => {
            const token = state.tokens.find((item) => item.id === id);
            if (token) token.usedAt = null;
        },
        updatePasswordHash: async (_id, passwordHash) => {
            if (state.failUpdate) throw new Error("db down");
            state.passwordHash = passwordHash;
            return true;
        },
        revokeSessions: async () => {
            if (state.failRevoke) throw new Error("db down");
            state.sessions = [];
        },
    };
    const mailer: MailService = {
        send: async (message) => {
            const error = options.sendError?.();
            if (error) throw error;
            sent.push(message);
        },
    };
    const service = createPasswordResetService({
        repository,
        mailer,
        clock: () => new Date(nowMs),
        clientUrl: `${CLIENT_URL}/`,
        hashPassword: async (password) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return bcrypt.hash(password, 4);
        },
    });

    // Token chỉ được đọc từ email giả lập trong test, không bao giờ in ra
    const lastToken = (): string => {
        const link = sent[sent.length - 1]?.text.match(/#token=([A-Za-z0-9_-]+)/);
        assert.ok(link, "email must contain a link with the token in the fragment");
        return link[1] as string;
    };
    return { service, state, sent, lastToken, advance: (ms: number) => { nowMs += ms; } };
};

const rejectsWith = async (promise: Promise<unknown>, statusCode: number, code?: string) =>
    assert.rejects(promise, (error: unknown) =>
        error instanceof ApiError && error.statusCode === statusCode && (code === undefined || error.code === code));

test("sends the link only to the signed-in user's email with a fragment token and never returns it", async () => {
    const { service, state, sent, lastToken } = await makeHarness();
    const result = await service.requestLink({ id: USER_ID, email: EMAIL });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, EMAIL);
    assert.match(sent[0]?.text ?? "", /^Bạn vừa yêu cầu đổi mật khẩu/);
    const token = lastToken();
    assert.ok(sent[0]?.html.includes(`${CLIENT_URL}/reset-password#token=${token}`));
    assert.equal(token.length, 43);

    assert.equal(JSON.stringify(result).includes(token), false);
    assert.deepEqual(result, { maskedEmail: maskEmail(EMAIL), expiresInMinutes: 15, resendAfterSeconds: 60 });

    // Chỉ lưu SHA-256, không lưu token gốc
    assert.equal(state.tokens.length, 1);
    assert.equal(state.tokens[0]?.tokenHash, sha256(token));
    assert.equal(JSON.stringify(state).includes(token), false);
});

test("resend: 60 second cooldown, then a new link replaces the previous one", async () => {
    const { service, sent, lastToken, advance } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const first = lastToken();

    advance(30_000);
    await rejectsWith(service.requestLink({ id: USER_ID, email: EMAIL }), 429, "RESET_LINK_RATE_LIMITED");
    assert.equal(sent.length, 1);

    advance(31_000);
    await service.requestLink({ id: USER_ID, email: EMAIL });
    assert.equal(sent.length, 2);
    await rejectsWith(service.validateToken({ token: first }), 400, "INVALID_RESET_TOKEN");
    assert.deepEqual(await service.validateToken({ token: lastToken() }), { maskedEmail: maskEmail(EMAIL) });
});

test("rate limit: at most 5 sends in 30 minutes, then allowed again after the window", async () => {
    const { service, sent, advance } = await makeHarness();
    for (let i = 0; i < 5; i++) {
        await service.requestLink({ id: USER_ID, email: EMAIL });
        advance(61_000);
    }
    assert.equal(sent.length, 5);

    await assert.rejects(service.requestLink({ id: USER_ID, email: EMAIL }), (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 429);
        const { retryAfterSeconds } = (error.errors[0] ?? {}) as { retryAfterSeconds?: number };
        assert.ok(retryAfterSeconds && retryAfterSeconds > 60 && retryAfterSeconds <= 30 * 60);
        return true;
    });
    assert.equal(sent.length, 5);

    advance(30 * 60_000);
    await service.requestLink({ id: USER_ID, email: EMAIL });
    assert.equal(sent.length, 6);
});

test("concurrent send requests: only one is accepted", async () => {
    const { service, sent } = await makeHarness();
    const results = await Promise.allSettled([
        service.requestLink({ id: USER_ID, email: EMAIL }),
        service.requestLink({ id: USER_ID, email: EMAIL }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(sent.length, 1);
});

test("email failure is reported, leaves no new link, frees the slot and keeps the previous link", async () => {
    let failNext = false;
    const { service, state, sent, lastToken, advance } = await makeHarness({
        sendError: () => failNext
            ? new ApiError(502, "Could not send the email", [], "EMAIL_DELIVERY_FAILED")
            : null,
    });
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const previous = lastToken();
    advance(61_000);

    failNext = true;
    await rejectsWith(service.requestLink({ id: USER_ID, email: EMAIL }), 502, "EMAIL_DELIVERY_FAILED");
    assert.equal(state.tokens.length, 1, "failed send must not leave a new token");
    await service.validateToken({ token: previous });

    // Lượt gửi lỗi không bị tính: thử lại ngay được, không bị cooldown
    failNext = false;
    await service.requestLink({ id: USER_ID, email: EMAIL });
    assert.equal(sent.length, 2);
});

test("validate is read-only: opening the link repeatedly does not consume it", async () => {
    const { service, state, lastToken } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const token = lastToken();

    for (let i = 0; i < 3; i++) {
        assert.deepEqual(await service.validateToken({ token }), { maskedEmail: maskEmail(EMAIL) });
    }
    assert.equal(state.tokens[0]?.usedAt, null);
    assert.equal(state.passwordHash.startsWith("$2"), true);
    await service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
});

test("wrong, malformed and expired tokens are rejected the same way", async () => {
    const { service, lastToken, advance } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const token = lastToken();

    for (const bad of [undefined, "", "short", "a".repeat(43), `${token}x`, 42, null]) {
        await rejectsWith(service.validateToken({ token: bad }), 400, "INVALID_RESET_TOKEN");
        await rejectsWith(
            service.confirm({ token: bad, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
            400,
            "INVALID_RESET_TOKEN",
        );
    }
    await rejectsWith(service.validateToken(undefined), 400, "INVALID_RESET_TOKEN");

    advance(15 * 60_000 + 1);
    await rejectsWith(service.validateToken({ token }), 400, "INVALID_RESET_TOKEN");
    await rejectsWith(
        service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
        400,
        "INVALID_RESET_TOKEN",
    );
});

test("confirm updates the password, revokes sessions and kills every link; the link is single-use", async () => {
    const { service, state, lastToken, advance } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const older = lastToken();
    advance(61_000);
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const token = lastToken();
    // Mô phỏng một link khác còn hiệu lực của cùng tài khoản
    state.tokens.push({ id: "extra", userId: USER_ID, tokenHash: sha256(older), expiresAt: new Date(Date.now() + 1e9), usedAt: null });

    await service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });

    assert.equal(await bcrypt.compare(NEW_PASSWORD, state.passwordHash), true);
    assert.equal(await bcrypt.compare("old-password-1", state.passwordHash), false);
    assert.deepEqual(state.sessions, []);
    assert.deepEqual(state.tokens, []);

    await rejectsWith(
        service.confirm({ token, newPassword: "another-pass-22", confirmPassword: "another-pass-22" }),
        400,
        "INVALID_RESET_TOKEN",
    );
    await rejectsWith(service.validateToken({ token: older }), 400, "INVALID_RESET_TOKEN");
    assert.equal(await bcrypt.compare(NEW_PASSWORD, state.passwordHash), true);
});

test("invalid new password or mismatched confirmation is rejected without consuming the link", async () => {
    const { service, state, lastToken } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const token = lastToken();
    const before = state.passwordHash;

    await rejectsWith(service.confirm({ token, newPassword: "short", confirmPassword: "short" }), 400, "INVALID_PASSWORD");
    await rejectsWith(service.confirm({ token, newPassword: "é".repeat(37), confirmPassword: "é".repeat(37) }), 400, "INVALID_PASSWORD");
    await rejectsWith(service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: "different-pass" }), 400, "PASSWORD_MISMATCH");
    await rejectsWith(service.confirm({ token, newPassword: 12345678, confirmPassword: 12345678 }), 400, "INVALID_PASSWORD");

    assert.equal(state.passwordHash, before);
    assert.equal(state.tokens[0]?.usedAt, null);
    assert.deepEqual(state.sessions, ["s1", "s2"]);
    await service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
});

test("two simultaneous confirmations: exactly one wins and the password is set once", async () => {
    const { service, state, lastToken } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const token = lastToken();

    const results = await Promise.allSettled([
        service.confirm({ token, newPassword: "winner-pass-111", confirmPassword: "winner-pass-111" }),
        service.confirm({ token, newPassword: "loser-pass-2222", confirmPassword: "loser-pass-2222" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ApiError);
    assert.equal(rejected.reason.code, "INVALID_RESET_TOKEN");

    const winnerFirst = results[0]?.status === "fulfilled";
    assert.equal(await bcrypt.compare(winnerFirst ? "winner-pass-111" : "loser-pass-2222", state.passwordHash), true);
});

test("a failed password write gives the link back so the user can retry", async () => {
    const { service, state, lastToken } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const token = lastToken();

    state.failUpdate = true;
    await assert.rejects(service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }), /db down/);
    assert.equal(state.tokens[0]?.usedAt, null);

    state.failUpdate = false;
    await service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    assert.equal(await bcrypt.compare(NEW_PASSWORD, state.passwordHash), true);
});

test("if sessions cannot be revoked after the password changed, the error says so explicitly", async () => {
    const { service, state, lastToken } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const token = lastToken();

    state.failRevoke = true;
    await rejectsWith(
        service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
        500,
        "SESSION_REVOKE_FAILED",
    );
    assert.equal(await bcrypt.compare(NEW_PASSWORD, state.passwordHash), true);
});

test("inactive accounts cannot use a link", async () => {
    const { service, state, lastToken } = await makeHarness();
    await service.requestLink({ id: USER_ID, email: EMAIL });
    const token = lastToken();
    state.status = "banned";
    await rejectsWith(service.validateToken({ token }), 400, "INVALID_RESET_TOKEN");
    await rejectsWith(
        service.confirm({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
        400,
        "INVALID_RESET_TOKEN",
    );
});

test("maskEmail hides most of the address", () => {
    assert.equal(maskEmail("learner@example.com"), "l***r@example.com");
    assert.equal(maskEmail("ab@example.com"), "a***@example.com");
    assert.equal(maskEmail("a@example.com"), "a***@example.com");
});

const startRouterServer = async (authentication: RequestHandler | undefined, service: PasswordResetService) => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/password-reset", createPasswordResetRouter(authentication, service));
    app.use(errorHandlingMiddleware);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}/api/password-reset`,
        close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
};

const post = (url: string, body: unknown) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("HTTP: sending a link requires sign-in; validate/confirm are public", async () => {
    const calls: string[] = [];
    const fake: PasswordResetService = {
        requestLink: async () => { calls.push("request"); return { maskedEmail: "x", expiresInMinutes: 15, resendAfterSeconds: 60 }; },
        forgotPassword: async () => { calls.push("forgot"); return { message: "ok" }; },
        validateToken: async () => { calls.push("validate"); return { maskedEmail: "x" }; },
        confirm: async () => { calls.push("confirm"); },
    };
    // Dùng protectedRoute thật: không có access token thì bị chặn trước khi chạm DB
    const server = await startRouterServer(undefined, fake);
    try {
        assert.equal((await post(`${server.baseUrl}/request`, {})).status, 401);
        assert.deepEqual(calls, []);
        assert.equal((await post(`${server.baseUrl}/validate`, { token: "x" })).status, 200);
        assert.equal((await post(`${server.baseUrl}/confirm`, {})).status, 200);
        assert.deepEqual(calls, ["validate", "confirm"]);
    } finally {
        await server.close();
    }
});

test("HTTP: the target email comes from the authenticated user, never from the request body", async () => {
    const received: { id: string; email: string }[] = [];
    const fake: PasswordResetService = {
        requestLink: async (user) => { received.push(user); return { maskedEmail: "l***r@example.com", expiresInMinutes: 15, resendAfterSeconds: 60 }; },
        forgotPassword: async () => ({ message: "ok" }),
        validateToken: async () => ({ maskedEmail: "x" }),
        confirm: async () => undefined,
    };
    const authentication: RequestHandler = (request, _response, next) => {
        request.user = { _id: { toString: () => USER_ID }, email: EMAIL } as never;
        next();
    };
    const server = await startRouterServer(authentication, fake);
    try {
        const response = await post(`${server.baseUrl}/request`, {
            email: "attacker@evil.test", userId: "someone-else", to: "attacker@evil.test", clientUrl: "https://evil.test",
        });
        assert.equal(response.status, 200);
        assert.deepEqual(received, [{ id: USER_ID, email: EMAIL }]);
        const body = await response.json() as { data: Record<string, unknown> };
        assert.equal("token" in body.data, false);
    } finally {
        await server.close();
    }
});

test("HTTP: rate-limit and invalid-token errors keep their codes", async () => {
    const harness = await makeHarness();
    const authentication: RequestHandler = (request, _response, next) => {
        request.user = { _id: { toString: () => USER_ID }, email: EMAIL } as never;
        next();
    };
    const server = await startRouterServer(authentication, harness.service);
    try {
        assert.equal((await post(`${server.baseUrl}/request`, {})).status, 200);
        const limited = await post(`${server.baseUrl}/request`, {});
        assert.equal(limited.status, 429);
        const limitedBody = await limited.json() as { code: string; errors: { retryAfterSeconds: number }[] };
        assert.equal(limitedBody.code, "RESET_LINK_RATE_LIMITED");
        assert.ok(limitedBody.errors[0]!.retryAfterSeconds > 0);

        const invalid = await post(`${server.baseUrl}/validate`, { token: "a".repeat(43) });
        assert.equal(invalid.status, 400);
        assert.equal(((await invalid.json()) as { code: string }).code, "INVALID_RESET_TOKEN");
    } finally {
        await server.close();
    }
});

test("forgotPassword: returns generic message for non-existent email without sending email", async () => {
    const harness = await makeHarness();
    const result = await harness.service.forgotPassword("nonexistent@example.com");
    assert.equal(result.message, "Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi tới hộp thư của bạn.");
    assert.equal(harness.sent.length, 0);
});

test("forgotPassword: sends reset link for existing email", async () => {
    const harness = await makeHarness();
    const result = await harness.service.forgotPassword(EMAIL);
    assert.equal(result.message, "Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi tới hộp thư của bạn.");
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0]!.to, EMAIL);
    assert.match(harness.sent[0]!.text, new RegExp(`${CLIENT_URL}/reset-password#token=[A-Za-z0-9_-]{43}`));
});

test("confirm rejects when new password matches current password", async () => {
    const harness = await makeHarness();
    await harness.service.requestLink({ id: USER_ID, email: EMAIL });
    const token = harness.lastToken();

    await assert.rejects(
        () => harness.service.confirm({ token, newPassword: "old-password-1", confirmPassword: "old-password-1" }),
        (error: unknown) =>
            error instanceof ApiError &&
            error.statusCode === 400 &&
            error.code === "SAME_PASSWORD",
    );
});

test("HTTP: /forgot is public and returns generic success", async () => {
    const harness = await makeHarness();
    const server = await startRouterServer(undefined, harness.service);
    try {
        const response = await post(`${server.baseUrl}/forgot`, { email: "anyone@example.com" });
        assert.equal(response.status, 200);
        const body = await response.json() as { status: string; message: string };
        assert.equal(body.status, "success");
        assert.equal(body.message, "Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi tới hộp thư của bạn.");
    } finally {
        await server.close();
    }
});

