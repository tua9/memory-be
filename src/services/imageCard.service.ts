import ImageCard, { type IImageCard } from "../models/imageCard.js";
import { SEED_IMAGES } from "../data/seedImages.js";
import type { PipelineStage } from "mongoose";

export interface ImageCardView {
  id: string;
  code: string;
  imageUrl: string;
  level?: number;
  title?: string;
}

export class ImageCardService {
  /**
   * Tự động kiểm tra và đồng bộ kho ảnh phân cấp vào MongoDB
   */
  async ensureSeedData(): Promise<void> {
    try {
      const count = await ImageCard.countDocuments();
      if (count < SEED_IMAGES.length) {
        console.info(`⚡ [ImageCardService] Đang đồng bộ kho ảnh mới theo 10 cấp độ (${SEED_IMAGES.length} ảnh)...`);
        await ImageCard.deleteMany({});
        await ImageCard.insertMany(SEED_IMAGES);
        console.info(`✅ [ImageCardService] Đã nạp thành công ${SEED_IMAGES.length} ảnh phân cấp vào MongoDB!`);
      }
    } catch (error) {
      console.error("❌ [ImageCardService] Lỗi khi nạp seed images:", error);
    }
  }

  /**
   * Lấy ngẫu nhiên N ảnh từ MongoDB cho cấp độ `level` chỉ định bằng MongoDB $sample
   * Đảm bảo:
   * - Các ảnh trong cùng 1 ván là đa dạng nhiều chủ đề, không trùng lặp
   * - Ảnh của level này không trùng với ảnh của level khác
   */
  async getRandomImages(count: number, level?: number): Promise<ImageCardView[]> {
    const safeCount = Math.max(1, count);
    const safeLevel = level ? Math.max(1, Math.min(10, Number(level))) : undefined;

    const pipeline: PipelineStage[] = [];
    if (safeLevel) {
      pipeline.push({ $match: { level: safeLevel } });
    }
    pipeline.push({ $sample: { size: safeCount } });

    const results = await ImageCard.aggregate<IImageCard>(pipeline);

    if (results.length > 0) {
      return results.map((item) => ({
        id: item.code,
        code: item.code,
        imageUrl: item.imageUrl,
        level: item.level,
        title: item.title,
      }));
    }

    // Fallback nếu DB chưa kịp nạp
    const filtered = safeLevel
      ? SEED_IMAGES.filter((img) => img.level === safeLevel)
      : SEED_IMAGES;
    const pool = filtered.length >= safeCount ? filtered : SEED_IMAGES;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, safeCount).map((item) => ({
      id: item.code,
      code: item.code,
      imageUrl: item.imageUrl,
      level: item.level,
      title: item.title,
    }));
  }
}

export const imageCardService = new ImageCardService();
export default imageCardService;
