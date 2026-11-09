import mongoose, { type Document, type Types } from "mongoose";

export const AGE_GROUPS = ["6-8", "9-12", "13-15"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export interface ParentDocument extends Document {
    _id: Types.ObjectId;
    childUserId: Types.ObjectId;
    fullname: string;
    email: string;
    passwordHash: string;
    emailVerifiedAt: Date | null;
    ageGroup: AgeGroup | null;
    createdAt: Date;
}

const parentSchema = new mongoose.Schema<ParentDocument>({
    childUserId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, unique: true },
    fullname: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true },
    emailVerifiedAt: { type: Date, default: null },
    ageGroup: { type: String, enum: [...AGE_GROUPS, null], default: null },
}, { timestamps: true, collection: "parents" });

export default mongoose.model<ParentDocument>("parent", parentSchema);
