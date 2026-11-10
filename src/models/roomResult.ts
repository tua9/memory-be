import mongoose, { type Types } from "mongoose";

// Kết quả một trận đấu đã hoàn thành, mỗi người chơi một bản ghi. Phòng tự xoá sau 24 giờ, bản ghi này thì giữ lại.
export interface RoomResult {
    roomId: Types.ObjectId;
    userId: Types.ObjectId;
    opponentId: Types.ObjectId;
    gameName: string;
    outcome: "win" | "lose" | "draw";
    wins: number;
    losses: number;
    draws: number;
    // Điểm giao lưu: 10 khi chơi đủ số vòng và cả hai đều có trả lời ở mọi vòng, ngược lại 0
    points: number;
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
    points: { type: Number, required: true },
    completedAt: { type: Date, required: true },
}, { collection: "room_results" });

schema.index({ roomId: 1, userId: 1 }, { unique: true });
schema.index({ userId: 1, completedAt: -1 });

export default mongoose.model<RoomResult>("room_result", schema);
