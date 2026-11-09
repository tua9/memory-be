import bcrypt from "bcrypt";
import { createHash, randomUUID } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import User, { type UserDocument } from "../models/user";
import Session from "../models/sessions";
import GameSession from "../models/gameSession";
import NumberSession from "../models/numberSession";
import UserGameProgress from "../models/userGameProgress";
import PasswordResetToken from "../models/passwordResetToken";
import PasswordResetLimit from "../models/passwordResetLimit";
import { JwtProvider } from "../providers/JwtProvider";
import ApiError from "../utils/ApiError";
import { assertValidNewPassword } from "../utils/password";
import { PASSWORD_RESET_ERROR_CODES } from "../config/passwordReset";

interface CredentialsBody {
    email?: unknown;
    password?: unknown;
    username?: unknown;
    rememberMe?: unknown;
}

interface UserInfo {
    _id: string;
    email: string;
    username: string;
    status: string;
    role: string;
    avatarUrl?: string | null;
    authProvider?: string;
    isEmailVerified?: boolean;
    hasPassword?: boolean;
}

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
    // false: cookie chỉ sống đến khi đóng trình duyệt và phiên có thời hạn ngắn hơn
    rememberMe: boolean;
    userInfo: UserInfo;
}

const hashToken = (token: string): string =>
    createHash("sha256").update(token).digest("hex");

const buildUserInfo = (user: UserDocument): UserInfo => ({
    _id: user._id.toString(),
    email: user.email,
    username: user.username,
    status: user.status,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    authProvider: user.authProvider ?? "local",
    isEmailVerified: user.isEmailVerified ?? false,
    hasPassword: Boolean(user.passwordHash),
});

const asCredentials = (body: unknown): CredentialsBody =>
    typeof body === "object" && body !== null ? (body as CredentialsBody) : {};

const validateCredentials = (
    body: unknown,
): { email: string; password: string } => {
    const { email, password } = asCredentials(body);
    if (
        typeof email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            "A valid email is required",
        );
    }
    if (
        typeof password !== "string" ||
        !password ||
        Buffer.byteLength(password, "utf8") > 72
    ) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            "Password is required and must not exceed 72 bytes",
        );
    }
    return { email: email.trim().toLowerCase(), password };
};

const ensureAccountCanSignIn = (user: UserDocument): void => {
    if (user.status !== "active") {
        throw new ApiError(StatusCodes.FORBIDDEN, "Account is not active");
    }
};

const generateTokens = async (
    user: UserDocument,
    rememberMe: boolean,
): Promise<AuthTokens> => {
    if (
        !env.ACCESS_TOKEN_SECRET ||
        !env.REFRESH_TOKEN_SECRET ||
        env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET
    ) {
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            "Distinct JWT secrets must be configured",
        );
    }

    const subject = user._id.toString();
    const accessToken = await JwtProvider.generateToken(
        {
            sub: subject,
            role: user.role,
            tokenType: "access",
            jti: randomUUID(),
        },
        env.ACCESS_TOKEN_SECRET,
        env.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
    );
    const refreshToken = await JwtProvider.generateToken(
        // rememberMe nằm trong payload đã ký để refresh giữ đúng lựa chọn lúc đăng nhập
        { sub: subject, tokenType: "refresh", jti: randomUUID(), rememberMe },
        env.REFRESH_TOKEN_SECRET,
        (rememberMe
            ? env.REFRESH_TOKEN_TTL
            : env.REFRESH_TOKEN_TTL_NO_REMEMBER) as SignOptions["expiresIn"],
    );
    const accessPayload = await JwtProvider.verifyToken(
        accessToken,
        env.ACCESS_TOKEN_SECRET,
    );
    const refreshPayload = await JwtProvider.verifyToken(
        refreshToken,
        env.REFRESH_TOKEN_SECRET,
    );
    if (
        typeof accessPayload.exp !== "number" ||
        typeof refreshPayload.exp !== "number"
    ) {
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            "Token expiration could not be determined",
        );
    }

    return {
        accessToken,
        refreshToken,
        accessExpiresAt: new Date(accessPayload.exp * 1000),
        refreshExpiresAt: new Date(refreshPayload.exp * 1000),
        rememberMe,
        userInfo: buildUserInfo(user),
    };
};

const signUp = async (body: unknown): Promise<UserInfo> => {
    const { email, password } = validateCredentials(body);
    const username = asCredentials(body).username;
    const normalizedUserName =
        typeof username === "string" ? username.trim() : "";
    if (
        normalizedUserName.length < 2 ||
        normalizedUserName.length > 100 ||
        password.length < 8
    ) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            "User name must be 2-100 characters and password at least 8 characters",
        );
    }
    if (await User.findOne({ email })) {
        throw new ApiError(StatusCodes.CONFLICT, "Email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    try {
        const user = await User.create({
            email,
            username: normalizedUserName,
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

    if (
        !user?.passwordHash ||
        !(await bcrypt.compare(password, user.passwordHash))
    ) {
        throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Invalid email or password",
        );
    }

    ensureAccountCanSignIn(user);

    const rememberMe = asCredentials(body).rememberMe === true;
    const tokens = await generateTokens(user, rememberMe);

    await Session.create({
        userId: user._id,
        refreshToken: hashToken(tokens.refreshToken),
        expiresAt: tokens.refreshExpiresAt,
    });

    return tokens;
};

const refreshToken = async (token: unknown): Promise<AuthTokens> => {
    if (typeof token !== "string" || !token) {
        throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Refresh token is required",
        );
    }

    let payload: JwtPayload;
    try {
        payload = await JwtProvider.verifyToken(
            token,
            env.REFRESH_TOKEN_SECRET,
        );
    } catch (error) {
        if (
            error instanceof Error &&
            [
                "TokenExpiredError",
                "JsonWebTokenError",
                "NotBeforeError",
            ].includes(error.name)
        ) {
            throw new ApiError(
                StatusCodes.UNAUTHORIZED,
                "Invalid or expired refresh token",
            );
        }
        throw error;
    }
    if (
        payload.tokenType !== "refresh" ||
        typeof payload.sub !== "string" ||
        !/^[a-f\d]{24}$/i.test(payload.sub)
    ) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid refresh token");
    }

    const user = await User.findById(payload.sub);
    if (!user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Account is unavailable");
    }
    ensureAccountCanSignIn(user);
    // Token cấp trước khi có rememberMe không có trường này: giữ hành vi cũ là duy trì đăng nhập
    const tokens = await generateTokens(user, payload.rememberMe !== false);
    const session = await Session.findOneAndUpdate(
        {
            userId: user._id,
            refreshToken: hashToken(token),
            expiresAt: { $gt: new Date() },
        },
        // Gia hạn phiên theo token mới (phiên trượt): người dùng thường xuyên không bị đăng xuất sau 14 ngày kể từ lúc đăng nhập
        { $set: { refreshToken: hashToken(tokens.refreshToken), expiresAt: tokens.refreshExpiresAt } },
        { new: true, runValidators: true },
    );
    if (!session) {
        throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Session expired or revoked",
        );
    }
    return tokens;
};

const signOut = async (token?: unknown): Promise<void> => {
    if (typeof token === "string" && token) {
        await Session.deleteOne({ refreshToken: hashToken(token) });
    }
};

interface GoogleProfile {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
    picture?: string;
}

const GOOGLE_ID_TOKEN_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

// Id token từ Google Sign-In trên mobile. Endpoint tokeninfo kiểm tra chữ ký và hạn;
// backend còn phải chắc token được cấp cho app này (aud), nếu không token đăng nhập app khác cũng dùng được.
// Trên mobile cấu hình webClientId = GOOGLE_CLIENT_ID để id token mang aud này.
const fetchGoogleIdTokenProfile = async (idToken: string): Promise<GoogleProfile> => {
    if (!env.GOOGLE_CLIENT_ID) {
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            "Google client ID must be configured",
        );
    }

    let claims: Record<string, unknown>;
    try {
        const response = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        );
        if (!response.ok) {
            throw new ApiError(
                StatusCodes.UNAUTHORIZED,
                "Google token is invalid or expired",
            );
        }
        claims = (await response.json()) as Record<string, unknown>;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Failed to authenticate with Google",
        );
    }

    if (
        claims.aud !== env.GOOGLE_CLIENT_ID ||
        !GOOGLE_ID_TOKEN_ISSUERS.includes(String(claims.iss)) ||
        typeof claims.sub !== "string" ||
        typeof claims.email !== "string"
    ) {
        throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Google token was not issued for this app",
        );
    }

    return {
        sub: claims.sub,
        email: claims.email,
        // tokeninfo trả email_verified dạng chuỗi "true"
        email_verified: claims.email_verified === true || claims.email_verified === "true",
        name: typeof claims.name === "string" ? claims.name : undefined,
        picture: typeof claims.picture === "string" ? claims.picture : undefined,
    };
};

const googleSignInWithIdToken = async (idToken: unknown): Promise<AuthTokens> => {
    if (typeof idToken !== "string" || !idToken.trim()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Google token is required");
    }
    return signInWithGoogleProfile(await fetchGoogleIdTokenProfile(idToken));
};

const googleSignIn = async (token: unknown): Promise<AuthTokens> => {
    if (typeof token !== "string" || !token.trim()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Google token is required");
    }

    let profile: GoogleProfile;
    try {
        const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
            throw new ApiError(
                StatusCodes.UNAUTHORIZED,
                "Google token is invalid or expired",
            );
        }

        profile = (await response.json()) as GoogleProfile;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Failed to authenticate with Google",
        );
    }

    return signInWithGoogleProfile(profile);
};

// Tìm hoặc tạo tài khoản từ hồ sơ Google đã xác thực, rồi mở phiên đăng nhập
const signInWithGoogleProfile = async (profile: GoogleProfile): Promise<AuthTokens> => {
    if (!profile.email_verified) {
        throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "Google email is not verified",
        );
    }

    const normalizedEmail = profile.email.trim().toLowerCase();
    const googleId = profile.sub;

    let user = await User.findOne({
        $or: [{ googleId }, { email: normalizedEmail }],
    });

    if (user) {
        ensureAccountCanSignIn(user);
        let hasChanges = false;

        if (!user.googleId) {
            user.googleId = googleId;
            user.isEmailVerified = true;
            hasChanges = true;
        }
        if (!user.avatarUrl && profile.picture) {
            user.avatarUrl = profile.picture;
            hasChanges = true;
        }
        if (!user.isEmailVerified) {
            user.isEmailVerified = true;
            hasChanges = true;
        }

        if (hasChanges) {
            await user.save();
        }
    } else {
        user = await User.create({
            username: profile.name?.trim() || normalizedEmail.split("@")[0],
            email: normalizedEmail,
            googleId,
            avatarUrl: profile.picture || null,
            authProvider: "google",
            isEmailVerified: true,
            status: "active",
            role: "user",
            passwordHash: null,
        });
    }

    const tokens = await generateTokens(user, true);

    await Session.create({
        userId: user._id,
        refreshToken: hashToken(tokens.refreshToken),
        expiresAt: tokens.refreshExpiresAt,
    });

    return tokens;
};

// Tài khoản đã có mật khẩu: phải nhập đúng mật khẩu hiện tại.
// Tài khoản Google chưa có mật khẩu: đặt mật khẩu lần đầu, không cần (và bỏ qua) mật khẩu hiện tại.
const changePassword = async (
    userId: string,
    body: unknown,
): Promise<void> => {
    const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const currentPassword = raw.currentPassword;
    const newPassword = raw.newPassword;
    const confirmPassword = raw.confirmPassword;

    const validatedNewPassword = assertValidNewPassword(newPassword, confirmPassword);

    const user = await User.findById(userId);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
    }
    if (user.status !== "active") {
        throw new ApiError(StatusCodes.FORBIDDEN, "Account is not active");
    }

    if (user.passwordHash) {
        if (typeof currentPassword !== "string" || !currentPassword) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "Vui lòng nhập mật khẩu hiện tại",
                [{ field: "currentPassword" }],
                PASSWORD_RESET_ERROR_CODES.CURRENT_PASSWORD_REQUIRED,
            );
        }
        const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isCurrentValid) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "Mật khẩu hiện tại không chính xác",
                [{ field: "currentPassword" }],
                PASSWORD_RESET_ERROR_CODES.INCORRECT_CURRENT_PASSWORD,
            );
        }

        const isSamePassword = await bcrypt.compare(validatedNewPassword, user.passwordHash);
        if (isSamePassword) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "Mật khẩu mới không được trùng với mật khẩu hiện tại.",
                [{ field: "newPassword" }],
                PASSWORD_RESET_ERROR_CODES.SAME_PASSWORD,
            );
        }
    }

    user.passwordHash = await bcrypt.hash(validatedNewPassword, 10);
    await user.save();

    // Thu hồi toàn bộ refresh session, kể cả khi vừa đặt mật khẩu lần đầu
    await Session.deleteMany({ userId: user._id });
};

// Xoá tài khoản và mọi dữ liệu gắn với nó (App Store/Google Play yêu cầu app có chức năng này).
// Tài khoản có mật khẩu phải nhập lại mật khẩu; tài khoản Google chưa đặt mật khẩu chỉ cần đang đăng nhập.
// Thu hồi phiên trước, xoá user sau cùng: lỗi giữa chừng chỉ để lại dữ liệu mồ côi, không để tài khoản mất dở.
const deleteAccount = async (userId: string, body: unknown): Promise<void> => {
    const password = (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {}).password;
    const user = await User.findById(userId);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
    }
    if (user.passwordHash) {
        if (typeof password !== "string" || !password) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Vui lòng nhập mật khẩu để xác nhận", [{ field: "password" }]);
        }
        if (!(await bcrypt.compare(password, user.passwordHash))) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Mật khẩu không chính xác", [{ field: "password" }]);
        }
    }

    await Session.deleteMany({ userId: user._id });
    await Promise.all([
        GameSession.deleteMany({ userId: user._id }),
        NumberSession.deleteMany({ userId: user._id }),
        UserGameProgress.deleteMany({ userId: user._id }),
        PasswordResetToken.deleteMany({ userId: user._id }),
        PasswordResetLimit.deleteMany({ userId: user._id }),
    ]);
    await User.deleteOne({ _id: user._id });
};

export const authService = {
    signUp,
    signIn,
    signOut,
    refreshToken,
    googleSignIn,
    googleSignInWithIdToken,
    changePassword,
    deleteAccount,
};
