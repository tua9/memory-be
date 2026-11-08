import { StatusCodes } from "http-status-codes";
import mongoose, { type Types } from "mongoose";
import {
  GUEST_PROGRESS_TTL_SEC,
  PHASE_GRACE_SEC,
  UNFINISHED_ROUND_TTL_SEC,
  type ConfiguredGameName,
  type GameResult,
} from "../config/games.js";
import {
  getGameEngine,
  parseAnswers,
  type GameEngine,
  type ItemView,
} from "../games/index.js";
import GameSession, {
  type GameSessionData,
  type GameSessionStatus,
} from "../models/gameSession.js";
import GuestProgress, { type GuestProgressData } from "../models/guestProgress.js";
import User, { type UserProgress } from "../models/user.js";
import UserGameProgress, {
  type GameProgress,
} from "../models/userGameProgress.js";
import { numberSessionRepository } from "../repositories/numberSession.repository.js";
import ApiError from "../utils/ApiError.js";
import type { PlayerRef } from "../utils/request.js";
import { getMaxLevel, gradeRound, parseGameName, resolveRoundRules } from "./gameRules.service.js";
import {
  compareAnswers,
  createInitialGameProgress,
  createInitialUserProgress,
  settleGuestRound,
  settleRound,
  type RoundRewards,
  type StoredRoundRules,
} from "./roundSettlement.service.js";

export type GameSessionRecord = GameSessionData & { _id: Types.ObjectId };

export interface RoundView {
  sessionId: string;
  gameName: ConfiguredGameName;
  status: GameSessionStatus;
  rules: StoredRoundRules;
  serverNow?: Date;
}

export interface StartedRoundView extends RoundView {
  items: ItemView[];
  memorizeDeadline: Date;
}

export interface RecallRoundView extends RoundView {
  recallOptions: ItemView[];
  recallDeadline: Date;
}

export interface ItemResultView {
  expected: ItemView;
  answer: ItemView | null;
  correct: boolean;
}

export interface RoundResultView {
  score?: number;
  maxScore?: number;
  correctItems: number;
  totalItems: number;
  accuracy: number;
  result: GameResult;
  memorizeSec: number;
  recallSec: number;
  perItem: ItemResultView[];
}

export interface CompletedRoundView extends RoundView {
  startedAt: Date;
  completedAt: Date;
  result: RoundResultView;
  // null với ván của khách: không có EXP, kỷ lục hay streak
  rewards: RoundRewards | null;
  // Level đã mở trước và sau ván, có ở cả ván của người đăng nhập lẫn của khách
  unlockedLevel: { before: number; after: number };
}

export interface GameSessionService {
  startRound(player: PlayerRef, body: unknown): Promise<StartedRoundView>;
  startRecall(player: PlayerRef, sessionId: string): Promise<RecallRoundView>;
  submitRound(
    player: PlayerRef,
    sessionId: string,
    body: unknown,
  ): Promise<CompletedRoundView>;
}

// Báo hiệu một yêu cầu nộp khác của cùng ván đã chấm xong trước, để huỷ transaction đang chạy
class RoundAlreadySettledError extends Error {}

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const addSeconds = (date: Date, seconds: number): Date =>
  new Date(date.getTime() + seconds * 1000);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const conflict = (message: string) =>
  new ApiError(StatusCodes.CONFLICT, message);

const START_ROUND_FIELDS = [
  "gameName",
  "mode",
  "gameLevel",
  "itemCount",
  "memorizeSec",
  "recallSec",
] as const;
const SUBMIT_ROUND_FIELDS = ["answers"] as const;

// Từ chối trường lạ để client gửi sai nhận lỗi rõ ràng, ví dụ frontend còn gọi API ghi ván kiểu cũ
// với userId, time, score thì không bị âm thầm tạo thành một ván mới
const parseBody = (
  body: unknown,
  allowedFields: readonly string[],
): Record<string, unknown> => {
  if (!isRecord(body)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "A JSON object is required");
  }
  const unsupportedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unsupportedFields.length > 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Unsupported field(s): ${unsupportedFields.join(", ")}`,
      unsupportedFields,
      "UNSUPPORTED_FIELD",
    );
  }
  return body;
};

// Điều kiện lọc ván theo chủ sở hữu: tài khoản hoặc khách
const ownerOf = (player: PlayerRef) =>
  "userId" in player
    ? { userId: player.userId }
    : { guestId: player.guestId };

// Ván của người khác cũng trả 404 để không lộ là ván đó có tồn tại
export const findOwnSession = async (
  player: PlayerRef,
  sessionId: string,
): Promise<GameSessionRecord> => {
  const notFound = new ApiError(
    StatusCodes.NOT_FOUND,
    "Game session not found",
  );
  if (!OBJECT_ID_PATTERN.test(sessionId)) {
    throw notFound;
  }
  const session = await GameSession.findOne({
    _id: sessionId,
    ...ownerOf(player),
  })
    .select("+items")
    .lean<GameSessionRecord>()
    .exec();
  if (!session) {
    throw notFound;
  }
  return session;
};

// Level cao nhất đã mở: của tài khoản, hoặc tiến độ tạm của khách; chưa chơi thì là level 1
const findUnlockedLevel = async (
  player: PlayerRef,
  gameName: ConfiguredGameName,
): Promise<number> => {
  const progress =
    "userId" in player
      ? await UserGameProgress.findOne({ userId: player.userId, gameName })
          .select("unlockedLevel")
          .lean<Pick<GameProgress, "unlockedLevel">>()
          .exec()
      : await GuestProgress.findOne({ guestId: player.guestId, gameName })
          .select("unlockedLevel")
          .lean<Pick<GuestProgressData, "unlockedLevel">>()
          .exec();
  const legacyLevel = gameName === "number" && "userId" in player
    ? Math.min(getMaxLevel(gameName), (await numberSessionRepository.findHighestPerfectLevel(player.userId) ?? 0) + 1) : 1;
  return Math.max(progress?.unlockedLevel ?? 1, legacyLevel);
};

const expireSession = async (
  sessionId: Types.ObjectId,
  fromStatus: GameSessionStatus,
): Promise<void> => {
  await GameSession.updateOne(
    { _id: sessionId, status: fromStatus },
    { $set: { status: "expired" } },
  ).exec();
};

export const toRoundView = (session: GameSessionRecord): RoundView => ({
  serverNow: new Date(),
  sessionId: session._id.toString(),
  gameName: session.gameName,
  status: session.status,
  rules: session.rules,
});

// Kết quả chấm của một ván đã hoàn thành; thiếu trường nào nghĩa là dữ liệu hỏng chứ không phải lỗi của người dùng
const requireGradedResult = (session: GameSessionRecord) => {
  const { completedAt, memorizeSec, recallSec, correctItems, accuracy, result } =
    session;
  if (
    session.status !== "completed" ||
    !completedAt ||
    memorizeSec === null ||
    recallSec === null ||
    correctItems === null ||
    accuracy === null ||
    result === null
  ) {
    throw new Error("Completed game session is missing its results");
  }
  return { completedAt, memorizeSec, recallSec, correctItems, accuracy, result };
};

// Ván của người đã đăng nhập: có thêm phần thưởng
export const requireCompletedResult = (session: GameSessionRecord) => {
  const graded = requireGradedResult(session);
  if (!session.rewards) {
    throw new Error("Completed game session is missing its results");
  }
  return { ...graded, rewards: session.rewards };
};

const toRecallView = (
  session: GameSessionRecord,
  engine: GameEngine,
): RecallRoundView => {
  if (!session.recallStartedAt) {
    throw new Error("A recalling game session must have recallStartedAt");
  }
  return {
    ...toRoundView(session),
    recallOptions: engine
      .buildRecallOptions(session.items)
      .map((code) => engine.toRecallView?.(code) ?? engine.toView(code)),
    recallDeadline: addSeconds(
      session.recallStartedAt,
      session.rules.recallLimitSec,
    ),
  };
};

// Dùng cho cả kết quả ngay sau khi nộp, nộp lại một ván đã chấm và trang chi tiết ván
export const toCompletedView = (
  session: GameSessionRecord,
): CompletedRoundView => {
  const { completedAt, memorizeSec, recallSec, correctItems, accuracy, result } =
    requireGradedResult(session);
  // Ván của khách không có phần thưởng nên level đã mở được ghi riêng
  const unlockedLevel = session.guestId
    ? session.guestUnlockedLevel
    : session.rewards?.unlockedLevel;
  if (!unlockedLevel) {
    throw new Error("Completed game session is missing its results");
  }

  const engine = getGameEngine(session.gameName);
  const compared = compareAnswers(session.items, session.answers ?? [], engine.matches);
  const graded = gradeRound(session.rules, correctItems, compared.filter((item) => !item.correct && item.answer !== null).length);
  const perItem = compared.map(
    (item) => ({
      expected: engine.toView(item.expected),
      answer: item.answer === null ? null : engine.answerView?.(item.answer) ?? engine.toView(item.answer),
      correct: item.correct,
    }),
  );

  return {
    ...toRoundView(session),
    startedAt: session.startedAt,
    completedAt,
    result: {
      ...(graded.score !== undefined ? { score: graded.score, maxScore: graded.maxScore } : {}),
      correctItems,
      totalItems: session.rules.totalItems,
      accuracy,
      result,
      memorizeSec,
      recallSec,
      perItem,
    },
    rewards: session.rewards,
    unlockedLevel,
  };
};

const startRound: GameSessionService["startRound"] = async (
  player,
  rawBody,
) => {
  const body = parseBody(rawBody, START_ROUND_FIELDS);
  const gameName = parseGameName(body.gameName);
  // gameLevel trong body cho phép chơi lại level cũ; level chưa mở bị resolveRoundRules từ chối
  const { gameName: _gameName, ...rules } = resolveRoundRules(
    gameName,
    body,
    await findUnlockedLevel(player, gameName),
  );
  const { gameLevel, totalItems, memorizeLimitSec } = rules;

  const engine = getGameEngine(gameName);
  const items = engine.generateItems(totalItems, gameLevel);
  const startedAt = new Date();
  const session = await GameSession.create({
    ...ownerOf(player),
    gameName,
    status: "memorizing",
    rules,
    items,
    startedAt,
    expiresAt: addSeconds(startedAt, UNFINISHED_ROUND_TTL_SEC),
  });

  return {
    sessionId: session._id.toString(),
    serverNow: startedAt,
    gameName,
    status: "memorizing",
    rules,
    items: items.map((code) => engine.toView(code)),
    memorizeDeadline: addSeconds(startedAt, memorizeLimitSec),
  };
};

const startRecall: GameSessionService["startRecall"] = async (
  player,
  sessionId,
) => {
  const session = await findOwnSession(player, sessionId);
  const engine = getGameEngine(session.gameName);
  // Gọi lại khi đã ở phase nhớ lại (ví dụ mạng lỗi): trả lại đúng phase hiện tại
  if (session.status === "recalling") {
    return toRecallView(session, engine);
  }
  if (session.status !== "memorizing") {
    throw conflict(`Game session is already ${session.status}`);
  }

  const now = new Date();
  const memorizeDeadline = addSeconds(
    session.startedAt,
    session.rules.memorizeLimitSec,
  );
  if (now > addSeconds(memorizeDeadline, PHASE_GRACE_SEC)) {
    await expireSession(session._id, "memorizing");
    throw conflict("Memorize time is over, this game session has expired");
  }

  const updated = await GameSession.findOneAndUpdate(
    { _id: session._id, status: "memorizing" },
    { $set: { status: "recalling", recallStartedAt: now } },
    { returnDocument: "after" },
  )
    .select("+items")
    .lean<GameSessionRecord>()
    .exec();
  // Không cập nhật được nghĩa là một yêu cầu khác vừa chuyển phase trước; đọc lại trạng thái mới nhất
  const current = updated ?? (await findOwnSession(player, sessionId));
  if (current.status !== "recalling") {
    throw conflict(`Game session is already ${current.status}`);
  }
  return toRecallView(current, engine);
};

// Ván của người đã đăng nhập: ghi kết quả ván, tiến độ game và tiến độ tài khoản trong cùng một transaction,
// hoặc cả ba cùng được ghi, hoặc không có gì thay đổi.
export const settleUserSession = async (
  session: GameSessionRecord,
  userId: string,
  answers: (string | null)[],
  completedAt: Date,
): Promise<void> => {
  const { gameName, recallStartedAt } = session;
  if (!recallStartedAt) {
    throw new Error("A recalling game session must have recallStartedAt");
  }

  try {
    await mongoose.connection.transaction(async (dbSession) => {
      const gameProgress = await UserGameProgress.findOne({ userId, gameName })
        .session(dbSession)
        .lean<GameProgress>()
        .exec();
      const user = await User.findById(userId)
        .select("progress")
        .session(dbSession)
        .lean<{ progress?: UserProgress }>()
        .exec();
      if (!user) {
        throw new ApiError(
          StatusCodes.NOT_FOUND,
          "Player account was not found",
        );
      }

      const initialProgress = gameProgress ?? createInitialGameProgress();
      if (gameName === "number") initialProgress.unlockedLevel = Math.max(initialProgress.unlockedLevel, await findUnlockedLevel({ userId }, gameName));
      const settlement = settleRound(
        {
          gameName,
          rules: session.rules,
          items: session.items,
          answers,
          startedAt: session.startedAt,
          recallStartedAt,
          completedAt,
        },
        {
          gameProgress: initialProgress,
          userProgress: user.progress ?? createInitialUserProgress(),
        },
      );

      const completed = await GameSession.updateOne(
        { _id: session._id, status: "recalling" },
        {
          $set: {
            status: "completed",
            answers,
            completedAt,
            memorizeSec: settlement.memorizeSec,
            recallSec: settlement.recallSec,
            correctItems: settlement.graded.correctItems,
            accuracy: settlement.graded.accuracy,
            result: settlement.graded.result,
            rewards: settlement.rewards,
          },
          $unset: { expiresAt: 1 },
        },
        { session: dbSession },
      ).exec();
      if (completed.modifiedCount === 0) {
        throw new RoundAlreadySettledError();
      }

      await UserGameProgress.updateOne(
        { userId, gameName },
        {
          $set: {
            unlockedLevel: settlement.gameProgress.unlockedLevel,
            stats: settlement.gameProgress.stats,
            records: settlement.gameProgress.records,
          },
        },
        { upsert: true, session: dbSession },
      ).exec();
      await User.updateOne(
        { _id: userId },
        { $set: { progress: settlement.userProgress } },
        { session: dbSession },
      ).exec();
    });
  } catch (error) {
    if (!(error instanceof RoundAlreadySettledError)) {
      throw error;
    }
  }
};

// Ván của khách: chỉ cập nhật level đã mở trong tiến độ tạm và gia hạn cả ván lẫn tiến độ thêm GUEST_PROGRESS_TTL_SEC
const settleGuestSession = async (
  session: GameSessionRecord,
  guestId: string,
  answers: (string | null)[],
  completedAt: Date,
): Promise<void> => {
  const { gameName, recallStartedAt } = session;
  if (!recallStartedAt) {
    throw new Error("A recalling game session must have recallStartedAt");
  }

  const settlement = settleGuestRound(
    {
      gameName,
      rules: session.rules,
      items: session.items,
      answers,
      startedAt: session.startedAt,
      recallStartedAt,
      completedAt,
    },
    await findUnlockedLevel({ guestId }, gameName),
  );
  const expiresAt = addSeconds(completedAt, GUEST_PROGRESS_TTL_SEC);

  const completed = await GameSession.updateOne(
    { _id: session._id, status: "recalling" },
    {
      $set: {
        status: "completed",
        answers,
        completedAt,
        memorizeSec: settlement.memorizeSec,
        recallSec: settlement.recallSec,
        correctItems: settlement.graded.correctItems,
        accuracy: settlement.graded.accuracy,
        result: settlement.graded.result,
        guestUnlockedLevel: settlement.unlockedLevel,
        expiresAt,
      },
    },
  ).exec();
  // Một yêu cầu nộp khác của cùng ván đã chấm trước: không cập nhật tiến độ lần nữa
  if (completed.modifiedCount === 0) {
    return;
  }

  // $max: hai ván nộp gần nhau không làm level đã mở bị giảm
  await GuestProgress.updateOne(
    { guestId, gameName },
    {
      $max: { unlockedLevel: settlement.unlockedLevel.after },
      $inc: { played: 1 },
      $set: { expiresAt },
    },
    { upsert: true },
  ).exec();
};

const submitRound: GameSessionService["submitRound"] = async (
  player,
  sessionId,
  body,
) => {
  const session = await findOwnSession(player, sessionId);
  // Nộp lại một ván đã chấm: trả lại kết quả cũ, không cộng thưởng lần nữa
  if (session.status === "completed") {
    return toCompletedView(session);
  }
  if (session.status === "memorizing") {
    throw conflict("Recall phase has not started");
  }
  if (session.status !== "recalling" || !session.recallStartedAt) {
    throw conflict(`Game session is already ${session.status}`);
  }

  const completedAt = new Date();
  const recallDeadline = addSeconds(
    session.recallStartedAt,
    session.rules.recallLimitSec,
  );
  if (completedAt > addSeconds(recallDeadline, PHASE_GRACE_SEC)) {
    await expireSession(session._id, "recalling");
    throw conflict("Recall time is over, this game session has expired");
  }

  const answers = parseAnswers(
    getGameEngine(session.gameName),
    session.items,
    parseBody(body, SUBMIT_ROUND_FIELDS).answers,
  );

  if ("userId" in player) {
    await settleUserSession(session, player.userId, answers, completedAt);
  } else {
    await settleGuestSession(session, player.guestId, answers, completedAt);
  }

  return toCompletedView(await findOwnSession(player, sessionId));
};

export const gameSessionService: GameSessionService = {
  startRound,
  startRecall,
  submitRound,
};
