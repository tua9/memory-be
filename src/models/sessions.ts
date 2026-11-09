import mongoose, { type Document, type Types } from "mongoose";

interface SessionDocument extends Document {
    userId?: Types.ObjectId;
    parentId?: Types.ObjectId;
    accountType?: "user" | "parent";
    refreshToken: string;
    expiresAt: Date;
}

const sessionSchema = new mongoose.Schema<SessionDocument>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: false,
            index: true,
        },
        parentId: { type: mongoose.Schema.Types.ObjectId, ref: "parent", index: true },
        accountType: { type: String, enum: ["user", "parent"], default: "user" },
        refreshToken: { type: String, required: true, unique: true },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Session = mongoose.model<SessionDocument>("session", sessionSchema);
export default Session;
