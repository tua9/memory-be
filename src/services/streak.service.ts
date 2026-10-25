import { PROGRESS_TIME_ZONE } from "../config/progression.js";
import { addDaysToDateKey, toDateKey } from "../utils/date.js";

export interface StreakState {
    currentStreak: number;
    longestStreak: number;
    // Ngày chơi gần nhất dạng "YYYY-MM-DD" theo PROGRESS_TIME_ZONE
    lastPlayedDate: string | null;
}

export interface StreakStatus {
    currentStreak: number;
    longestStreak: number;
    playedToday: boolean;
}

export const createEmptyStreak = (): StreakState => ({
    currentStreak: 0,
    longestStreak: 0,
    lastPlayedDate: null,
});

// Cập nhật streak khi hoàn thành một ván. isFirstGameOfDay dùng để cộng thưởng EXP ván đầu ngày.
export const recordPlayDay = (
    state: StreakState,
    playedAt: Date,
): { streak: StreakState; isFirstGameOfDay: boolean } => {
    const today = toDateKey(playedAt, PROGRESS_TIME_ZONE);
    const { lastPlayedDate } = state;

    // Đã chơi trong ngày, hoặc thời điểm cũ hơn ngày chơi gần nhất: giữ nguyên streak
    if (lastPlayedDate !== null && today <= lastPlayedDate) {
        return { streak: state, isFirstGameOfDay: false };
    }

    const currentStreak = lastPlayedDate === addDaysToDateKey(today, -1)
        ? state.currentStreak + 1
        : 1;

    return {
        streak: {
            currentStreak,
            longestStreak: Math.max(state.longestStreak, currentStreak),
            lastPlayedDate: today,
        },
        isFirstGameOfDay: true,
    };
};

// Streak hiển thị cho người dùng. Bỏ qua trọn một ngày thì streak về 0 ngay khi đọc,
// không cần job định kỳ để reset; số trong DB được ghi đè ở ván tiếp theo.
export const getStreakStatus = (state: StreakState, now: Date): StreakStatus => {
    const today = toDateKey(now, PROGRESS_TIME_ZONE);
    const playedToday = state.lastPlayedDate === today;
    const isAlive = playedToday || state.lastPlayedDate === addDaysToDateKey(today, -1);

    return {
        currentStreak: isAlive ? state.currentStreak : 0,
        longestStreak: state.longestStreak,
        playedToday,
    };
};
