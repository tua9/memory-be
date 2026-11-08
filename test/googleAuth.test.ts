import assert from "node:assert/strict";
import { test } from "node:test";
import { authService } from "../src/services/user.service.js";
import ApiError from "../src/utils/ApiError.js";

test("googleSignIn: rejects empty or non-string token", async () => {
    await assert.rejects(
        async () => {
            await authService.googleSignIn("");
        },
        (error: unknown) => {
            assert(error instanceof ApiError);
            assert.equal(error.statusCode, 400);
            return true;
        },
    );

    await assert.rejects(
        async () => {
            await authService.googleSignIn(null);
        },
        (error: unknown) => {
            assert(error instanceof ApiError);
            assert.equal(error.statusCode, 400);
            return true;
        },
    );
});

test("setPassword: rejects short password (< 8 chars)", async () => {
    await assert.rejects(
        async () => {
            await authService.setPassword("507f1f77bcf86cd799439011", {
                newPassword: "short",
            });
        },
        (error: unknown) => {
            assert(error instanceof ApiError);
            assert.equal(error.statusCode, 400);
            return true;
        },
    );
});

