import mongoose, { type Document, type Types } from "mongoose";

export const NUMBER_GAME_MODES = ["practice", "challenge"] as const;
export type NumberGameMode = (typeof NUMBER_GAME_MODES)[number];

export const NUMBER_SESSION_PHASES = ["memorizing", "recalling", "completed"] as const;
export type NumberSessionPhase = (typeof NUMBER_SESSION_PHASES)[number];

export const NUMBER_COMPLETION_REASONS = ["submitted", "timeout"] as const;
export type NumberCompletionReason = (typeof NUMBER_COMPLETION_REASONS)[number];

export interface NumberSessionDocument extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    mode: NumberGameMode;
    // Cấp của ván luyện tập theo cấp; null với ván tự chọn số lượng và ván thử thách
    level: number | null;
    // Ngày "YYYY-MM-DD" (giờ Việt Nam) của ván thử thách; null với ván luyện tập
    challengeDate: string | null;
    sharedProgress?: boolean;
    progressRecordedAt?: Date | null;
    digitCount: number;
    memorizeSeconds: number;
    recallSeconds: number;
    originalDigits: string[];
    answers: (string | null)[];
    phase: NumberSessionPhase;
    revision: number;
    startedAt: Date;
    memorizeEndsAt: Date;
    recallStartedAt: Date | null;
    recallEndsAt: Date | null;
    completedAt: Date | null;
    completionReason: NumberCompletionReason | null;
    correctCount: number | null;
    wrongCount: number | null;
    blankCount: number | null;
    accuracy: number | null;
    memorizeUsedMs: number | null;
    score: number | null;
    createdAt: Date;
    updatedAt: Date;
}

const numberSessionSchema = new mongoose.Schema<NumberSessionDocument>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true,
            index: true,
        },
        mode: {
            type: String,
            enum: NUMBER_GAME_MODES,
            required: true,
        },
        level: {
            type: Number,
            default: null,
            min: 1,
        },
        challengeDate: {
            type: String,
            default: null,
        },
        sharedProgress: { type: Boolean, default: false },
        progressRecordedAt: { type: Date, default: null },
        digitCount: {
            type: Number,
            required: true,
            min: 4,
            max: 80,
        },
        memorizeSeconds: {
            type: Number,
            required: true,
            min: 5,
            max: 300,
        },
        recallSeconds: {
            type: Number,
            required: true,
            min: 10,
            max: 600,
        },
        originalDigits: {
            type: [String],
            required: true,
        },
        answers: {
            type: [mongoose.Schema.Types.Mixed],
            required: true,
            default: [],
        },
        phase: {
            type: String,
            enum: NUMBER_SESSION_PHASES,
            default: "memorizing",
            index: true,
        },
        revision: {
            type: Number,
            default: 0,
            min: 0,
        },
        startedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        memorizeEndsAt: {
            type: Date,
            required: true,
        },
        recallStartedAt: {
            type: Date,
            default: null,
        },
        recallEndsAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        completionReason: {
            type: String,
            enum: [...NUMBER_COMPLETION_REASONS, null],
            default: null,
        },
        correctCount: {
            type: Number,
            default: null,
        },
        wrongCount: {
            type: Number,
            default: null,
        },
        blankCount: {
            type: Number,
            default: null,
        },
        accuracy: {
            type: Number,
            default: null,
        },
        memorizeUsedMs: {
            type: Number,
            default: null,
        },
        score: {
            type: Number,
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: {
            transform: (_doc, ret: Record<string, unknown>) => {
                ret.id = (ret._id as { toString(): string }).toString();
                delete ret._id;
                delete ret.__v;
                return ret;
            },
        },
    },
);

// Compound indexes for history queries and sorting
numberSessionSchema.index({ userId: 1, createdAt: -1, _id: -1 });
numberSessionSchema.index({ userId: 1, mode: 1, createdAt: -1 });
numberSessionSchema.index({ userId: 1, phase: 1, createdAt: -1 });

// Cấp đã mở: tìm ván hoàn hảo ở cấp cao nhất của một người chơi
numberSessionSchema.index({ userId: 1, level: -1, phase: 1 });
numberSessionSchema.index({ sharedProgress: 1, phase: 1, progressRecordedAt: 1 });
// Thử thách: mỗi tài khoản đúng một ván mỗi ngày, kể cả khi hai yêu cầu bắt đầu gửi cùng lúc
numberSessionSchema.index(
    { userId: 1, challengeDate: 1 },
    { unique: true, partialFilterExpression: { challengeDate: { $type: "string" } } },
);

// Indexes for background timeout sweep
numberSessionSchema.index({ phase: 1, recallEndsAt: 1 });
numberSessionSchema.index({ phase: 1, memorizeEndsAt: 1 });

const NumberSession = mongoose.model<NumberSessionDocument>(
    "number_session",
    numberSessionSchema,
);

export default NumberSession;
