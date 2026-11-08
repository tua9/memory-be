// Luật chơi của từng game. Backend là nơi duy nhất quyết định số lượng, thời gian và ngưỡng đạt;
// frontend đọc các giá trị này qua API thay vì tự định nghĩa.

// Sắp xếp từ thấp đến cao để so sánh kết quả
import { FACENAME_LEVELS } from "./facename.js";
import { NUMBER_LEVEL_DIGITS } from "./numbers.js";

export const GAME_RESULTS = ["fail", "pass", "perfect"] as const;
export type GameResult = (typeof GAME_RESULTS)[number];

// daily: ván thử thách ngày, chỉ tạo qua /api/daily-challenge nên client không chọn được ở /api/game-sessions
export const GAME_MODES = ["level", "custom", "daily"] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const SELECTABLE_GAME_MODES = ["level", "custom"] as const satisfies readonly GameMode[];

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
    recallSecPerLevel?: readonly number[];
    requiredScorePerLevel?: readonly number[];
    customTimeRange?: { min: number; max: number };
    wrongAnswerPenalty?: number;
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
    number: {
        itemsPerLevel: NUMBER_LEVEL_DIGITS,
        customItems: { min: 4, max: 80 },
        memorizeSecOptions: [30, 60, 120, 300],
        defaultMemorizeSec: 60,
        recallSec: 300,
        passAccuracy: 0.7,
        unlockOn: "perfect",
        customTimeRange: { min: 10, max: 600 },
    },
    facename: {
        itemsPerLevel: FACENAME_LEVELS.map((level) => level.faceCount),
        customItems: { min: 3, max: 30 },
        memorizeSecOptions: [60],
        defaultMemorizeSec: 60,
        recallSec: 120,
        recallSecPerLevel: FACENAME_LEVELS.map((level) => level.recallSeconds),
        requiredScorePerLevel: FACENAME_LEVELS.map((level) => level.requiredScore),
        customTimeRange: { min: 10, max: 300 },
        wrongAnswerPenalty: 0.5,
        passAccuracy: 0.7,
        unlockOn: "pass",
    },
    word: {
        itemsPerLevel: [6, 10, 14, 18, 22, 26, 30, 35, 42, 50],
        customItems: { min: 4, max: 50 },
        memorizeSecOptions: [30, 60, 120, 300],
        defaultMemorizeSec: 60,
        recallSec: 240,
        requiredScorePerLevel: [4, 7, 10, 12, 15, 18, 20, 24, 28, 34],
        passAccuracy: 2 / 3,
        unlockOn: "pass",
        customTimeRange: { min: 10, max: 600 },
    },
} as const satisfies Record<string, GameConfig>;

export type ConfiguredGameName = keyof typeof GAME_CONFIGS;
export const CONFIGURED_GAME_NAMES = Object.keys(GAME_CONFIGS) as ConfiguredGameName[];

// Cho phép chuyển phase hoặc nộp bài trễ hơn hạn một chút, bù độ trễ mạng khi frontend tự chuyển lúc hết giờ
export const PHASE_GRACE_SEC = 30;

// Ván bỏ dở (chưa nộp bài) được MongoDB tự xoá sau khoảng thời gian này
export const UNFINISHED_ROUND_TTL_SEC = 24 * 60 * 60;

// Khách (chưa đăng nhập) chỉ được giữ tạm level đã mở và các ván đã chơi: tính từ ván gần nhất,
// quá khoảng này mà không chơi tiếp thì cookie khách hết hạn và MongoDB tự xoá dữ liệu
export const GUEST_PROGRESS_TTL_SEC = 24 * 60 * 60;
