import mongoose, { type Document, type Types } from "mongoose";

// A single unique index arbitrates new user, Google and parent registrations.
// Existing users are checked during reservation; no bulk migration is required.
export interface LoginIdentityDocument extends Document {
    email: string;
    accountType: "user" | "parent";
    accountId: Types.ObjectId;
    expiresAt?: Date;
}

const identitySchema = new mongoose.Schema<LoginIdentityDocument>({
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    accountType: { type: String, required: true, enum: ["user", "parent"] },
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date },
}, { collection: "login_identities" });

identitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<LoginIdentityDocument>("login_identity", identitySchema);
