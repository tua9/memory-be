import { shuffle } from "../utils/random.js";
import type { GameEngine } from "./types.js";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
// Cơ, rô, chuồn, bích: cùng thứ tự với bộ bài đang hiển thị ở frontend
const SUITS = ["H", "D", "C", "S"] as const;

// Mã lá bài = rank + chất, ví dụ "AS" (át bích), "10H" (10 cơ)
export const CARD_CODES: readonly string[] = SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`));

export const cardEngine: GameEngine = {
    gameName: "card",
    generateItems: (count) => {
        if (!Number.isInteger(count) || count < 1 || count > CARD_CODES.length) {
            throw new RangeError(`Card count must be an integer from 1 to ${CARD_CODES.length}`);
        }
        return shuffle(CARD_CODES).slice(0, count);
    },
    // Người chơi chọn lại từ đủ bộ 52 lá
    buildRecallOptions: () => [...CARD_CODES],
    toView: (code) => ({ code }),
};
