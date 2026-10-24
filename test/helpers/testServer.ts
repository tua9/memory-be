import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express, { type RequestHandler, type Router } from "express";
import { StatusCodes } from "http-status-codes";
import { errorHandlingMiddleware } from "../../src/middlewares/errorHandlingMiddleware.js";
import type { UserDocument } from "../../src/models/user.js";
import ApiError from "../../src/utils/ApiError.js";

export const TEST_USER_ID = "507f1f77bcf86cd799439011";

// Giả lập middleware xác thực đã chạy thành công
export const acceptAuthentication: RequestHandler = (request, _response, next) => {
    request.user = { _id: { toString: () => TEST_USER_ID } } as unknown as UserDocument;
    next();
};

export const rejectAuthentication: RequestHandler = (_request, _response, next) => {
    next(new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized"));
};

// Chạy router thật trên một cổng ngẫu nhiên, dùng errorHandlingMiddleware như app thật
export const startTestServer = async (mountPath: string, ...routers: Router[]) => {
    const app = express();
    app.use(express.json());
    app.use(mountPath, ...routers);
    app.use(errorHandlingMiddleware);

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}${mountPath}`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        }),
    };
};

export const postJson = (url: string, body?: unknown) =>
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
