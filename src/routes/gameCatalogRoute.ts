import express, { type RequestHandler } from "express";
import { createGameCatalogController } from "../controller/gameCatalog.controller.js";
import { optionalAuthentication } from "../middlewares/authMiddleware.js";
import { gameCatalogService, type GameCatalogService } from "../services/gameCatalog.service.js";

export const createGameCatalogRouter = (
    authentication: RequestHandler = optionalAuthentication,
    service: GameCatalogService = gameCatalogService,
) => {
    const router = express.Router();
    const controller = createGameCatalogController(service);

    router.get("/", authentication, controller.listGames);

    return router;
};

export default createGameCatalogRouter();
