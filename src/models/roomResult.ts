import mongoose, { type Types } from "mongoose";

// Kết quả một trận đấu đã hoàn thành, mỗi người chơi một bản ghi. Phòng tự xoá sau 24 giờ, bản ghi này thì giữ lại.
export interface RoomResult {
    // Mã của trận (matchId của phòng): một phòng chơi lại nhiều trận thì mỗi trận một mã
    roomId: Types.ObjectId;
    userId: Types.ObjectId;
    opponentId: Types.ObjectId;
    gameName: string;
    outcome: "win" | "lose" | "draw";
    wins: number;
    losses: number;
    draws: number;
    // 1 cúp cho người thắng trận, khi cả hai đều có trả lời ở mọi vòng; còn lại 0
    cups: number;
    completedAt: Date;
}

const schema = new mongoose.Schema<RoomResult>({
    roomId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    opponentId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    gameName: { type: String, required: true },
    outcome: { type: String, enum: ["win", "lose", "draw"], required: true },
    wins: { type: Number, required: true },
    losses: { type: Number, required: true },
    draws: { type: Number, required: true },
    cups: { type: Number, required: true, enum: [0, 1] },
    completedAt: { type: Date, required: true },
}, { collection: "room_results" });

schema.index({ roomId: 1, userId: 1 }, { unique: true });
schema.index({ userId: 1, completedAt: -1 });
// Bảng xếp hạng cộng cúp theo người
schema.index({ cups: 1, userId: 1 });

export default mongoose.model<RoomResult>("room_result", schema);
