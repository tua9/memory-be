import mongoose, { type Types } from "mongoose";

// Một người đang tìm trận. Người vào hàng sau ghép với người đang chờ trước (cùng trò, cấp gần nhất).
// state: searching (đang chờ), locked (đang tự đi ghép, tạm không cho người khác ghép), matched (đã có phòng).
export interface MatchTicket {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    username: string;
    avatarUrl: string | null;
    gameName: string;
    level: number;
    state: "searching" | "locked" | "matched";
    roomCode: string | null;
    // Client hỏi mỗi 2 giây sẽ gia hạn; đóng trang thì vé tự hết hạn và không ai bị ghép với người đã đi
    expiresAt: Date;
    createdAt: Date;
}

const schema = new mongoose.Schema<MatchTicket>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, unique: true },
    username: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    gameName: { type: String, required: true },
    level: { type: Number, required: true },
    state: { type: String, enum: ["searching", "locked", "matched"], required: true },
    roomCode: { type: String, default: null },
    expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: "match_queue" });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ gameName: 1, state: 1, _id: 1 });

export default mongoose.model<MatchTicket>("match_ticket", schema);
