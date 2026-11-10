import type { Request, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import * as family from "../services/family.service.js";
import { getChildOverview, getChildReport } from "../services/familyReport.service.js";
import { gameCatalogService } from "../services/gameCatalog.service.js";

const meOf = (request: Request) => {
    if (!request.user) throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    return request.user;
};
const send = (response: Response, data: unknown, status = StatusCodes.OK) =>
    response.status(status).json({ status: "success", data });
const handle = (run: (request: Request) => Promise<unknown>, status = StatusCodes.OK): RequestHandler =>
    asyncHandler(async (request, response) => { send(response, await run(request), status); });

export const getFamily = handle((request) => family.getFamily(meOf(request)._id));
export const createLinkCode = handle((request) => family.createLinkCode(meOf(request)._id), StatusCodes.CREATED);
export const cancelLinkCode = handle(async (request) => { await family.cancelLinkCode(meOf(request)._id); return { cancelled: true }; });
export const requestLink = handle((request) => family.requestLink(meOf(request)._id, request.body?.code), StatusCodes.CREATED);
export const acceptLink = handle((request) => family.acceptLink(meOf(request)._id, request.params.linkId));
export const removeLink = handle(async (request) => { await family.removeLink(meOf(request)._id, request.params.linkId); return { removed: true }; });
export const sendInvite = handle((request) => family.sendInvite(meOf(request)._id, request.body?.email), StatusCodes.CREATED);
export const inspectInvite = handle((request) => family.inspectInvite(request.body));
export const acceptInvite = handle((request) => family.acceptInvite(meOf(request)._id, request.body));

export const childOverview = handle(async (request) => {
    const me = meOf(request);
    const { link, child } = await family.requireChildOf(me._id, request.params.childId);
    return getChildOverview(me._id.toString(), child, link.ageGroup);
});
export const childReport = handle(async (request) => {
    const { link, child } = await family.requireChildOf(meOf(request)._id, request.params.childId);
    return getChildReport(child._id.toString(), link.ageGroup, request.query);
});
export const childGames = handle(async (request) => {
    const { child } = await family.requireChildOf(meOf(request)._id, request.params.childId);
    return { games: await gameCatalogService.listGames({ userId: child._id.toString() }) };
});
export const updateChild = handle((request) =>
    family.updateChildAgeGroup(meOf(request)._id, request.params.childId, request.body?.ageGroup));
