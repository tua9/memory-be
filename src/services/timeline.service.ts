import { CONFIGURED_GAME_NAMES, type ConfiguredGameName, type GameResult } from "../config/games.js";
import { PROGRESS_TIME_ZONE } from "../config/progression.js";
import {
    addDaysToDateKey,
    addMonthsToDateKey,
    startOfDateKey,
    toDateKey,
    weekdayOfDateKey,
} from "../utils/date.js";

// Dashboard xem theo 8 tuần hoặc 6 tháng gần nhất, so sánh với cùng số kỳ ngay trước đó
export const TIMELINE_PERIODS = {
    week: { count: 8 },
    month: { count: 6 },
} as const;

export type TimelinePeriod = keyof typeof TIMELINE_PERIODS;
export type TimelineGameFilter = ConfiguredGameName | "all";

export interface TimelineRange {
    start: Date;
    // Không bao gồm mốc này
    end: Date;
}

export interface TimelineRanges {
    // Các kỳ hiện tại, cũ nhất trước; kỳ cuối cùng chứa thời điểm hiện tại
    buckets: TimelineRange[];
    range: TimelineRange;
    previousRange: TimelineRange;
}

// Dữ liệu tối thiểu của một ván đã hoàn thành để tính thống kê
export interface TimelineSession {
    gameName: ConfiguredGameName;
    completedAt: Date;
    // null với ván tự chọn số lượng
    gameLevel: number | null;
    totalItems: number;
    correctItems: number;
    result: GameResult;
    durationSec: number;
}

export interface GamePeriodStats {
    played: number;
    // Tỷ lệ đúng tính trên tổng số item, null khi không có ván nào
    accuracy: number | null;
}

export interface TimelineBucket extends TimelineRange {
    byGame: Record<ConfiguredGameName, GamePeriodStats>;
}

export interface TimelineSummary {
    played: number;
    accuracy: number | null;
    // Chỉ tính ván chơi theo level, null khi chưa có
    bestLevel: number | null;
    perfectCount: number;
    durationSec: number;
}

export interface Timeline {
    period: TimelinePeriod;
    game: TimelineGameFilter;
    timeZone: string;
    range: TimelineRange;
    previousRange: TimelineRange;
    buckets: TimelineBucket[];
    summary: TimelineSummary;
    previousSummary: TimelineSummary;
}

// Mốc các kỳ tính theo lịch Việt Nam: tuần bắt đầu từ 00:00 thứ Hai, tháng bắt đầu từ 00:00 ngày 1
export const getTimelineRanges = (period: TimelinePeriod, now: Date): TimelineRanges => {
    const { count } = TIMELINE_PERIODS[period];
    const today = toDateKey(now, PROGRESS_TIME_ZONE);
    const currentStart = period === "week"
        ? addDaysToDateKey(today, -((weekdayOfDateKey(today) + 6) % 7))
        : addMonthsToDateKey(today, 0);
    const shift = (dateKey: string, periods: number) => period === "week"
        ? addDaysToDateKey(dateKey, 7 * periods)
        : addMonthsToDateKey(dateKey, periods);
    const toInstant = (dateKey: string) => startOfDateKey(dateKey, PROGRESS_TIME_ZONE);

    // count + 1 mốc liên tiếp: mốc i và i + 1 là đầu và cuối của kỳ i
    const boundaries = Array.from({ length: count + 1 }, (_, index) => shift(currentStart, index - (count - 1)));
    const buckets = boundaries.slice(0, count).map((dateKey, index) => ({
        start: toInstant(dateKey),
        end: toInstant(boundaries[index + 1]),
    }));
    const range = { start: buckets[0].start, end: buckets[count - 1].end };

    return {
        buckets,
        range,
        previousRange: { start: toInstant(shift(boundaries[0], -count)), end: range.start },
    };
};

const isWithin = (date: Date, { start, end }: TimelineRange) => date >= start && date < end;

const accuracyOf = (sessions: readonly TimelineSession[]): number | null => {
    const totalItems = sessions.reduce((sum, session) => sum + session.totalItems, 0);
    if (totalItems === 0) {
        return null;
    }
    return sessions.reduce((sum, session) => sum + session.correctItems, 0) / totalItems;
};

export const summarizeSessions = (sessions: readonly TimelineSession[]): TimelineSummary => {
    const levels = sessions.flatMap((session) => (session.gameLevel === null ? [] : [session.gameLevel]));
    return {
        played: sessions.length,
        accuracy: accuracyOf(sessions),
        bestLevel: levels.length > 0 ? Math.max(...levels) : null,
        perfectCount: sessions.filter((session) => session.result === "perfect").length,
        durationSec: sessions.reduce((sum, session) => sum + session.durationSec, 0),
    };
};

// Gom các ván đã hoàn thành thành số liệu cho dashboard. Hàm thuần: service đọc DB rồi truyền ván vào.
// Gom bằng code thay vì aggregation của MongoDB vì mỗi lần chỉ có các ván của một người trong tối đa
// 12 tháng; khi dữ liệu lớn hơn có thể chuyển sang $group mà không đổi kết quả trả về.
export const buildTimeline = (input: {
    period: TimelinePeriod;
    game: TimelineGameFilter;
    ranges: TimelineRanges;
    sessions: readonly TimelineSession[];
}): Timeline => {
    const { period, game, ranges } = input;
    const sessions = game === "all"
        ? input.sessions
        : input.sessions.filter((session) => session.gameName === game);
    const current = sessions.filter((session) => isWithin(session.completedAt, ranges.range));
    const previous = sessions.filter((session) => isWithin(session.completedAt, ranges.previousRange));

    const buckets = ranges.buckets.map((bucket) => {
        const inBucket = current.filter((session) => isWithin(session.completedAt, bucket));
        const byGame = Object.fromEntries(
            CONFIGURED_GAME_NAMES.map((gameName) => {
                const ofGame = inBucket.filter((session) => session.gameName === gameName);
                return [gameName, { played: ofGame.length, accuracy: accuracyOf(ofGame) }];
            }),
        ) as Record<ConfiguredGameName, GamePeriodStats>;
        return { ...bucket, byGame };
    });

    return {
        period,
        game,
        timeZone: PROGRESS_TIME_ZONE,
        range: ranges.range,
        previousRange: ranges.previousRange,
        buckets,
        summary: summarizeSessions(current),
        previousSummary: summarizeSessions(previous),
    };
};
