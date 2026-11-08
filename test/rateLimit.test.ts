import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { errorHandlingMiddleware } from "../src/middlewares/errorHandlingMiddleware.js";
import { forgotPasswordIpLimiter } from "../src/middlewares/rateLimit.js";

test("forgot password IP limiter: 10 requests per window, then 429 with the shared rate-limit code", async () => {
    const app = express();
    app.post("/forgot", forgotPasswordIpLimiter, (_request, response) => {
        response.json({ status: "success" });
    });
    app.use(errorHandlingMiddleware);

    const server = app.listen(0);
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/forgot`;
    const originalError = console.error;
    console.error = () => undefined;

    try {
        for (let i = 0; i < 10; i++) {
            assert.equal((await fetch(url, { method: "POST" })).status, 200);
        }
        const blocked = await fetch(url, { method: "POST" });
        assert.equal(blocked.status, 429);
        const body = (await blocked.json()) as { code: string; errors: { retryAfterSeconds: number }[] };
        assert.equal(body.code, "RESET_LINK_RATE_LIMITED");
        assert.ok(body.errors[0]!.retryAfterSeconds > 0);
    } finally {
        console.error = originalError;
        await new Promise((resolve) => server.close(resolve));
    }
});
