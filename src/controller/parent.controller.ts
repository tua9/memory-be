import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { baseCookieOptions } from "../utils/cookies.js";
import {
    changeParentPassword, confirmParentVerification, inspectParentVerification,
    parentStatus, registerParent, resendParentVerification, updateParentAgeGroup,
} from "../services/parent.service.js";
import { getParentOverview, getParentReport } from "../services/parentReport.service.js";
import { gameCatalogService } from "../services/gameCatalog.service.js";

const childId = (request: Parameters<RequestHandler>[0]): string => {
    if (!request.user) throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    return request.user._id.toString();
};
const parentOf = (request: Parameters<RequestHandler>[0]) => {
    if (!request.parent) throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    return request.parent;
};
const send = (response: Parameters<RequestHandler>[1], data: unknown, status = StatusCodes.OK) =>
    response.status(status).json({ status: "success", data });

export const childParentStatus: RequestHandler = asyncHandler(async (request, response) => {
    send(response, await parentStatus(childId(request)));
});
export const childRegisterParent: RequestHandler = asyncHandler(async (request, response) => {
    send(response, await registerParent(childId(request), request.body), StatusCodes.CREATED);
});
export const childResendParent: RequestHandler = asyncHandler(async (request, response) => {
    send(response, await resendParentVerification(childId(request)));
});
export const validateParentEmail: RequestHandler = asyncHandler(async (request, response) => {
    send(response, await inspectParentVerification(request.body));
});
export const verifyParentEmail: RequestHandler = asyncHandler(async (request, response) => {
    await confirmParentVerification(request.body);
    send(response, { verified: true });
});
export const parentOverview: RequestHandler = asyncHandler(async (request, response) => {
    send(response, await getParentOverview(parentOf(request)));
});
export const parentGames: RequestHandler = asyncHandler(async (request, response) => {
    const parent = parentOf(request);
    send(response, { games: await gameCatalogService.listGames({ userId: parent.childUserId.toString() }) });
});
export const parentReport: RequestHandler = asyncHandler(async (request, response) => {
    send(response, await getParentReport(parentOf(request), request.query));
});
export const parentAgeGroup: RequestHandler = asyncHandler(async (request, response) => {
    send(response, await updateParentAgeGroup(parentOf(request), request.body?.ageGroup));
});
export const parentPassword: RequestHandler = asyncHandler(async (request, response) => {
    await changeParentPassword(parentOf(request), request.body);
    // Phải xoá bằng đúng option lúc set (SameSite=None; Secure), nếu không trình duyệt chặn khi FE/BE khác domain
    response.clearCookie("accessToken", baseCookieOptions);
    response.clearCookie("refreshToken", baseCookieOptions);
    send(response, { changed: true });
});
