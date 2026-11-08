import { StatusCodes } from "http-status-codes";
import rawPeople from "../data/faceNamePeople.json" with { type: "json" };
import { FaceNameService, normalizeName } from "../services/faceName.service.js";
import ApiError from "../utils/ApiError.js";
import type { GameEngine } from "./types.js";

const people = new Map(rawPeople.map((person) => [String(person.id), person]));
export const faceNameEngine: GameEngine = {
    gameName: "facename",
    generateItems: (count, level, random) => new FaceNameService(rawPeople as ConstructorParameters<typeof FaceNameService>[0], random)
        .generateRoundPeople(level ?? undefined, count).map((person) => String(person.id)),
    buildRecallOptions: (items) => [...items],
    toView: (code) => {
        const person = people.get(code);
        if (!person) throw new Error(`Unknown face: ${code}`);
        return { code, imageUrl: person.imageUrl, label: person.name };
    },
    toRecallView: (code) => {
        const person = people.get(code);
        if (!person) throw new Error(`Unknown face: ${code}`);
        return { code, imageUrl: person.imageUrl };
    },
    answerView: (answer) => ({ code: answer, label: answer }),
    matches: (code, answer) => answer !== null && normalizeName(answer) === normalizeName(people.get(code)?.name ?? ""),
    parseAnswers: (items, answers) => {
        if (!Array.isArray(answers) || answers.length !== items.length || answers.some((answer) => answer !== null && (typeof answer !== "string" || answer.length > 100))) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `answers must contain ${items.length} names or nulls`);
        }
        return answers.map((answer: string | null) => answer?.trim() ? answer : null);
    },
};
