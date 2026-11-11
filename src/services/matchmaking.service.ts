import { randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { CONFIGURED_GAME_NAMES, type ConfiguredGameName } from "../config/games.js";
import MatchTicket, { type MatchTicket as Ticket } from "../models/matchTicket.js";
import UserGameProgress from "../models/userGameProgress.js";
import type { UserDocument } from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { addPlayerToRoom, createMatchedRoom, hostSearchInfo } from "./gameRoom.service.js";
import { getMaxLevel, parseGameName } from "./gameRules.service.js";

// Ghép trận tự động. Người vào hàng sau đi ghép với người đang chờ trước.
// - Vé thường: chọn một trò, hoặc "any" (bất kỳ trò nào). Ghép xong là có phòng hai người, tự bắt đầu sau 30 giây.
// - Vé phòng: chủ phòng đang chờ tìm một người ngẫu nhiên; ai được ghép sẽ vào thẳng phòng đó.
// Ưu tiên cùng trò và cấp đã mở gần nhất; vé "any" và vé phòng xếp sau theo thứ tự vào hàng.
const TICKET_TTL_MS = 30_000;
const MATCHED_TTL_MS = 60_000;
const MATCH_ROUNDS = 3;
const CANDIDATES = 20;
export const ANY_GAME = "any";

type Me = Pick<UserDocument, "_id" | "username" | "avatarUrl">;
type Status =
    | { status: "idle" }
    | { status: "searching"; gameName: string; since: Date; roomCode: string | null }
    | { status: "matched"; code: string };

const later = (ms: number) => new Date(Date.now() + ms);
const asMe = (ticket: Pick<Ticket, "userId" | "username" | "avatarUrl">) =>
    ({ _id: ticket.userId, username: ticket.username, avatarUrl: ticket.avatarUrl }) as Me;
const searching = (ticket: Pick<Ticket, "gameName" | "createdAt" | "hostRoomCode">): Status =>
    ({ status: "searching", gameName: ticket.gameName, since: ticket.createdAt, roomCode: ticket.hostRoomCode ?? null });

const matched = async (ticket: Pick<Ticket, "_id" | "roomCode">): Promise<Status> => {
    await MatchTicket.deleteOne({ _id: ticket._id });
    return { status: "matched", code: ticket.roomCode as string };
};

const levelFor = async (userId: Ticket["userId"], gameName: ConfiguredGameName) => {
    const progress = await UserGameProgress.findOne({ userId, gameName }).select("unlockedLevel").lean();
    return Math.min(progress?.unlockedLevel ?? 1, getMaxLevel(gameName));
};

const isConflict = (error: unknown) => error instanceof ApiError && error.statusCode === StatusCodes.CONFLICT;

// Ghép hai vé thành một phòng và trả mã phòng
const pair = async (mine: Ticket, other: Ticket, me: Me): Promise<string> => {
    if (other.hostRoomCode) return addPlayerToRoom(other.hostRoomCode, me);
    if (mine.hostRoomCode) return addPlayerToRoom(mine.hostRoomCode, asMe(other));
    const gameName = (mine.gameName !== ANY_GAME ? mine.gameName
        : other.gameName !== ANY_GAME ? other.gameName
        : CONFIGURED_GAME_NAMES[randomInt(CONFIGURED_GAME_NAMES.length)]) as ConfiguredGameName;
    // Người chờ trước làm chủ phòng; đề ở cấp thấp hơn của hai người để không ai bị đề quá khó
    const [hostLevel, myLevel] = await Promise.all([levelFor(other.userId, gameName), levelFor(me._id as Ticket["userId"], gameName)]);
    return createMatchedRoom(asMe(other), me, { gameName, mode: "level", gameLevel: Math.min(hostLevel, myLevel), roundCount: MATCH_ROUNDS });
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
        return current ? searching(current) : { status: "idle" };
    }
    const release = () => MatchTicket.updateOne({ _id: mine._id, state: "locked" }, { $set: { state: "searching" } });
    try {
        const candidates = await MatchTicket.find({
            ...(mine.gameName === ANY_GAME ? {} : { gameName: { $in: [mine.gameName, ANY_GAME] } }),
            // Hai phòng đang tìm người không ghép được với nhau
            ...(mine.hostRoomCode ? { hostRoomCode: null } : {}),
            state: "searching", _id: { $lt: mine._id }, expiresAt: { $gt: new Date() },
        }).sort({ _id: 1 }).limit(CANDIDATES).lean();
        const distance = (other: Ticket) => (other.gameName === mine.gameName && mine.gameName !== ANY_GAME ? Math.abs(other.level - mine.level) : 100);
        candidates.sort((a, b) => distance(a) - distance(b));
        for (const candidate of candidates) {
            const claimed = await MatchTicket.findOneAndUpdate(
                { _id: candidate._id, state: "searching" }, { $set: { state: "locked" } }, { new: true },
            ).lean();
            if (!claimed) continue;
            try {
                const code = await pair(mine, claimed, me);
                await MatchTicket.updateOne({ _id: claimed._id }, { $set: { state: "matched", roomCode: code, expiresAt: later(MATCHED_TTL_MS) } });
                await MatchTicket.deleteOne({ _id: mine._id });
                return { status: "matched", code };
            } catch (error) {
                // Phòng của người kia vừa đủ người hoặc đã bắt đầu: bỏ vé phòng đó, thử người tiếp theo
                if (isConflict(error) && claimed.hostRoomCode) {
                    await MatchTicket.deleteOne({ _id: claimed._id });
                    continue;
                }
                await MatchTicket.updateOne({ _id: claimed._id, state: "locked" }, { $set: { state: "searching" } });
                // Phòng của chính mình không còn chờ người: thôi tìm
                if (isConflict(error) && mine.hostRoomCode) {
                    await MatchTicket.deleteOne({ _id: mine._id });
                    return { status: "idle" };
                }
                throw error;
            }
        }
    } catch (error) {
        await release();
        throw error;
    }
    await release();
    return searching(mine);
};

const enqueue = async (me: Me, fields: { gameName: string; level: number; hostRoomCode: string | null }) => {
    const current = await MatchTicket.findOne({ userId: me._id }).lean();
    if (current?.state === "matched" && current.roomCode) return matched(current);
    if (current?.state === "locked") throw new ApiError(StatusCodes.CONFLICT, "Đang ghép trận, vui lòng thử lại");
    await MatchTicket.init();
    // Tìm lại (hoặc đổi trò) thì xếp lại cuối hàng
    await MatchTicket.deleteOne({ userId: me._id });
    try {
        await MatchTicket.create({
            userId: me._id, username: me.username, avatarUrl: me.avatarUrl ?? null, ...fields,
            state: "searching", roomCode: null, expiresAt: later(TICKET_TTL_MS),
        });
    } catch (error) {
        // Hai lần bấm cùng lúc: vé của lần kia đã có, dùng luôn vé đó
        if ((error as { code?: number }).code !== 11000) throw error;
    }
    return attemptMatch(me);
};

// Tìm trận nhanh: một trò cụ thể, hoặc "any" để ghép với người tìm bất kỳ trò nào
export const findMatch = async (me: Me, raw: unknown): Promise<Status> => {
    const body = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    if (body.gameName === ANY_GAME) return enqueue(me, { gameName: ANY_GAME, level: 1, hostRoomCode: null });
    const gameName = parseGameName(body.gameName);
    return enqueue(me, { gameName, level: await levelFor(me._id as Ticket["userId"], gameName), hostRoomCode: null });
};

// Chủ phòng tìm một người chơi ngẫu nhiên vào phòng của mình (cùng trò với phòng, hoặc người tìm bất kỳ trò nào)
export const findRoomPlayer = async (me: Me, code: string): Promise<Status> => {
    const room = await hostSearchInfo(code, me);
    return enqueue(me, { gameName: room.gameName, level: room.level, hostRoomCode: room.code });
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
