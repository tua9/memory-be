import { StatusCodes } from "http-status-codes";
import type { ConfiguredGameName } from "../config/games.js";
import ApiError from "../utils/ApiError.js";
import { cardEngine } from "./card.js";
import { imageEngine } from "./image.js";
import type { GameEngine } from "./types.js";

export type { GameEngine, ItemView } from "./types.js";

const GAME_ENGINES: Record<ConfiguredGameName, GameEngine> = {
    card: cardEngine,
    image: imageEngine,
};

export const getGameEngine = (gameName: ConfiguredGameName): GameEngine => GAME_ENGINES[gameName];

// Kiểm tra câu trả lời gửi lên: đúng số vị trí, mỗi vị trí là null (bỏ trống) hoặc một lựa chọn hợp lệ.
// Không cho dùng một lựa chọn ở nhiều vị trí, tránh rải cùng một lá vào nhiều ô để "đoán may".
export const parseAnswers = (
    engine: GameEngine,
    items: readonly string[],
    answers: unknown,
): (string | null)[] => {
    if (!Array.isArray(answers) || answers.length !== items.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `answers must be an array of ${items.length} items`);
    }

    const allowed = new Set(engine.buildRecallOptions(items));
    const used = new Set<string>();
    return answers.map((answer: unknown, index) => {
        if (answer === null) {
            return null;
        }
        if (typeof answer !== "string" || !allowed.has(answer)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `answers[${index}] is not a valid option`);
        }
        if (used.has(answer)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `answers[${index}] repeats an option already used`);
        }
        used.add(answer);
        return answer;
    });
};
