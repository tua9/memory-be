import type { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { wordsSessionService, type WordsSessionService } from "../services/wordsSession.service.js";

export const createWordsSessionController = (service: WordsSessionService = wordsSessionService) => {
  const getLevels = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const levels = service.getLevels();
      const languages = service.getLanguages();
      res.status(StatusCodes.OK).json({
        status: "success",
        data: {
          levels,
          languages,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  const createSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = service.createSession(req.body);
      res.status(StatusCodes.CREATED).json({
        status: "success",
        message: "Phiên chơi ghi nhớ từ đã được tạo.",
        data: session,
      });
    } catch (error) {
      next(error);
    }
  };

  const submitSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = req.params.sessionId || req.params.id || req.body.sessionId;
      const result = service.submitSession(sessionId, req.body);
      res.status(StatusCodes.OK).json({
        status: "success",
        message: "Kết quả chấm bài ghi nhớ từ.",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    getLevels,
    createSession,
    submitSession,
  };
};

export const wordsSessionController = createWordsSessionController();

