import { randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/ApiError.js";
import {
  WORDS_LEVELS,
  type WordLevelConfig,
  type SupportedLanguageCode,
  SUPPORTED_LANGUAGES,
  DEFAULT_MEMORIZE_SECONDS,
  DEFAULT_RECALL_SECONDS,
} from "../config/wordsRules.js";
import { SEED_WORDS_BY_LANG } from "../data/seedWords.js";

export interface CreateSessionInput {
  level?: number;
  language?: string;
  memorizeSec?: number;
  groups?: number;
  prepTime?: number;
}

export interface SubmitSessionInput {
  answers?: (string | null)[];
  timeSpent?: number;
}

export interface WordItemReview {
  index: number;
  expected: string;
  answer: string | null;
  correct: boolean;
}

export interface SessionSubmissionResult {
  sessionId: string;
  level: number;
  language: SupportedLanguageCode;
  score: number;
  totalWords: number;
  requiredScore: number;
  passed: boolean;
  accuracy: number;
  timeSpent: number;
  unlockedNextLevel: number | null;
  review: WordItemReview[];
}

export interface ActiveWordSession {
  sessionId: string;
  level: number;
  language: SupportedLanguageCode;
  words: string[];
  memorizeSec: number;
  recallSec: number;
  groups: number;
  prepTime: number;
  startedAt: number;
  expiresAt: number;
  isSubmitted: boolean;
}

export const normalizeWord = (str: string | null | undefined): string => {
  if (!str) return "";
  return str
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ");
};

export class WordsSessionService {
  private activeSessions = new Map<string, ActiveWordSession>();
  private readonly SESSION_TTL_MS = 60 * 60 * 1000; // 1 giờ

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.activeSessions.entries()) {
      if (now > session.expiresAt) {
        this.activeSessions.delete(id);
      }
    }
  }

  private shuffle<T>(array: readonly T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = temp;
    }
    return copy;
  }

  public getLevels(): readonly WordLevelConfig[] {
    return WORDS_LEVELS;
  }

  public getLanguages() {
    return SUPPORTED_LANGUAGES;
  }

  public createSession(input: CreateSessionInput = {}) {
    this.cleanupExpiredSessions();

    const rawLevel = Number(input.level) || 1;
    const safeLevel = Math.max(1, Math.min(10, rawLevel));
    const levelConfig = WORDS_LEVELS.find((l) => l.level === safeLevel) || WORDS_LEVELS[0]!;

    // Xác thực ngôn ngữ
    const validLangCodes: string[] = SUPPORTED_LANGUAGES.map((l) => l.code);
    const rawLang = (input.language || "vi").toLowerCase() as SupportedLanguageCode;
    const language: SupportedLanguageCode = validLangCodes.includes(rawLang) ? rawLang : "vi";

    const memorizeSec =
      typeof input.memorizeSec === "number" && input.memorizeSec > 0
        ? input.memorizeSec
        : levelConfig.memorizeSeconds || DEFAULT_MEMORIZE_SECONDS;
    const recallSec = levelConfig.recallSeconds || DEFAULT_RECALL_SECONDS;
    const groups = Math.max(1, Math.min(5, Number(input.groups) || 1));
    const prepTime = Math.max(0, Math.min(30, Number(input.prepTime) || 0));

    // Lấy kho từ vựng tương ứng
    const wordPool = SEED_WORDS_BY_LANG[language] || SEED_WORDS_BY_LANG.vi;
    const count = levelConfig.itemCount;

    if (wordPool.length < count) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        `Kho từ vựng của ngôn ngữ "${language}" không đủ ${count} từ.`
      );
    }

    const shuffled = this.shuffle(wordPool);
    const selectedWords = shuffled.slice(0, count);

    const sessionId = randomUUID();
    const startedAt = Date.now();
    const expiresAt = startedAt + this.SESSION_TTL_MS;

    const session: ActiveWordSession = {
      sessionId,
      level: safeLevel,
      language,
      words: selectedWords,
      memorizeSec,
      recallSec,
      groups,
      prepTime,
      startedAt,
      expiresAt,
      isSubmitted: false,
    };

    this.activeSessions.set(sessionId, session);

    return {
      sessionId,
      level: safeLevel,
      language,
      words: selectedWords,
      totalWords: count,
      requiredScore: levelConfig.requiredScore,
      memorizeSec,
      recallSec,
      groups,
      prepTime,
      expiresAt,
    };
  }

  public submitSession(sessionId: string, input: SubmitSessionInput): SessionSubmissionResult {
    this.cleanupExpiredSessions();

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Phiên chơi không tồn tại hoặc đã hết hạn.");
    }

    if (session.isSubmitted) {
      throw new ApiError(StatusCodes.CONFLICT, "Ván chơi này đã được nộp trước đó.");
    }

    const answers = Array.isArray(input.answers) ? input.answers : [];
    const expectedWords = session.words;
    const levelConfig = WORDS_LEVELS.find((l) => l.level === session.level) || WORDS_LEVELS[0]!;

    let score = 0;
    const review: WordItemReview[] = [];

    for (let i = 0; i < expectedWords.length; i++) {
      const expected = expectedWords[i]!;
      const rawAnswer = answers[i] !== undefined && answers[i] !== null ? String(answers[i]) : null;
      const normalizedAnswer = normalizeWord(rawAnswer);
      const normalizedExpected = normalizeWord(expected);

      const isCorrect =
        normalizedAnswer.length > 0 && normalizedAnswer === normalizedExpected;

      if (isCorrect) score++;

      review.push({
        index: i + 1,
        expected,
        answer: rawAnswer,
        correct: isCorrect,
      });
    }

    const totalWords = expectedWords.length;
    const accuracy = totalWords > 0 ? Number((score / totalWords).toFixed(3)) : 0;
    const passed = score >= levelConfig.requiredScore;
    const unlockedNextLevel = passed && session.level < 10 ? session.level + 1 : null;
    const timeSpent = typeof input.timeSpent === "number" && input.timeSpent > 0 ? input.timeSpent : 0;

    session.isSubmitted = true;

    return {
      sessionId,
      level: session.level,
      language: session.language,
      score,
      totalWords,
      requiredScore: levelConfig.requiredScore,
      passed,
      accuracy,
      timeSpent,
      unlockedNextLevel,
      review,
    };
  }
}

export const wordsSessionService = new WordsSessionService();

