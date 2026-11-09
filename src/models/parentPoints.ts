import mongoose, { type Types } from "mongoose";

const schema = new mongoose.Schema({
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "parent", required: true, index: true },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "family_room", required: true, unique: true },
    points: { type: Number, required: true, enum: [10] },
    earnedAt: { type: Date, required: true },
}, { collection: "parent_points" });
export interface ParentPoint { parentId: Types.ObjectId; roomId: Types.ObjectId; points: number; earnedAt: Date }
export default mongoose.model<ParentPoint>("parent_point", schema);
