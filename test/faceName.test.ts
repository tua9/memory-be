import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FaceNameService,
  normalizeName,
  FACENAME_LEVELS,
  type PersonRecord,
} from "../src/services/faceName.service.js";

test("FaceName: name normalization with Unicode NFC, trimming, lowercase, and diacritics", () => {
  // NFC normalization
  assert.equal(normalizeName("  ANNA  "), "anna");
  assert.equal(normalizeName("Thảo"), "thảo");
  assert.equal(normalizeName("  QUỲNH  "), "quỳnh");
  assert.equal(normalizeName("Đức"), "đức");

  // Diacritics MUST match (no accent stripping)
  assert.notEqual(normalizeName("Thảo"), "thao");
  assert.notEqual(normalizeName("Đức"), "duc");
  assert.notEqual(normalizeName("Quỳnh"), "quynh");
});

test("FaceName: scoring calculation, accuracy, and passing threshold", () => {
  const service = new FaceNameService();

  // Create round with Level 1 (6 faces)
  const round = service.createRound({ mode: "level", levelId: 1 });
  assert.equal(round.people.length, 6);

  const p1 = round.people[0]!;
  const p2 = round.people[1]!;
  const p3 = round.people[2]!;
  const p4 = round.people[3]!;
  const p5 = round.people[4]!;
  const p6 = round.people[5]!;

  // Case 1: 5 correct, 1 wrong
  // Score = 5 * (+1) + 1 * (-0.5) = 4.5
  // Max score = 6. Required score for level 1 is 4.
  // 4.5 >= 4 -> isPassed should be true
  const submitResult = service.submitRound(round.roundId, {
    answers: [
      { personId: p1.id, answer: p1.name },
      { personId: p2.id, answer: p2.name.toUpperCase() }, // Case-insensitive
      { personId: p3.id, answer: `  ${p3.name}  ` }, // Trimmed
      { personId: p4.id, answer: p4.name },
      { personId: p5.id, answer: p5.name },
      { personId: p6.id, answer: "WrongName" },
    ],
    timeUsedSeconds: 45,
  });

  assert.equal(submitResult.correctCount, 5);
  assert.equal(submitResult.incorrectCount, 1);
  assert.equal(submitResult.blankCount, 0);
  assert.equal(submitResult.score, 4.5);
  assert.equal(submitResult.maxScore, 6);
  assert.equal(submitResult.accuracy, 83.3);
  assert.equal(submitResult.isPassed, true);
  assert.equal(submitResult.nextLevelUnlocked, true);
});

test("FaceName: scoring handles blank answers (0 points) and negative scores", () => {
  const service = new FaceNameService();
  const round = service.createRound({ mode: "level", levelId: 1 });

  const p1 = round.people[0]!;
  const p2 = round.people[1]!;
  const p3 = round.people[2]!;
  const p4 = round.people[3]!;
  const p5 = round.people[4]!;
  const p6 = round.people[5]!;

  // 1 correct (+1), 2 blank (0), 3 wrong (-1.5) => Score = -0.5
  const result = service.submitRound(round.roundId, {
    answers: [
      { personId: p1.id, answer: p1.name },
      { personId: p2.id, answer: "" }, // blank
      { personId: p3.id, answer: "" }, // blank
      { personId: p4.id, answer: "Wrong1" },
      { personId: p5.id, answer: "Wrong2" },
      { personId: p6.id, answer: "Wrong3" },
    ],
  });

  assert.equal(result.correctCount, 1);
  assert.equal(result.blankCount, 2);
  assert.equal(result.incorrectCount, 3);
  assert.equal(result.score, -0.5);
  assert.equal(result.isPassed, false);
});

test("FaceName: round generation per level matches faceCount and categories", () => {
  const service = new FaceNameService();

  // Level 1: 6 faces, common
  const l1 = service.createRound({ mode: "level", levelId: 1 });
  assert.equal(l1.people.length, 6);
  // Verify unique person IDs
  const l1Ids = new Set(l1.people.map((p) => p.id));
  assert.equal(l1Ids.size, 6);

  // Level 2: 8 faces, common
  const l2 = service.createRound({ mode: "level", levelId: 2 });
  assert.equal(l2.people.length, 8);

  // Level 3: 10 faces, varied (mix of vietnamese and international)
  const l3 = service.createRound({ mode: "level", levelId: 3 });
  assert.equal(l3.people.length, 10);

  // Level 4: 12 faces, varied
  const l4 = service.createRound({ mode: "level", levelId: 4 });
  assert.equal(l4.people.length, 12);

  // Level 5: 14 faces, international
  const l5 = service.createRound({ mode: "level", levelId: 5 });
  assert.equal(l5.people.length, 14);

  // Level 6: 16 faces
  const l6 = service.createRound({ mode: "level", levelId: 6 });
  assert.equal(l6.people.length, 16);

  // Level 7: 18 faces
  const l7 = service.createRound({ mode: "level", levelId: 7 });
  assert.equal(l7.people.length, 18);

  // Level 8: 22 faces
  const l8 = service.createRound({ mode: "level", levelId: 8 });
  assert.equal(l8.people.length, 22);

  // Level 9: 26 faces
  const l9 = service.createRound({ mode: "level", levelId: 9 });
  assert.equal(l9.people.length, 26);

  // Level 10: 30 faces, international challenging
  const l10 = service.createRound({ mode: "level", levelId: 10 });
  assert.equal(l10.people.length, 30);
  const l10Ids = new Set(l10.people.map((p) => p.id));
  assert.equal(l10Ids.size, 30);

  // No exposed metadata in client person objects
  for (const person of l10.people) {
    assert.equal(typeof person.id, "number");
    assert.equal(typeof person.name, "string");
    assert.equal(typeof person.imageUrl, "string");
    assert.equal((person as any).confusableGroup, undefined);
    assert.equal((person as any).origin, undefined);
    assert.equal((person as any).difficulty, undefined);
  }
});

test("FaceName: Level 5 confusable pairs selection includes >= 5 confusable pairs", () => {
  const service = new FaceNameService();
  const rawPeople = (service as any).people as PersonRecord[];

  const l5People = service.pickLevel5Challenging(
    rawPeople.filter((p) => p.origin === "international" && p.difficulty === "challenging"),
    30,
  );

  assert.equal(l5People.length, 30);

  // Count how many confusable groups have at least 2 members selected
  const groupCounts = new Map<string, number>();
  for (const person of l5People) {
    if (person.confusableGroup) {
      groupCounts.set(person.confusableGroup, (groupCounts.get(person.confusableGroup) || 0) + 1);
    }
  }

  let pairCount = 0;
  for (const count of groupCounts.values()) {
    if (count >= 2) {
      pairCount++;
    }
  }

  assert.ok(
    pairCount >= 5,
    `Level 5 must have at least 5 confusable pairs, but got ${pairCount}`,
  );
});

test("FaceName: submission validation rejects duplicate IDs, unknown IDs, and duplicate submissions", () => {
  const service = new FaceNameService();
  const round = service.createRound({ mode: "level", levelId: 1 });

  // Unknown personId
  assert.throws(
    () => {
      service.submitRound(round.roundId, {
        answers: [{ personId: 99999, answer: "Someone" }],
      });
    },
    { message: /Unknown personId/ },
  );

  // Duplicate personId in answers
  assert.throws(
    () => {
      service.submitRound(round.roundId, {
        answers: [
          { personId: round.people[0]!.id, answer: "Test" },
          { personId: round.people[0]!.id, answer: "Test2" },
        ],
      });
    },
    { message: /Duplicate personId/ },
  );

  // Answer longer than 50 chars
  assert.throws(
    () => {
      service.submitRound(round.roundId, {
        answers: [
          { personId: round.people[0]!.id, answer: "a".repeat(51) },
        ],
      });
    },
    { message: /exceeds 50 characters/ },
  );

  // Successful first submission
  const res = service.submitRound(round.roundId, { answers: [] });
  assert.equal(res.blankCount, 6);

  // Duplicate submission rejected
  assert.throws(
    () => {
      service.submitRound(round.roundId, { answers: [] });
    },
    { message: /Duplicate submission/ },
  );
});

test("FaceName: Free training configuration validation and generation", () => {
  const service = new FaceNameService();

  // Valid free training round
  const freeRound = service.createRound({
    mode: "free",
    faceCount: 15,
    memorizeSeconds: 45,
    recallSeconds: 90,
  });

  assert.equal(freeRound.people.length, 15);
  assert.equal(freeRound.settings.faceCount, 15);
  assert.equal(freeRound.settings.memorizeSeconds, 45);
  assert.equal(freeRound.settings.recallSeconds, 90);

  // Invalid faceCount
  assert.throws(
    () => service.createRound({ mode: "free", faceCount: 2, memorizeSeconds: 30, recallSeconds: 30 }),
    { message: /faceCount must be between 3 and 30/ },
  );

  // Invalid memorizeSeconds
  assert.throws(
    () => service.createRound({ mode: "free", faceCount: 10, memorizeSeconds: 5, recallSeconds: 30 }),
    { message: /memorizeSeconds must be between 10 and 300/ },
  );
});

test("FaceName: overdue submission later than memorize+recall+10s is rejected", () => {
  const service = new FaceNameService();
  const round = service.createRound({ mode: "level", levelId: 1 });

  // Simulate round started in the past (overdue: memorize 60 + recall 120 + 10s = 190s)
  const active = service.getActiveRound(round.roundId);
  assert.ok(active);
  active!.startedAt = Date.now() - 200 * 1000; // 200s ago

  assert.throws(
    () => {
      service.submitRound(round.roundId, { answers: [] });
    },
    { message: /time limit exceeded/ },
  );
});

