import express, { type RequestHandler } from "express";
import { createProgressController } from "../controller/progress.controller.js";
import { protectedRoute } from "../middlewares/authMiddleware.js";
import { progressService, type ProgressService } from "../services/progress.service.js";

export const createProgressRouter = (
    authentication: RequestHandler = protectedRoute,
    service: ProgressService = progressService,
) => {
    const router = express.Router();
    const controller = createProgressController(service);

    router.get("/timeline", authentication, controller.getTimeline);

    return router;
};

export default createProgressRouter();
