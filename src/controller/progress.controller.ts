import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { progressService, type ProgressService } from "../services/progress.service.js";
import { requireUserId } from "../utils/request.js";

export const createProgressController = (
    service: ProgressService = progressService,
): { getTimeline: RequestHandler } => ({
    // GET /api/progress/timeline?period=week|month&game=all|card|image
    getTimeline: asyncHandler(async (request, response) => {
        const timeline = await service.getTimeline(requireUserId(request), request.query);
        response.status(StatusCodes.OK).json({
            status: "success",
            data: { timeline },
        });
    }),
});

export const progressController = createProgressController();
