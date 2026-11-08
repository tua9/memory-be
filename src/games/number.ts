import { randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/ApiError.js";
import type { GameEngine } from "./types.js";

export const numberEngine: GameEngine = {
    gameName: "number",
    generateItems: (count, _level, random = randomInt) => Array.from({ length: count }, () => String(random(10))),
    buildRecallOptions: () => Array.from({ length: 10 }, (_, index) => String(index)),
    toView: (code) => ({ code }),
    parseAnswers: (items, answers) => {
        if (!Array.isArray(answers) || answers.length !== items.length || answers.some((answer) => answer !== null && (typeof answer !== "string" || !/^\d$/.test(answer)))) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `answers must contain ${items.length} digits or nulls`);
        }
        return answers;
    },
};
