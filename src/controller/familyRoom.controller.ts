import type { Request, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import {
    createFamilyRoom, finishFamilyRoom, getFamilyRoom, getParentPoints, joinFamilyRoom,
    nextFamilyRound, readyFamilyRoom, recallFamilyRoom, startFamilyRoom, submitFamilyRoom,
    type RoomActor,
} from "../services/familyRoom.service.js";

const actorOf = (request: Request): RoomActor => {
    if (request.parent) return { role: "parent", parent: request.parent };
    if (request.user) return { role: "child", child: request.user };
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
};
const roomCode = (request: Request): string => String(request.params.code ?? "");
const send = (response: Response, data: unknown, status = StatusCodes.OK) => response.status(status).json({ status: "success", data });

export const createRoom: RequestHandler = asyncHandler(async (request, response) => {
    if (!request.parent) throw new ApiError(StatusCodes.FORBIDDEN, "Only a verified parent can create a room");
    send(response, await createFamilyRoom(request.parent, request.body), StatusCodes.CREATED);
});
export const readRoom: RequestHandler = asyncHandler(async (request, response) => send(response, await getFamilyRoom(roomCode(request), actorOf(request))));
export const joinRoom: RequestHandler = asyncHandler(async (request, response) => send(response, await joinFamilyRoom(roomCode(request), actorOf(request))));
export const readyRoom: RequestHandler = asyncHandler(async (request, response) => send(response, await readyFamilyRoom(roomCode(request), actorOf(request))));
export const startRoom: RequestHandler = asyncHandler(async (request, response) => send(response, await startFamilyRoom(roomCode(request), actorOf(request))));
export const recallRoom: RequestHandler = asyncHandler(async (request, response) => send(response, await recallFamilyRoom(roomCode(request), actorOf(request))));
export const submitRoom: RequestHandler = asyncHandler(async (request, response) => send(response, await submitFamilyRoom(roomCode(request), actorOf(request), request.body)));
export const nextRoom: RequestHandler = asyncHandler(async (request, response) => send(response, await nextFamilyRound(roomCode(request), actorOf(request))));
export const finishRoom: RequestHandler = asyncHandler(async (request, response) => send(response, await finishFamilyRoom(roomCode(request), actorOf(request))));
export const parentPoints: RequestHandler = asyncHandler(async (request, response) => {
    if (!request.parent) throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    send(response, await getParentPoints(request.parent));
});
