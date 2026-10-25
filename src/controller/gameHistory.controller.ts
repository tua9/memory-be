import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { gameHistoryService, type GameHistoryService } from "../services/gameHistory.service.js";
import { requireUserId, routeParam } from "../utils/request.js";

export const createGameHistoryController = (
    service: GameHistoryService = gameHistoryService,
): {
    listHistory: RequestHandler;
    getSessionDetail: RequestHandler;
} => ({
    // GET /api/game-sessions?game=&from=&to=&limit=&cursor=
    listHistory: asyncHandler(async (request, response) => {
        const history = await service.listHistory(requireUserId(request), request.query);
        response.status(StatusCodes.OK).json({
            status: "success",
            data: history,
        });
    }),

    // GET /api/game-sessions/:sessionId
    getSessionDetail: asyncHandler(async (request, response) => {
        const session = await service.getSessionDetail(requireUserId(request), routeParam(request, "sessionId"));
        response.status(StatusCodes.OK).json({
            status: "success",
            data: { session },
        });
    }),
});

export const gameHistoryController = createGameHistoryController();
