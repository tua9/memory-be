import { randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import type { ConfiguredGameName } from "../config/games.js";
import { getGameEngine, parseAnswers } from "../games/index.js";
import FamilyRoom, { type FamilyRoomDocument, type FamilyRound, type RoomAnswer, type RoomRole } from "../models/familyRoom.js";
import ParentPoints from "../models/parentPoints.js";
import UserGameProgress from "../models/userGameProgress.js";
import type { ParentDocument } from "../models/parent.js";
import type { UserDocument } from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { parseGameName, resolveRoundRules } from "./gameRules.service.js";

export type RoomActor = { role: "parent"; parent: ParentDocument } | { role: "child"; child: UserDocument };
const ROOM_TTL_MS = 24 * 60 * 60_000;
const RESULT_GRACE_MS = 2 * 60_000;
const MAX_ROUNDS = 10;
const fail = (message: string) => new ApiError(StatusCodes.CONFLICT, message);
const blank = (): RoomAnswer => ({ enteredRecallAt: null, memorizeUsedMs: null, submittedAt: null, answers: null, correct: null, usedMs: null, participated: false });
const addSeconds = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);
const asObject = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const assertMember = (room: FamilyRoomDocument, actor: RoomActor) => {
    const allowed = actor.role === "parent"
        ? room.parentId.toString() === actor.parent._id.toString()
        : room.childUserId.toString() === actor.child._id.toString();
    if (!allowed) throw new ApiError(StatusCodes.NOT_FOUND, "Room not found");
};

const findRoom = async (code: string, actor: RoomActor): Promise<FamilyRoomDocument> => {
    if (!/^[A-Z2-9]{8}$/.test(code)) throw new ApiError(StatusCodes.NOT_FOUND, "Room not found");
    const room = await FamilyRoom.findOne({ code });
    if (!room) throw new ApiError(StatusCodes.NOT_FOUND, "Room not found");
    assertMember(room, actor);
    return room;
};

const enterRecall = (player: RoomAnswer, round: FamilyRound, now: Date) => {
    if (player.enteredRecallAt) return;
    const enteredAt = now < round.memorizeEndsAt ? now : round.memorizeEndsAt;
    player.enteredRecallAt = enteredAt;
    player.memorizeUsedMs = enteredAt.getTime() - round.startedAt.getTime();
};

export const decideRoundWinner = (parent: Pick<RoomAnswer, "correct" | "usedMs">, child: Pick<RoomAnswer, "correct" | "usedMs">): RoomRole | "draw" => {
    const p = parent.correct ?? 0; const c = child.correct ?? 0;
    if (p === 0 && c === 0) return "draw";
    if (p !== c) return p > c ? "parent" : "child";
    const pMs = parent.usedMs ?? Number.MAX_SAFE_INTEGER;
    const cMs = child.usedMs ?? Number.MAX_SAFE_INTEGER;
    return pMs === cMs ? "draw" : pMs < cMs ? "parent" : "child";
};

const finishRoundIfReady = (room: FamilyRoomDocument, round: FamilyRound) => {
    if (!round.players.parent.submittedAt || !round.players.child.submittedAt) return;
    round.outcome = decideRoundWinner(round.players.parent, round.players.child);
    round.resultAt = new Date(Math.max(round.players.parent.submittedAt.getTime(), round.players.child.submittedAt.getTime()));
    room.state = "round_result";
};

// Every request reconciles deadlines from server time. Nobody has to keep a tab open
// for the other participant to see the result on their next poll.
const advanceByClock = (room: FamilyRoomDocument, now: Date) => {
    if (room.state === "waiting" && now >= room.expiresAt) { room.state = "cancelled"; return; }
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
        enterRecall(round.players.parent, round, now);
        enterRecall(round.players.child, round, now);
        room.state = "recalling";
    }
    if (now >= round.recallEndsAt) {
        for (const role of ["parent", "child"] as const) {
            const player = round.players[role];
            if (!player.submittedAt) {
                player.submittedAt = round.recallEndsAt;
                player.answers = Array(round.items.length).fill(null);
                player.correct = 0;
                player.usedMs = round.recallEndsAt.getTime() - round.startedAt.getTime();
            }
        }
        finishRoundIfReady(room, round);
    }
};

const mutate = async (code: string, actor: RoomActor, action: (room: FamilyRoomDocument, now: Date) => void) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const room = await findRoom(code, actor);
        const now = new Date();
        advanceByClock(room, now);
        action(room, now);
        const updated = await FamilyRoom.findOneAndUpdate(
            { _id: room._id, revision: room.revision },
            { $set: { state: room.state, parentReady: room.parentReady, childJoined: room.childJoined,
                childReady: room.childReady, roundIndex: room.roundIndex, rounds: room.rounds }, $inc: { revision: 1 } },
            { new: true },
        );
        if (updated) return updated;
    }
    throw fail("Room changed concurrently. Please retry");
};

const makeRound = (room: FamilyRoomDocument, now: Date): FamilyRound => {
    const engine = getGameEngine(room.gameName);
    const items = engine.generateItems(room.rules.totalItems, room.rules.gameLevel, undefined, room.rules.language);
    const memorizeEndsAt = addSeconds(now, room.rules.memorizeLimitSec);
    return { items, recallOptions: engine.buildRecallOptions(items), startedAt: now, memorizeEndsAt,
        recallEndsAt: addSeconds(memorizeEndsAt, room.rules.recallLimitSec),
        players: { parent: blank(), child: blank() }, outcome: null, resultAt: null };
};

const scoresOf = (rounds: FamilyRound[]) => {
    const finished = rounds.filter((round) => round.outcome !== null);
    const parentWins = finished.filter((round) => round.outcome === "parent").length;
    const childWins = finished.filter((round) => round.outcome === "child").length;
    const draws = finished.filter((round) => round.outcome === "draw").length;
    const parentPoints = parentWins - childWins;
    const childPoints = childWins - parentWins;
    return { parent: { wins: parentWins, losses: childWins, draws, points: parentPoints, rank: parentPoints === childPoints ? 1 : parentPoints > childPoints ? 1 : 2 },
        child: { wins: childWins, losses: parentWins, draws, points: childPoints, rank: parentPoints === childPoints ? 1 : childPoints > parentPoints ? 1 : 2 } };
};

const view = (room: FamilyRoomDocument, actor: RoomActor) => {
    const round = room.rounds[room.roundIndex];
    const engine = getGameEngine(room.gameName);
    const role = actor.role;
    const myAnswer = round?.players[role];
    const resultVisible = room.state === "round_result" || room.state === "completed";
    const phase = !round ? room.state : resultVisible ? room.state :
        myAnswer?.submittedAt ? "waiting_for_other" :
        myAnswer?.enteredRecallAt ? "recalling" : "memorizing";
    return {
        code: room.code, revision: room.revision, role, state: room.state, phase, gameName: room.gameName,
        rules: room.rules, roundCount: room.roundCount, roundIndex: room.roundIndex,
        parentReady: room.parentReady, childJoined: room.childJoined, childReady: room.childReady,
        serverNow: new Date(),
        round: round ? {
            memorizeEndsAt: round.memorizeEndsAt, recallEndsAt: round.recallEndsAt,
            items: phase === "memorizing" ? round.items.map((item) => engine.toView(item)) : undefined,
            recallOptions: phase === "recalling" ? round.recallOptions.map((item) => engine.toRecallView?.(item) ?? engine.toView(item)) : undefined,
            myAnswers: myAnswer?.submittedAt ? myAnswer.answers : undefined,
            result: resultVisible ? {
                outcome: round.outcome,
                parent: { correct: round.players.parent.correct, total: round.items.length, usedMs: round.players.parent.usedMs },
                child: { correct: round.players.child.correct, total: round.items.length, usedMs: round.players.child.usedMs },
                expected: round.items.map((item) => engine.toView(item)),
            } : undefined,
        } : null,
        scores: scoresOf(room.rounds),
    };
};

export const createFamilyRoom = async (parent: ParentDocument, raw: unknown) => {
    await FamilyRoom.init();
    const body = asObject(raw);
    const gameName = parseGameName(body.gameName);
    const rounds = body.roundCount;
    if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `roundCount must be 1-${MAX_ROUNDS}`);
    }
    const progress = await UserGameProgress.findOne({ userId: parent.childUserId, gameName }).select("unlockedLevel");
    const rules = resolveRoundRules(gameName, body, progress?.unlockedLevel ?? 1);
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            const room = await FamilyRoom.create({ code: randomBytes(6).toString("base64url").toUpperCase().replace(/[^A-Z2-9]/g, "A").slice(0, 8),
                parentId: parent._id, childUserId: parent.childUserId, gameName, rules, roundCount: rounds,
                expiresAt: new Date(Date.now() + ROOM_TTL_MS) });
            return view(room, { role: "parent", parent });
        } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    }
    throw fail("Could not allocate a room code");
};

export const getFamilyRoom = async (code: string, actor: RoomActor) => {
    const room = await mutate(code, actor, () => undefined);
    await awardIfEligible(room);
    return view(room, actor);
};

export const joinFamilyRoom = async (code: string, actor: RoomActor) => {
    if (actor.role !== "child") throw new ApiError(StatusCodes.FORBIDDEN, "Only the linked child can join");
    const room = await mutate(code, actor, (room) => {
        if (room.state !== "waiting") throw fail("This room has already started");
        room.childJoined = true;
    });
    return view(room, actor);
};

export const readyFamilyRoom = async (code: string, actor: RoomActor) => {
    const room = await mutate(code, actor, (room) => {
        if (room.state !== "waiting") throw fail("Room is not waiting");
        if (actor.role === "parent") room.parentReady = true;
        else { if (!room.childJoined) throw fail("Join the room first"); room.childReady = true; }
    });
    return view(room, actor);
};

export const startFamilyRoom = async (code: string, actor: RoomActor) => {
    if (actor.role !== "parent") throw new ApiError(StatusCodes.FORBIDDEN, "Only parent can start");
    const room = await mutate(code, actor, (room, now) => {
        if (room.state !== "waiting" || !room.parentReady || !room.childReady || !room.childJoined) throw fail("Both players must be ready");
        room.rounds.push(makeRound(room, now)); room.roundIndex = 0; room.state = "memorizing";
    });
    return view(room, actor);
};

export const recallFamilyRoom = async (code: string, actor: RoomActor) => {
    const room = await mutate(code, actor, (room, now) => {
        if (room.state !== "memorizing" && room.state !== "recalling") throw fail("Round is not active");
        const round = room.rounds[room.roundIndex];
        if (!round) throw fail("Round is missing");
        enterRecall(round.players[actor.role], round, now);
        if (round.players.parent.enteredRecallAt && round.players.child.enteredRecallAt) room.state = "recalling";
    });
    return view(room, actor);
};

export const submitFamilyRoom = async (code: string, actor: RoomActor, raw: unknown) => {
    const room = await mutate(code, actor, (room, now) => {
        if (room.state !== "memorizing" && room.state !== "recalling") throw fail("Round is not active");
        const round = room.rounds[room.roundIndex];
        if (!round) throw fail("Round is missing");
        const player = round.players[actor.role];
        if (player.submittedAt) throw fail("Answer already submitted");
        if (!player.enteredRecallAt) throw fail("Enter recall before submitting");
        const answers = parseAnswers(getGameEngine(room.gameName), round.items, asObject(raw).answers);
        const engine = getGameEngine(room.gameName);
        player.answers = answers;
        player.correct = answers.filter((answer, index) => engine.matches ? engine.matches(round.items[index], answer) : answer === round.items[index]).length;
        player.submittedAt = now;
        player.usedMs = (player.memorizeUsedMs ?? 0) + now.getTime() - player.enteredRecallAt.getTime();
        player.participated = answers.some((answer) => answer !== null);
        finishRoundIfReady(room, round);
    });
    return view(room, actor);
};

export const nextFamilyRound = async (code: string, actor: RoomActor) => {
    if (actor.role !== "parent") throw new ApiError(StatusCodes.FORBIDDEN, "Only parent can advance");
    const room = await mutate(code, actor, (room, now) => {
        if (room.state !== "round_result" || room.roundIndex + 1 >= room.roundCount) throw fail("No next round is available");
        room.rounds.push(makeRound(room, now)); room.roundIndex += 1; room.state = "memorizing";
    });
    return view(room, actor);
};

const awardIfEligible = async (room: FamilyRoomDocument) => {
    if (room.state !== "completed" || room.rounds.length !== room.roundCount ||
        !room.rounds.every((round) => round.outcome && round.players.parent.participated && round.players.child.participated)) return;
    await ParentPoints.init();
    try { await ParentPoints.create({ parentId: room.parentId, roomId: room._id, points: 10, earnedAt: new Date() }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
};

export const finishFamilyRoom = async (code: string, actor: RoomActor) => {
    if (actor.role !== "parent") throw new ApiError(StatusCodes.FORBIDDEN, "Only parent can finish");
    const room = await mutate(code, actor, (room) => {
        if (room.state === "completed" || room.state === "cancelled") return;
        room.state = room.state === "round_result" && room.rounds.length === room.roundCount ? "completed" : "cancelled";
    });
    await awardIfEligible(room);
    return view(room, actor);
};

export const getParentPoints = async (parent: ParentDocument) => {
    const entries = await ParentPoints.find({ parentId: parent._id }).sort({ earnedAt: -1 }).limit(50).lean();
    const total = await ParentPoints.countDocuments({ parentId: parent._id });
    return { points: total * 10, sessions: entries.map((entry) => ({ roomId: entry.roomId.toString(), points: entry.points, earnedAt: entry.earnedAt })) };
};
