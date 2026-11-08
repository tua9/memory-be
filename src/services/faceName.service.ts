import { randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/ApiError.js";
import rawPeople from "../data/faceNamePeople.json" with { type: "json" };

export interface PersonRecord {
  id: number;
  name: string;
  imageUrl: string;
  origin: "vietnamese" | "international";
  difficulty: "common" | "varied" | "challenging";
  confusableGroup: string | null;
}

export interface ClientPerson {
  id: number;
  name: string;
  imageUrl: string;
}

export interface FaceNameLevelConfig {
  levelId: number;
  faceCount: number;
  memorizeSeconds: number;
  recallSeconds: number;
  nameType: string;
  unlockThreshold: number;
}

export const FACENAME_LEVELS: readonly FaceNameLevelConfig[] = [
  {
    levelId: 1,
    faceCount: 5,
    memorizeSeconds: 60,
    recallSeconds: 120,
    nameType: "Tên phổ biến",
    unlockThreshold: 0.7,
  },
  {
    levelId: 2,
    faceCount: 8,
    memorizeSeconds: 60,
    recallSeconds: 150,
    nameType: "Tên phổ biến",
    unlockThreshold: 0.7,
  },
  {
    levelId: 3,
    faceCount: 12,
    memorizeSeconds: 60,
    recallSeconds: 180,
    nameType: "Tên đa dạng (Việt + Quốc tế)",
    unlockThreshold: 0.7,
  },
  {
    levelId: 4,
    faceCount: 20,
    memorizeSeconds: 60,
    recallSeconds: 240,
    nameType: "Tên quốc tế phong phú",
    unlockThreshold: 0.7,
  },
  {
    levelId: 5,
    faceCount: 30,
    memorizeSeconds: 60,
    recallSeconds: 240,
    nameType: "Tên quốc tế dễ nhầm lẫn",
    unlockThreshold: 0.7,
  },
] as const;

export const normalizeName = (name: string): string => {
  return name.normalize("NFC").trim().toLowerCase();
};

export interface ActiveRound {
  roundId: string;
  mode: "level" | "free";
  levelId?: number;
  settings: {
    faceCount: number;
    memorizeSeconds: number;
    recallSeconds: number;
  };
  people: ClientPerson[];
  correctAnswers: Map<number, string>;
  startedAt: number;
  expiresAt: number;
  isSubmitted: boolean;
}

export interface CreateRoundInput {
  mode: "level" | "free";
  levelId?: number;
  faceCount?: number;
  memorizeSeconds?: number;
  recallSeconds?: number;
}

export interface SubmitAnswerItem {
  personId: number;
  answer: string;
}

export interface SubmitRoundInput {
  answers: SubmitAnswerItem[];
  timeUsedSeconds?: number;
}

export interface AnswerResultItem {
  personId: number;
  name: string;
  answer: string;
  isCorrect: boolean;
  isBlank: boolean;
}

export interface RoundSubmissionResult {
  roundId: string;
  mode: "level" | "free";
  levelId?: number;
  score: number;
  maxScore: number;
  accuracy: number;
  correctCount: number;
  incorrectCount: number;
  blankCount: number;
  isPassed: boolean;
  timeUsedSeconds: number;
  nextLevelUnlocked: boolean;
  results: AnswerResultItem[];
}

export class FaceNameService {
  private people: PersonRecord[];
  private activeRounds = new Map<string, ActiveRound>();
  private readonly ROUND_TTL_MS = 30 * 60 * 1000; // 30 minutes

  constructor(peopleData: PersonRecord[] = rawPeople as PersonRecord[]) {
    this.people = peopleData;
  }

  public getLevels(): readonly FaceNameLevelConfig[] {
    return FACENAME_LEVELS;
  }

  public cleanupExpiredRounds(): void {
    const now = Date.now();
    for (const [id, round] of this.activeRounds.entries()) {
      if (now > round.expiresAt) {
        this.activeRounds.delete(id);
      }
    }
  }

  public getActiveRound(roundId: string): ActiveRound | undefined {
    this.cleanupExpiredRounds();
    return this.activeRounds.get(roundId);
  }

  private shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = temp;
    }
    return copy;
  }

  public generateRoundPeople(levelId?: number, requestedFaceCount?: number): ClientPerson[] {
    let selected: PersonRecord[] = [];

    if (levelId !== undefined) {
      const config = FACENAME_LEVELS.find((l) => l.levelId === levelId);
      if (!config) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid levelId: ${levelId}`);
      }
      const count = config.faceCount;

      switch (levelId) {
        case 1:
        case 2: {
          // L1, L2: origin any, difficulty=common
          const pool = this.people.filter((p) => p.difficulty === "common");
          selected = this.pickUniqueNames(pool, count);
          break;
        }
        case 3: {
          // L3: difficulty=varied, mix of vietnamese + international
          const vnPool = this.people.filter((p) => p.origin === "vietnamese" && p.difficulty === "varied");
          const intlPool = this.people.filter((p) => p.origin === "international" && p.difficulty === "varied");
          const half = Math.floor(count / 2);
          const chosenVn = this.pickUniqueNames(vnPool, half);
          const usedNames = new Set(chosenVn.map((p) => normalizeName(p.name)));
          const chosenIntl = this.pickUniqueNames(
            intlPool.filter((p) => !usedNames.has(normalizeName(p.name))),
            count - chosenVn.length,
          );
          selected = this.shuffle([...chosenVn, ...chosenIntl]);
          break;
        }
        case 4: {
          // L4: origin=international, difficulty in (varied, challenging)
          const pool = this.people.filter(
            (p) => p.origin === "international" && (p.difficulty === "varied" || p.difficulty === "challenging"),
          );
          selected = this.pickUniqueNames(pool, count);
          break;
        }
        case 5: {
          // L5: origin=international, difficulty=challenging, >= 5 confusable pairs when possible
          const pool = this.people.filter((p) => p.origin === "international" && p.difficulty === "challenging");
          selected = this.pickLevel5Challenging(pool, count);
          break;
        }
        default:
          throw new ApiError(StatusCodes.BAD_REQUEST, `Unsupported level: ${levelId}`);
      }
    } else {
      // Free training: names from whole dataset
      const count = requestedFaceCount ?? 10;
      selected = this.pickUniqueNames(this.people, count);
    }

    return selected.map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.imageUrl,
    }));
  }

  private pickUniqueNames(pool: PersonRecord[], count: number): PersonRecord[] {
    const shuffled = this.shuffle(pool);
    const chosen: PersonRecord[] = [];
    const usedNames = new Set<string>();

    for (const person of shuffled) {
      const norm = normalizeName(person.name);
      if (!usedNames.has(norm)) {
        usedNames.add(norm);
        chosen.push(person);
        if (chosen.length === count) break;
      }
    }

    if (chosen.length < count) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Not enough unique names in dataset: needed ${count}, found ${chosen.length}`,
      );
    }
    return chosen;
  }

  public pickLevel5Challenging(pool: PersonRecord[], count: number): PersonRecord[] {
    // Group people by confusableGroup
    const groupMap = new Map<string, PersonRecord[]>();
    const withoutGroup: PersonRecord[] = [];

    for (const person of pool) {
      if (person.confusableGroup) {
        const list = groupMap.get(person.confusableGroup) || [];
        list.push(person);
        groupMap.set(person.confusableGroup, list);
      } else {
        withoutGroup.push(person);
      }
    }

    // Filter groups that have at least 2 members
    const eligibleGroups = Array.from(groupMap.entries()).filter(([_, members]) => members.length >= 2);
    const shuffledGroups = this.shuffle(eligibleGroups);

    // Pick at least 5 confusable pairs (or as many as available, up to count / 2)
    const targetPairCount = Math.min(Math.floor(count / 2), Math.max(5, Math.min(shuffledGroups.length, 6)));
    const chosen: PersonRecord[] = [];
    const usedNames = new Set<string>();

    for (let i = 0; i < targetPairCount && i < shuffledGroups.length; i++) {
      const [_, members] = shuffledGroups[i]!;
      const shuffledMembers = this.shuffle(members);
      // Select 2 distinct names
      let addedInGroup = 0;
      for (const m of shuffledMembers) {
        const norm = normalizeName(m.name);
        if (!usedNames.has(norm)) {
          usedNames.add(norm);
          chosen.push(m);
          addedInGroup++;
          if (addedInGroup === 2) break;
        }
      }
    }

    // Remaining spots filled from rest of pool
    const remainingPool = this.shuffle(pool.filter((p) => !chosen.some((c) => c.id === p.id)));
    for (const person of remainingPool) {
      if (chosen.length >= count) break;
      const norm = normalizeName(person.name);
      if (!usedNames.has(norm)) {
        usedNames.add(norm);
        chosen.push(person);
      }
    }

    if (chosen.length < count) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Cannot fulfill ${count} people for Level 5: found ${chosen.length}`,
      );
    }

    return this.shuffle(chosen);
  }

  public createRound(input: CreateRoundInput): {
    roundId: string;
    mode: "level" | "free";
    levelId?: number;
    settings: {
      faceCount: number;
      memorizeSeconds: number;
      recallSeconds: number;
    };
    people: ClientPerson[];
  } {
    this.cleanupExpiredRounds();

    if (input.mode === "level") {
      const levelId = Number(input.levelId);
      if (!levelId || isNaN(levelId) || levelId < 1 || levelId > 5) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "levelId must be between 1 and 5");
      }
      const config = FACENAME_LEVELS.find((l) => l.levelId === levelId)!;
      const people = this.generateRoundPeople(levelId);

      const roundId = randomUUID();
      const startedAt = Date.now();
      const expiresAt = startedAt + this.ROUND_TTL_MS;

      const correctAnswers = new Map<number, string>();
      for (const p of people) {
        correctAnswers.set(p.id, p.name);
      }

      const activeRound: ActiveRound = {
        roundId,
        mode: "level",
        levelId,
        settings: {
          faceCount: config.faceCount,
          memorizeSeconds: config.memorizeSeconds,
          recallSeconds: config.recallSeconds,
        },
        people,
        correctAnswers,
        startedAt,
        expiresAt,
        isSubmitted: false,
      };

      this.activeRounds.set(roundId, activeRound);

      return {
        roundId,
        mode: "level",
        levelId,
        settings: activeRound.settings,
        people,
      };
    } else if (input.mode === "free") {
      const faceCount = Number(input.faceCount);
      const memorizeSeconds = Number(input.memorizeSeconds);
      const recallSeconds = Number(input.recallSeconds);

      if (isNaN(faceCount) || faceCount < 3 || faceCount > 30) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "faceCount must be between 3 and 30");
      }
      if (isNaN(memorizeSeconds) || memorizeSeconds < 10 || memorizeSeconds > 300) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "memorizeSeconds must be between 10 and 300");
      }
      if (isNaN(recallSeconds) || recallSeconds < 10 || recallSeconds > 300) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "recallSeconds must be between 10 and 300");
      }

      const people = this.generateRoundPeople(undefined, faceCount);

      const roundId = randomUUID();
      const startedAt = Date.now();
      const expiresAt = startedAt + this.ROUND_TTL_MS;

      const correctAnswers = new Map<number, string>();
      for (const p of people) {
        correctAnswers.set(p.id, p.name);
      }

      const activeRound: ActiveRound = {
        roundId,
        mode: "free",
        settings: {
          faceCount,
          memorizeSeconds,
          recallSeconds,
        },
        people,
        correctAnswers,
        startedAt,
        expiresAt,
        isSubmitted: false,
      };

      this.activeRounds.set(roundId, activeRound);

      return {
        roundId,
        mode: "free",
        settings: activeRound.settings,
        people,
      };
    } else {
      throw new ApiError(StatusCodes.BAD_REQUEST, "mode must be 'level' or 'free'");
    }
  }

  public submitRound(roundId: string, input: SubmitRoundInput): RoundSubmissionResult {
    this.cleanupExpiredRounds();

    const round = this.activeRounds.get(roundId);
    if (!round) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Round not found or has expired");
    }

    if (round.isSubmitted) {
      throw new ApiError(StatusCodes.CONFLICT, "Duplicate submission: this round has already been submitted");
    }

    // Check time limit: reject submissions later than memorize + recall + 10s
    const maxAllowedMs =
      round.startedAt + (round.settings.memorizeSeconds + round.settings.recallSeconds + 10) * 1000;
    const now = Date.now();
    if (now > maxAllowedMs) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Submission rejected: time limit exceeded");
    }

    if (!input || !Array.isArray(input.answers)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "answers must be an array");
    }

    // Validate person IDs and answers
    const submittedPersonIds = new Set<number>();
    const answerMap = new Map<number, string>();

    for (let i = 0; i < input.answers.length; i++) {
      const item = input.answers[i];
      if (!item || typeof item.personId !== "number") {
        throw new ApiError(StatusCodes.BAD_REQUEST, `answers[${i}] must have a numeric personId`);
      }
      if (submittedPersonIds.has(item.personId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Duplicate personId in answers: ${item.personId}`);
      }
      submittedPersonIds.add(item.personId);

      if (!round.correctAnswers.has(item.personId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Unknown personId: ${item.personId}`);
      }

      if (typeof item.answer !== "string") {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Answer for personId ${item.personId} must be a string`);
      }
      if (item.answer.length > 50) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Answer for personId ${item.personId} exceeds 50 characters`);
      }

      answerMap.set(item.personId, item.answer);
    }

    // Grade each person in authoritative round.people
    let correctCount = 0;
    let incorrectCount = 0;
    let blankCount = 0;
    let internalPoints = 0; // correct=+2, wrong=-1, blank=0

    const results: AnswerResultItem[] = [];

    for (const person of round.people) {
      const correctName = round.correctAnswers.get(person.id)!;
      const rawAnswer = answerMap.get(person.id) ?? "";
      const trimmed = rawAnswer.trim();

      if (trimmed === "") {
        blankCount++;
        results.push({
          personId: person.id,
          name: correctName,
          answer: "",
          isCorrect: false,
          isBlank: true,
        });
      } else if (normalizeName(trimmed) === normalizeName(correctName)) {
        correctCount++;
        internalPoints += 2;
        results.push({
          personId: person.id,
          name: correctName,
          answer: rawAnswer,
          isCorrect: true,
          isBlank: false,
        });
      } else {
        incorrectCount++;
        internalPoints -= 1;
        results.push({
          personId: person.id,
          name: correctName,
          answer: rawAnswer,
          isCorrect: false,
          isBlank: false,
        });
      }
    }

    const totalFaces = round.people.length;
    const maxScore = totalFaces; // each correct is +1 display
    const score = internalPoints / 2; // integer internal / 2
    const accuracy = Math.round((correctCount / totalFaces) * 1000) / 10; // e.g. 83.3%

    // Pass threshold: score >= 70% of maxScore
    const isPassed = score >= 0.7 * maxScore;

    round.isSubmitted = true;

    const timeUsedSeconds =
      typeof input.timeUsedSeconds === "number" && input.timeUsedSeconds >= 0
        ? Math.round(input.timeUsedSeconds)
        : Math.round((now - round.startedAt) / 1000);

    const nextLevelUnlocked =
      round.mode === "level" && isPassed && typeof round.levelId === "number" && round.levelId < 5;

    return {
      roundId: round.roundId,
      mode: round.mode,
      levelId: round.levelId,
      score,
      maxScore,
      accuracy,
      correctCount,
      incorrectCount,
      blankCount,
      isPassed,
      timeUsedSeconds,
      nextLevelUnlocked,
      results,
    };
  }
}

export const faceNameService = new FaceNameService();

