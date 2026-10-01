import bcrypt from "bcrypt";
import { createHash, randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import User, { type UserDocument } from "../models/user";
import Session from "../models/sessions";
import { JwtProvider } from "../providers/JwtProvider";
import ApiError from "../utils/ApiError";

interface CredentialsBody {
    email?: unknown;
    password?: unknown;
    fullName?: unknown;
}

interface UserInfo {
    _id: string;
    email: string;
    fullName: string;
    status: string;
    role: string;
}

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
    userInfo: UserInfo;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const buildUserInfo = (user: UserDocument): UserInfo => ({
    _id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    role: user.role,
});

const asCredentials = (body: unknown): CredentialsBody =>
    typeof body === "object" && body !== null ? body as CredentialsBody : {};

const validateCredentials = (body: unknown): { email: string; password: string } => {
    const { email, password } = asCredentials(body);
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "A valid email is required");
    }
    if (typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > 72) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Password is required and must not exceed 72 bytes");
    }
    return { email: email.trim().toLowerCase(), password };
};

const ensureAccountCanSignIn = (user: UserDocument): void => {
    if (user.status !== "active") {
        throw new ApiError(StatusCodes.FORBIDDEN, "Account is not active");
    }
};

const generateTokens = async (user: UserDocument): Promise<AuthTokens> => {
    if (!env.ACCESS_TOKEN_SECRET || !env.REFRESH_TOKEN_SECRET ||
        env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Distinct JWT secrets must be configured");
    }

    const subject = user._id.toString();
    const accessToken = await JwtProvider.generateToken(
        { sub: subject, role: user.role, tokenType: "access", jti: randomUUID() },
        env.ACCESS_TOKEN_SECRET,
        env.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
    );
    const refreshToken = await JwtProvider.generateToken(
        { sub: subject, tokenType: "refresh", jti: randomUUID() },
        env.REFRESH_TOKEN_SECRET,
        env.REFRESH_TOKEN_TTL as SignOptions["expiresIn"],
    );
    const accessPayload = await JwtProvider.verifyToken(accessToken, env.ACCESS_TOKEN_SECRET);
    const refreshPayload = await JwtProvider.verifyToken(refreshToken, env.REFRESH_TOKEN_SECRET);
    if (typeof accessPayload.exp !== "number" || typeof refreshPayload.exp !== "number") {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Token expiration could not be determined");
    }

    return {
        accessToken,
        refreshToken,
        accessExpiresAt: new Date(accessPayload.exp * 1000),
        refreshExpiresAt: new Date(refreshPayload.exp * 1000),
        userInfo: buildUserInfo(user),
    };
};

const signUp = async (body: unknown): Promise<UserInfo> => {
    const { email, password } = validateCredentials(body);
    const fullName = asCredentials(body).fullName;
    const normalizedFullName = typeof fullName === "string" ? fullName.trim() : "";
    if (normalizedFullName.length < 2 || normalizedFullName.length > 100 || password.length < 8) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Full name must be 2-100 characters and password at least 8 characters");
    }
    if (await User.findOne({ email })) {
        throw new ApiError(StatusCodes.CONFLICT, "Email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    try {
        const user = await User.create({
            email,
            fullName: normalizedFullName,
            passwordHash,
            role: "user",
            status: "active",
        });
        return buildUserInfo(user);
    } catch (error) {
        if ((error as { code?: number }).code === 11000) {
            throw new ApiError(StatusCodes.CONFLICT, "Email already exists");
        }
        throw error;
    }
};

const signIn = async (body: unknown): Promise<AuthTokens> => {
    const { email, password } = validateCredentials(body);
    const user = await User.findOne({ email });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid email or password");
    }
    ensureAccountCanSignIn(user);
    const tokens = await generateTokens(user);
    await Session.create({
        userId: user._id,
        refreshToken: hashToken(tokens.refreshToken),
        expiresAt: tokens.refreshExpiresAt,
    });
    return tokens;
};

const refreshToken = async (token: unknown): Promise<AuthTokens> => {
    if (typeof token !== "string" || !token) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Refresh token is required");
    }

    let payload: JwtPayload;
    try {
        payload = await JwtProvider.verifyToken(token, env.REFRESH_TOKEN_SECRET);
    } catch (error) {
        if (error instanceof Error && ["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"].includes(error.name)) {
            throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid or expired refresh token");
        }
        throw error;
    }
    if (payload.tokenType !== "refresh" || typeof payload.sub !== "string" || !/^[a-f\d]{24}$/i.test(payload.sub)) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid refresh token");
    }

    const user = await User.findById(payload.sub);
    if (!user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Account is unavailable");
    }
    ensureAccountCanSignIn(user);
    const tokens = await generateTokens(user);
    const session = await Session.findOneAndUpdate(
        { userId: user._id, refreshToken: hashToken(token), expiresAt: { $gt: new Date() } },
        { $set: { refreshToken: hashToken(tokens.refreshToken), expiresAt: tokens.refreshExpiresAt } },
        { new: true, runValidators: true },
    );
    if (!session) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Session expired or revoked");
    }
    return tokens;
};

const signOut = async (token?: unknown): Promise<void> => {
    if (typeof token === "string" && token) {
        await Session.deleteOne({ refreshToken: hashToken(token) });
    }
};

export const authService = { signUp, signIn, signOut, refreshToken };