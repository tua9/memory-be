import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import { errorHandlingMiddleware } from "../src/middlewares/errorHandlingMiddleware.js";
import { authService } from "../src/services/user.service.js";
import User from "../src/models/user.js";
import Session from "../src/models/sessions.js";
import ApiError from "../src/utils/ApiError.js";
import authRoute from "../src/routes/authRoute.js";
import profileRoute from "../src/routes/profileRoute.js";

const USER_ID = "507f1f77bcf86cd799439011";
const OLD_PASSWORD = "current-password-123";
const NEW_PASSWORD = "brand-new-password-456";

test("changePassword: rejects short or invalid newPassword", async () => {
    await assert.rejects(
        () => authService.changePassword(USER_ID, { currentPassword: OLD_PASSWORD, newPassword: "short", confirmPassword: "short" }),
        (error: unknown) =>
            error instanceof ApiError &&
            error.statusCode === 400 &&
            error.code === "INVALID_PASSWORD",
    );
});

test("changePassword: rejects mismatched confirmPassword", async () => {
    await assert.rejects(
        () => authService.changePassword(USER_ID, { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: "wrong" }),
        (error: unknown) =>
            error instanceof ApiError &&
            error.statusCode === 400 &&
            error.code === "PASSWORD_MISMATCH",
    );
});

test("changePassword: unit test with mocked User & Session", async () => {
    const originalFindById = User.findById;
    const originalDeleteMany = Session.deleteMany;

    const oldHash = await bcrypt.hash(OLD_PASSWORD, 4);
    const mockUser = {
        _id: USER_ID,
        passwordHash: oldHash,
        status: "active",
        save: async () => {},
    };

    let sessionDeletedUserId: unknown = null;
    (User as unknown as { findById: (id: string) => Promise<unknown> }).findById = async (id: string) => {
        if (id === USER_ID) return mockUser;
        return null;
    };
    (Session as unknown as { deleteMany: (filter?: any) => Promise<unknown> }).deleteMany = async (filter?: { userId?: unknown }) => {
        sessionDeletedUserId = filter?.userId;
        return { deletedCount: 2 };
    };

    try {
        // Tài khoản đã có mật khẩu thì bắt buộc nhập mật khẩu hiện tại
        await assert.rejects(
            () => authService.changePassword(USER_ID, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
            (error: unknown) =>
                error instanceof ApiError &&
                error.statusCode === 400 &&
                error.code === "CURRENT_PASSWORD_REQUIRED",
        );

        // Sai mật khẩu hiện tại
        await assert.rejects(
            () => authService.changePassword(USER_ID, {
                currentPassword: "wrong-password",
                newPassword: NEW_PASSWORD,
                confirmPassword: NEW_PASSWORD,
            }),
            (error: unknown) =>
                error instanceof ApiError &&
                error.statusCode === 400 &&
                error.code === "INCORRECT_CURRENT_PASSWORD",
        );

        // Mật khẩu mới trùng mật khẩu cũ
        await assert.rejects(
            () => authService.changePassword(USER_ID, {
                currentPassword: OLD_PASSWORD,
                newPassword: OLD_PASSWORD,
                confirmPassword: OLD_PASSWORD,
            }),
            (error: unknown) =>
                error instanceof ApiError &&
                error.statusCode === 400 &&
                error.code === "SAME_PASSWORD",
        );

        // Thành công: cập nhật hash và thu hồi session
        await authService.changePassword(USER_ID, {
            currentPassword: OLD_PASSWORD,
            newPassword: NEW_PASSWORD,
            confirmPassword: NEW_PASSWORD,
        });

        assert.equal(sessionDeletedUserId, USER_ID);
        const isMatch = await bcrypt.compare(NEW_PASSWORD, mockUser.passwordHash);
        assert.equal(isMatch, true);
    } finally {
        User.findById = originalFindById;
        Session.deleteMany = originalDeleteMany;
    }
});

test("changePassword: a Google account without a password sets one without currentPassword", async () => {
    const originalFindById = User.findById;
    const originalDeleteMany = Session.deleteMany;
    const mockUser = { _id: USER_ID, passwordHash: null as string | null, status: "active", save: async () => {} };
    let sessionsRevoked = false;
    (User as unknown as { findById: (id: string) => Promise<unknown> }).findById = async () => mockUser;
    (Session as unknown as { deleteMany: () => Promise<unknown> }).deleteMany = async () => {
        sessionsRevoked = true;
        return { deletedCount: 1 };
    };

    try {
        await authService.changePassword(USER_ID, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
        assert.equal(await bcrypt.compare(NEW_PASSWORD, mockUser.passwordHash!), true);
        assert.equal(sessionsRevoked, true);
    } finally {
        User.findById = originalFindById;
        Session.deleteMany = originalDeleteMany;
    }
});

test("HTTP: PATCH /profile/password requires authentication", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/auth", authRoute);
    app.use("/api/profile", profileRoute);
    app.use(errorHandlingMiddleware);

    const server = app.listen(0);
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // Chỉ còn một endpoint: route cũ dưới /auth không nằm trong luồng tự refresh phiên của client
        const authRes = await fetch(`${baseUrl}/api/auth/change-password`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword: "x", newPassword: "y", confirmPassword: "y" }),
        });
        assert.equal(authRes.status, 404);

        const profileRes = await fetch(`${baseUrl}/api/profile/password`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword: "x", newPassword: "y", confirmPassword: "y" }),
        });
        assert.equal(profileRes.status, 401);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
