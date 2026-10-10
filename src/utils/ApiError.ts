export default class ApiError extends Error {
    statusCode: number;
    errors: unknown[];
       code?: string;

    constructor(statusCode: number, message: string, errors: unknown[] = [], code?: string) {
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        this.errors = errors;
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}