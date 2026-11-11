import mongoose, { type Document, type Types } from "mongoose";

export const AGE_GROUPS = ["6-8", "9-12", "13-15"] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

// Một người theo dõi (ba mẹ) và một người được theo dõi (con). Cả hai đều là user thường.
// pending: ba mẹ đã nhập mã, chờ con đồng ý. active: ba mẹ được xem hoạt động của con.
export interface FamilyLinkDocument extends Document {
    _id: Types.ObjectId;
    guardianId: Types.ObjectId;
    childId: Types.ObjectId;
    status: "pending" | "active";
    // Ba mẹ khai cho từng con, dùng để chọn gợi ý hoạt động
    ageGroup: AgeGroup | null;
    acceptedAt: Date | null;
    createdAt: Date;
}

const schema = new mongoose.Schema<FamilyLinkDocument>({
    guardianId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
    status: { type: String, enum: ["pending", "active"], required: true },
    ageGroup: { type: String, enum: [...AGE_GROUPS, null], default: null },
    acceptedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: "family_links" });

schema.index({ guardianId: 1, childId: 1 }, { unique: true });

export default mongoose.model<FamilyLinkDocument>("family_link", schema);
