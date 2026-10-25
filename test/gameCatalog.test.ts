import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { createGameCatalogRouter } from "../src/routes/gameCatalogRoute.js";
import {
    buildGameCatalog,
    type GameCatalogItem,
    type GameCatalogService,
    type StoredGameProgress,
} from "../src/services/gameCatalog.service.js";
import { createInitialGameProgress } from "../src/services/roundSettlement.service.js";
import { TEST_USER_ID, acceptAuthentication, startTestServer } from "./helpers/testServer.js";

const progress = (overrides: Partial<StoredGameProgress>): StoredGameProgress => ({
    ...createInitialGameProgress(),
    ...overrides,
});

test("guests get the rules of every game without player progress", () => {
    const [card, image] = buildGameCatalog(null);

    assert.equal(card.gameName, "card");
    assert.equal(card.maxLevel, 10);
    assert.deepEqual(card.levels.slice(0, 3), [
        { level: 1, itemCount: 5 },
        { level: 2, itemCount: 9 },
        { level: 3, itemCount: 15 },
    ]);
    assert.deepEqual(card.customItems, { min: 5, max: 52 });
    assert.deepEqual(card.memorizeSecOptions, [30, 60, 120, 300]);
    assert.equal(card.defaultMemorizeSec, 120);
    assert.equal(card.player, null);

    assert.equal(image.gameName, "image");
    assert.equal(image.customItems, null);
    assert.equal(image.levels[9].itemCount, 24);
    assert.equal(image.player, null);
});

test("players get their unlocked level, best level and played count per game", () => {
    const [card, image] = buildGameCatalog({
        card: progress({
            unlockedLevel: 3,
            records: { bestLevel: 2, fastestMemorizeSecByLevel: {} },
            stats: { ...createInitialGameProgress().stats, played: 7 },
        }),
    });

    assert.deepEqual(card.player, { unlockedLevel: 3, bestLevel: 2, played: 7 });
    // Chưa chơi game này: bắt đầu từ level 1
    assert.deepEqual(image.player, { unlockedLevel: 1, bestLevel: null, played: 0 });
});

test("an unlocked level above the current max level is capped", () => {
    const [card] = buildGameCatalog({ card: progress({ unlockedLevel: 99 }) });
    assert.equal(card.player?.unlockedLevel, 10);
});

const createRecordingService = () => {
    const calls: (string | null)[] = [];
    const service: GameCatalogService = {
        listGames: async (userId) => {
            calls.push(userId);
            return [] as GameCatalogItem[];
        },
    };
    return { service, calls };
};

const asGuest: RequestHandler = (_request, _response, next) => next();

test("the game list works for guests and for signed-in players", async () => {
    const guest = createRecordingService();
    const guestServer = await startTestServer("/api/games", createGameCatalogRouter(asGuest, guest.service));
    const player = createRecordingService();
    const playerServer = await startTestServer("/api/games", createGameCatalogRouter(acceptAuthentication, player.service));
    try {
        const guestResponse = await fetch(guestServer.baseUrl);
        assert.equal(guestResponse.status, StatusCodes.OK);
        assert.deepEqual(await guestResponse.json(), { status: "success", data: { games: [] } });
        assert.deepEqual(guest.calls, [null]);

        assert.equal((await fetch(playerServer.baseUrl)).status, StatusCodes.OK);
        assert.deepEqual(player.calls, [TEST_USER_ID]);
    } finally {
        await guestServer.close();
        await playerServer.close();
    }
});
