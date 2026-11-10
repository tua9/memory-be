import { StatusCodes } from "http-status-codes";
import MatchTicket, { type MatchTicket as Ticket } from "../models/matchTicket.js";
import UserGameProgress from "../models/userGameProgress.js";
import type { UserDocument } from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { createMatchedRoom } from "./gameRoom.service.js";
import { getMaxLevel, parseGameName } from "./gameRules.service.js";

// Ghép trận tự động: chọn một trò rồi chờ. Người vào hàng sau đi ghép với người đang chờ trước, cùng trò,
// cấp đã mở gần nhau nhất. Ghép xong là có phòng hai người, trận tự bắt đầu sau 30 giây.
const TICKET_TTL_MS = 30_000;
const MATCHED_TTL_MS = 60_000;
const MATCH_ROUNDS = 3;
const CANDIDATES = 20;

type Me = Pick<UserDocument, "_id" | "username" | "avatarUrl">;
type Status = { status: "idle" } | { status: "searching"; gameName: string; since: Date } | { status: "matched"; code: string };

const later = (ms: number) => new Date(Date.now() + ms);

const matched = async (ticket: Pick<Ticket, "_id" | "roomCode">): Promise<Status> => {
    await MatchTicket.deleteOne({ _id: ticket._id });
    return { status: "matched", code: ticket.roomCode as string };
};

// Khoá vé của mình trước khi đi ghép, để trong lúc đó không ai ghép mình vào một phòng khác.
// Chỉ ghép với vé vào hàng trước mình, nên hai người không thể ghép chéo nhau thành hai phòng.
const attemptMatch = async (me: Me): Promise<Status> => {
    const mine = await MatchTicket.findOneAndUpdate(
        { userId: me._id, state: "searching", expiresAt: { $gt: new Date() } },
        { $set: { state: "locked" } },
        { new: true },
    ).lean();
    if (!mine) {
        const current = await MatchTicket.findOne({ userId: me._id }).lean();
        if (current?.state === "matched" && current.roomCode) return matched(current);
        return current ? { status: "searching", gameName: current.gameName, since: current.createdAt } : { status: "idle" };
    }
    try {
        const candidates = await MatchTicket.find({
            gameName: mine.gameName, state: "searching", _id: { $lt: mine._id }, expiresAt: { $gt: new Date() },
        }).sort({ _id: 1 }).limit(CANDIDATES).lean();
        candidates.sort((a, b) => Math.abs(a.level - mine.level) - Math.abs(b.level - mine.level));
        for (const candidate of candidates) {
            const claimed = await MatchTicket.findOneAndUpdate(
                { _id: candidate._id, state: "searching" }, { $set: { state: "locked" } }, { new: true },
            ).lean();
            if (!claimed) continue;
            try {
                // Người chờ trước làm chủ phòng; đề ở cấp thấp hơn của hai người để không ai bị đề quá khó
                const host = { _id: claimed.userId, username: claimed.username, avatarUrl: claimed.avatarUrl } as Me;
                const code = await createMatchedRoom(host, me, {
                    gameName: mine.gameName, mode: "level", gameLevel: Math.min(claimed.level, mine.level), roundCount: MATCH_ROUNDS,
                });
                await MatchTicket.updateOne({ _id: claimed._id }, { $set: { state: "matched", roomCode: code, expiresAt: later(MATCHED_TTL_MS) } });
                await MatchTicket.deleteOne({ _id: mine._id });
                return { status: "matched", code };
            } catch (error) {
                await MatchTicket.updateOne({ _id: claimed._id, state: "locked" }, { $set: { state: "searching" } });
                throw error;
            }
        }
    } catch (error) {
        await MatchTicket.updateOne({ _id: mine._id, state: "locked" }, { $set: { state: "searching" } });
        throw error;
    }
    await MatchTicket.updateOne({ _id: mine._id, state: "locked" }, { $set: { state: "searching" } });
    return { status: "searching", gameName: mine.gameName, since: mine.createdAt };
};

export const findMatch = async (me: Me, raw: unknown): Promise<Status> => {
    const body = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const gameName = parseGameName(body.gameName);
    const current = await MatchTicket.findOne({ userId: me._id }).lean();
    if (current?.state === "matched" && current.roomCode) return matched(current);
    if (current?.state === "locked") throw new ApiError(StatusCodes.CONFLICT, "Đang ghép trận, vui lòng thử lại");
    const progress = await UserGameProgress.findOne({ userId: me._id, gameName }).select("unlockedLevel").lean();
    const level = Math.min(progress?.unlockedLevel ?? 1, getMaxLevel(gameName));
    await MatchTicket.init();
    // Tìm lại (hoặc đổi trò) thì xếp lại cuối hàng
    await MatchTicket.deleteOne({ userId: me._id });
    try {
        await MatchTicket.create({
            userId: me._id, username: me.username, avatarUrl: me.avatarUrl ?? null, gameName, level,
            state: "searching", roomCode: null, expiresAt: later(TICKET_TTL_MS),
        });
    } catch (error) {
        // Hai lần bấm cùng lúc: vé của lần kia đã có, dùng luôn vé đó
        if ((error as { code?: number }).code !== 11000) throw error;
    }
    return attemptMatch(me);
};

// Client hỏi mỗi 2 giây: gia hạn vé, thử ghép lại, hoặc nhận mã phòng khi người khác đã ghép mình
export const pollMatch = async (me: Me): Promise<Status> => {
    const current = await MatchTicket.findOne({ userId: me._id }).lean();
    if (!current) return { status: "idle" };
    if (current.state === "matched" && current.roomCode) return matched(current);
    if (current.expiresAt <= new Date()) {
        await MatchTicket.deleteOne({ _id: current._id, state: { $ne: "matched" } });
        return { status: "idle" };
    }
    await MatchTicket.updateOne({ _id: current._id, state: "searching" }, { $set: { expiresAt: later(TICKET_TTL_MS) } });
    return attemptMatch(me);
};

// Huỷ tìm trận. Nếu vừa được ghép thì vẫn trả mã phòng, để người chơi không bỏ lỡ trận đã ghép.
export const cancelMatch = async (me: Me): Promise<Status> => {
    await MatchTicket.deleteOne({ userId: me._id, state: { $ne: "matched" } });
    const current = await MatchTicket.findOne({ userId: me._id }).lean();
    return current?.roomCode ? matched(current) : { status: "idle" };
};
