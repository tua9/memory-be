import { randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/ApiError.js";
import { SEED_WORDS_BY_LANG } from "../data/seedWords.js";
import type { SupportedLanguageCode } from "../config/wordsRules.js";
import type { GameEngine, ItemView } from "./types.js";
import type { RandomInt } from "../utils/random.js";

export const normalizeWord = (str: string): string =>
    str.trim().toLowerCase().normalize("NFC");

export const generateWordItems = (
    count: number,
    lang: SupportedLanguageCode = "vi",
    random: RandomInt = randomInt,
): string[] => {
    const sourcePool = SEED_WORDS_BY_LANG[lang] || SEED_WORDS_BY_LANG.vi;
    const pool = [...sourcePool];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = random(i + 1);
        const temp = pool[i];
        pool[i] = pool[j];
        pool[j] = temp;
    }
    return pool.slice(0, count);
};

export const wordEngine: GameEngine = {
    gameName: "word",
    generateItems: (count, _level, random = randomInt, options?: unknown) => {
        const lang = (typeof options === "string" && options in SEED_WORDS_BY_LANG)
            ? (options as SupportedLanguageCode)
            : "vi";
        return generateWordItems(count, lang, random);
    },
    // Người chơi tự gõ lại từ, không chọn từ danh sách: phase nhớ lại không gửi từ nào xuống,
    // nếu không recallOptions chính là đáp án theo đúng thứ tự
    buildRecallOptions: () => [],
    toView: (code) => ({ code, label: code }),
    answerView: (answer) => ({ code: answer, label: answer }),
    matches: (expected, answer) =>
        answer !== null && normalizeWord(answer) === normalizeWord(expected),
    parseAnswers: (items, answers) => {
        if (
            !Array.isArray(answers) ||
            answers.length !== items.length ||
            answers.some((a) => a !== null && (typeof a !== "string" || a.length > 100))
        ) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `answers must contain ${items.length} words or nulls`);
        }
        return answers.map((a: string | null) => (a?.trim() ? a.trim() : null));
    },
};

