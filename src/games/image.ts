import { randomBytes } from "node:crypto";
import { shuffle } from "../utils/random.js";
import type { GameEngine } from "./types.js";

// Tạm lấy ảnh ngẫu nhiên từ picsum theo mã, giống cách frontend đang làm; sẽ thay bằng kho ảnh riêng
const imageUrlOf = (code: string) => `https://picsum.photos/seed/memio-${code}/400/400`;

const createImageCode = () => randomBytes(6).toString("hex");

export const imageEngine: GameEngine = {
    gameName: "image",
    generateItems: (count) => {
        if (!Number.isInteger(count) || count < 1) {
            throw new RangeError("Image count must be a positive integer");
        }
        const codes = new Set<string>();
        while (codes.size < count) {
            codes.add(createImageCode());
        }
        return [...codes];
    },
    // Người chơi xếp lại chính các ảnh đã nhớ, theo thứ tự đã bị xáo trộn
    buildRecallOptions: (items) => shuffle(items),
    toView: (code) => ({ code, imageUrl: imageUrlOf(code) }),
};
