import { StatusCodes } from "http-status-codes";
import { env } from "../../config/env.js";
import ApiError from "../../utils/ApiError.js";
import type { CoachChatMessage } from "../types.js";

const GEMINI_TIMEOUT_MS = 45_000;

interface GeminiResponse {
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
}

interface GeminiErrorResponse {
    error?: { message?: unknown };
}

export const requestGemini = async (
    systemPrompt: string,
    messages: CoachChatMessage[],
    config: { apiKey: string; model: string } = { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
): Promise<string> => {
    if (!config.apiKey) {
        throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, "Gemini chưa được cấu hình API key.");
    }

    let response: Response;
    try {
        response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": config.apiKey,
                },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: messages.map(({ role, content }) => ({
                        role: role === "assistant" ? "model" : "user",
                        parts: [{ text: content }],
                    })),
                    generationConfig: {
                        temperature: 0.4,
                        maxOutputTokens: 1200,
                    },
                }),
                signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
            },
        );
    } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
            throw new ApiError(StatusCodes.GATEWAY_TIMEOUT, "Gemini không phản hồi kịp thời.");
        }
        throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, "Không kết nối được Gemini.");
    }

    if (!response.ok) {
        let detail = "";
        try {
            const result = await response.json() as GeminiErrorResponse;
            if (typeof result.error?.message === "string") {
                detail = ` ${result.error.message.slice(0, 300)}`;
            }
        } catch {
            detail = "";
        }
        throw new ApiError(StatusCodes.BAD_GATEWAY, `Gemini trả về lỗi HTTP ${response.status}.${detail}`);
    }

    let result: GeminiResponse;
    try {
        result = await response.json() as GeminiResponse;
    } catch {
        throw new ApiError(StatusCodes.BAD_GATEWAY, "Gemini trả về phản hồi không hợp lệ.");
    }
    const content = result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter((text): text is string => typeof text === "string")
        .join("")
        .trim();
    if (!content) {
        throw new ApiError(StatusCodes.BAD_GATEWAY, "Gemini không trả về nội dung tư vấn.");
    }
    if (content.length > 3000) {
        throw new ApiError(StatusCodes.BAD_GATEWAY, "Phản hồi từ Gemini vượt quá giới hạn cho phép.");
    }
    return content;
};
