import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { progressService, type ProgressService } from "../services/progress.service.js";
import { requireUserId } from "../utils/request.js";

export const createProgressController = (
    service: ProgressService = progressService,
): {
    getTimeline: RequestHandler;
    getCoach: RequestHandler;
    chat: RequestHandler;
    generateCoachPlan: RequestHandler;
    getCoachPlan: RequestHandler;
    saveCoachPlan: RequestHandler;
} => ({
    // GET /api/progress/timeline?period=week|month&game=all|card|image
    getTimeline: asyncHandler(async (request, response) => {
        const timeline = await service.getTimeline(requireUserId(request), request.query);
        response.status(StatusCodes.OK).json({
            status: "success",
            data: { timeline },
        });
    }),
    // GET /api/progress/coach
    getCoach: asyncHandler(async (request, response) => {
        const analysis = await service.getCoach(requireUserId(request));
        response.status(StatusCodes.OK).json({
            status: "success",
            data: { analysis },
        });
    }),
    // POST /api/progress/coach/chat
    chat: asyncHandler(async (request, response) => {
        const result = await service.chat(requireUserId(request), request.body);
        response.status(StatusCodes.OK).json({
            status: "success",
            data: result,
        });
    }),
    generateCoachPlan: asyncHandler(async (request, response) => {
        const result = await service.generateCoachPlan(requireUserId(request), request.body);
        response.status(StatusCodes.OK).json({
            status: "success",
            data: result,
        });
    }),
    getCoachPlan: asyncHandler(async (request, response) => {
        const savedPlan = await service.getCoachPlan(requireUserId(request));
        response.status(StatusCodes.OK).json({
            status: "success",
            data: { savedPlan },
        });
    }),
    saveCoachPlan: asyncHandler(async (request, response) => {
        const savedPlan = await service.saveCoachPlan(requireUserId(request), request.body);
        response.status(StatusCodes.OK).json({
            status: "success",
            data: { savedPlan },
        });
    }),
});

export const progressController = createProgressController();
