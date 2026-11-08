import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env.js";
import {
    PASSWORD_RESET_ERROR_CODES,
    PASSWORD_RESET_MAX_SENDS_PER_WINDOW,
    PASSWORD_RESET_RESEND_COOLDOWN_MS,
    PASSWORD_RESET_TOKEN_PATTERN,
    PASSWORD_RESET_TOKEN_TTL_MS,
    PASSWORD_RESET_WINDOW_MS,
} from "../config/passwordReset.js";
import {
    mongoPasswordResetRepository,
    type PasswordResetRepository,
    type SendLimitState,
} from "../repositories/passwordReset.repository.js";
import ApiError from "../utils/ApiError.js";
import { assertValidNewPassword, maskEmail } from "../utils/password.js";
import { smtpMailService, type MailService } from "./mail.service.js";
import { buildPasswordResetEmail } from "./passwordResetEmail.js";

export interface RequestLinkResult {
    maskedEmail: string;
    expiresInMinutes: number;
    resendAfterSeconds: number;
}

export interface PasswordResetService {
    requestLink(user: { id: string; email: string }): Promise<RequestLinkResult>;
    forgotPassword(rawEmail: unknown): Promise<{ message: string }>;
    validateToken(body: unknown): Promise<{ maskedEmail: string }>;
    confirm(body: unknown): Promise<void>;
}

export interface PasswordResetDependencies {
    repository?: PasswordResetRepository;
    mailer?: MailService;
    clock?: () => Date;
    clientUrl?: string;
    hashPassword?: (password: string) => Promise<string>;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const invalidToken = (): ApiError =>
    new ApiError(
        StatusCodes.BAD_REQUEST,
        "This link is invalid, expired or has already been used",
        [],
        PASSWORD_RESET_ERROR_CODES.INVALID_TOKEN,
    );

const rateLimited = (retryAfterMs: number): ApiError => {
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return new ApiError(
        StatusCodes.TOO_MANY_REQUESTS,
        "Too many password reset requests. Please try again later",
        [{ retryAfterSeconds }],
        PASSWORD_RESET_ERROR_CODES.RATE_LIMITED,
    );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Token đọc từ body (không phải URL) để không lọt vào log truy cập của server
const readToken = (body: unknown): string => {
    const token = isRecord(body) ? body.token : undefined;
    if (typeof token !== "string" || !PASSWORD_RESET_TOKEN_PATTERN.test(token)) throw invalidToken();
    return token;
};

const nextLimitState = (previous: SendLimitState | null, now: Date): SendLimitState => {
    if (!previous) return { windowStartedAt: now, count: 1, lastSentAt: now };

    const nowMs = now.getTime();
    const cooldownEnd = previous.lastSentAt.getTime() + PASSWORD_RESET_RESEND_COOLDOWN_MS;
    if (nowMs < cooldownEnd) throw rateLimited(cooldownEnd - nowMs);

    const windowEnd = previous.windowStartedAt.getTime() + PASSWORD_RESET_WINDOW_MS;
    if (nowMs >= windowEnd) return { windowStartedAt: now, count: 1, lastSentAt: now };
    if (previous.count >= PASSWORD_RESET_MAX_SENDS_PER_WINDOW) throw rateLimited(windowEnd - nowMs);
    return { windowStartedAt: previous.windowStartedAt, count: previous.count + 1, lastSentAt: now };
};

export const createPasswordResetService = ({
    repository = mongoPasswordResetRepository,
    mailer = smtpMailService,
    clock = () => new Date(),
    clientUrl = env.CLIENT_URL,
    hashPassword = (password) => bcrypt.hash(password, 10),
}: PasswordResetDependencies = {}): PasswordResetService => ({
    requestLink: async (user) => {
        const now = clock();
        const previous = await repository.getSendLimit(user.id);
        const next = nextLimitState(previous, now);

        // Giữ chỗ trước khi gửi: hai request đồng thời không cùng vượt qua cooldown
        if (!(await repository.reserveSend(user.id, previous, next))) {
            throw rateLimited(PASSWORD_RESET_RESEND_COOLDOWN_MS);
        }

        const token = randomBytes(32).toString("base64url");
        let created: Awaited<ReturnType<PasswordResetRepository["createToken"]>> | null = null;
        try {
            created = await repository.createToken({
                userId: user.id,
                tokenHash: hashToken(token),
                expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
            });
            // Link luôn dựng từ cấu hình; token nằm ở fragment (#) nên không gửi lên server hay vào Referer
            const link = `${clientUrl.replace(/\/+$/, "")}/reset-password#token=${token}`;
            await mailer.send({
                to: user.email,
                ...buildPasswordResetEmail({
                    link,
                    expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MS / 60_000,
                }),
            });
        } catch (error) {
            // Gửi lỗi: không báo thành công, bỏ link vừa tạo và trả lại lượt gửi để người dùng thử lại ngay
            if (created) await repository.deleteToken(created.id).catch(() => undefined);
            await repository.restoreSendLimit(user.id, previous).catch(() => undefined);
            throw error;
        }

        // Gửi xong mới thu hồi link cũ, nên nếu gửi lỗi thì link cũ (nếu còn hạn) vẫn dùng được
        await repository.deleteTokensExcept(user.id, created.id);

        return {
            maskedEmail: maskEmail(user.email),
            expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MS / 60_000,
            resendAfterSeconds: PASSWORD_RESET_RESEND_COOLDOWN_MS / 1000,
        };
    },

    forgotPassword: async (rawEmail: unknown) => {
        const GENERIC_SENT_MESSAGE = "Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi tới hộp thư của bạn.";
        if (typeof rawEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim())) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "A valid email is required",
                [{ field: "email" }],
            );
        }
        const email = rawEmail.trim().toLowerCase();
        const account = await repository.findAccountByEmail(email);

        // Nếu email không tồn tại hoặc tài khoản không active: trả về thông báo trung tính, không tiết lộ tài khoản
        if (!account || account.status !== "active") {
            return { message: GENERIC_SENT_MESSAGE };
        }

        const now = clock();
        const previous = await repository.getSendLimit(account.id);
        const next = nextLimitState(previous, now);

        if (!(await repository.reserveSend(account.id, previous, next))) {
            throw rateLimited(PASSWORD_RESET_RESEND_COOLDOWN_MS);
        }

        const token = randomBytes(32).toString("base64url");
        let created: Awaited<ReturnType<PasswordResetRepository["createToken"]>> | null = null;
        try {
            created = await repository.createToken({
                userId: account.id,
                tokenHash: hashToken(token),
                expiresAt: new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
            });
            const link = `${clientUrl.replace(/\/+$/, "")}/reset-password#token=${token}`;
            await mailer.send({
                to: account.email,
                ...buildPasswordResetEmail({
                    link,
                    expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MS / 60_000,
                }),
            });
        } catch (error) {
            if (created) await repository.deleteToken(created.id).catch(() => undefined);
            await repository.restoreSendLimit(account.id, previous).catch(() => undefined);
            throw error;
        }

        await repository.deleteTokensExcept(account.id, created.id);
        return { message: GENERIC_SENT_MESSAGE };
    },

    // Chỉ đọc: không tiêu thụ token, để trình quét link của dịch vụ email không làm link mất hiệu lực
    validateToken: async (body) => {
        const token = readToken(body);
        const active = await repository.findActiveToken(hashToken(token), clock());
        const account = active ? await repository.findAccount(active.userId) : null;
        if (!account || account.status !== "active") throw invalidToken();
        return { maskedEmail: maskEmail(account.email) };
    },

    confirm: async (body) => {
        const token = readToken(body);
        const { newPassword, confirmPassword } = isRecord(body) ? body : {};
        const password = assertValidNewPassword(newPassword, confirmPassword);

        const tokenHash = hashToken(token);
        // Kiểm tra rẻ trước khi băm bcrypt, tránh bị dùng token bừa để tốn CPU
        if (!(await repository.findActiveToken(tokenHash, clock()))) throw invalidToken();
        const passwordHash = await hashPassword(password);

        const claimed = await repository.claimToken(tokenHash, clock());
        if (!claimed) throw invalidToken();

        const account = await repository.findAccount(claimed.userId);
        if (!account || account.status !== "active") throw invalidToken();

        if (account.passwordHash && (await bcrypt.compare(password, account.passwordHash))) {
            await repository.releaseToken(claimed.id).catch(() => undefined);
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                "Mật khẩu mới không được trùng với mật khẩu hiện tại.",
                [{ field: "newPassword" }],
                PASSWORD_RESET_ERROR_CODES.SAME_PASSWORD,
            );
        }

        try {
            if (!(await repository.updatePasswordHash(claimed.userId, passwordHash))) throw invalidToken();
        } catch (error) {
            // Chưa đổi được mật khẩu thì trả lại link để người dùng thử lại
            await repository.releaseToken(claimed.id).catch(() => undefined);
            throw error;
        }

        try {
            await repository.revokeSessions(claimed.userId);
            await repository.deleteAllTokens(claimed.userId);
        } catch (error) {
            console.error("Password reset cleanup failed for user", claimed.userId, (error as Error).name);
            throw new ApiError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                "Password was changed but other sessions could not be signed out. Sign in with the new password and sign out on other devices",
                [],
                PASSWORD_RESET_ERROR_CODES.SESSION_REVOKE_FAILED,
            );
        }
    },
});

export const passwordResetService = createPasswordResetService();

