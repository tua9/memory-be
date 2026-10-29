import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { imageCardService } from "../services/imageCard.service.js";

export const getRandomImages = asyncHandler(
  async (request: Request, response: Response) => {
    const count = Number(request.query.count) || 6;
    const level = request.query.level ? Number(request.query.level) : undefined;
    const images = await imageCardService.getRandomImages(count, level);

    response.status(StatusCodes.OK).json({
      status: "success",
      message: "Get random images successfully",
      data: {
        images,
        count: images.length,
      },
    });
  }
);
