import { randomInt } from "node:crypto";

// Xáo trộn Fisher–Yates; trả về mảng mới, không sửa mảng gốc
export const shuffle = <T>(items: readonly T[]): T[] => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = randomInt(index + 1);
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
};
