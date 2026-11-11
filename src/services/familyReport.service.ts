import { StatusCodes } from "http-status-codes";
import { PROGRESS_TIME_ZONE } from "../config/progression.js";
import GameSession from "../models/gameSession.js";
import NumberSession from "../models/numberSession.js";
import UserGameProgress from "../models/userGameProgress.js";
import RoomResult from "../models/roomResult.js";
import type { UserDocument } from "../models/user.js";
import type { AgeGroup } from "../models/familyLink.js";
import { userProfileService } from "./profile.service.js";
import { addDaysToDateKey, startOfDateKey, toDateKey, weekdayOfDateKey } from "../utils/date.js";
import ApiError from "../utils/ApiError.js";

type Activity = { gameName: string; completedAt: Date; totalItems: number; correctItems: number; durationSec: number };
const MIN_TREND_GAMES = 3;

const readActivities = async (childUserId: string, start: Date, end: Date): Promise<Activity[]> => {
    const [shared, legacy] = await Promise.all([
        GameSession.find({ userId: childUserId, status: "completed", completedAt: { $gte: start, $lt: end } })
            .select("gameName completedAt rules.totalItems correctItems memorizeSec recallSec").lean().exec(),
        NumberSession.find({ userId: childUserId, phase: "completed", completedAt: { $gte: start, $lt: end } })
            .select("completedAt digitCount correctCount memorizeUsedMs recallStartedAt").lean().exec(),
    ]);
    const sharedIds = new Set(shared.map((session) => session._id.toString()));
    return [
        ...shared.filter((s) => s.completedAt && s.correctItems !== null).map((s) => ({
            gameName: s.gameName, completedAt: s.completedAt as Date, totalItems: s.rules.totalItems,
            correctItems: s.correctItems as number, durationSec: (s.memorizeSec ?? 0) + (s.recallSec ?? 0),
        })),
        ...legacy.filter((s) => s.completedAt && s.correctCount !== null && !sharedIds.has(s._id.toString())).map((s) => ({
            gameName: "number", completedAt: s.completedAt as Date, totalItems: s.digitCount,
            correctItems: s.correctCount as number,
            durationSec: Math.max(0, (s.memorizeUsedMs ?? 0) +
                (s.recallStartedAt && s.completedAt ? s.completedAt.getTime() - s.recallStartedAt.getTime() : 0)) / 1000,
        })),
    ].sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
};

export const summarizeActivities = (activities: readonly Activity[]) => {
    const totalItems = activities.reduce((sum, item) => sum + item.totalItems, 0);
    return {
        games: activities.length,
        practiceDays: new Set(activities.map((item) => toDateKey(item.completedAt, PROGRESS_TIME_ZONE))).size,
        accuracy: totalItems ? activities.reduce((sum, item) => sum + item.correctItems, 0) / totalItems : null,
        recordedPracticeSeconds: activities.reduce((sum, item) => sum + item.durationSec, 0),
        lastPlayedAt: activities[0]?.completedAt ?? null,
        byGame: Object.values(activities.reduce<Record<string, { gameName: string; games: number; correct: number; total: number }>>((acc, item) => {
            const entry = acc[item.gameName] ?? { gameName: item.gameName, games: 0, correct: 0, total: 0 };
            entry.games += 1; entry.correct += item.correctItems; entry.total += item.totalItems;
            acc[item.gameName] = entry;
            return acc;
        }, {})),
    };
};

// Số trận ba mẹ đã đấu cùng con trong phòng đấu, tính từ phía ba mẹ
const togetherStats = async (guardianId: string, childId: string) => {
    // Trận nhiều người lưu mọi đối thủ ở opponentIds; bản ghi cũ chỉ có opponentId
    const results = await RoomResult.find({ userId: guardianId, $or: [{ opponentIds: childId }, { opponentId: childId }] }).select("outcome").lean();
    return {
        matches: results.length,
        wins: results.filter((item) => item.outcome === "win").length,
        losses: results.filter((item) => item.outcome === "lose").length,
        draws: results.filter((item) => item.outcome === "draw").length,
    };
};

export const getChildOverview = async (guardianId: string, child: UserDocument, ageGroup: AgeGroup | null) => {
    const childId = child._id.toString();
    const [activities, progress, together] = await Promise.all([
        readActivities(childId, new Date(0), new Date()),
        UserGameProgress.find({ userId: child._id }).select("gameName unlockedLevel stats records").lean().exec(),
        togetherStats(guardianId, childId),
    ]);
    return {
        child: { _id: childId, username: child.username, avatarUrl: child.avatarUrl ?? null, profile: userProfileService.getProfile(child) },
        summary: summarizeActivities(activities),
        progress,
        ageGroup,
        together,
    };
};

export const getChildReport = async (childId: string, ageGroup: AgeGroup | null, query: Record<string, unknown>, now = new Date()) => {
    const period = query.period ?? "day";
    if (period !== "day" && period !== "week") throw new ApiError(StatusCodes.BAD_REQUEST, "period must be day or week");
    const today = toDateKey(now, PROGRESS_TIME_ZONE);
    const chosen = query.date ?? today;
    if (typeof chosen !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(chosen) || addDaysToDateKey(chosen, 0) !== chosen || chosen > today) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid report date");
    }
    const first = period === "week" ? addDaysToDateKey(chosen, -((weekdayOfDateKey(chosen) + 6) % 7)) : chosen;
    const length = period === "week" ? 7 : 1;
    const start = startOfDateKey(first, PROGRESS_TIME_ZONE);
    const end = startOfDateKey(addDaysToDateKey(first, length), PROGRESS_TIME_ZONE);
    const previousStart = startOfDateKey(addDaysToDateKey(first, -length), PROGRESS_TIME_ZONE);
    const currentEnd = now < end ? now : end;
    const elapsedMs = currentEnd.getTime() - start.getTime();
    const previousEnd = new Date(previousStart.getTime() + elapsedMs);
    const [activities, previous] = await Promise.all([
        readActivities(childId, start, currentEnd),
        readActivities(childId, previousStart, previousEnd),
    ]);
    const summary = summarizeActivities(activities);
    const previousSummary = summarizeActivities(previous);
    const incomplete = now < end;
    const observation = summary.games === 0
        ? "Chưa có lượt luyện tập được ghi nhận trong kỳ này."
        : `Con đã luyện tập ${summary.games} ván trong ${summary.practiceDays} ngày của kỳ này.`;
    const evidence = summary.games === 0 ? "Chưa có dữ liệu ván đã hoàn thành." :
        `Số đúng trên tổng vị trí: ${activities.reduce((sum, item) => sum + item.correctItems, 0)}/${activities.reduce((sum, item) => sum + item.totalItems, 0)}.`;
    const trend = summary.games >= MIN_TREND_GAMES && previousSummary.games >= MIN_TREND_GAMES
        ? `So với cùng khoảng thời gian kỳ trước: ${summary.games - previousSummary.games >= 0 ? "+" : ""}${summary.games - previousSummary.games} ván.`
        : "Chưa đủ dữ liệu để nhận xét xu hướng.";
    const suggestions = [
        { title: "Cùng kể chuyện nối đồ vật", reason: ageGroup ? `Phù hợp nhóm tuổi ${ageGroup}; ba mẹ có thể cùng con thử cách liên kết hình ảnh.` : "Gợi ý chung khi chưa khai báo nhóm tuổi.",
            steps: ["Chọn 3 đồ vật quen thuộc.", "Cùng tạo một câu chuyện nối chúng.", "Lần lượt kể lại."], question: "Con nhớ chi tiết nào thú vị nhất?", gameName: "word" },
        { title: "Đấu trí nhớ cùng con", reason: summary.games ? "Cùng thử lại một trò con đã luyện tập." : "Bắt đầu với một trận ngắn cùng nhau.",
            steps: ["Ba mẹ tạo phòng đấu.", "Gửi mã phòng cho con.", "Cả hai cùng sẵn sàng rồi bắt đầu."], question: "Con muốn chọn trò nào hôm nay?", gameName: summary.byGame[0]?.gameName ?? "card" },
    ];
    return { period, date: chosen, start, end, incomplete, timeZone: PROGRESS_TIME_ZONE,
        summary, previousSummary, activities, comment: { observation, evidence, trend, suggestion: suggestions[0].title }, suggestions };
};
