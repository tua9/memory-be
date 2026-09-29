import express, { type RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

const router = express.Router();
const notImplemented: RequestHandler = (_request, response) => {
    response.sendStatus(StatusCodes.NOT_IMPLEMENTED);
};

router.get("/", notImplemented);
router.get("/:type/configs", notImplemented);
router.post("/:type/questions", notImplemented);
router.get("/:type/leaderboard", notImplemented);

export default router;