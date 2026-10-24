import express, { type RequestHandler } from "express";
import { createGameHistoryController } from "../controller/gameHistory.controller.js";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { gameHistoryService, type GameHistoryService } from "../services/gameHistory.service.js";

// Phần đọc của /api/game-sessions; phần chơi (POST) nằm ở gameSessionRoute
export const createGameHistoryRouter = (
    authentication: RequestHandler = protectedRoute,
    service: GameHistoryService = gameHistoryService,
) => {
    const router = express.Router();
    const controller = createGameHistoryController(service);

    router.get("/", authentication, controller.listHistory);
    router.get("/:sessionId", authentication, controller.getSessionDetail);

    return router;
};

export default createGameHistoryRouter();
