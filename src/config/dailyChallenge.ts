import type { ConfiguredGameName } from "./games.js";

// Thử thách ngày: mỗi ngày (theo PROGRESS_TIME_ZONE) mọi người chơi cùng một đề, mỗi tài khoản một lượt.
// Các game luân phiên theo ngày, theo đúng thứ tự trong danh sách này.
export interface DailyChallengeGame {
    gameName: ConfiguredGameName;
    itemCount: number;
    // Kho item để rút đề: game hình rút ảnh theo level, game bài không cần (null)
    poolLevel: number | null;
    memorizeSec: number;
}

export const DAILY_CHALLENGE_GAMES: readonly DailyChallengeGame[] = [
    { gameName: "card", itemCount: 12, poolLevel: null, memorizeSec: 120 },
    { gameName: "image", itemCount: 10, poolLevel: 4, memorizeSec: 60 },
];

// Số người hiện trên bảng xếp hạng; người chơi ngoài top vẫn thấy hạng của mình
export const DAILY_LEADERBOARD_SIZE = 20;
