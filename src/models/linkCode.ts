import mongoose, { type Types } from "mongoose";

// Mã liên kết con tạo để ba mẹ nhập. Mỗi con chỉ có một mã còn hiệu lực, dùng một lần, tự xoá khi hết hạn.
// Lưu mã gốc (không băm) để con mở lại trang vẫn thấy mã: mã chỉ sống vài phút và còn cần con đồng ý.
export interface LinkCode {
    childId: Types.ObjectId;
    code: string;
    expiresAt: Date;
}

const schema = new mongoose.Schema<LinkCode>({
    childId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, unique: true },
    code: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
}, { collection: "link_codes" });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<LinkCode>("link_code", schema);
