import { randomInt } from "node:crypto";

// Số nguyên ngẫu nhiên trong [0, max)
export type RandomInt = (max: number) => number;

// Xáo trộn Fisher–Yates; trả về mảng mới, không sửa mảng gốc.
// Mặc định dùng nguồn ngẫu nhiên an toàn; truyền nguồn có seed khi cần kết quả lặp lại được (thử thách ngày).
export const shuffle = <T>(items: readonly T[], random: RandomInt = randomInt): T[] => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = random(index + 1);
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
};

// Băm chuỗi thành số 32 bit (FNV-1a) để làm seed
const hashSeed = (seed: string): number => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
};

// Nguồn ngẫu nhiên có seed (mulberry32): cùng seed luôn cho cùng dãy số.
// Chỉ dùng để mọi người nhận cùng một đề, không dùng cho việc cần bảo mật.
export const createSeededRandom = (seed: string): RandomInt => {
    let state = hashSeed(seed);
    return (max) => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        const unit = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        return Math.floor(unit * max);
    };
};
