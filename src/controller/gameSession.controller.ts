import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { gameSessionService, type GameSessionService } from "../services/gameSession.service.js";
import { requireUserId, routeParam } from "../utils/request.js";

export const createGameSessionController = (
    service: GameSessionService = gameSessionService,
): {
    startRound: RequestHandler;
    startRecall: RequestHandler;
    submitRound: RequestHandler;
} => ({
    // POST /api/game-sessions
    startRound: asyncHandler(async (request, response) => {
        const session = await service.startRound(requireUserId(request), request.body);
        response.status(StatusCodes.CREATED).json({
            status: "success",
            message: "Game round started",
            data: { session },
        });
    }),

    // POST /api/game-sessions/:sessionId/recall
    startRecall: asyncHandler(async (request, response) => {
        const session = await service.startRecall(requireUserId(request), routeParam(request, "sessionId"));
        response.status(StatusCodes.OK).json({
            status: "success",
            message: "Recall phase started",
            data: { session },
        });
    }),

    // POST /api/game-sessions/:sessionId/submit
    submitRound: asyncHandler(async (request, response) => {
        const session = await service.submitRound(
            requireUserId(request),
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
