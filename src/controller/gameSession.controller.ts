import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { gameSessionService, type GameSessionService } from "../services/gameSession.service.js";

export const createGameSessionController = (
    service: GameSessionService = gameSessionService,
): {
    createSession: RequestHandler;
    getUserHistory: RequestHandler;
} => ({
    // POST /api/game-sessions
    createSession: asyncHandler(async (request, response) => {
        const user = request.user;
        if (!user) {
            throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
        }
        const userId = user._id.toString();
        if (request.body?.userId !== undefined && request.body.userId !== userId) {
            throw new ApiError(StatusCodes.FORBIDDEN, "Cannot create a session for another user");
        }
        const session = await service.createSession({ ...request.body, userId });

        response.status(StatusCodes.CREATED).json({
            status: "success",
            message: "Game session recorded successfully",
            data: { session },
        });
    }),

    // GET /api/game-sessions/user/:userId
    getUserHistory: asyncHandler(async (request, response) => {
        const user = request.user;
        if (!user) {
            throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
        }
        const requestedUserId = Array.isArray(request.params.userId)
            ? request.params.userId[0]
            : (request.params.userId ?? "");
        const userId = user._id.toString();
        if (requestedUserId !== userId) {
            throw new ApiError(StatusCodes.FORBIDDEN, "Cannot view another user's game history");
        }
        const history = await service.getHistoryByUserId(userId);

        response.status(StatusCodes.OK).json({
            status: "success",
            data: { history },
        });
    }),
});

export const gameSessionController = createGameSessionController();
