import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
    numberSessionService,
    type NumberSessionService,
} from "../services/numberSession.service.js";
import ApiError from "../utils/ApiError.js";

const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

const getUserIdFromRequest = (request: Parameters<RequestHandler>[0]): string => {
    const user = request.user;
    if (!user || !user._id) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    }
    return user._id.toString();
};

const getSessionIdFromParams = (request: Parameters<RequestHandler>[0]): string => {
    const rawId = Array.isArray(request.params.id)
        ? request.params.id[0]
        : request.params.id;

    if (!rawId || typeof rawId !== "string" || !OBJECT_ID_REGEX.test(rawId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid session ID format");
    }

    return rawId;
};

export const createNumberSessionController = (
    service: NumberSessionService = numberSessionService,
): {
    createSession: RequestHandler;
    getSession: RequestHandler;
    startRecall: RequestHandler;
    saveAnswers: RequestHandler;
    submitSession: RequestHandler;
    getHistory: RequestHandler;
    getResult: RequestHandler;
    getProgress: RequestHandler;
} => ({
    // GET /progress: cấp đã mở, số chữ số mỗi cấp và lượt thử thách hôm nay
    getProgress: asyncHandler(async (request, response) => {
        const userId = getUserIdFromRequest(request);
        const progress = await service.getProgress(userId);

        response.set("Cache-Control", "no-store");
        response.status(StatusCodes.OK).json({
            status: "success",
            data: progress,
        });
    }),


    // POST /sessions
    createSession: asyncHandler(async (request, response) => {
        const userId = getUserIdFromRequest(request);
        const session = await service.createSession(userId, request.body);

        response.set("Cache-Control", "no-store");
        response.status(StatusCodes.CREATED).json({
            status: "success",
            data: {
                session,
                ...session,
            },
        });
    }),

    // GET /sessions/:id
    getSession: asyncHandler(async (request, response) => {
        const userId = getUserIdFromRequest(request);
        const sessionId = getSessionIdFromParams(request);
        const session = await service.getSession(userId, sessionId);

        response.set("Cache-Control", "no-store");
        response.status(StatusCodes.OK).json({
            status: "success",
            data: {
                session,
                ...session,
            },
        });
    }),

    // POST /sessions/:id/recall
    startRecall: asyncHandler(async (request, response) => {
        const userId = getUserIdFromRequest(request);
        const sessionId = getSessionIdFromParams(request);
        const session = await service.startRecall(userId, sessionId);

        response.set("Cache-Control", "no-store");
        response.status(StatusCodes.OK).json({
            status: "success",
            data: {
                session,
                ...session,
            },
        });
    }),

    // PUT /sessions/:id/answers
    saveAnswers: asyncHandler(async (request, response) => {
        const userId = getUserIdFromRequest(request);
        const sessionId = getSessionIdFromParams(request);
        const session = await service.saveAnswers(userId, sessionId, request.body);

        response.set("Cache-Control", "no-store");
        response.status(StatusCodes.OK).json({
            status: "success",
            data: {
                session,
                ...session,
            },
        });
    }),

    // POST /sessions/:id/submit
    submitSession: asyncHandler(async (request, response) => {
        const userId = getUserIdFromRequest(request);
        const sessionId = getSessionIdFromParams(request);
        const session = await service.submitSession(userId, sessionId, request.body);

        response.set("Cache-Control", "no-store");
        response.status(StatusCodes.OK).json({
            status: "success",
            data: {
                session,
                ...session,
            },
        });
    }),

    // GET /sessions
    getHistory: asyncHandler(async (request, response) => {
        const userId = getUserIdFromRequest(request);
        const history = await service.getHistory(userId, request.query);

        response.set("Cache-Control", "no-store");
        response.status(StatusCodes.OK).json({
            status: "success",
            data: history,
        });
    }),

    // GET /sessions/:id/result
    getResult: asyncHandler(async (request, response) => {
        const userId = getUserIdFromRequest(request);
        const sessionId = getSessionIdFromParams(request);
        const result = await service.getResult(userId, sessionId);

        response.set("Cache-Control", "no-store");
        response.status(StatusCodes.OK).json({
            status: "success",
            data: result,
        });
    }),
});

export const numberSessionController = createNumberSessionController();
