import assert from "node:assert/strict";
import { test } from "node:test";
import { GAME_CONFIGS } from "../src/config/games.js";
import { SEED_IMAGES } from "../src/data/seedImages.js";
import { SEED_WORDS_BY_LANG } from "../src/data/seedWords.js";
import { CARD_CODES, cardEngine } from "../src/games/card.js";
import { imageEngine } from "../src/games/image.js";
import { getGameEngine, parseAnswers } from "../src/games/index.js";
import ApiError from "../src/utils/ApiError.js";

const isBadRequest = (error: unknown) => error instanceof ApiError && error.statusCode === 400;

test("every configured game has an engine", () => {
    assert.equal(getGameEngine("card"), cardEngine);
    assert.equal(getGameEngine("image"), imageEngine);
    assert.ok(getGameEngine("word"));
    assert.ok(getGameEngine("number"));
    assert.ok(getGameEngine("facename"));
});

test("the card deck has 52 unique codes", () => {
    assert.equal(CARD_CODES.length, 52);
    assert.equal(new Set(CARD_CODES).size, 52);
    assert.ok(CARD_CODES.includes("AS"));
    assert.ok(CARD_CODES.includes("10H"));
});

test("card rounds draw unique cards from the deck", () => {
    const items = cardEngine.generateItems(15, 3);
    assert.equal(items.length, 15);
    assert.equal(new Set(items).size, 15);
    assert.ok(items.every((code) => CARD_CODES.includes(code)));
    assert.equal(cardEngine.generateItems(52, null).length, 52);
    for (const count of [0, 53, 2.5]) {
        assert.throws(() => cardEngine.generateItems(count, null), RangeError);
    }
});

test("card recall offers the whole deck", () => {
    assert.deepEqual(cardEngine.buildRecallOptions(["AS", "2H"]), [...CARD_CODES]);
    assert.deepEqual(cardEngine.toView("QD"), { code: "QD" });
});

const imagesOfLevel = (level: number) => SEED_IMAGES.filter((image) => image.level === level);

test("every image level has enough distinct images for its rounds", () => {
    assert.equal(new Set(SEED_IMAGES.map((image) => image.code)).size, SEED_IMAGES.length);
    GAME_CONFIGS.image.itemsPerLevel.forEach((itemCount, index) => {
        const images = imagesOfLevel(index + 1);
        assert.ok(images.length >= itemCount, `level ${index + 1}`);
        // Hai ô trong cùng một ván không được là cùng một ảnh
        assert.equal(new Set(images.map((image) => image.imageUrl)).size, images.length, `level ${index + 1}`);
    });
});

test("image rounds draw unique images of their level and recall offers the same images shuffled", () => {
    const levelCodes = imagesOfLevel(3).map((image) => image.code);
    const items = imageEngine.generateItems(10, 3);
    assert.equal(new Set(items).size, 10);
    assert.ok(items.every((code) => levelCodes.includes(code)));
    assert.equal(imageEngine.generateItems(levelCodes.length, 3).length, levelCodes.length);
    for (const count of [0, levelCodes.length + 1, 2.5]) {
        assert.throws(() => imageEngine.generateItems(count, 3), RangeError);
    }
    // Game hình không có ván tự chọn số lượng, cũng không có level ngoài kho ảnh
    assert.throws(() => imageEngine.generateItems(6, null), RangeError);
    assert.throws(() => imageEngine.generateItems(6, 11), RangeError);

    const options = imageEngine.buildRecallOptions(items);
    assert.deepEqual([...options].sort(), [...items].sort());
});

test("image codes resolve to their image, including codes saved by older rounds", () => {
    const [first] = SEED_IMAGES;
    assert.deepEqual(imageEngine.toView(first.code), { code: first.code, imageUrl: first.imageUrl });
    // Kho 24 ảnh trước đây lưu id ảnh Unsplash làm mã
    const unsplashCode = "photo-1543466835-00a7907e9de1";
    assert.ok(imageEngine.toView(unsplashCode).imageUrl?.startsWith(`https://images.unsplash.com/${unsplashCode}?`));
    // Trước nữa là mã ngẫu nhiên hiển thị qua picsum
    assert.ok(imageEngine.toView("a1b2c3d4e5f6").imageUrl?.includes("picsum.photos/seed/memio-a1b2c3d4e5f6"));
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

test("word engine generates unique words and compares with NFC normalization", () => {
    const wordEngine = getGameEngine("word");
    const items = wordEngine.generateItems(10, 1);
    assert.equal(items.length, 10);
    assert.equal(new Set(items).size, 10);
    assert.equal(wordEngine.matches?.("Mặt trời", "mặt trời"), true);
    assert.equal(wordEngine.matches?.("Mặt trời", "  MẶT TRỜI  "), true);
    assert.equal(wordEngine.matches?.("Mặt trời", "mặt trăng"), false);
    assert.equal(wordEngine.matches?.("Mặt trời", null), false);
    assert.deepEqual(
        wordEngine.parseAnswers?.(items, [items[0], null, ...Array(8).fill(null)]),
        [items[0], null, ...Array(8).fill(null)],
    );

    const enItems = wordEngine.generateItems(10, 1, undefined, "en");
    assert.equal(enItems.length, 10);
    assert.equal(new Set(enItems).size, 10);
    assert.ok(enItems.every((w) => typeof w === "string" && w.length > 0));

    const frItems = wordEngine.generateItems(10, 1, undefined, "fr");
    assert.equal(frItems.length, 10);
    assert.equal(new Set(frItems).size, 10);
});

test("all languages have unique seed words and enough words for level 10", () => {
    const issues: string[] = [];
    for (const [lang, words] of Object.entries(SEED_WORDS_BY_LANG)) {
        const norm = words.map((w) => w.trim().toLowerCase().normalize("NFC"));
        const dupes = norm.filter((w, i) => norm.indexOf(w) !== i);
        if (dupes.length > 0) issues.push(`${lang} dupes: ${dupes.join(", ")}`);
        if (words.length < 50) issues.push(`${lang} has only ${words.length} words`);
    }
    assert.deepEqual(issues, []);
});
