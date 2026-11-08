import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
  dailyChallengeService,
  type DailyChallengeService,
} from "../services/dailyChallenge.service.js";
import { requireUserId } from "../utils/request.js";

export const createDailyChallengeController = (
  service: DailyChallengeService = dailyChallengeService,
): {
  getChallenge: RequestHandler;
  startChallenge: RequestHandler;
} => ({
  // GET /api/daily-challenge: thử thách hôm nay và bảng xếp hạng; khách cũng xem được
  getChallenge: asyncHandler(async (request, response) => {
    const data = await service.getChallenge(request.user?._id.toString() ?? null);
    response.status(StatusCodes.OK).json({
      status: "success",
      message: "Daily challenge retrieved",
      data,
    });
  }),

  // POST /api/daily-challenge/start: dùng lượt chơi hôm nay; ghi nhớ, nhớ lại và nộp bài đi qua /api/game-sessions
  startChallenge: asyncHandler(async (request, response) => {
    const session = await service.startChallenge(requireUserId(request));
    response.status(StatusCodes.CREATED).json({
      status: "success",
      message: "Daily challenge started",
      data: { session },
    });
  }),
});

export const dailyChallengeController = createDailyChallengeController();
