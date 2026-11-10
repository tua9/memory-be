import { randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import { getGameEngine, parseAnswers } from "../games/index.js";
import GameRoom, { type GameRoomDocument, type RoomAnswer, type RoomRound } from "../models/gameRoom.js";
import RoomResult from "../models/roomResult.js";
import type { UserDocument } from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { getMaxLevel, parseGameName, resolveRoundRules } from "./gameRules.service.js";

// Phòng đấu trí nhớ: ai cũng tạo được, ai có mã cũng vào được. Bản đầu cho 2 người;
// dữ liệu lưu theo danh sách người chơi nên sau này mở rộng thêm người không phải đổi cấu trúc.
const CAPACITY = 2;
const MAX_ROUNDS = 10;
const ROOM_TTL_MS = 24 * 60 * 60_000;
// Có kết quả vòng mà không ai chuyển vòng trong 2 phút: phòng tự kết thúc
const RESULT_GRACE_MS = 2 * 60_000;
// Bài nộp đúng lúc hết giờ vẫn được nhận dù đường truyền chậm vài giây
const SUBMIT_GRACE_MS = 3_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

type Me = Pick<UserDocument, "_id" | "username" | "avatarUrl">;
const idOf = (value: { toString(): string }) => value.toString();
const conflict = (message: string) => new ApiError(StatusCodes.CONFLICT, message);
const forbidden = (message: string) => new ApiError(StatusCodes.FORBIDDEN, message);
const notFound = () => new ApiError(StatusCodes.NOT_FOUND, "Không tìm thấy phòng");
const blank = (): RoomAnswer => ({ enteredRecallAt: null, memorizeUsedMs: null, submittedAt: null, answers: null, correct: null, usedMs: null, participated: false });
const addMs = (date: Date, ms: number) => new Date(date.getTime() + ms);
const asObject = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const isPlayer = (room: GameRoomDocument, userId: string) => room.players.some((player) => idOf(player.userId) === userId);
const isHost = (room: GameRoomDocument, userId: string) => idOf(room.hostId) === userId;
const assertHost = (room: GameRoomDocument, userId: string, message: string) => {
    if (!isHost(room, userId)) throw forbidden(message);
};

export const normalizeRoomCode = (code: unknown): string => {
    const value = typeof code === "string" ? code.trim().toUpperCase() : "";
    if (!new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(value)) throw notFound();
    return value;
};

// Thắng vòng: nhiều vị trí đúng hơn; bằng nhau thì ai dùng ít thời gian hơn. Không ai đúng, hoặc bằng nhau cả hai: hoà.
export const decideRoundWinner = (players: { id: string; correct: number | null; usedMs: number | null }[]): string => {
    const best = Math.max(...players.map((player) => player.correct ?? 0));
    if (best === 0) return "draw";
    const top = players.filter((player) => (player.correct ?? 0) === best);
    const fastest = Math.min(...top.map((player) => player.usedMs ?? Number.MAX_SAFE_INTEGER));
    const winners = top.filter((player) => (player.usedMs ?? Number.MAX_SAFE_INTEGER) === fastest);
    return winners.length === 1 ? winners[0].id : "draw";
};

const enterRecall = (player: RoomAnswer, round: RoomRound, now: Date) => {
    if (player.enteredRecallAt) return;
    const enteredAt = now < round.memorizeEndsAt ? now : round.memorizeEndsAt;
    player.enteredRecallAt = enteredAt;
    player.memorizeUsedMs = enteredAt.getTime() - round.startedAt.getTime();
};

const finishRoundIfReady = (room: GameRoomDocument, round: RoomRound) => {
    const entries = Object.entries(round.answers);
    if (!entries.every(([, answer]) => answer.submittedAt)) return;
    round.outcome = decideRoundWinner(entries.map(([id, answer]) => ({ id, correct: answer.correct, usedMs: answer.usedMs })));
    round.resultAt = new Date(Math.max(...entries.map(([, answer]) => answer.submittedAt!.getTime())));
    room.state = "round_result";
};

// Mọi request đều đối chiếu hạn giờ theo đồng hồ server: không ai cần giữ tab mở để phòng chạy tiếp
const advanceByClock = (room: GameRoomDocument, now: Date) => {
    if (room.state === "round_result") {
        const last = room.rounds[room.roundIndex];
        if (last?.resultAt && now.getTime() >= last.resultAt.getTime() + RESULT_GRACE_MS) {
            room.state = room.rounds.length === room.roundCount ? "completed" : "cancelled";
        }
        return;
    }
    if (room.state !== "memorizing" && room.state !== "recalling") return;
    const round = room.rounds[room.roundIndex];
    if (!round) return;
    if (now >= round.memorizeEndsAt) {
        Object.values(round.answers).forEach((answer) => enterRecall(answer, round, now));
        room.state = "recalling";
    }
    if (now.getTime() >= round.recallEndsAt.getTime() + SUBMIT_GRACE_MS) {
        // Hết giờ mà chưa nộp: nộp bài trắng thay người đó để người còn lại không bị kẹt
        for (const answer of Object.values(round.answers)) {
            if (answer.submittedAt) continue;
            answer.submittedAt = round.recallEndsAt;
            answer.answers = Array(round.items.length).fill(null);
            answer.correct = 0;
            answer.usedMs = round.recallEndsAt.getTime() - round.startedAt.getTime();
        }
        finishRoundIfReady(room, round);
    }
};

const snapshot = (room: GameRoomDocument) =>
    JSON.stringify([room.state, room.roundIndex, room.players, room.rounds, room.gameName, room.rules, room.roundCount, room.matchId, room.history]);

const findRoom = async (code: string) => {
    const room = await GameRoom.findOne({ code: normalizeRoomCode(code) });
    if (!room) throw notFound();
    return room;
};

const scoresOf = (room: GameRoomDocument) => {
    const finished = room.rounds.filter((round) => round.outcome !== null);
    return Object.fromEntries(room.players.map((player) => {
        const id = idOf(player.userId);
        const wins = finished.filter((round) => round.outcome === id).length;
        const draws = finished.filter((round) => round.outcome === "draw").length;
        const losses = finished.length - wins - draws;
        return [id, { wins, losses, draws, points: wins - losses }];
    }));
};

// Người thắng trận: thắng nhiều vòng hơn (thắng trừ thua). Bằng nhau là hoà.
const matchWinner = (room: GameRoomDocument): string => {
    const ranked = Object.entries(scoresOf(room)).sort(([, a], [, b]) => b.points - a.points);
    if (ranked.length < 2 || ranked[0][1].points === ranked[1][1].points) return "draw";
    return ranked[0][0];
};

// Cúp chỉ trao khi trận chơi đủ vòng và cả hai đều có trả lời ở mọi vòng,
// để không ai "nuôi cúp" bằng cách đấu với một tài khoản bỏ trống
const cupWinner = (room: GameRoomDocument): string | null => {
    const fair = room.state === "completed" && room.rounds.length === room.roundCount &&
        room.rounds.every((round) => round.outcome !== null && Object.values(round.answers).every((answer) => answer.participated));
    const winner = matchWinner(room);
    return fair && winner !== "draw" ? winner : null;
};

const recordResults = async (room: GameRoomDocument) => {
    const scores = scoresOf(room);
    const winner = matchWinner(room);
    const cupFor = cupWinner(room);
    const ids = room.players.map((player) => idOf(player.userId));
    const docs = ids.map((id) => {
        const opponent = ids.find((other) => other !== id) ?? id;
        const mine = scores[id];
        return {
            roomId: room.matchId ?? room._id, userId: id, opponentId: opponent, gameName: room.gameName,
            outcome: winner === "draw" ? "draw" : winner === id ? "win" : "lose",
            wins: mine.wins, losses: mine.losses, draws: mine.draws, cups: cupFor === id ? 1 : 0, completedAt: new Date(),
        };
    });
    try {
        await RoomResult.insertMany(docs, { ordered: false });
    } catch (error) {
        // Đã ghi từ request khác: unique (mã trận, userId) chặn ghi trùng
        if ((error as { code?: number }).code !== 11000) throw error;
    }
};

// Đọc phòng, chạy đồng hồ, áp dụng thao tác rồi ghi lại bằng so sánh revision.
// Không có gì thay đổi thì không ghi, nên việc client hỏi phòng mỗi 2 giây không tạo ghi DB.
const mutate = async (
    code: string,
    me: Me,
    action: (room: GameRoomDocument, now: Date, meId: string) => void,
    { memberOnly = true } = {},
) => {
    const meId = idOf(me._id);
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const room = await findRoom(code);
        if (memberOnly && !isPlayer(room, meId)) throw notFound();
        const before = snapshot(room);
        const wasCompleted = room.state === "completed";
        const now = new Date();
        advanceByClock(room, now);
        action(room, now, meId);
        if (snapshot(room) === before) return room;
        const finishing = !wasCompleted && room.state === "completed";
        if (finishing) room.history = [...(room.history ?? []), { winner: matchWinner(room), at: now }];
        const updated = await GameRoom.findOneAndUpdate(
            { _id: room._id, revision: room.revision },
            {
                $set: {
                    state: room.state, roundIndex: room.roundIndex, players: room.players, rounds: room.rounds,
                    gameName: room.gameName, rules: room.rules, roundCount: room.roundCount,
                    matchId: room.matchId, history: room.history, expiresAt: addMs(now, ROOM_TTL_MS),
                },
                $inc: { revision: 1 },
            },
            { new: true },
        );
        if (!updated) continue;
        if (finishing) await recordResults(updated);
        return updated;
    }
    throw conflict("Phòng vừa thay đổi, vui lòng thử lại");
};

const makeRound = (room: GameRoomDocument, now: Date): RoomRound => {
    const engine = getGameEngine(room.gameName);
    const items = engine.generateItems(room.rules.totalItems, room.rules.gameLevel, undefined, room.rules.language);
    const memorizeEndsAt = addMs(now, room.rules.memorizeLimitSec * 1000);
    return {
        items, recallOptions: engine.buildRecallOptions(items), startedAt: now, memorizeEndsAt,
        recallEndsAt: addMs(memorizeEndsAt, room.rules.recallLimitSec * 1000),
        answers: Object.fromEntries(room.players.map((player) => [idOf(player.userId), blank()])),
        outcome: null, resultAt: null,
    };
};

const view = (room: GameRoomDocument, me: Me) => {
    const meId = idOf(me._id);
    const engine = getGameEngine(room.gameName);
    const round = room.rounds[room.roundIndex];
    const mine = round?.answers[meId];
    const resultVisible = room.state === "round_result" || room.state === "completed";
    const phase = !round || resultVisible || room.state === "cancelled" ? room.state
        : mine?.submittedAt ? "waiting_for_other"
        : mine?.enteredRecallAt ? "recalling" : "memorizing";
    const scores = scoresOf(room);
    const showAnswer = (answer: string | null) => answer === null ? null : engine.answerView?.(answer) ?? engine.toView(answer);
    const marks = (answers: (string | null)[] | null) => round.items.map((item, index) => {
        const answer = answers?.[index] ?? null;
        return engine.matches ? engine.matches(item, answer) : answer === item;
    });
    return {
        code: room.code, revision: room.revision, state: room.state, phase,
        gameName: room.gameName, rules: room.rules, roundCount: room.roundCount, roundIndex: room.roundIndex,
        capacity: room.capacity, isHost: isHost(room, meId), meId, serverNow: new Date(),
        players: room.players.map((player) => {
            const id = idOf(player.userId);
            const answer = round?.answers[id];
            return {
                _id: id, username: player.username, avatarUrl: player.avatarUrl, ready: player.ready,
                isHost: isHost(room, id), isMe: id === meId,
                inRecall: Boolean(answer?.enteredRecallAt), submitted: Boolean(answer?.submittedAt),
                score: scores[id],
            };
        }),
        round: round ? {
            memorizeEndsAt: round.memorizeEndsAt, recallEndsAt: round.recallEndsAt,
            items: phase === "memorizing" ? round.items.map((item) => engine.toView(item)) : undefined,
            recallOptions: phase === "recalling" ? round.recallOptions.map((item) => engine.toRecallView?.(item) ?? engine.toView(item)) : undefined,
            myAnswers: mine?.submittedAt ? mine.answers : undefined,
            result: resultVisible ? {
                outcome: round.outcome,
                expected: round.items.map((item) => engine.toView(item)),
                players: Object.entries(round.answers).map(([id, answer]) => ({
                    _id: id, correct: answer.correct ?? 0, total: round.items.length, usedMs: answer.usedMs ?? 0,
                    answers: (answer.answers ?? round.items.map(() => null)).map(showAnswer),
                    marks: marks(answer.answers),
                })),
            } : undefined,
        } : null,
        // Người thắng từng vòng đã chơi (userId, "draw", hoặc null khi vòng đang diễn ra)
        roundOutcomes: room.rounds.map((item) => item.outcome),
        cupWinnerId: cupWinner(room),
        history: (room.history ?? []).map((match) => ({ winner: match.winner })),
    };
};

export type RoomView = ReturnType<typeof view>;

const playerOf = (me: Me) => ({
    userId: me._id as Types.ObjectId, username: me.username, avatarUrl: me.avatarUrl ?? null, ready: false, joinedAt: new Date(),
});

// Cài đặt một trận: trò chơi, độ khó, thời gian, số vòng. Dùng khi tạo phòng và khi chơi lại với trò khác.
const parseSetup = (raw: unknown) => {
    const body = asObject(raw);
    const gameName = parseGameName(body.gameName);
    const roundCount = body.roundCount;
    if (typeof roundCount !== "number" || !Number.isInteger(roundCount) || roundCount < 1 || roundCount > MAX_ROUNDS) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Số vòng phải từ 1 đến ${MAX_ROUNDS}`);
    }
    // Phòng đấu không ảnh hưởng tiến độ cá nhân nên chủ phòng chọn cấp nào cũng được
    return { gameName, roundCount, rules: resolveRoundRules(gameName, body, getMaxLevel(gameName)) };
};

export const createRoom = async (me: Me, raw: unknown) => {
    await GameRoom.init();
    const { gameName, roundCount, rules } = parseSetup(raw);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
        try {
            const room = await GameRoom.create({
                code, hostId: me._id, capacity: CAPACITY, players: [playerOf(me)], gameName, rules, roundCount,
                expiresAt: addMs(new Date(), ROOM_TTL_MS),
            });
            return view(room, me);
        } catch (error) {
            if ((error as { code?: number }).code !== 11000) throw error;
        }
    }
    throw conflict("Chưa tạo được mã phòng, vui lòng thử lại");
};

export const getRoom = async (code: string, me: Me) => view(await mutate(code, me, () => undefined), me);

export const joinRoom = async (code: string, me: Me) => view(await mutate(code, me, (room, _now, meId) => {
    if (isPlayer(room, meId)) return;
    if (room.state !== "waiting") throw conflict("Trận đấu đã bắt đầu hoặc đã kết thúc");
    if (room.players.length >= room.capacity) throw conflict("Phòng đã đủ người");
    room.players.push(playerOf(me));
}, { memberOnly: false }), me);

// Rời phòng lúc chờ hoặc sau khi trận xong. Chủ phòng rời thì phòng đóng; khách rời thì chỗ trống cho người khác vào.
export const leaveRoom = async (code: string, me: Me) => view(await mutate(code, me, (room, _now, meId) => {
    if (room.state !== "waiting" && room.state !== "completed" && room.state !== "cancelled") throw conflict("Trận đấu đang diễn ra");
    // Chủ phòng cũng ra khỏi danh sách để người còn lại thấy chủ phòng đã đi, không chờ trận mới
    if (isHost(room, meId)) room.state = "cancelled";
    room.players = room.players.filter((player) => idOf(player.userId) !== meId);
}), me);

export const kickPlayer = async (code: string, me: Me, raw: unknown) => view(await mutate(code, me, (room, _now, meId) => {
    assertHost(room, meId, "Chỉ chủ phòng mới mời người chơi ra");
    if (room.state !== "waiting") throw conflict("Trận đấu đang diễn ra");
    const target = asObject(raw).userId;
    if (typeof target !== "string" || target === meId || !isPlayer(room, target)) throw new ApiError(StatusCodes.BAD_REQUEST, "Người chơi không hợp lệ");
    room.players = room.players.filter((player) => idOf(player.userId) !== target);
}), me);

export const setReady = async (code: string, me: Me, raw: unknown) => view(await mutate(code, me, (room, _now, meId) => {
    if (room.state !== "waiting") throw conflict("Trận đấu đã bắt đầu");
    const player = room.players.find((item) => idOf(item.userId) === meId);
    if (player) player.ready = asObject(raw).ready !== false;
}), me);

export const startRoom = async (code: string, me: Me) => view(await mutate(code, me, (room, now, meId) => {
    assertHost(room, meId, "Chỉ chủ phòng mới bắt đầu được");
    if (room.state !== "waiting") throw conflict("Trận đấu đã bắt đầu");
    if (room.players.length < room.capacity || !room.players.every((player) => player.ready)) throw conflict("Cần đủ người và tất cả đã sẵn sàng");
    room.rounds.push(makeRound(room, now));
    room.roundIndex = 0;
    room.state = "memorizing";
}), me);

export const enterRecallPhase = async (code: string, me: Me) => view(await mutate(code, me, (room, now, meId) => {
    if (room.state !== "memorizing" && room.state !== "recalling") throw conflict("Vòng đấu chưa diễn ra");
    const round = room.rounds[room.roundIndex];
    if (!round?.answers[meId]) throw conflict("Không tìm thấy vòng đấu");
    enterRecall(round.answers[meId], round, now);
    if (Object.values(round.answers).every((answer) => answer.enteredRecallAt)) room.state = "recalling";
}), me);

export const submitAnswers = async (code: string, me: Me, raw: unknown) => view(await mutate(code, me, (room, now, meId) => {
    if (room.state !== "memorizing" && room.state !== "recalling") throw conflict("Vòng đấu đã kết thúc");
    const round = room.rounds[room.roundIndex];
    const player = round?.answers[meId];
    if (!player) throw conflict("Không tìm thấy vòng đấu");
    if (player.submittedAt) throw conflict("Bạn đã nộp bài vòng này");
    if (!player.enteredRecallAt) throw conflict("Hãy chuyển sang phần trả lời trước khi nộp");
    const engine = getGameEngine(room.gameName);
    const answers = parseAnswers(engine, round.items, asObject(raw).answers);
    // Nộp trong thời gian gia hạn thì tính thời gian đến đúng lúc hết giờ
    const countedAt = now < round.recallEndsAt ? now : round.recallEndsAt;
    player.answers = answers;
    player.correct = answers.filter((answer, index) => engine.matches ? engine.matches(round.items[index], answer) : answer === round.items[index]).length;
    player.submittedAt = now;
    player.usedMs = (player.memorizeUsedMs ?? 0) + Math.max(0, countedAt.getTime() - player.enteredRecallAt.getTime());
    player.participated = answers.some((answer) => answer !== null);
    finishRoundIfReady(room, round);
}), me);

export const nextRound = async (code: string, me: Me) => view(await mutate(code, me, (room, now, meId) => {
    assertHost(room, meId, "Chỉ chủ phòng mới chuyển vòng được");
    if (room.state !== "round_result" || room.roundIndex + 1 >= room.roundCount) throw conflict("Không còn vòng tiếp theo");
    room.rounds.push(makeRound(room, now));
    room.roundIndex += 1;
    room.state = "memorizing";
}), me);

// Kết thúc sau vòng cuối là hoàn thành trận; kết thúc giữa chừng là huỷ trận
export const finishRoom = async (code: string, me: Me) => view(await mutate(code, me, (room, _now, meId) => {
    assertHost(room, meId, "Chỉ chủ phòng mới kết thúc được");
    if (room.state === "completed" || room.state === "cancelled") return;
    room.state = room.state === "round_result" && room.rounds.length === room.roundCount ? "completed" : "cancelled";
}), me);

// Chơi lại trong cùng phòng với người đang ở đây. Không gửi cài đặt thì giữ trò cũ; gửi cài đặt thì đổi trò.
// Mỗi trận mới có mã trận riêng để kết quả và cúp ghi riêng từng trận.
export const rematch = async (code: string, me: Me, raw: unknown) => {
    const body = asObject(raw);
    const setup = body.gameName === undefined ? null : parseSetup(body);
    return view(await mutate(code, me, (room, _now, meId) => {
        assertHost(room, meId, "Chỉ chủ phòng mới mở trận mới");
        if (room.state !== "completed" && room.state !== "cancelled") throw conflict("Trận hiện tại chưa kết thúc");
        if (setup) Object.assign(room, setup);
        room.matchId = new Types.ObjectId();
        room.rounds = [];
        room.roundIndex = -1;
        room.state = "waiting";
        room.players.forEach((player) => { player.ready = false; });
    }), me);
};

const countResults = async (userId: Types.ObjectId) => {
    const results = await RoomResult.find({ userId }).select("outcome cups").lean();
    return {
        matches: results.length,
        wins: results.filter((item) => item.outcome === "win").length,
        losses: results.filter((item) => item.outcome === "lose").length,
        draws: results.filter((item) => item.outcome === "draw").length,
        cups: results.reduce((sum, item) => sum + item.cups, 0),
    };
};

export const getRoomStats = async (me: Me) => countResults(me._id as Types.ObjectId);

const LEADERBOARD_SIZE = 20;

// Bảng xếp hạng cúp. Cùng số cúp thì cùng hạng.
// shortcut: cộng lại từ room_results mỗi lần xem, đủ nhanh với vài chục nghìn trận; nhiều hơn thì lưu sẵn tổng cúp theo người.
export const getLeaderboard = async (me: Me) => {
    type Entry = { _id: Types.ObjectId; cups: number; wins: number; matches: number; user: { username: string; avatarUrl?: string | null } };
    const totals = RoomResult.aggregate<Entry>()
        .group({
            _id: "$userId",
            cups: { $sum: "$cups" },
            wins: { $sum: { $cond: [{ $eq: ["$outcome", "win"] }, 1, 0] } },
            matches: { $sum: 1 },
        })
        .match({ cups: { $gt: 0 } });
    const top = await totals
        .sort({ cups: -1, wins: -1, _id: 1 })
        .limit(LEADERBOARD_SIZE * 2)
        .lookup({ from: "users", localField: "_id", foreignField: "_id", as: "user" })
        .unwind("$user")
        .match({ "user.status": "active" })
        .limit(LEADERBOARD_SIZE);
    const mine = await countResults(me._id as Types.ObjectId);
    const ahead = mine.cups > 0
        ? (await RoomResult.aggregate<{ n: number }>()
            .group({ _id: "$userId", cups: { $sum: "$cups" } })
            .match({ cups: { $gt: mine.cups } })
            .count("n"))[0]?.n ?? 0
        : null;
    const rankOf = (cups: number) => top.filter((entry) => entry.cups > cups).length + 1;
    return {
        entries: top.map((entry) => ({
            _id: idOf(entry._id),
            username: entry.user.username,
            avatarUrl: entry.user.avatarUrl ?? null,
            cups: entry.cups, wins: entry.wins, matches: entry.matches,
            rank: rankOf(entry.cups), isMe: idOf(entry._id) === idOf(me._id),
        })),
        me: { ...mine, rank: ahead === null ? null : ahead + 1 },
    };
};

export const deleteRoomDataOf = async (userId: string | Types.ObjectId) => {
    await Promise.all([
        GameRoom.deleteMany({ "players.userId": userId }),
        RoomResult.deleteMany({ userId }),
    ]);
};
