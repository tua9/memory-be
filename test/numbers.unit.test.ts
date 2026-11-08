import assert from "node:assert/strict";
import { test } from "node:test";
import {
    validateAnswersArray,
    validateCreateSessionInput,
} from "../src/services/numberSession.service.js";
import ApiError from "../src/utils/ApiError.js";
import {
    generateRandomDigits,
    gradeAnswers,
} from "../src/utils/numberGrading.js";

test("generateRandomDigits generates valid digits with length, allowed 0 prefix and repetitions", () => {
    const digits8 = generateRandomDigits(8);
    assert.equal(digits8.length, 8);
    for (const d of digits8) {
        assert.match(d, /^[0-9]$/);
    }

    const digits80 = generateRandomDigits(80);
    assert.equal(digits80.length, 80);

    // Over multiple generations, we expect digits to include '0' and repeating values
    let foundZero = false;
    let foundRepeats = false;
    for (let i = 0; i < 50; i++) {
        const sample = generateRandomDigits(20);
        if (sample.includes("0")) foundZero = true;
        const set = new Set(sample);
        if (set.size < sample.length) foundRepeats = true;
    }
    assert.equal(foundZero, true, "Should produce '0'");
    assert.equal(foundRepeats, true, "Should produce repeating digits");

    // Negative or 0 count
    assert.deepEqual(generateRandomDigits(0), []);
});

test("gradeAnswers handles perfect score", () => {
    const original = ["1", "2", "3", "4"];
    const answers = ["1", "2", "3", "4"];
    const result = gradeAnswers(original, answers);

    assert.equal(result.correctCount, 4);
    assert.equal(result.wrongCount, 0);
    assert.equal(result.blankCount, 0);
    assert.equal(result.score, 4);
    assert.equal(result.accuracy, 100);
    assert.equal(result.comparison.length, 4);
    assert.equal(result.comparison.every((c) => c.status === "correct"), true);
});

test("gradeAnswers handles mismatch at one position without stopping subsequent checks", () => {
    const original = ["0", "7", "2", "2", "9", "4", "0", "8"];
    const answers = ["0", "7", "3", "2", null, "4", "0", "8"];
    const result = gradeAnswers(original, answers);

    assert.equal(result.total, 8);
    assert.equal(result.correctCount, 6);
    assert.equal(result.wrongCount, 1);
    assert.equal(result.blankCount, 1);
    assert.equal(result.score, 6);
    assert.equal(result.accuracy, 75);

    assert.deepEqual(result.comparison[2], {
        index: 2,
        expected: "2",
        actual: "3",
        status: "wrong",
    });
    assert.deepEqual(result.comparison[3], {
        index: 3,
        expected: "2",
        actual: "2",
        status: "correct",
    });
    assert.deepEqual(result.comparison[4], {
        index: 4,
        expected: "9",
        actual: null,
        status: "blank",
    });
});

test("gradeAnswers handles all blank and all wrong answers", () => {
    const original = ["0", "1", "2"];
    const allBlank = [null, null, null];
    const blankResult = gradeAnswers(original, allBlank);
    assert.equal(blankResult.correctCount, 0);
    assert.equal(blankResult.wrongCount, 0);
    assert.equal(blankResult.blankCount, 3);
    assert.equal(blankResult.accuracy, 0);

    const allWrong = ["9", "9", "9"];
    const wrongResult = gradeAnswers(original, allWrong);
    assert.equal(wrongResult.correctCount, 0);
    assert.equal(wrongResult.wrongCount, 3);
    assert.equal(wrongResult.blankCount, 0);
    assert.equal(wrongResult.accuracy, 0);
});

test("gradeAnswers rounds accuracy to maximum 2 decimal places", () => {
    const original = ["1", "2", "3"];
    const answers = ["1", null, null];
    const result = gradeAnswers(original, answers);
    // 1 / 3 * 100 = 33.333333333... -> 33.33
    assert.equal(result.correctCount, 1);
    assert.equal(result.accuracy, 33.33);
});

test("validateCreateSessionInput enforces practice defaults and bounds", () => {
    // Defaults
    const defaults = validateCreateSessionInput({ mode: "practice" });
    assert.deepEqual(defaults, {
        mode: "practice",
        digitCount: 8,
        memorizeSeconds: 60,
        recallSeconds: 120,
    });

    // Custom valid practice values
    const valid = validateCreateSessionInput({
        mode: "practice",
        digitCount: 40,
        memorizeSeconds: 150,
        recallSeconds: 300,
    });
    assert.deepEqual(valid, {
        mode: "practice",
        digitCount: 40,
        memorizeSeconds: 150,
        recallSeconds: 300,
    });

    // Out of bounds: digitCount < 4 or > 80
    assert.throws(
        () => validateCreateSessionInput({ mode: "practice", digitCount: 3 }),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );
    assert.throws(
        () => validateCreateSessionInput({ mode: "practice", digitCount: 81 }),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );

    // Out of bounds: memorizeSeconds < 5 or > 300
    assert.throws(
        () => validateCreateSessionInput({ mode: "practice", memorizeSeconds: 4 }),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );
    assert.throws(
        () => validateCreateSessionInput({ mode: "practice", memorizeSeconds: 301 }),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );

    // Out of bounds: recallSeconds < 10 or > 600
    assert.throws(
        () => validateCreateSessionInput({ mode: "practice", recallSeconds: 9 }),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );
    assert.throws(
        () => validateCreateSessionInput({ mode: "practice", recallSeconds: 601 }),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );
});

test("validateCreateSessionInput handles challenge mode and rejects custom parameters", () => {
    // Standard challenge
    const challenge = validateCreateSessionInput({ mode: "challenge" });
    assert.deepEqual(challenge, {
        mode: "challenge",
        digitCount: 80,
        memorizeSeconds: 60,
        recallSeconds: 240,
    });

    // Rejects custom parameters in challenge mode
    assert.throws(
        () =>
            validateCreateSessionInput({
                mode: "challenge",
                digitCount: 40,
            }),
        (err: unknown) =>
            err instanceof ApiError &&
            err.statusCode === 400 &&
            err.message.includes("Custom parameters are not allowed in challenge mode"),
    );

    assert.throws(
        () =>
            validateCreateSessionInput({
                mode: "challenge",
                memorizeSeconds: 30,
            }),
        (err: unknown) =>
            err instanceof ApiError &&
            err.statusCode === 400 &&
            err.message.includes("Custom parameters are not allowed in challenge mode"),
    );
});

test("validateAnswersArray validates length and single digit format", () => {
    const valid = validateAnswersArray(["0", "9", null, "5"], 4);
    assert.deepEqual(valid, ["0", "9", null, "5"]);

    // Invalid length
    assert.throws(
        () => validateAnswersArray(["0", "1"], 4),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );

    // Non-digit string
    assert.throws(
        () => validateAnswersArray(["0", "a", null, "1"], 4),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );

    // Multi-digit string
    assert.throws(
        () => validateAnswersArray(["0", "12", null, "1"], 4),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );

    // Number instead of string
    assert.throws(
        () => validateAnswersArray(["0", 1 as unknown as string, null, "1"], 4),
        (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );
});

test("testDbGuard: extractDatabaseName correctly extracts db name from various URI formats", async () => {
    const { extractDatabaseName } = await import("./helpers/testDbGuard.js");
    assert.equal(extractDatabaseName("mongodb://localhost:27017/memio_test"), "memio_test");
    assert.equal(
        extractDatabaseName("mongodb+srv://user:pass@cluster.mongodb.net/memio_test?retryWrites=true&w=majority"),
        "memio_test",
    );
    assert.equal(extractDatabaseName("mongodb+srv://user:pass@cluster.mongodb.net/"), "");
    assert.equal(extractDatabaseName(""), "");
});

test("testDbGuard: assertSafeTestDatabase enforces safety guard conditions", async () => {
    const { assertSafeTestDatabase } = await import("./helpers/testDbGuard.js");

    // Missing test URI -> throws config error
    assert.throws(
        () => assertSafeTestDatabase("", "mongodb+srv://user:pass@cluster.mongodb.net/memio"),
        /CONFIG ERROR/,
    );
    assert.throws(
        () => assertSafeTestDatabase(undefined, "mongodb+srv://user:pass@cluster.mongodb.net/memio"),
        /CONFIG ERROR/,
    );

    // No db name in test URI -> throws
    assert.throws(
        () => assertSafeTestDatabase("mongodb+srv://user:pass@cluster.mongodb.net/", "mongodb+srv://user:pass@cluster.mongodb.net/memio"),
        /Could not determine database name/,
    );

    // Collision with app database -> throws safety guard error
    assert.throws(
        () => assertSafeTestDatabase(
            "mongodb+srv://user:pass@cluster.mongodb.net/memio?retryWrites=true",
            "mongodb+srv://user:pass@cluster.mongodb.net/memio?retryWrites=true",
        ),
        /matches the application database/,
    );

    // Test DB name does not contain "test" -> throws safety guard error
    assert.throws(
        () => assertSafeTestDatabase(
            "mongodb+srv://user:pass@cluster.mongodb.net/production_replica?retryWrites=true",
            "mongodb+srv://user:pass@cluster.mongodb.net/memio?retryWrites=true",
        ),
        /does not contain "test"/,
    );

    // Valid isolated test DB name -> passes and returns db name
    const dbName = assertSafeTestDatabase(
        "mongodb+srv://user:pass@cluster.mongodb.net/memio_test?retryWrites=true",
        "mongodb+srv://user:pass@cluster.mongodb.net/memio?retryWrites=true",
    );
    assert.equal(dbName, "memio_test");

    const localDbName = assertSafeTestDatabase(
        "mongodb://127.0.0.1:27017/memio_test",
        "mongodb+srv://user:pass@cluster.mongodb.net/memio?retryWrites=true",
    );
    assert.equal(localDbName, "memio_test");
});
