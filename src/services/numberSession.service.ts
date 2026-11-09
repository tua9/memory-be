import { StatusCodes } from "http-status-codes";
import { recordNumberCompletion } from "./numberSettlement.service.js";
import { mongo } from "mongoose";
import { NUMBER_LEVEL_DIGITS, NUMBER_MAX_LEVEL } from "../config/numbers.js";
import { PROGRESS_TIME_ZONE } from "../config/progression.js";
import { toDateKey } from "../utils/date.js";
import type {
    NumberCompletionReason,
    NumberGameMode,
    NumberSessionDocument,
    NumberSessionPhase,
} from "../models/numberSession.js";
import {
    numberSessionRepository,
    type HistoryQueryOptions,
    type NumberSessionRepository,
} from "../repositories/numberSession.repository.js";
import ApiError from "../utils/ApiError.js";
import {
    generateRandomDigits,
    gradeAnswers,
    type ComparisonItem,
    type GradingResult,
} from "../utils/numberGrading.js";

export interface CreateSessionInput {
    mode?: unknown;
    level?: unknown;
    digitCount?: unknown;
    memorizeSeconds?: unknown;
    recallSeconds?: unknown;
}

export interface SaveAnswersInput {
    revision: number;
    answers: (string | null)[];
}

export interface SubmitSessionInput {
    revision?: number;
    answers?: (string | null)[];
}

export interface SessionResultData {
    score: number;
    accuracy: number;
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    total: number;
    completionReason: NumberCompletionReason;
    memorizeUsedMs: number | null;
}

export interface FormattedSessionResponse {
    id: string;
    mode: NumberGameMode;
    level: number | null;
    digitCount: number;
    memorizeSeconds: number;
    recallSeconds: number;
    phase: NumberSessionPhase;
    revision: number;
    startedAt: string;
    memorizeEndsAt: string;
    recallStartedAt: string | null;
    recallEndsAt: string | null;
    completedAt: string | null;
    completionReason: NumberCompletionReason | null;
    memorizeUsedMs: number | null;
    serverNow: string;
    digits?: string[];
    answers?: (string | null)[];
    result?: SessionResultData;
    comparison?: ComparisonItem[];
}

export interface HistoryItemSummary {
    id: string;
    mode: NumberGameMode;
    level: number | null;
    digitCount: number;
    memorizeSeconds: number;
    recallSeconds: number;
    phase: NumberSessionPhase;
    revision: number;
    startedAt: string;
    completedAt: string | null;
    completionReason: NumberCompletionReason | null;
    score: number | null;
    accuracy: number | null;
    memorizeUsedMs: number | null;
    createdAt: string;
}

export interface HistoryResponse {
    items: HistoryItemSummary[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface TodayChallengeStatus {
    played: boolean;
    phase?: NumberSessionPhase;
    digitCount?: number;
    score?: number;
    correctCount?: number;
    accuracy?: number;
    memorizeUsedMs?: number | null;
}

export interface NumberProgressResponse {
    unlockedLevel: number;
    digitCounts: number[];
    todayChallenge: TodayChallengeStatus;
}

const alreadyPlayedChallenge = () =>
    new ApiError(StatusCodes.FORBIDDEN, "You have already played today's challenge", [], "CHALLENGE_PLAYED");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isValidDigit = (item: unknown): item is string | null => {
    if (item === null) return true;
    return typeof item === "string" && /^[0-9]$/.test(item);
};

export const validateCreateSessionInput = (
    body: unknown,
): {
    mode: NumberGameMode;
    digitCount: number;
    memorizeSeconds: number;
    recallSeconds: number;
    // Chỉ có khi chơi theo cấp: số chữ số lấy theo bảng cấp, không do client tự đặt
    level?: number;
} => {
    if (!isRecord(body)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "A JSON object is required");
    }

    const { mode = "practice", level, digitCount, memorizeSeconds, recallSeconds } = body;

    if (mode !== "practice" && mode !== "challenge") {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'mode must be either "practice" or "challenge"',
        );
    }

    if (mode === "challenge") {
        if (
            level !== undefined ||
            digitCount !== undefined ||
            memorizeSeconds !== undefined ||
            recallSeconds !== undefined
        ) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "Custom parameters are not allowed in challenge mode",
            );
        }
        return {
            mode: "challenge",
            digitCount: 80,
            memorizeSeconds: 60,
            recallSeconds: 240,
        };
    }

    // Practice mode
    let validDigitCount = 8;
    let validLevel: number | undefined;
    if (level !== undefined) {
        if (digitCount !== undefined) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "Send either level or digitCount, not both",
            );
        }
        if (
            typeof level !== "number" ||
            !Number.isInteger(level) ||
            level < 1 ||
            level > NUMBER_MAX_LEVEL
        ) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                `level must be an integer between 1 and ${NUMBER_MAX_LEVEL}`,
            );
        }
        validLevel = level;
        validDigitCount = NUMBER_LEVEL_DIGITS[level - 1];
    }
    if (digitCount !== undefined) {
        if (
            typeof digitCount !== "number" ||
            !Number.isInteger(digitCount) ||
            digitCount < 4 ||
            digitCount > 80
        ) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "digitCount must be an integer between 4 and 80",
            );
        }
        validDigitCount = digitCount;
    }

    let validMemorizeSeconds = 60;
    if (memorizeSeconds !== undefined) {
        if (
            typeof memorizeSeconds !== "number" ||
            !Number.isInteger(memorizeSeconds) ||
            memorizeSeconds < 5 ||
            memorizeSeconds > 300
        ) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "memorizeSeconds must be an integer between 5 and 300",
            );
        }
        validMemorizeSeconds = memorizeSeconds;
    }

    let validRecallSeconds = 120;
    if (recallSeconds !== undefined) {
        if (
            typeof recallSeconds !== "number" ||
            !Number.isInteger(recallSeconds) ||
            recallSeconds < 10 ||
            recallSeconds > 600
        ) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "recallSeconds must be an integer between 10 and 600",
            );
        }
        validRecallSeconds = recallSeconds;
    }

    return {
        mode: "practice",
        digitCount: validDigitCount,
        memorizeSeconds: validMemorizeSeconds,
        recallSeconds: validRecallSeconds,
        ...(validLevel !== undefined ? { level: validLevel } : {}),
    };
};

export const validateAnswersArray = (
    answers: unknown,
    expectedLength: number,
): (string | null)[] => {
    if (!Array.isArray(answers)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "answers must be an array");
    }

    if (answers.length !== expectedLength) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `answers array must contain exactly ${expectedLength} items`,
        );
    }

    for (let i = 0; i < answers.length; i++) {
        const item = answers[i];
        if (!isValidDigit(item)) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                `Invalid answer at index ${i}: must be a single digit string "0"-"9" or null`,
            );
        }
    }

    return answers as (string | null)[];
};

export class NumberSessionService {
    constructor(
        private repository: NumberSessionRepository = numberSessionRepository,
        private clock: () => Date = () => new Date(),
        private recordCompletion: (session: NumberSessionDocument) => Promise<void> = recordNumberCompletion,
    ) {}

    /**
     * Đồng bộ deadline nếu thời gian hiện tại đã vượt qua hạn chót.
     */
    async syncDeadlines(
        session: NumberSessionDocument,
        now: Date = this.clock(),
    ): Promise<NumberSessionDocument> {
        if (session.phase === "completed") {
            await this.recordCompletion(session);
            return session;
        }

        if (session.phase === "memorizing") {
            if (now.getTime() > session.memorizeEndsAt.getTime()) {
                const recallEndsAt = new Date(
                    session.memorizeEndsAt.getTime() + session.recallSeconds * 1000,
                );

                if (now.getTime() >= recallEndsAt.getTime()) {
                    // Cả giai đoạn ghi nhớ và recall đều đã hết giờ
                    const grading = gradeAnswers(session.originalDigits, session.answers);
                    const updated = await this.repository.completeExpiredSessionById(
                        session._id.toString(),
                        {
                            phase: "completed",
                            completionReason: "timeout",
                            completedAt: recallEndsAt,
                            correctCount: grading.correctCount,
                            wrongCount: grading.wrongCount,
                            blankCount: grading.blankCount,
                            score: grading.score,
                            accuracy: grading.accuracy,
                            recallStartedAt: session.memorizeEndsAt,
                            recallEndsAt,
                            memorizeUsedMs: session.memorizeSeconds * 1000,
                        },
                    );
                    if (updated?.phase === "completed") await this.recordCompletion(updated);
                    return updated ?? session;
                } else {
                    // Hết giờ ghi nhớ, chuyển sang recall bắt đầu từ memorizeEndsAt
                    const updated =
                        await this.repository.transitionExpiredMemorizingToRecalling(
                            session._id.toString(),
                            session.memorizeEndsAt,
                            recallEndsAt,
                            session.memorizeSeconds * 1000,
                        );
                    return updated ?? session;
                }
            }
        } else if (session.phase === "recalling") {
            if (session.recallEndsAt && now.getTime() >= session.recallEndsAt.getTime()) {
                // Hết giờ recall, tự động hoàn tất với đáp án đã lưu
                const grading = gradeAnswers(session.originalDigits, session.answers);
                const updated = await this.repository.completeExpiredSessionById(
                    session._id.toString(),
                    {
                        phase: "completed",
                        completionReason: "timeout",
                        completedAt: session.recallEndsAt,
                        correctCount: grading.correctCount,
                        wrongCount: grading.wrongCount,
                        blankCount: grading.blankCount,
                        score: grading.score,
                        accuracy: grading.accuracy,
                    },
                );
                if (updated?.phase === "completed") await this.recordCompletion(updated);
                return updated ?? session;
            }
        }

        return session;
    }

    /**
     * Tạo một lượt chơi mới.
     */
    async createSession(
        userId: string,
        rawInput: unknown,
    ): Promise<FormattedSessionResponse> {
        const input = validateCreateSessionInput(rawInput);
        const now = this.clock();

        // Chơi theo cấp: chỉ được chọn cấp đã mở
        if (input.level !== undefined && input.level > (await this.getUnlockedLevel(userId))) {
            throw new ApiError(StatusCodes.FORBIDDEN, `Level ${input.level} is locked`, [], "LEVEL_LOCKED");
        }

        // Thử thách: mỗi tài khoản một lượt mỗi ngày (giờ Việt Nam)
        const challengeDate = input.mode === "challenge" ? toDateKey(now, PROGRESS_TIME_ZONE) : null;
        if (challengeDate && (await this.repository.findChallengeOn(userId, challengeDate))) {
            throw alreadyPlayedChallenge();
        }

        const originalDigits = generateRandomDigits(input.digitCount);
        const answers = new Array<null>(input.digitCount).fill(null);
        const memorizeEndsAt = new Date(now.getTime() + input.memorizeSeconds * 1000);

        try {
            const newSession = await this.repository.create({
                userId,
                mode: input.mode,
                level: input.level ?? null,
                challengeDate,
                digitCount: input.digitCount,
                memorizeSeconds: input.memorizeSeconds,
                recallSeconds: input.recallSeconds,
                originalDigits,
                answers,
                phase: "memorizing",
                revision: 0,
                startedAt: now,
                memorizeEndsAt,
            });
            return this.formatSessionResponse(newSession, now);
        } catch (error) {
            // Hai yêu cầu bắt đầu thử thách gửi cùng lúc: unique index chỉ cho một ván được tạo
            if (challengeDate && error instanceof mongo.MongoServerError && error.code === 11000) {
                throw alreadyPlayedChallenge();
            }
            throw error;
        }
    }

    /**
     * Cấp cao nhất đang mở: cấp 1, hoặc cấp ngay sau cấp cao nhất từng nhớ đúng hết.
     */
    async getUnlockedLevel(userId: string): Promise<number> {
        const best = await this.repository.findHighestPerfectLevel(userId);
        return Math.min(NUMBER_MAX_LEVEL, (best ?? 0) + 1);
    }

    /**
     * Tiến độ cho màn thiết lập: cấp đã mở, số chữ số mỗi cấp và lượt thử thách hôm nay.
     */
    async getProgress(userId: string): Promise<NumberProgressResponse> {
        const now = this.clock();
        const [unlockedLevel, todaySession] = await Promise.all([
            this.getUnlockedLevel(userId),
            this.repository.findChallengeOn(userId, toDateKey(now, PROGRESS_TIME_ZONE)),
        ]);

        let todayChallenge: TodayChallengeStatus = { played: false };
        if (todaySession) {
            // Ván thử thách bỏ dở quá hạn được chấm luôn, để trạng thái hôm nay đúng
            const today = await this.syncDeadlines(todaySession, now);
            todayChallenge = { played: true, phase: today.phase, digitCount: today.digitCount };
            if (today.phase === "completed") {
                todayChallenge = {
                    ...todayChallenge,
                    score: today.score ?? 0,
                    correctCount: today.correctCount ?? 0,
                    accuracy: today.accuracy ?? 0,
                    memorizeUsedMs: today.memorizeUsedMs,
                };
            }
        }

        return { unlockedLevel, digitCounts: [...NUMBER_LEVEL_DIGITS], todayChallenge };
    }

    /**
     * Lấy thông tin lượt chơi và đồng bộ trạng thái deadline.
     */
    async getSession(
        userId: string,
        sessionId: string,
    ): Promise<FormattedSessionResponse> {
        const rawSession = await this.repository.findByIdAndUser(sessionId, userId);
        if (!rawSession) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Game session not found");
        }

        const now = this.clock();
        const session = await this.syncDeadlines(rawSession, now);
        return this.formatSessionResponse(session, now);
    }

    /**
     * Kết thúc ghi nhớ sớm hoặc chuyển sang recall.
     */
    async startRecall(
        userId: string,
        sessionId: string,
    ): Promise<FormattedSessionResponse> {
        const rawSession = await this.repository.findByIdAndUser(sessionId, userId);
        if (!rawSession) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Game session not found");
        }

        const now = this.clock();
        let session = await this.syncDeadlines(rawSession, now);

        if (session.phase === "completed") {
            return this.formatSessionResponse(session, now);
        }

        if (session.phase === "recalling") {
            // Đã ở phase recalling, trả về trạng thái hiện tại, không reset thời gian
            return this.formatSessionResponse(session, now);
        }

        // Đang ở phase memorizing
        const memorizeEndsAtMs = session.memorizeEndsAt.getTime();
        let recallStartedAt: Date;
        let recallEndsAt: Date;
        let memorizeUsedMs: number;

        if (now.getTime() <= memorizeEndsAtMs) {
            // Kết thúc ghi nhớ sớm
            recallStartedAt = now;
            recallEndsAt = new Date(now.getTime() + session.recallSeconds * 1000);
            memorizeUsedMs = recallStartedAt.getTime() - session.startedAt.getTime();
        } else {
            // Đã quá hạn ghi nhớ, recall bắt đầu từ memorizeEndsAt
            recallStartedAt = session.memorizeEndsAt;
            recallEndsAt = new Date(memorizeEndsAtMs + session.recallSeconds * 1000);
            memorizeUsedMs = session.memorizeSeconds * 1000;
        }

        if (now.getTime() >= recallEndsAt.getTime()) {
            // Recall cũng đã quá hạn!
            const grading = gradeAnswers(session.originalDigits, session.answers);
            const completed = await this.repository.completeSession(
                sessionId,
                userId,
                null,
                {
                    phase: "completed",
                    completionReason: "timeout",
                    completedAt: recallEndsAt,
                    correctCount: grading.correctCount,
                    wrongCount: grading.wrongCount,
                    blankCount: grading.blankCount,
                    score: grading.score,
                    accuracy: grading.accuracy,
                    recallStartedAt,
                    recallEndsAt,
                    memorizeUsedMs,
                },
            );
            return this.formatSessionResponse(completed ?? session, now);
        }

        const updated = await this.repository.transitionToRecalling(
            sessionId,
            userId,
            recallStartedAt,
            recallEndsAt,
            memorizeUsedMs,
        );

        session = updated ?? (await this.repository.findByIdAndUser(sessionId, userId))!;
        return this.formatSessionResponse(session, now);
    }

    /**
     * Lưu đáp án (autosave).
     */
    async saveAnswers(
        userId: string,
        sessionId: string,
        body: unknown,
    ): Promise<FormattedSessionResponse> {
        if (!isRecord(body)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "A JSON object is required");
        }

        const { revision, answers } = body;
        if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "revision is required and must be a non-negative integer",
            );
        }

        const rawSession = await this.repository.findByIdAndUser(sessionId, userId);
        if (!rawSession) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Game session not found");
        }

        const validatedAnswers = validateAnswersArray(answers, rawSession.digitCount);

        const now = this.clock();
        const session = await this.syncDeadlines(rawSession, now);

        if (session.phase === "completed") {
            throw new ApiError(
                StatusCodes.CONFLICT,
                "Game session is already completed",
            );
        }

        if (session.phase !== "recalling") {
            throw new ApiError(
                StatusCodes.CONFLICT,
                "Cannot save answers when not in recalling phase",
            );
        }

        if (session.recallEndsAt && now.getTime() >= session.recallEndsAt.getTime()) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                "Recall time limit has expired",
            );
        }

        if (session.revision !== revision) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                "Revision conflict. Please refresh your session.",
                [],
                "REVISION_CONFLICT",
            );
        }

        const updated = await this.repository.updateAnswersWithRevision(
            sessionId,
            userId,
            revision,
            validatedAnswers,
        );

        if (!updated) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                "Revision conflict or session state changed concurrently",
                [],
                "REVISION_CONFLICT",
            );
        }

        return this.formatSessionResponse(updated, now);
    }

    /**
     * Nộp bài hoặc hoàn tất lượt chơi.
     */
    async submitSession(
        userId: string,
        sessionId: string,
        body: unknown,
    ): Promise<FormattedSessionResponse> {
        const rawSession = await this.repository.findByIdAndUser(sessionId, userId);
        if (!rawSession) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Game session not found");
        }

        const now = this.clock();
        let session = await this.syncDeadlines(rawSession, now);

        // Submit lặp lại sau completed: trả kết quả cũ, không chấm lại
        if (session.phase === "completed") {
            return this.formatSessionResponse(session, now);
        }

        if (session.phase === "memorizing") {
            throw new ApiError(
                StatusCodes.CONFLICT,
                "Cannot submit answers while in memorizing phase",
            );
        }

        // Giai đoạn recalling
        const isOverdue =
            session.recallEndsAt && now.getTime() > session.recallEndsAt.getTime();

        let answersToGrade: (string | null)[];
        let completionReason: NumberCompletionReason;
        let completedAt: Date;
        let expectedRevision: number | null = null;

        if (isOverdue) {
            // Quá hạn: chấm từ đáp án đã lưu hợp lệ trước deadline, bỏ qua payload tới muộn
            answersToGrade = session.answers;
            completionReason = "timeout";
            completedAt = session.recallEndsAt!;
        } else {
            // Nộp trong thời hạn hợp lệ
            completionReason = "submitted";
            completedAt = now;

            if (isRecord(body)) {
                if (body.revision !== undefined) {
                    if (
                        typeof body.revision !== "number" ||
                        !Number.isInteger(body.revision) ||
                        body.revision < 0
                    ) {
                        throw new ApiError(
                            StatusCodes.BAD_REQUEST,
                            "revision must be a non-negative integer",
                        );
                    }
                    if (body.revision !== session.revision) {
                        throw new ApiError(
                            StatusCodes.CONFLICT,
                            "Revision conflict. Please refresh your session.",
                            [],
                            "REVISION_CONFLICT",
                        );
                    }
                    expectedRevision = body.revision;
                }

                if (body.answers !== undefined) {
                    answersToGrade = validateAnswersArray(
                        body.answers,
                        session.digitCount,
                    );
                } else {
                    answersToGrade = session.answers;
                }
            } else {
                answersToGrade = session.answers;
            }
        }

        const grading = gradeAnswers(session.originalDigits, answersToGrade);

        const updated = await this.repository.completeSession(
            sessionId,
            userId,
            expectedRevision,
            {
                phase: "completed",
                completionReason,
                completedAt,
                correctCount: grading.correctCount,
                wrongCount: grading.wrongCount,
                blankCount: grading.blankCount,
                score: grading.score,
                accuracy: grading.accuracy,
                answers: answersToGrade,
            },
        );

        if (!updated) {
            // Có thể đã hoàn tất do request khác hoặc revision conflict
            const current = await this.repository.findByIdAndUser(sessionId, userId);
            if (current && current.phase === "completed") {
                return this.formatSessionResponse(current, now);
            }
            throw new ApiError(
                StatusCodes.CONFLICT,
                "Unable to submit due to concurrency or state conflict",
                [],
                "REVISION_CONFLICT",
            );
        }

        return this.formatSessionResponse(updated, now);
    }

    /**
     * Lấy lịch sử lượt chơi của user với phân trang và bộ lọc.
     */
    async getHistory(
        userId: string,
        query: Record<string, unknown>,
    ): Promise<HistoryResponse> {
        let page = 1;
        if (query.page !== undefined) {
            const parsedPage = Number(query.page);
            if (!Number.isInteger(parsedPage) || parsedPage < 1) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST,
                    "page must be a positive integer",
                );
            }
            page = parsedPage;
        }

        let limit = 10;
        if (query.limit !== undefined) {
            const parsedLimit = Number(query.limit);
            if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST,
                    "limit must be an integer between 1 and 50",
                );
            }
            limit = parsedLimit;
        }

        let mode: NumberGameMode | undefined;
        if (query.mode !== undefined) {
            if (query.mode !== "practice" && query.mode !== "challenge") {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST,
                    'mode must be either "practice" or "challenge"',
                );
            }
            mode = query.mode;
        }

        let phase: NumberSessionPhase | undefined;
        if (query.phase !== undefined) {
            if (
                query.phase !== "memorizing" &&
                query.phase !== "recalling" &&
                query.phase !== "completed"
            ) {
                throw new ApiError(
                    StatusCodes.BAD_REQUEST,
                    'phase must be "memorizing", "recalling", or "completed"',
                );
            }
            phase = query.phase;
        }

        const options: HistoryQueryOptions = { page, limit, mode, phase };
        const { items, total } = await this.repository.findHistory(userId, options);

        const summaries: HistoryItemSummary[] = items.map((doc) => ({
            id: doc._id.toString(),
            mode: doc.mode,
            level: doc.level ?? null,
            digitCount: doc.digitCount,
            memorizeSeconds: doc.memorizeSeconds,
            recallSeconds: doc.recallSeconds,
            phase: doc.phase,
            revision: doc.revision,
            startedAt: doc.startedAt.toISOString(),
            completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
            completionReason: doc.completionReason,
            score: doc.score,
            accuracy: doc.accuracy,
            memorizeUsedMs: doc.memorizeUsedMs,
            createdAt: doc.createdAt.toISOString(),
        }));

        const totalPages = Math.ceil(total / limit);

        return {
            items: summaries,
            pagination: {
                total,
                page,
                limit,
                totalPages: totalPages === 0 ? 1 : totalPages,
            },
        };
    }

    /**
     * Lấy kết quả khi session đã completed.
     */
    async getResult(
        userId: string,
        sessionId: string,
    ): Promise<{
        id: string;
        mode: NumberGameMode;
        level: number | null;
        digitCount: number;
        result: SessionResultData;
        comparison: ComparisonItem[];
        startedAt: string;
        completedAt: string;
        completionReason: NumberCompletionReason;
        memorizeUsedMs: number | null;
        serverNow: string;
    }> {
        const rawSession = await this.repository.findByIdAndUser(sessionId, userId);
        if (!rawSession) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Game session not found");
        }

        const now = this.clock();
        const session = await this.syncDeadlines(rawSession, now);

        if (session.phase !== "completed") {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "Game session is not completed yet",
            );
        }

        const grading = gradeAnswers(session.originalDigits, session.answers);

        return {
            id: session._id.toString(),
            mode: session.mode,
            level: session.level ?? null,
            digitCount: session.digitCount,
            result: {
                score: session.score ?? grading.score,
                accuracy: session.accuracy ?? grading.accuracy,
                correctCount: session.correctCount ?? grading.correctCount,
                wrongCount: session.wrongCount ?? grading.wrongCount,
                blankCount: session.blankCount ?? grading.blankCount,
                total: session.digitCount,
                completionReason: session.completionReason ?? "submitted",
                memorizeUsedMs: session.memorizeUsedMs,
            },
            comparison: grading.comparison,
            startedAt: session.startedAt.toISOString(),
            completedAt: (session.completedAt ?? now).toISOString(),
            completionReason: session.completionReason ?? "submitted",
            memorizeUsedMs: session.memorizeUsedMs,
            serverNow: now.toISOString(),
        };
    }

    /**
     * Chuyển đổi session sang format phản hồi client tùy theo phase hiện tại.
     * Tuyệt đối không để lộ originalDigits khi đang recalling hoặc trong danh sách.
     */
    private async formatSessionResponse(
        session: NumberSessionDocument,
        now: Date,
    ): Promise<FormattedSessionResponse> {
        if (session.phase === "completed") await this.recordCompletion(session);
        const base: FormattedSessionResponse = {
            id: session._id.toString(),
            mode: session.mode,
            level: session.level ?? null,
            digitCount: session.digitCount,
            memorizeSeconds: session.memorizeSeconds,
            recallSeconds: session.recallSeconds,
            phase: session.phase,
            revision: session.revision,
            startedAt: session.startedAt.toISOString(),
            memorizeEndsAt: session.memorizeEndsAt.toISOString(),
            recallStartedAt: session.recallStartedAt
                ? session.recallStartedAt.toISOString()
                : null,
            recallEndsAt: session.recallEndsAt
                ? session.recallEndsAt.toISOString()
                : null,
            completedAt: session.completedAt ? session.completedAt.toISOString() : null,
            completionReason: session.completionReason,
            memorizeUsedMs: session.memorizeUsedMs,
            serverNow: now.toISOString(),
        };

        if (session.phase === "memorizing") {
            base.digits = session.originalDigits;
        } else if (session.phase === "recalling") {
            base.answers = session.answers;
        } else if (session.phase === "completed") {
            base.answers = session.answers;
            const grading = gradeAnswers(session.originalDigits, session.answers);
            base.result = {
                score: session.score ?? grading.score,
                accuracy: session.accuracy ?? grading.accuracy,
                correctCount: session.correctCount ?? grading.correctCount,
                wrongCount: session.wrongCount ?? grading.wrongCount,
                blankCount: session.blankCount ?? grading.blankCount,
                total: session.digitCount,
                completionReason: session.completionReason ?? "submitted",
                memorizeUsedMs: session.memorizeUsedMs,
            };
            base.comparison = grading.comparison;
        }

        return base;
    }
}

export const numberSessionService = new NumberSessionService();
