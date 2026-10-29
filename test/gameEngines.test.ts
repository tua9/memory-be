import assert from "node:assert/strict";
import { test } from "node:test";
import { GAME_CONFIGS } from "../src/config/games.js";
import { CARD_CODES, cardEngine } from "../src/games/card.js";
import { IMAGE_CODES, imageEngine } from "../src/games/image.js";
import { getGameEngine, parseAnswers } from "../src/games/index.js";
import ApiError from "../src/utils/ApiError.js";

const isBadRequest = (error: unknown) => error instanceof ApiError && error.statusCode === 400;

test("every configured game has an engine", () => {
    assert.equal(getGameEngine("card"), cardEngine);
    assert.equal(getGameEngine("image"), imageEngine);
});

test("the card deck has 52 unique codes", () => {
    assert.equal(CARD_CODES.length, 52);
    assert.equal(new Set(CARD_CODES).size, 52);
    assert.ok(CARD_CODES.includes("AS"));
    assert.ok(CARD_CODES.includes("10H"));
});

test("card rounds draw unique cards from the deck", () => {
    const items = cardEngine.generateItems(15);
    assert.equal(items.length, 15);
    assert.equal(new Set(items).size, 15);
    assert.ok(items.every((code) => CARD_CODES.includes(code)));
    assert.equal(cardEngine.generateItems(52).length, 52);
    for (const count of [0, 53, 2.5]) {
        assert.throws(() => cardEngine.generateItems(count), RangeError);
    }
});

test("card recall offers the whole deck", () => {
    assert.deepEqual(cardEngine.buildRecallOptions(["AS", "2H"]), [...CARD_CODES]);
    assert.deepEqual(cardEngine.toView("QD"), { code: "QD" });
});

test("the image pool has unique codes and covers the highest level", () => {
    assert.equal(new Set(IMAGE_CODES).size, IMAGE_CODES.length);
    assert.ok(IMAGE_CODES.length >= Math.max(...GAME_CONFIGS.image.itemsPerLevel));
});

test("image rounds draw unique images from the pool and recall offers the same images shuffled", () => {
    const items = imageEngine.generateItems(10);
    assert.equal(new Set(items).size, 10);
    assert.ok(items.every((code) => IMAGE_CODES.includes(code)));
    assert.equal(imageEngine.generateItems(IMAGE_CODES.length).length, IMAGE_CODES.length);
    for (const count of [0, IMAGE_CODES.length + 1, 2.5]) {
        assert.throws(() => imageEngine.generateItems(count), RangeError);
    }

    const options = imageEngine.buildRecallOptions(items);
    assert.deepEqual([...options].sort(), [...items].sort());

    const view = imageEngine.toView(items[0]);
    assert.equal(view.code, items[0]);
    assert.ok(view.imageUrl?.startsWith(`https://images.unsplash.com/${items[0]}?`));
    // Ván cũ lưu mã ngẫu nhiên vẫn có ảnh để hiển thị
    assert.ok(imageEngine.toView("a1b2c3d4e5f6").imageUrl?.includes("a1b2c3d4e5f6"));
});

test("answers keep empty slots as null", () => {
    assert.deepEqual(parseAnswers(cardEngine, ["AS", "2H", "3D"], ["AS", null, "KC"]), ["AS", null, "KC"]);
});

test("answers with the wrong shape or invalid options are rejected", () => {
    const items = ["AS", "2H", "3D"];
    assert.throws(() => parseAnswers(cardEngine, items, ["AS", "2H"]), isBadRequest);
    assert.throws(() => parseAnswers(cardEngine, items, "AS,2H,3D"), isBadRequest);
    assert.throws(() => parseAnswers(cardEngine, items, ["AS", "2H", "1X"]), isBadRequest);
    assert.throws(() => parseAnswers(cardEngine, items, ["AS", 2, "3D"]), isBadRequest);
    assert.throws(() => parseAnswers(imageEngine, ["a1", "b2"], ["a1", "c3"]), isBadRequest);
});

test("an option cannot be used in more than one slot", () => {
    assert.throws(() => parseAnswers(cardEngine, ["AS", "2H", "3D"], ["AS", "AS", null]), isBadRequest);
});
