import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { gameSessionService, type GameSessionService } from "../services/gameSession.service.js";

export const createGameSessionController = (
    service: GameSessionService = gameSessionService,
): {
    createSession: RequestHandler;
    getUserHistory: RequestHandler;
} => ({
    // POST /api/game-sessions
    createSession: asyncHandler(async (request, response) => {
        const session = await service.createSession(request.body);

        response.status(StatusCodes.CREATED).json({
            status: "success",
            message: "Game session recorded successfully",
            data: { session },
        });
    }),

    // GET /api/game-sessions/user/:userId
    getUserHistory: asyncHandler(async (request, response) => {
        const userId = Array.isArray(request.params.userId)
            ? request.params.userId[0]
            : (request.params.userId ?? "");
        const history = await service.getHistoryByUserId(userId);


        response.status(StatusCodes.OK).json({
            status: "success",
            data: { history },
        });
    }),
});

export const gameSessionController = createGameSessionController();
