import type { Request, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import * as rooms from "../services/gameRoom.service.js";

const meOf = (request: Request) => {
    if (!request.user) throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    return request.user;
};
const codeOf = (request: Request) => String(request.params.code ?? "");
const handle = (run: (request: Request) => Promise<unknown>, status = StatusCodes.OK): RequestHandler =>
    asyncHandler(async (request, response: Response) => {
        response.status(status).json({ status: "success", data: await run(request) });
    });

export const createRoom = handle((request) => rooms.createRoom(meOf(request), request.body), StatusCodes.CREATED);
export const roomStats = handle((request) => rooms.getRoomStats(meOf(request)));
export const leaderboard = handle((request) => rooms.getLeaderboard(meOf(request)));
export const rematchRoom = handle((request) => rooms.rematch(codeOf(request), meOf(request), request.body));
export const readRoom = handle((request) => rooms.getRoom(codeOf(request), meOf(request)));
export const joinRoom = handle((request) => rooms.joinRoom(codeOf(request), meOf(request)));
export const leaveRoom = handle((request) => rooms.leaveRoom(codeOf(request), meOf(request)));
export const kickPlayer = handle((request) => rooms.kickPlayer(codeOf(request), meOf(request), request.body));
export const readyRoom = handle((request) => rooms.setReady(codeOf(request), meOf(request), request.body));
export const startRoom = handle((request) => rooms.startRoom(codeOf(request), meOf(request)));
export const recallRoom = handle((request) => rooms.enterRecallPhase(codeOf(request), meOf(request)));
export const submitRoom = handle((request) => rooms.submitAnswers(codeOf(request), meOf(request), request.body));
export const nextRoom = handle((request) => rooms.nextRound(codeOf(request), meOf(request)));
export const finishRoom = handle((request) => rooms.finishRoom(codeOf(request), meOf(request)));
