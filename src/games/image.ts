import { buildUrl, SEED_IMAGES } from "../data/seedImages.js";
import { shuffle } from "../utils/random.js";
import type { GameEngine } from "./types.js";

const IMAGE_URLS = new Map(SEED_IMAGES.map((image) => [image.code, image.imageUrl]));

// Mã ảnh của ván cũ vẫn phải hiển thị lại được: id ảnh Unsplash (kho 24 ảnh trước đây)
// hoặc chuỗi ngẫu nhiên (picsum, trước nữa)
const imageUrlOf = (code: string) =>
    IMAGE_URLS.get(code) ??
    (code.startsWith("photo-") ? buildUrl(code) : `https://picsum.photos/seed/memio-${code}/400/400`);

export const imageEngine: GameEngine = {
    gameName: "image",
    // Mỗi level có kho ảnh riêng; game hình không có ván tự chọn số lượng nên luôn có level
    generateItems: (count, level) => {
        const pool = SEED_IMAGES.filter((image) => image.level === level).map((image) => image.code);
        if (!Number.isInteger(count) || count < 1 || count > pool.length) {
            throw new RangeError(`Level ${level} has ${pool.length} images, cannot draw ${count}`);
        }
        return shuffle(pool).slice(0, count);
    },
    // Người chơi xếp lại chính các ảnh đã nhớ, theo thứ tự đã bị xáo trộn
    buildRecallOptions: (items) => shuffle(items),
    toView: (code) => ({ code, imageUrl: imageUrlOf(code) }),
};
