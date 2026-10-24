import "./helpers/testEnv.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { StatusCodes } from "http-status-codes";
import { optionalAuthentication } from "../src/middlewares/authMiddleware.js";
import { startTestServer } from "./helpers/testServer.js";

// Route thử: trả về người dùng mà middleware đã nhận ra, null nếu là khách
const probeRouter = express.Router().get("/", optionalAuthentication, (request, response) => {
    response.json({ userId: request.user?._id.toString() ?? null });
});

const withProbe = async (run: (url: string) => Promise<void>) => {
    const server = await startTestServer("/probe", probeRouter);
    try {
        await run(server.baseUrl);
    } finally {
        await server.close();
    }
};

test("requests without any session are treated as guests", async () => {
    await withProbe(async (url) => {
        const response = await fetch(url);
        assert.equal(response.status, StatusCodes.OK);
        assert.deepEqual(await response.json(), { userId: null });
    });
});

test("a session with only a refresh token asks the client to refresh instead of becoming a guest", async () => {
    await withProbe(async (url) => {
        const response = await fetch(url, { headers: { Cookie: "refreshToken=some-refresh-token" } });
        assert.equal(response.status, StatusCodes.UNAUTHORIZED);
        assert.equal((await response.json()).code, "TOKEN_EXPIRED");
    });
});

test("an access token is verified like a protected route", async () => {
    await withProbe(async (url) => {
        const response = await fetch(url, { headers: { Cookie: "accessToken=not-a-jwt" } });
        assert.equal(response.status, StatusCodes.UNAUTHORIZED);
        assert.equal((await response.json()).message, "Invalid access token");
    });
});
