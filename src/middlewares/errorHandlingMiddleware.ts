import type { ErrorRequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

type ErrorWithStatus = Error & {
    statusCode?: number;
    errors?: unknown[];
};

export const errorHandlingMiddleware: ErrorRequestHandler = (error, _request, response, _next) => {
    const normalizedError = error as ErrorWithStatus;
    const statusCode = normalizedError.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR;
    const responseError = {
        statusCode,
        message: normalizedError.message || "Internal Server Error",
        errors: normalizedError.errors || [],
        stack: process.env.NODE_ENV === "production" ? null : normalizedError.stack,
    };

    console.error("Error:", responseError.message);
    response.status(statusCode).json(responseError);
};