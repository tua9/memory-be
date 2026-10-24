import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusCodes } from "http-status-codes";
import authRoute from "../src/routes/authRoute.js";
import { startTestServer } from "./helpers/testServer.js";

// Cookie bị xoá được gửi lại với giá trị rỗng, ví dụ "accessToken=; Path=/; Expires=Thu, 01 Jan 1970 ..."
const clearedCookies = (response: Response) =>
    response.headers.getSetCookie().filter((cookie) => /^[^=]+=;/.test(cookie)).map((cookie) => cookie.split("=")[0]);

test("a refresh with an unusable token clears both session cookies", async () => {
    const server = await startTestServer("/api/auth", authRoute);
    try {
        const response = await fetch(`${server.baseUrl}/refresh`, {
            method: "POST",
            headers: { Cookie: "refreshToken=not-a-jwt; accessToken=stale" },
        });
        assert.equal(response.status, StatusCodes.UNAUTHORIZED);
        assert.deepEqual(clearedCookies(response).sort(), ["accessToken", "refreshToken"]);
    } finally {
        await server.close();
    }
});

test("a refresh without a token is rejected and clears the session cookies", async () => {
    const server = await startTestServer("/api/auth", authRoute);
    try {
        const response = await fetch(`${server.baseUrl}/refresh`, { method: "POST" });
        assert.equal(response.status, StatusCodes.UNAUTHORIZED);
        assert.deepEqual(clearedCookies(response).sort(), ["accessToken", "refreshToken"]);
    } finally {
        await server.close();
    }
});
