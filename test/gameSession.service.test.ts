import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusCodes } from "http-status-codes";
import { gameSessionService } from "../src/services/gameSession.service.js";
import ApiError from "../src/utils/ApiError.js";
import { TEST_USER_ID } from "./helpers/testServer.js";

const isBadRequest = (error: unknown) => error instanceof ApiError && error.statusCode === StatusCodes.BAD_REQUEST;

// Các trường hợp dưới đây bị từ chối trước khi chạm tới database, nên không cần kết nối DB
test("starting a round with the old record-game payload is rejected instead of creating a round", async () => {
    await assert.rejects(
        gameSessionService.startRound(TEST_USER_ID, { userId: TEST_USER_ID, gameName: "card", time: 30, score: 5 }),
        (error: unknown) => isBadRequest(error) && (error as ApiError).code === "UNSUPPORTED_FIELD"
            && (error as ApiError).message === "Unsupported field(s): userId, time, score",
    );
});

test("starting a round needs a JSON object with a configured game", async () => {
    for (const body of [undefined, "card", ["card"], {}, { gameName: "number" }]) {
        await assert.rejects(gameSessionService.startRound(TEST_USER_ID, body), isBadRequest, JSON.stringify(body));
    }
});
