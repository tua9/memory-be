import mongoose, { type Document, type Types } from "mongoose";

export interface ParentVerificationDocument extends Document {
    parentId: Types.ObjectId;
    tokenHash: string | null;
    expiresAt: Date | null;
    windowStartedAt: Date;
    sendCount: number;
    lastSentAt: Date | null;
    sending: boolean;
    sendingStartedAt: Date | null;
}

const schema = new mongoose.Schema<ParentVerificationDocument>({
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "parent", required: true, unique: true },
    tokenHash: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    windowStartedAt: { type: Date, required: true },
    sendCount: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
    sending: { type: Boolean, default: false },
    sendingStartedAt: { type: Date, default: null },
}, { collection: "parent_verifications" });

schema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: "string" } } });
export default mongoose.model<ParentVerificationDocument>("parent_verification", schema);
