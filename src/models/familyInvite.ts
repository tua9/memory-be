import mongoose, { type Types } from "mongoose";

// Lời mời liên kết con gửi qua email cho ba mẹ. Chỉ lưu hash của token; dùng một lần, tự xoá khi hết hạn.
export interface FamilyInvite {
    childId: Types.ObjectId;
    email: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
}

const schema = new mongoose.Schema<FamilyInvite>({
    childId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: "family_invites" });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<FamilyInvite>("family_invite", schema);
