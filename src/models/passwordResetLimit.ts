import mongoose, { type Document, type Types } from "mongoose";
import { PASSWORD_RESET_PURPOSE, type PasswordResetPurpose } from "../config/passwordReset.js";

export interface PasswordResetLimitDocument extends Document {
    userId: Types.ObjectId;
    purpose: PasswordResetPurpose;
    windowStartedAt: Date;
    count: number;
    lastSentAt: Date;
    // Mốc dọn bản ghi khi không còn tác dụng (hết cửa sổ giới hạn)
    expiresAt: Date;
}

const passwordResetLimitSchema = new mongoose.Schema<PasswordResetLimitDocument>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    purpose: { type: String, enum: [PASSWORD_RESET_PURPOSE], required: true },
    windowStartedAt: { type: Date, required: true },
    count: { type: Number, required: true, min: 0 },
    lastSentAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
});

// Mỗi tài khoản + mục đích chỉ có một bản ghi; index unique còn chặn hai request tạo trùng cùng lúc
passwordResetLimitSchema.index({ userId: 1, purpose: 1 }, { unique: true });
passwordResetLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PasswordResetLimit = mongoose.model<PasswordResetLimitDocument>(
    "password_reset_limit",
    passwordResetLimitSchema,
);
export default PasswordResetLimit;

