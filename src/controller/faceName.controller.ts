import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { faceNameService, FaceNameService } from "../services/faceName.service.js";
import ApiError from "../utils/ApiError.js";

export const createFaceNameController = (service: FaceNameService = faceNameService) => ({
  getLevels: asyncHandler(async (_req: Request, res: Response) => {
    const levels = service.getLevels();
    res.status(StatusCodes.OK).json({
      status: "success",
      levels,
    });
  }),

  createRound: asyncHandler(async (req: Request, res: Response) => {
    const result = service.createRound(req.body);
    res.status(StatusCodes.CREATED).json(result);
  }),

  submitRound: asyncHandler(async (req: Request, res: Response) => {
    const roundId = req.params.roundId || (req.body && req.body.roundId);
    if (!roundId || typeof roundId !== "string") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Missing roundId parameter");
    }
    const result = service.submitRound(roundId, req.body);
    res.status(StatusCodes.OK).json(result);
  }),
});

export const faceNameController = createFaceNameController();

