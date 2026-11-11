import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import type { ConfiguredGameName } from "../../config/games.js";
import { PROGRESS_TIME_ZONE } from "../../config/progression.js";
import GameSession from "../../models/gameSession.js";
import User, { type SavedCoachPlan } from "../../models/user.js";
import ApiError from "../../utils/ApiError.js";
import { addDaysToDateKey, startOfDateKey, toDateKey, weekdayOfDateKey } from "../../utils/date.js";
import { fitPlanToProgress, markWeekProgress, parsePlan, type PlanSession } from "../plan.service.js";
import { progressTool } from "./progress.tool.js";

export interface CoachPlanView extends SavedCoachPlan {
    weekStart: string;
    today: number;
    sessions: (PlanSession & { bestAccuracy: number | null })[];
}

// 1 = Thứ 2, ..., 7 = Chủ nhật theo giờ Việt Nam
const planDayOf = (dateKey: string) => weekdayOfDateKey(dateKey) || 7;

const withWeekProgress = async (userId: string, plan: SavedCoachPlan, now = new Date()): Promise<CoachPlanView> => {
    const todayKey = toDateKey(now, PROGRESS_TIME_ZONE);
    const today = planDayOf(todayKey);
    const weekStart = addDaysToDateKey(todayKey, 1 - today);
    const sessions = await GameSession.find({
        userId: new Types.ObjectId(userId),
        status: "completed",
        "rules.mode": "level",
        completedAt: {
            $gte: startOfDateKey(weekStart, PROGRESS_TIME_ZONE),
            $lt: startOfDateKey(addDaysToDateKey(weekStart, 7), PROGRESS_TIME_ZONE),
        },
    })
        .select("gameName rules.gameLevel accuracy completedAt")
        .lean<{ gameName: ConfiguredGameName; rules: { gameLevel: number | null }; accuracy: number | null; completedAt: Date }[]>()
        .exec();
    const plays = sessions.map((session) => ({
        day: planDayOf(toDateKey(session.completedAt, PROGRESS_TIME_ZONE)),
        gameName: session.gameName,
        level: session.rules.gameLevel ?? 1,
        accuracy: session.accuracy ?? 0,
    }));
    return { ...plan, weekStart, today, sessions: markWeekProgress(plan.sessions, plays) };
};

const getSavedPlan = async (userId: string): Promise<CoachPlanView | null> => {
    const user = await User.findById(userId).select("coachPlan").lean<{ coachPlan?: SavedCoachPlan | null }>().exec();
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User was not found");
    // Lộ trình dạng chữ của bản cũ không có sessions: coi như chưa lưu
    const plan = user.coachPlan;
    return plan && Array.isArray(plan.sessions) ? withWeekProgress(userId, plan) : null;
};

// Lộ trình từ client được kiểm tra và ép lại theo tiến độ thật trước khi lưu, như lộ trình từ Gemini
const savePlan = async (userId: string, rawBody: unknown): Promise<CoachPlanView> => {
    const plan = fitPlanToProgress(parsePlan(rawBody), await progressTool.getProgress(userId));
    if (!plan.sessions.length) throw new ApiError(StatusCodes.BAD_REQUEST, "A plan must contain at least one session");
    const user = await User.findByIdAndUpdate(
        userId,
        { $set: { coachPlan: { ...plan, savedAt: new Date() } } },
        { new: true, runValidators: true },
    ).select("coachPlan").lean<{ coachPlan?: SavedCoachPlan | null }>().exec();
    if (!user?.coachPlan) throw new ApiError(StatusCodes.NOT_FOUND, "User was not found");
    return withWeekProgress(userId, user.coachPlan);
};

export const coachPlanTool = {
    getSavedPlan,
    savePlan,
};
