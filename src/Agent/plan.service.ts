import { StatusCodes } from "http-status-codes";
import { CONFIGURED_GAME_NAMES, type ConfiguredGameName } from "../config/games.js";
import ApiError from "../utils/ApiError.js";
import type { CoachAnalysis } from "./coach.service.js";

// Lộ trình tuần có cấu trúc: day 1 là Thứ 2, ..., 7 là Chủ nhật
export interface PlanSession {
    day: number;
    minutes: number;
    gameName: ConfiguredGameName;
    level: number;
    targetAccuracy: number;
    tip: string;
}

export interface CoachPlan {
    goal: string;
    minutesPerDay: number;
    sessions: PlanSession[];
}

const MAX_SESSIONS = 14;
const MAX_SESSIONS_PER_DAY = 3;
const MAX_MINUTES = 180;
const MAX_TEXT = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const invalid = (message: string) => new ApiError(StatusCodes.BAD_REQUEST, message);

const intIn = (value: unknown, min: number, max: number, field: string): number => {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
        throw invalid(`${field} must be an integer from ${min} to ${max}`);
    }
    return value as number;
};

const textIn = (value: unknown, field: string): string => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > MAX_TEXT) throw invalid(`${field} must contain 1 to ${MAX_TEXT} characters`);
    return text;
};

// Kiểm tra cấu trúc lộ trình đến từ client hoặc từ Gemini; chỉ lấy các trường đã biết
export const parsePlan = (value: unknown): CoachPlan => {
    if (!isRecord(value)) throw invalid("A plan object is required");
    const { sessions } = value;
    if (!Array.isArray(sessions) || sessions.length < 1 || sessions.length > MAX_SESSIONS) {
        throw invalid(`A plan must contain 1 to ${MAX_SESSIONS} sessions`);
    }
    const plan: CoachPlan = {
        goal: textIn(value.goal, "goal"),
        minutesPerDay: intIn(value.minutesPerDay, 5, MAX_MINUTES, "minutesPerDay"),
        sessions: sessions.map((session): PlanSession => {
            if (!isRecord(session)) throw invalid("Each session must be an object");
            if (!CONFIGURED_GAME_NAMES.includes(session.gameName as ConfiguredGameName)) {
                throw invalid("Each session must use a known game");
            }
            return {
                day: intIn(session.day, 1, 7, "day"),
                minutes: intIn(session.minutes, 1, MAX_MINUTES, "minutes"),
                gameName: session.gameName as ConfiguredGameName,
                level: intIn(session.level, 1, 100, "level"),
                targetAccuracy: intIn(session.targetAccuracy, 50, 100, "targetAccuracy"),
                tip: textIn(session.tip, "tip"),
            };
        }),
    };
    for (let day = 1; day <= 7; day++) {
        if (plan.sessions.filter((session) => session.day === day).length > MAX_SESSIONS_PER_DAY) {
            throw invalid(`A day can hold at most ${MAX_SESSIONS_PER_DAY} sessions`);
        }
    }
    return plan;
};

// Lớp bảo vệ thật sự (prompt chỉ là lời dặn): không vượt cấp đã mở, không vượt ngân sách phút mỗi ngày.
// Ngày vượt ngân sách được chia lại theo tỷ lệ; tối đa 3 buổi/ngày và ngân sách >= 5 nên buổi dài nhất luôn còn >= 1 phút.
export const fitPlanToProgress = (plan: CoachPlan, analysis: Pick<CoachAnalysis, "games">): CoachPlan => {
    const unlocked = new Map(analysis.games.map((game) => [game.gameName, game.unlockedLevel]));
    const dayTotals = new Map<number, number>();
    for (const session of plan.sessions) {
        dayTotals.set(session.day, (dayTotals.get(session.day) ?? 0) + session.minutes);
    }
    const sessions = plan.sessions
        .map((session) => {
            const total = dayTotals.get(session.day) ?? 0;
            return {
                ...session,
                level: Math.min(session.level, unlocked.get(session.gameName) ?? 1),
                minutes: total > plan.minutesPerDay
                    ? Math.floor((session.minutes * plan.minutesPerDay) / total)
                    : session.minutes,
            };
        })
        .filter((session) => session.minutes > 0)
        .sort((a, b) => a.day - b.day);
    return { ...plan, sessions };
};

// Schema cho structured output của Gemini: luôn có reply, plan chỉ có khi đủ thông tin để lập hoặc sửa lộ trình
export const COACH_RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        reply: { type: "STRING" },
        plan: {
            type: "OBJECT",
            nullable: true,
            properties: {
                goal: { type: "STRING" },
                minutesPerDay: { type: "INTEGER" },
                sessions: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            day: { type: "INTEGER" },
                            minutes: { type: "INTEGER" },
                            gameName: { type: "STRING", enum: [...CONFIGURED_GAME_NAMES] },
                            level: { type: "INTEGER" },
                            targetAccuracy: { type: "INTEGER" },
                            tip: { type: "STRING" },
                        },
                        required: ["day", "minutes", "gameName", "level", "targetAccuracy", "tip"],
                    },
                },
            },
            required: ["goal", "minutesPerDay", "sessions"],
        },
    },
    required: ["reply"],
} as const;

export interface PlanPlay {
    day: number;
    gameName: ConfiguredGameName;
    level: number;
    accuracy: number;
}

// Một buổi tính là đã tập khi trong ngày đó có ván cùng game ở cấp >= cấp của buổi; giữ độ chính xác cao nhất
export const markWeekProgress = (sessions: readonly PlanSession[], plays: readonly PlanPlay[]) =>
    sessions.map((session) => {
        const matches = plays.filter((play) =>
            play.day === session.day && play.gameName === session.gameName && play.level >= session.level);
        return {
            ...session,
            bestAccuracy: matches.length ? Math.max(...matches.map((play) => play.accuracy)) : null,
        };
    });
