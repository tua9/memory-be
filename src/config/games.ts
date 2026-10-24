// Luật chơi của từng game. Backend là nơi duy nhất quyết định số lượng, thời gian và ngưỡng đạt;
// frontend đọc các giá trị này qua API thay vì tự định nghĩa.

// Sắp xếp từ thấp đến cao để so sánh kết quả
export const GAME_RESULTS = ["fail", "pass", "perfect"] as const;
export type GameResult = (typeof GAME_RESULTS)[number];

export const GAME_MODES = ["level", "custom"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export interface GameConfig {
    // Số thẻ/hình cần nhớ ở từng level, phần tử đầu tiên là level 1
    itemsPerLevel: readonly number[];
    // Giới hạn số lượng ở chế độ tự chọn; null nếu game không có chế độ này
    customItems: { min: number; max: number } | null;
    memorizeSecOptions: readonly number[];
    defaultMemorizeSec: number;
    recallSec: number;
    // Tỷ lệ đúng tối thiểu để ván được tính là "đạt"
    passAccuracy: number;
    // Kết quả tối thiểu để mở level tiếp theo
    unlockOn: Exclude<GameResult, "fail">;
}

export const GAME_CONFIGS = {
    card: {
        itemsPerLevel: [5, 9, 15, 20, 25, 31, 36, 41, 47, 52],
        customItems: { min: 5, max: 52 },
        memorizeSecOptions: [30, 60, 120, 300],
        defaultMemorizeSec: 120,
        recallSec: 300,
        passAccuracy: 0.7,
        unlockOn: "perfect",
    },
    image: {
        itemsPerLevel: [6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
        customItems: null,
        memorizeSecOptions: [30, 60, 120, 300],
        defaultMemorizeSec: 60,
        recallSec: 180,
        passAccuracy: 0.7,
        unlockOn: "perfect",
    },
} as const satisfies Record<string, GameConfig>;

export type ConfiguredGameName = keyof typeof GAME_CONFIGS;
export const CONFIGURED_GAME_NAMES = Object.keys(GAME_CONFIGS) as ConfiguredGameName[];

// Cho phép chuyển phase hoặc nộp bài trễ hơn hạn một chút, bù độ trễ mạng khi frontend tự chuyển lúc hết giờ
export const PHASE_GRACE_SEC = 30;

// Ván bỏ dở (chưa nộp bài) được MongoDB tự xoá sau khoảng thời gian này
export const UNFINISHED_ROUND_TTL_SEC = 24 * 60 * 60;
