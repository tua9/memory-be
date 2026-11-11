import { randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import { getGameEngine, parseAnswers } from "../games/index.js";
import GameRoom, { type GameRoomDocument, type RoomAnswer, type RoomRound } from "../models/gameRoom.js";
import MatchTicket from "../models/matchTicket.js";
import RoomResult from "../models/roomResult.js";
import type { UserDocument } from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { getMaxLevel, parseGameName, resolveRoundRules } from "./gameRules.service.js";

// Phòng đấu trí nhớ: ai cũng tạo được, ai có mã cũng vào được. Phòng 2–5 người; ghép trận nhanh tạo phòng 5 chỗ.
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
const MAX_ROUNDS = 10;
const ROOM_TTL_MS = 24 * 60 * 60_000;
// Có kết quả vòng mà không ai chuyển vòng trong 2 phút: phòng tự kết thúc
const RESULT_GRACE_MS = 2 * 60_000;
// Bài nộp đúng lúc hết giờ vẫn được nhận dù đường truyền chậm vài giây
const SUBMIT_GRACE_MS = 3_000;
// Từ 2 người trở lên và tất cả đã sẵn sàng: đếm ngược 5 giây rồi tự vào trận, không cần bấm bắt đầu
export const START_DELAY_MS = 5_000;
// Chủ phòng bấm tìm người chơi: phòng mở cho ghép trận nhanh 60 giây, có người vào cũng không gia hạn
export const SEARCH_WINDOW_MS = 60_000;
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
const activePlayers = (room: GameRoomDocument) => room.players.filter((player) => !player.left);
const isPlaying = (room: GameRoomDocument) => room.state === "memorizing" || room.state === "recalling" || room.state === "round_result";
const canStart = (room: GameRoomDocument) => room.players.length >= MIN_PLAYERS && room.players.every((player) => player.ready);
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
    if (room.state === "waiting") {
        if (room.startsAt && now >= room.startsAt && canStart(room)) beginMatch(room, now);
        return;
    }
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
    JSON.stringify([room.state, room.hostId, room.roundIndex, room.players, room.rounds, room.gameName, room.rules, room.roundCount, room.matchId, room.history, room.startsAt, room.searchEndsAt]);

const findRoom = async (code: string) => {
    const room = await GameRoom.findOne({ code: normalizeRoomCode(code) });
    if (!room) throw notFound();
    return room;
};

type Entry = { correct: number | null; usedMs: number | null };
// Trong một vòng: nhiều vị trí đúng hơn xếp trên; bằng nhau thì nhanh hơn xếp trên, trừ khi cả hai đều không đúng vị trí nào
const beats = (a: Entry, b: Entry) => {
    const [mine, theirs] = [a.correct ?? 0, b.correct ?? 0];
    if (mine !== theirs) return mine > theirs;
    return mine > 0 && (a.usedMs ?? Number.MAX_SAFE_INTEGER) < (b.usedMs ?? Number.MAX_SAFE_INTEGER);
};

// Mỗi vòng, mỗi người được 1 điểm cho mỗi người mình xếp trên (2 người thì thắng vòng là 1 điểm).
// Chỉ tính những vòng người đó có mặt; rời giữa vòng thì vòng đó không có bài của họ.
const scoresOf = (room: GameRoomDocument) => {
    const finished = room.rounds.filter((round) => round.outcome !== null);
    return Object.fromEntries(room.players.map((player) => {
        const id = idOf(player.userId);
        const played = finished.filter((round) => round.answers[id]);
        const wins = played.filter((round) => round.outcome === id).length;
        const draws = played.filter((round) => round.outcome === "draw").length;
        const points = played.reduce((sum, round) => {
            const mine = round.answers[id];
            return sum + Object.entries(round.answers).filter(([other, answer]) => other !== id && beats(mine, answer)).length;
        }, 0);
        const correct = played.reduce((sum, round) => sum + (round.answers[id].correct ?? 0), 0);
        return [id, { wins, losses: played.length - wins - draws, draws, points, correct }];
    }));
};

// Xếp hạng trận: người rời trận đứng sau mọi người ở lại; rồi nhiều điểm hơn, rồi nhiều vị trí đúng hơn.
// Bằng nhau hết thì đồng hạng (hạng = 1 + số người xếp trên mình).
export const placeAll = (players: { id: string; points: number; correct: number; left: boolean }[]): Record<string, number> => {
    const better = (a: typeof players[number], b: typeof players[number]) =>
        a.left !== b.left ? !a.left : a.points !== b.points ? a.points > b.points : a.correct > b.correct;
    return Object.fromEntries(players.map((player) => [player.id, 1 + players.filter((other) => better(other, player)).length]));
};

// Cúp theo hạng, theo số người trong trận. Đồng hạng thì chia trung bình cúp của các hạng cùng chiếm, làm tròn xuống
// (hai người hoà nhau được 0).
const CUP_TABLE: Record<number, number[]> = { 2: [2, -1], 3: [2, 0, -1], 4: [2, 1, 0, -1], 5: [2, 1, 0, -1, -2] };
export const cupsFor = (places: Record<string, number>): Record<string, number> => {
    const table = CUP_TABLE[Object.keys(places).length];
    const values = Object.values(places);
    return Object.fromEntries(Object.entries(places).map(([id, place]) => {
        if (!table) return [id, 0];
        const shared = table.slice(place - 1, place - 1 + values.filter((value) => value === place).length);
        return [id, Math.floor(shared.reduce((sum, cups) => sum + cups, 0) / shared.length)];
    }));
};

// Có thi đấu thật: có mặt ít nhất một vòng và vòng nào có mặt cũng có trả lời
const competed = (room: GameRoomDocument, id: string) => {
    const rounds = room.rounds.filter((round) => round.outcome !== null && round.answers[id]);
    return rounds.length > 0 && rounds.every((round) => round.answers[id].participated);
};

// Hạng và cúp của trận. Cần ít nhất 2 người thi đấu thật thì mới trao cúp, để không ai "nuôi cúp"
// bằng tài khoản bỏ trống; người rời trận thì vẫn bị trừ cúp, để rời trận không thành cách né thua.
const standings = (room: GameRoomDocument) => {
    const scores = scoresOf(room);
    const places = placeAll(room.players.map((player) => {
        const id = idOf(player.userId);
        return { id, points: scores[id].points, correct: scores[id].correct, left: player.left };
    }));
    const table = cupsFor(places);
    const contested = room.players.filter((player) => competed(room, idOf(player.userId))).length >= MIN_PLAYERS;
    const cups = Object.fromEntries(room.players.map((player) => {
        const id = idOf(player.userId);
        return [id, contested ? table[id] : player.left ? Math.min(table[id], 0) : 0];
    }));
    return { scores, places, cups };
};

// Người thắng trận: người duy nhất đứng hạng 1; đồng hạng 1 là hoà
const matchWinner = (room: GameRoomDocument): string => {
    const firsts = Object.entries(standings(room).places).filter(([, place]) => place === 1);
    return firsts.length === 1 ? firsts[0][0] : "draw";
};

const recordResults = async (room: GameRoomDocument) => {
    const { scores, places, cups } = standings(room);
    const ids = room.players.map((player) => idOf(player.userId));
    const firsts = ids.filter((id) => places[id] === 1).length;
    const docs = ids.map((id) => {
        const opponents = ids.filter((other) => other !== id);
        const mine = scores[id];
        return {
            roomId: room.matchId ?? room._id, userId: id, opponentId: opponents[0] ?? id, opponentIds: opponents,
            gameName: room.gameName, placement: places[id], playerCount: ids.length,
            outcome: places[id] !== 1 ? "lose" : firsts === 1 ? "win" : "draw",
            wins: mine.wins, losses: mine.losses, draws: mine.draws, cups: cups[id], completedAt: new Date(),
        };
    });
    ids.forEach((id) => statsCache.delete(id));
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
                    state: room.state, hostId: room.hostId, roundIndex: room.roundIndex, players: room.players, rounds: room.rounds,
                    gameName: room.gameName, rules: room.rules, roundCount: room.roundCount,
                    matchId: room.matchId, history: room.history, startsAt: room.startsAt ?? null, searchEndsAt: room.searchEndsAt ?? null, expiresAt: addMs(now, ROOM_TTL_MS),
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
        answers: Object.fromEntries(activePlayers(room).map((player) => [idOf(player.userId), blank()])),
        outcome: null, resultAt: null,
    };
};

const beginMatch = (room: GameRoomDocument, now: Date) => {
    room.rounds = [makeRound(room, now)];
    room.roundIndex = 0;
    room.state = "memorizing";
    room.startsAt = null;
    room.searchEndsAt = null;
};

// Từ 2 người trở lên và tất cả sẵn sàng thì hẹn giờ bắt đầu (giữ mốc đã hẹn);
// có người huỷ sẵn sàng hoặc người mới vào (chưa sẵn sàng) thì huỷ hẹn
const armCountdown = (room: GameRoomDocument, now: Date) => {
    if (room.state !== "waiting" || !canStart(room)) room.startsAt = null;
    else room.startsAt ??= addMs(now, START_DELAY_MS);
};

const view = (room: GameRoomDocument, me: Me) => {
    const meId = idOf(me._id);
    const engine = getGameEngine(room.gameName);
    const round = room.rounds[room.roundIndex];
    const mine = round?.answers[meId];
    const resultVisible = room.state === "round_result" || room.state === "completed";
    const phase = !round || resultVisible || room.state === "cancelled" ? room.state
        // Không có bài trong vòng này (đã rời trận): chỉ được xem, không thấy đề
        : !mine || mine.submittedAt ? "waiting_for_other"
        : mine?.enteredRecallAt ? "recalling" : "memorizing";
    const { scores, places, cups } = standings(room);
    const done = room.state === "completed";
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
                _id: id, username: player.username, avatarUrl: player.avatarUrl, ready: player.ready, left: player.left,
                isHost: isHost(room, id), isMe: id === meId,
                inRecall: Boolean(answer?.enteredRecallAt), submitted: Boolean(answer?.submittedAt),
                score: { wins: scores[id].wins, points: scores[id].points },
                // Hạng và cúp cộng/trừ của trận vừa xong
                place: done ? places[id] : null, cups: done ? cups[id] : null,
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
        startsAt: room.state === "waiting" ? room.startsAt ?? null : null,
        searchEndsAt: room.state === "waiting" ? room.searchEndsAt ?? null : null,
        history: (room.history ?? []).map((match) => ({ winner: match.winner })),
    };
};

// Giới thiệu ngắn về người chơi (số trận, số cúp) để hai bên biết mình đấu với ai.
// shortcut: đệm trong bộ nhớ 30 giây theo từng tiến trình, đủ cho một máy chủ; nhiều máy chủ thì chuyển sang lưu sẵn tổng.
const STATS_TTL_MS = 30_000;
const statsCache = new Map<string, { at: number; matches: number; cups: number }>();

const statsOf = async (ids: string[]) => {
    const now = Date.now();
    const missing = ids.filter((id) => (statsCache.get(id)?.at ?? 0) + STATS_TTL_MS < now);
    if (missing.length) {
        const rows = await RoomResult.aggregate<{ _id: Types.ObjectId; matches: number; cups: number }>()
            .match({ userId: { $in: missing.map((id) => new Types.ObjectId(id)) } })
            .group({ _id: "$userId", matches: { $sum: 1 }, cups: { $sum: "$cups" } });
        for (const id of missing) {
            const row = rows.find((item) => idOf(item._id) === id);
            statsCache.set(id, { at: now, matches: row?.matches ?? 0, cups: row?.cups ?? 0 });
        }
    }
    return Object.fromEntries(ids.map((id) => {
        const entry = statsCache.get(id);
        return [id, { matches: entry?.matches ?? 0, cups: entry?.cups ?? 0 }];
    }));
};

const present = async (room: GameRoomDocument, me: Me) => {
    const shown = view(room, me);
    const stats = await statsOf(shown.players.map((player) => player._id));
    return { ...shown, players: shown.players.map((player) => ({ ...player, stats: stats[player._id] })) };
};

export type RoomView = Awaited<ReturnType<typeof present>>;

const playerOf = (me: Me) => ({
    userId: me._id as Types.ObjectId, username: me.username, avatarUrl: me.avatarUrl ?? null, ready: false, joinedAt: new Date(), left: false,
});

const parseCapacity = (raw: unknown) => {
    const capacity = asObject(raw).capacity ?? MIN_PLAYERS;
    if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Số người chơi phải từ ${MIN_PLAYERS} đến ${MAX_PLAYERS}`);
    }
    return capacity;
};

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

const insertRoom = async (host: Me, guests: Me[], raw: unknown, { capacity, searching }: { capacity: number; searching: boolean }) => {
    await GameRoom.init();
    const { gameName, roundCount, rules } = parseSetup(raw);
    const now = new Date();
    const players = [host, ...guests].map(playerOf);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
        try {
            return await GameRoom.create({
                code, hostId: host._id, capacity, players, gameName, rules, roundCount,
                searchEndsAt: searching ? addMs(now, SEARCH_WINDOW_MS) : null,
                expiresAt: addMs(now, ROOM_TTL_MS),
            });
        } catch (error) {
            if ((error as { code?: number }).code !== 11000) throw error;
        }
    }
    throw conflict("Chưa tạo được mã phòng, vui lòng thử lại");
};

export const createRoom = async (me: Me, raw: unknown) =>
    present(await insertRoom(me, [], raw, { capacity: parseCapacity(raw), searching: false }), me);

// Phòng cho hai người vừa được ghép trận nhanh: 5 chỗ và mở tìm thêm người 60 giây
export const createMatchedRoom = async (host: Me, guest: Me, raw: unknown) =>
    (await insertRoom(host, [guest], raw, { capacity: MAX_PLAYERS, searching: true })).code;

export const getRoom = async (code: string, me: Me) => present(await mutate(code, me, () => undefined), me);

const enterRoom = (code: string, me: Me) => mutate(code, me, (room, now, meId) => {
    if (isPlayer(room, meId)) return;
    if (room.state !== "waiting") throw conflict("Trận đấu đã bắt đầu hoặc đã kết thúc");
    if (room.players.length >= room.capacity) throw conflict("Phòng đã đủ người");
    room.players.push(playerOf(me));
    if (room.players.length >= room.capacity) room.searchEndsAt = null;
    armCountdown(room, now);
}, { memberOnly: false });

export const joinRoom = async (code: string, me: Me) => present(await enterRoom(code, me), me);

// Ghép trận nhanh đưa người chơi vào một phòng đang mở tìm người
export const addPlayerToRoom = async (code: string, player: Me) => (await enterRoom(code, player)).code;

// Các phòng đang mở tìm người, còn chỗ, chưa có mình; gameName null là trò nào cũng được
export const openRoomCodes = async (me: Me, gameName: string | null) => {
    // Kiểu lọc của mongoose không nhận $expr kèm khoá lồng nhau, nên khai báo lỏng
    const filter: Record<string, unknown> = {
        state: "waiting", searchEndsAt: { $gt: new Date() }, "players.userId": { $ne: me._id },
        ...(gameName ? { gameName } : {}),
        $expr: { $lt: [{ $size: "$players" }, "$capacity"] },
    };
    const rooms = await GameRoom.find(filter).select("code").limit(20).lean();
    return rooms.map((room) => room.code);
};

// Chủ phòng bật/tắt tìm người chơi ngẫu nhiên. Bật lại khi đang tìm thì giữ mốc cũ: 60 giây không gia hạn.
export const setSearching = async (code: string, me: Me, raw: unknown) => present(await mutate(code, me, (room, now, meId) => {
    assertHost(room, meId, "Chỉ chủ phòng mới tìm người chơi được");
    if (asObject(raw).searching === false) {
        room.searchEndsAt = null;
        return;
    }
    if (room.state !== "waiting") throw conflict("Trận đấu đã bắt đầu");
    if (room.players.length >= room.capacity) throw conflict("Phòng đã đủ người");
    if (!room.searchEndsAt || room.searchEndsAt <= now) room.searchEndsAt = addMs(now, SEARCH_WINDOW_MS);
}), me);

// Rời phòng. Đang chờ hoặc trận đã xong: ra khỏi danh sách. Giữa trận: bị xếp cuối (vẫn giữ trong danh sách tới hết trận
// để tính cúp), người còn lại chơi tiếp; chỉ còn một người thì trận kết thúc. Chủ phòng rời thì người vào sớm nhất làm chủ phòng.
export const leaveRoom = async (code: string, me: Me) => present(await mutate(code, me, (room, now, meId) => {
    if (isPlaying(room)) {
        const player = room.players.find((item) => idOf(item.userId) === meId);
        if (player) player.left = true;
        const round = room.rounds[room.roundIndex];
        if (round && round.outcome === null && round.answers[meId] && !round.answers[meId].submittedAt) {
            delete round.answers[meId];
            finishRoundIfReady(room, round);
        }
        if (activePlayers(room).length < MIN_PLAYERS) {
            // Bỏ vòng đang dở, trận kết thúc với các vòng đã có kết quả
            room.rounds = room.rounds.filter((item) => item.outcome !== null);
            room.roundIndex = room.rounds.length - 1;
            room.state = "completed";
        }
    } else {
        room.players = room.players.filter((player) => idOf(player.userId) !== meId);
    }
    if (isHost(room, meId)) {
        const next = activePlayers(room).find((player) => idOf(player.userId) !== meId);
        if (next) room.hostId = next.userId;
        else room.searchEndsAt = null;
    }
    if (room.state === "waiting" && room.players.length === 0) room.state = "cancelled";
    armCountdown(room, now);
}), me);

export const kickPlayer = async (code: string, me: Me, raw: unknown) => present(await mutate(code, me, (room, now, meId) => {
    assertHost(room, meId, "Chỉ chủ phòng mới mời người chơi ra");
    if (room.state !== "waiting") throw conflict("Trận đấu đang diễn ra");
    const target = asObject(raw).userId;
    if (typeof target !== "string" || target === meId || !isPlayer(room, target)) throw new ApiError(StatusCodes.BAD_REQUEST, "Người chơi không hợp lệ");
    room.players = room.players.filter((player) => idOf(player.userId) !== target);
    armCountdown(room, now);
}), me);

export const setReady = async (code: string, me: Me, raw: unknown) => present(await mutate(code, me, (room, now, meId) => {
    if (room.state !== "waiting") throw conflict("Trận đấu đã bắt đầu");
    const player = room.players.find((item) => idOf(item.userId) === meId);
    if (player) player.ready = asObject(raw).ready !== false;
    armCountdown(room, now);
}), me);

export const enterRecallPhase = async (code: string, me: Me) => present(await mutate(code, me, (room, now, meId) => {
    if (room.state !== "memorizing" && room.state !== "recalling") throw conflict("Vòng đấu chưa diễn ra");
    const round = room.rounds[room.roundIndex];
    if (!round?.answers[meId]) throw conflict("Không tìm thấy vòng đấu");
    enterRecall(round.answers[meId], round, now);
    if (Object.values(round.answers).every((answer) => answer.enteredRecallAt)) room.state = "recalling";
}), me);

export const submitAnswers = async (code: string, me: Me, raw: unknown) => present(await mutate(code, me, (room, now, meId) => {
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

export const nextRound = async (code: string, me: Me) => present(await mutate(code, me, (room, now, meId) => {
    assertHost(room, meId, "Chỉ chủ phòng mới chuyển vòng được");
    if (room.state !== "round_result" || room.roundIndex + 1 >= room.roundCount) throw conflict("Không còn vòng tiếp theo");
    room.rounds.push(makeRound(room, now));
    room.roundIndex += 1;
    room.state = "memorizing";
}), me);

// Kết thúc trận sau vòng cuối. Không có dừng giữa chừng: ai muốn thôi thì rời trận (bị xếp cuối), để không ai né bị trừ cúp.
export const finishRoom = async (code: string, me: Me) => present(await mutate(code, me, (room, _now, meId) => {
    assertHost(room, meId, "Chỉ chủ phòng mới kết thúc được");
    if (room.state === "completed" || room.state === "cancelled") return;
    if (room.state !== "round_result" || room.rounds.length !== room.roundCount) throw conflict("Trận chưa tới vòng cuối");
    room.state = "completed";
}), me);

// Chơi lại trong cùng phòng với người đang ở đây. Không gửi cài đặt thì giữ trò cũ; gửi cài đặt thì đổi trò.
// Mỗi trận mới có mã trận riêng để kết quả và cúp ghi riêng từng trận.
export const rematch = async (code: string, me: Me, raw: unknown) => {
    const body = asObject(raw);
    const setup = body.gameName === undefined ? null : parseSetup(body);
    return present(await mutate(code, me, (room, now, meId) => {
        assertHost(room, meId, "Chỉ chủ phòng mới mở trận mới");
        if (room.state !== "completed" && room.state !== "cancelled") throw conflict("Trận hiện tại chưa kết thúc");
        if (setup) Object.assign(room, setup);
        room.matchId = new Types.ObjectId();
        room.rounds = [];
        room.roundIndex = -1;
        room.state = "waiting";
        // Người đã rời giữa trận trước thì không vào trận mới
        room.players = activePlayers(room);
        room.players.forEach((player) => { player.ready = false; });
        room.startsAt = null;
        room.searchEndsAt = null;
        armCountdown(room, now);
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
        MatchTicket.deleteMany({ userId }),
    ]);
};
