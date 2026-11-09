import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import Parent, { AGE_GROUPS, type ParentDocument } from "../models/parent.js";
import ParentVerification from "../models/parentVerification.js";
import Session from "../models/sessions.js";
import User from "../models/user.js";
import { assertValidNewPassword, maskEmail } from "../utils/password.js";
import ApiError from "../utils/ApiError.js";
import { confirmLoginEmail, releaseLoginEmail, reserveLoginEmail } from "./loginIdentity.service.js";
import { smtpMailService, type MailService } from "./mail.service.js";

const TOKEN_TTL_MS = 24 * 60 * 60_000;
const COOLDOWN_MS = 60_000;
const WINDOW_MS = 30 * 60_000;
const MAX_SENDS = 5;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const parentStatus = async (childUserId: string) => {
    const parent = await Parent.findOne({ childUserId }).select("email emailVerifiedAt fullname");
    return parent ? {
        state: parent.emailVerifiedAt ? "verified" : "pending",
        fullname: parent.fullname,
        maskedEmail: maskEmail(parent.email),
    } : { state: "none" };
};

export const sendParentVerification = async (parent: ParentDocument, mailer: MailService = smtpMailService, now = new Date()) => {
    if (parent.emailVerifiedAt) throw new ApiError(StatusCodes.CONFLICT, "Email is already verified");
    try {
        await ParentVerification.updateOne(
            { parentId: parent._id },
            { $setOnInsert: { parentId: parent._id, windowStartedAt: now, sendCount: 0, sending: false } },
            { upsert: true },
        );
    } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
    }
    let previous = await ParentVerification.findOne({ parentId: parent._id });
    if (!previous) throw new Error("Verification state unavailable");
    // An interrupted process must not leave this account permanently locked.
    if (previous.sending && (!previous.sendingStartedAt || now.getTime() - previous.sendingStartedAt.getTime() > COOLDOWN_MS)) {
        await ParentVerification.updateOne(
            { parentId: parent._id, sending: true, sendingStartedAt: previous.sendingStartedAt },
            { $set: { sending: false, sendingStartedAt: null } },
        );
        previous = await ParentVerification.findOne({ parentId: parent._id });
        if (!previous) throw new Error("Verification state unavailable");
    }
    if (previous.sending || (previous.lastSentAt && now.getTime() - previous.lastSentAt.getTime() < COOLDOWN_MS)) {
        throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, "Please wait before resending");
    }
    const freshWindow = now.getTime() - previous.windowStartedAt.getTime() >= WINDOW_MS;
    if (!freshWindow && previous.sendCount >= MAX_SENDS) {
        throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, "Verification email limit reached");
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = digest(token);
    const reserved = await ParentVerification.findOneAndUpdate(
        { parentId: parent._id, sendCount: previous.sendCount, lastSentAt: previous.lastSentAt, sending: false },
        { $set: { sending: true, sendingStartedAt: now, tokenHash, expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
            lastSentAt: now, windowStartedAt: freshWindow ? now : previous.windowStartedAt,
            sendCount: freshWindow ? 1 : previous.sendCount + 1 } },
        { new: true },
    );
    if (!reserved) throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, "Please wait before resending");
    try {
        const link = `${env.CLIENT_URL.replace(/\/+$/, "")}/parent/verify#token=${token}`;
        await mailer.send({
            to: parent.email,
            subject: "Xác minh tài khoản phụ huynh Memio",
            text: `Chọn liên kết để xác minh tài khoản phụ huynh (hiệu lực 24 giờ): ${link}`,
            html: `<p>Vui lòng xác minh tài khoản phụ huynh Memio trong 24 giờ.</p><p><a href="${link}">Xác minh email</a></p>`,
        });
        await ParentVerification.updateOne({ parentId: parent._id, tokenHash, sending: true }, { $set: { sending: false, sendingStartedAt: null } });
    } catch (error) {
        await ParentVerification.updateOne({ parentId: parent._id, tokenHash, sending: true }, {
            $set: { tokenHash: previous.tokenHash, expiresAt: previous.expiresAt,
                lastSentAt: previous.lastSentAt, windowStartedAt: previous.windowStartedAt,
                sendCount: previous.sendCount, sending: false, sendingStartedAt: null },
        });
        throw error;
    }
    return { maskedEmail: maskEmail(parent.email), resendAfterSeconds: COOLDOWN_MS / 1000 };
};

export const registerParent = async (childUserId: string, body: unknown, mailer: MailService = smtpMailService) => {
    const data = record(body);
    const fullname = typeof data.fullname === "string" ? data.fullname.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (fullname.length < 2 || fullname.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Valid parent name and email are required");
    }
    const password = assertValidNewPassword(data.password, data.confirmPassword);
    if (await Parent.exists({ childUserId })) throw new ApiError(StatusCodes.CONFLICT, "This child already has a parent account");
    const child = await User.findById(childUserId);
    if (!child) throw new ApiError(StatusCodes.NOT_FOUND, "Child account not found");
    if (child.email === email) throw new ApiError(StatusCodes.CONFLICT, "Parent email must differ from child email");
    const accountId = new Types.ObjectId();
    const passwordHash = await bcrypt.hash(password, 10);
    await Parent.init();
    await reserveLoginEmail(email, "parent", accountId);
    let parent: ParentDocument;
    try {
        parent = await Parent.create({ _id: accountId, childUserId: child._id, fullname, email, passwordHash });
    } catch (error) {
        await releaseLoginEmail(email, accountId);
        if ((error as { code?: number }).code === 11000) throw new ApiError(StatusCodes.CONFLICT, "This child already has a parent account");
        throw error;
    }
    await confirmLoginEmail(email, accountId).catch(() => undefined);
    // Account remains pending if SMTP is unavailable; the child can retry sending.
    await sendParentVerification(parent, mailer);
    return { state: "pending", maskedEmail: maskEmail(email) };
};

export const resendParentVerification = async (childUserId: string, mailer: MailService = smtpMailService) => {
    const parent = await Parent.findOne({ childUserId });
    if (!parent) throw new ApiError(StatusCodes.NOT_FOUND, "Parent account not found");
    return sendParentVerification(parent, mailer);
};

const readToken = (body: unknown): string => {
    const token = record(body).token;
    if (typeof token !== "string" || !/^[\w-]{40,80}$/.test(token)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid verification link");
    }
    return token;
};

export const inspectParentVerification = async (body: unknown) => {
    const state = await ParentVerification.findOne({ tokenHash: digest(readToken(body)), expiresAt: { $gt: new Date() }, sending: false });
    if (!state) throw new ApiError(StatusCodes.BAD_REQUEST, "Verification link is invalid or expired");
    return { valid: true };
};

export const confirmParentVerification = async (body: unknown) => {
    const state = await ParentVerification.findOneAndUpdate(
        { tokenHash: digest(readToken(body)), expiresAt: { $gt: new Date() }, sending: false },
        { $set: { tokenHash: null, expiresAt: null } }, { new: false },
    );
    if (!state) throw new ApiError(StatusCodes.BAD_REQUEST, "Verification link is invalid or expired");
    await Parent.updateOne({ _id: state.parentId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
};

export const changeParentPassword = async (parent: ParentDocument, body: unknown) => {
    const data = record(body);
    const next = assertValidNewPassword(data.newPassword, data.confirmPassword);
    if (typeof data.currentPassword !== "string" || !(await bcrypt.compare(data.currentPassword, parent.passwordHash))) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Current password is incorrect");
    }
    if (await bcrypt.compare(next, parent.passwordHash)) throw new ApiError(StatusCodes.BAD_REQUEST, "New password must differ");
    parent.passwordHash = await bcrypt.hash(next, 10);
    await parent.save();
    await Session.deleteMany({ parentId: parent._id });
};

export const updateParentAgeGroup = async (parent: ParentDocument, value: unknown) => {
    if (value !== null && !(typeof value === "string" && (AGE_GROUPS as readonly string[]).includes(value))) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid age group");
    }
    parent.ageGroup = value as ParentDocument["ageGroup"];
    await parent.save();
    return { ageGroup: parent.ageGroup };
};
