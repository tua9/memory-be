import mongoose from "mongoose";
import { CONFIGURED_GAME_NAMES, type ConfiguredGameName } from "../config/games.js";

// Tiến độ tạm của khách (chưa đăng nhập) trong một game, nhận diện bằng cookie guestId.
// Không có EXP, kỷ lục hay streak; chỉ giữ level đã mở để khách chơi tiếp hoặc chơi lại level cũ.
export interface GuestProgressData {
    guestId: string;
    gameName: ConfiguredGameName;
    unlockedLevel: number;
    played: number;
    // Gia hạn mỗi khi khách nộp xong một ván; quá hạn thì MongoDB tự xoá
    expiresAt: Date;
}

const guestProgressSchema = new mongoose.Schema<GuestProgressData>(
    {
        guestId: { type: String, required: true },
        gameName: { type: String, required: true, enum: CONFIGURED_GAME_NAMES },
        unlockedLevel: { type: Number, required: true, default: 1, min: 1 },
        played: { type: Number, default: 0, min: 0 },
        expiresAt: { type: Date, required: true },
    },
    { collection: "guest_progress" },
);

guestProgressSchema.index({ guestId: 1, gameName: 1 }, { unique: true });
guestProgressSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const GuestProgress = mongoose.model<GuestProgressData>("guest_progress", guestProgressSchema);
export default GuestProgress;
