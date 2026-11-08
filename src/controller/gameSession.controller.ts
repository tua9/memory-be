import type { Request, RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import {
  gameSessionService,
  type GameSessionService,
} from "../services/gameSession.service.js";
import { setGuestCookie } from "../utils/cookies.js";
import {
  createGuestId,
  readPlayer,
  routeParam,
  type PlayerRef,
} from "../utils/request.js";

// Chưa đăng nhập và chưa có cookie khách thì không thể sở hữu ván nào: trả 404 như ván của người khác
const requirePlayer = (request: Request): PlayerRef => {
  const player = readPlayer(request);
  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Game session not found");
  }
  return player;
};

export const createGameSessionController = (
  service: GameSessionService = gameSessionService,
): {
  startRound: RequestHandler;
  startRecall: RequestHandler;
  submitRound: RequestHandler;
} => ({
  // POST /api/game-sessions: khách lần đầu chơi được cấp cookie guestId, các lần sau được gia hạn
  startRound: asyncHandler(async (request, response) => {
    const player = readPlayer(request) ?? { guestId: createGuestId() };
    if ("guestId" in player) {
      setGuestCookie(response, player.guestId);
    }
    const session = await service.startRound(player, request.body);
    response.status(StatusCodes.CREATED).json({
      status: "success",
      message: "Game round started",
      data: { session },
    });
  }),

  // POST /api/game-sessions/:sessionId/recall
  startRecall: asyncHandler(async (request, response) => {
    const session = await service.startRecall(
      requirePlayer(request),
      routeParam(request, "sessionId"),
    );
    response.status(StatusCodes.OK).json({
      status: "success",
      message: "Recall phase started",
      data: { session },
    });
  }),

  // POST /api/game-sessions/:sessionId/submit
  submitRound: asyncHandler(async (request, response) => {
    const session = await service.submitRound(
      requirePlayer(request),
      routeParam(request, "sessionId"),
      request.body,
    );
    response.status(StatusCodes.OK).json({
      status: "success",
      message: "Game round submitted",
      data: { session },
    });
  }),
});

export const gameSessionController = createGameSessionController();
