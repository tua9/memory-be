import mongoose, { type Document, type Types } from "mongoose";
import { PASSWORD_RESET_PURPOSE, PARENT_PASSWORD_RESET_PURPOSE, type PasswordResetPurpose } from "../config/passwordReset.js";

export interface PasswordResetTokenDocument extends Document {
    userId: Types.ObjectId;
    purpose: PasswordResetPurpose;
    // Chỉ lưu SHA-256 của token; token gốc chỉ xuất hiện trong email gửi cho người dùng
    tokenHash: string;
    expiresAt: Date;
    // Có giá trị khi link đã được dùng; đặt bằng một thao tác nguyên tử để chặn dùng lại
    usedAt: Date | null;
}

const passwordResetTokenSchema = new mongoose.Schema<PasswordResetTokenDocument>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
        purpose: { type: String, enum: [PASSWORD_RESET_PURPOSE, PARENT_PASSWORD_RESET_PURPOSE], required: true },
        tokenHash: { type: String, required: true, unique: true },
        expiresAt: { type: Date, required: true },
        usedAt: { type: Date, default: null },
    },
    { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

// Mongo tự dọn bản ghi hết hạn; khi xác minh vẫn luôn so expiresAt, không chờ TTL xoá
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PasswordResetToken = mongoose.model<PasswordResetTokenDocument>(
    "password_reset_token",
    passwordResetTokenSchema,
);
export default PasswordResetToken;

