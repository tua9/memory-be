import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { gameCatalogService, type GameCatalogService } from "../services/gameCatalog.service.js";
import { readPlayer } from "../utils/request.js";

export const createGameCatalogController = (
    service: GameCatalogService = gameCatalogService,
): { listGames: RequestHandler } => ({
    // GET /api/games: dùng được cho người đã đăng nhập và cho khách (tiến độ tạm theo cookie khách nếu có)
    listGames: asyncHandler(async (request, response) => {
        const games = await service.listGames(readPlayer(request));
        response.status(StatusCodes.OK).json({
            status: "success",
            data: { games },
        });
    }),
});

export const gameCatalogController = createGameCatalogController();
