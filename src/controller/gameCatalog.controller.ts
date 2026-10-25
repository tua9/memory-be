import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { gameCatalogService, type GameCatalogService } from "../services/gameCatalog.service.js";

export const createGameCatalogController = (
    service: GameCatalogService = gameCatalogService,
): { listGames: RequestHandler } => ({
    // GET /api/games: dùng được cho cả khách (không có tiến độ) và người đã đăng nhập
    listGames: asyncHandler(async (request, response) => {
        const games = await service.listGames(request.user?._id.toString() ?? null);
        response.status(StatusCodes.OK).json({
            status: "success",
            data: { games },
        });
    }),
});

export const gameCatalogController = createGameCatalogController();
