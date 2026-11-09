import PasswordResetLimit from "../models/passwordResetLimit.js";
import PasswordResetToken from "../models/passwordResetToken.js";
import Session from "../models/sessions.js";
import User from "../models/user.js";
import Parent from "../models/parent.js";
import {
    PASSWORD_RESET_PURPOSE,
    PARENT_PASSWORD_RESET_PURPOSE,
    PASSWORD_RESET_WINDOW_MS,
} from "../config/passwordReset.js";

export interface SendLimitState {
    windowStartedAt: Date;
    count: number;
    lastSentAt: Date;
}

export interface ResetAccount {
    id: string;
    email: string;
    status: string;
    passwordHash?: string | null;
}

export interface TokenRef {
    id: string;
    userId: string;
}

export interface PasswordResetRepository {
    findAccount(userId: string): Promise<ResetAccount | null>;
    findAccountByEmail(email: string): Promise<ResetAccount | null>;
    getSendLimit(userId: string): Promise<SendLimitState | null>;
    // So sánh-và-đặt: chỉ ghi khi trạng thái hiện tại vẫn đúng như `expected`; false nếu request khác đã chen vào
    reserveSend(userId: string, expected: SendLimitState | null, next: SendLimitState): Promise<boolean>;
    restoreSendLimit(userId: string, previous: SendLimitState | null): Promise<void>;
    createToken(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<TokenRef>;
    deleteToken(id: string): Promise<void>;
    deleteTokensExcept(userId: string, keepId: string): Promise<void>;
    deleteAllTokens(userId: string): Promise<void>;
    findActiveToken(tokenHash: string, now: Date): Promise<TokenRef | null>;
    // Nguyên tử: đúng một request thắng; request còn lại nhận null
    claimToken(tokenHash: string, now: Date): Promise<TokenRef | null>;
    releaseToken(id: string): Promise<void>;
    updatePasswordHash(userId: string, passwordHash: string): Promise<boolean>;
    revokeSessions(userId: string): Promise<void>;
}

const toLimit = (doc: { windowStartedAt: Date; count: number; lastSentAt: Date }): SendLimitState => ({
    windowStartedAt: doc.windowStartedAt,
    count: doc.count,
    lastSentAt: doc.lastSentAt,
});

const expiresAtFor = (state: SendLimitState): Date =>
    new Date(state.windowStartedAt.getTime() + PASSWORD_RESET_WINDOW_MS);

const isDuplicateKey = (error: unknown): boolean => (error as { code?: number }).code === 11000;

export const createMongoPasswordResetRepository = (kind: "user" | "parent"): PasswordResetRepository => {
const purpose = kind === "parent" ? PARENT_PASSWORD_RESET_PURPOSE : PASSWORD_RESET_PURPOSE;
return {
    findAccount: async (userId) => {
        if (kind === "parent") {
            const parent = await Parent.findById(userId).select("email passwordHash").lean();
            return parent ? { id: parent._id.toString(), email: parent.email, status: "active", passwordHash: parent.passwordHash } : null;
        }
        const user = await User.findById(userId).select("email status passwordHash").lean();
        return user ? { id: user._id.toString(), email: user.email, status: user.status, passwordHash: user.passwordHash } : null;
    },

    findAccountByEmail: async (email) => {
        if (kind === "parent") {
            // Do not choose an account type by query order if legacy data contain an overlap.
            if (await User.exists({ email })) return null;
            const parent = await Parent.findOne({ email }).select("email passwordHash").lean();
            return parent ? { id: parent._id.toString(), email: parent.email, status: "active", passwordHash: parent.passwordHash } : null;
        }
        const user = await User.findOne({ email }).select("email status passwordHash").lean();
        return user ? { id: user._id.toString(), email: user.email, status: user.status, passwordHash: user.passwordHash } : null;
    },

    getSendLimit: async (userId) => {
        const doc = await PasswordResetLimit.findOne({ userId, purpose }).lean();
        return doc ? toLimit(doc) : null;
    },

    reserveSend: async (userId, expected, next) => {
        const fields = { ...next, expiresAt: expiresAtFor(next) };
        if (!expected) {
            try {
                await PasswordResetLimit.create({ userId, purpose, ...fields });
                return true;
            } catch (error) {
                // Request khác vừa tạo bản ghi trước: coi như đã có người giữ chỗ
                if (isDuplicateKey(error)) return false;
                throw error;
            }
        }
        const updated = await PasswordResetLimit.findOneAndUpdate(
            {
                userId,
                purpose,
                windowStartedAt: expected.windowStartedAt,
                count: expected.count,
                lastSentAt: expected.lastSentAt,
            },
            { $set: fields },
        );
        return updated !== null;
    },

    restoreSendLimit: async (userId, previous) => {
        if (!previous) {
            await PasswordResetLimit.deleteOne({ userId, purpose });
            return;
        }
        await PasswordResetLimit.updateOne(
            { userId, purpose },
            { $set: { ...previous, expiresAt: expiresAtFor(previous) } },
        );
    },

    createToken: async ({ userId, tokenHash, expiresAt }) => {
        const doc = await PasswordResetToken.create({
            userId,
            purpose,
            tokenHash,
            expiresAt,
            usedAt: null,
        });
        return { id: doc._id.toString(), userId };
    },

    deleteToken: async (id) => {
        await PasswordResetToken.deleteOne({ _id: id });
    },

    deleteTokensExcept: async (userId, keepId) => {
        await PasswordResetToken.deleteMany({ userId, purpose, _id: { $ne: keepId } });
    },

    deleteAllTokens: async (userId) => {
        await PasswordResetToken.deleteMany({ userId, purpose });
    },

    findActiveToken: async (tokenHash, now) => {
        const doc = await PasswordResetToken.findOne({
            tokenHash,
            purpose,
            usedAt: null,
            expiresAt: { $gt: now },
        }).lean();
        return doc ? { id: doc._id.toString(), userId: doc.userId.toString() } : null;
    },

    claimToken: async (tokenHash, now) => {
        const doc = await PasswordResetToken.findOneAndUpdate(
            { tokenHash, purpose, usedAt: null, expiresAt: { $gt: now } },
            { $set: { usedAt: now } },
        ).lean();
        return doc ? { id: doc._id.toString(), userId: doc.userId.toString() } : null;
    },

    releaseToken: async (id) => {
        await PasswordResetToken.updateOne({ _id: id }, { $set: { usedAt: null } });
    },

    updatePasswordHash: async (userId, passwordHash) => {
        const result = kind === "parent"
            ? await Parent.updateOne({ _id: userId }, { $set: { passwordHash } })
            : await User.updateOne({ _id: userId }, { $set: { passwordHash } });
        return result.matchedCount === 1;
    },

    revokeSessions: async (userId) => {
        await Session.deleteMany(kind === "parent" ? { parentId: userId } : { userId });
    },
};
};

export const mongoPasswordResetRepository = createMongoPasswordResetRepository("user");
export const mongoParentPasswordResetRepository = createMongoPasswordResetRepository("parent");

