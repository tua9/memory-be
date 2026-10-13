import mongoose, { type Document } from "mongoose";

// Định nghĩa các loại game được phép trong hệ thống
export const ALLOWED_GAME_NAMES = ["card", "image", "number"] as const;
export type GameName = (typeof ALLOWED_GAME_NAMES)[number];

export interface GameSessionDocument extends Document {
    userId: string;
    gameName: GameName;
    time: number;
    score: number;
    date: Date;
}

const gameSessionSchema = new mongoose.Schema<GameSessionDocument>(
    {
        userId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        gameName: {
            type: String,
            required: true,
            enum: ALLOWED_GAME_NAMES, // Mongoose tự động kiểm tra enum
            index: true,
        },
        time: {
            type: Number,
            required: true,
            min: 0,
        },
        score: {
            type: Number,
            default: 0,
            min: 0,
        },
        date: {
            type: Date,
            default: Date.now,
            index: true,
        },
    },
    {
        timestamps: false,
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

const GameSession = mongoose.model<GameSessionDocument>("game_session", gameSessionSchema);
export default GameSession;
