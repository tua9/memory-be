import { createHash, randomBytes, randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { isValidObjectId, type Types } from "mongoose";
import { env } from "../config/env.js";
import FamilyInvite from "../models/familyInvite.js";
import FamilyLink, { AGE_GROUPS, type AgeGroup, type FamilyLinkDocument } from "../models/familyLink.js";
import LinkCode from "../models/linkCode.js";
import User, { type UserDocument } from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { smtpMailService, type MailService } from "./mail.service.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60_000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const INVITES_PER_DAY = 5;
// Ba, mẹ, ông, bà... đủ cho một gia đình mà vẫn chặn việc một mã bị phát tán
export const MAX_GUARDIANS = 4;

type Id = string | Types.ObjectId;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const isDuplicate = (error: unknown) => (error as { code?: number }).code === 11000;
const bad = (message: string) => new ApiError(StatusCodes.BAD_REQUEST, message);
const conflict = (message: string) => new ApiError(StatusCodes.CONFLICT, message);
const notFound = (message = "Không tìm thấy liên kết") => new ApiError(StatusCodes.NOT_FOUND, message);

const personView = (user: Pick<UserDocument, "_id" | "username" | "avatarUrl"> | null) => user
    ? { _id: user._id.toString(), username: user.username, avatarUrl: user.avatarUrl ?? null }
    : null;

const readUsers = async (ids: Types.ObjectId[]) => {
    const users = await User.find({ _id: { $in: ids } }).select("username avatarUrl").lean();
    return new Map(users.map((user) => [user._id.toString(), user]));
};

const generateCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

const assertGuardianSlot = async (childId: Id) => {
    if (await FamilyLink.countDocuments({ childId }) >= MAX_GUARDIANS) {
        throw conflict(`Mỗi tài khoản chỉ được tối đa ${MAX_GUARDIANS} người theo dõi`);
    }
};

const assertActiveUser = async (userId: Id) => {
    const user = await User.findById(userId).select("username avatarUrl status email");
    if (!user || user.status !== "active") throw bad("Tài khoản này không còn hoạt động");
    return user;
};

// Toàn bộ mục Gia đình trong Hồ sơ: con mình đang theo dõi, người đang theo dõi mình, mã liên kết đang mở
export const getFamily = async (me: Id) => {
    const [asGuardian, asChild, code] = await Promise.all([
        FamilyLink.find({ guardianId: me }).sort({ createdAt: 1 }).lean(),
        FamilyLink.find({ childId: me }).sort({ createdAt: 1 }).lean(),
        LinkCode.findOne({ childId: me, expiresAt: { $gt: new Date() } }).lean(),
    ]);
    const users = await readUsers([...asGuardian.map((link) => link.childId), ...asChild.map((link) => link.guardianId)]);
    const linkView = (link: FamilyLinkDocument, other: Types.ObjectId) => ({
        _id: link._id.toString(), status: link.status, ageGroup: link.ageGroup,
        createdAt: link.createdAt, acceptedAt: link.acceptedAt,
        user: personView(users.get(other.toString()) ?? null),
    });
    return {
        children: asGuardian.map((link) => linkView(link as FamilyLinkDocument, link.childId)).filter((link) => link.user),
        guardians: asChild.map((link) => linkView(link as FamilyLinkDocument, link.guardianId)).filter((link) => link.user),
        code: code ? { code: code.code, expiresAt: code.expiresAt } : null,
        maxGuardians: MAX_GUARDIANS,
    };
};

// Con tạo mã mới; mã cũ (nếu có) mất hiệu lực ngay
export const createLinkCode = async (me: Id) => {
    await LinkCode.init();
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = generateCode();
        const expiresAt = new Date(Date.now() + CODE_TTL_MS);
        try {
            await LinkCode.findOneAndUpdate({ childId: me }, { $set: { code, expiresAt } }, { upsert: true });
            return { code, expiresAt };
        } catch (error) {
            if (!isDuplicate(error)) throw error;
        }
    }
    throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, "Chưa tạo được mã, vui lòng thử lại");
};

export const cancelLinkCode = async (me: Id) => {
    await LinkCode.deleteOne({ childId: me });
};

// Ba mẹ nhập mã con đưa: tạo yêu cầu liên kết chờ con đồng ý. Mã dùng một lần.
export const requestLink = async (me: Id, rawCode: unknown) => {
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    if (!new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code)) throw bad("Mã liên kết gồm 6 ký tự");
    const found = await LinkCode.findOne({ code, expiresAt: { $gt: new Date() } }).lean();
    if (!found) throw bad("Mã liên kết không đúng hoặc đã hết hạn");
    if (found.childId.toString() === me.toString()) throw bad("Đây là mã của chính bạn. Hãy đưa mã cho ba mẹ nhập");
    const existing = await FamilyLink.findOne({ guardianId: me, childId: found.childId }).lean();
    if (existing) throw conflict(existing.status === "active" ? "Bạn đã liên kết với tài khoản này" : "Bạn đã gửi yêu cầu, hãy chờ con đồng ý");
    const child = await assertActiveUser(found.childId);
    await assertGuardianSlot(found.childId);
    // Chỉ một người dùng được mã: ai xoá được bản ghi trước thì người đó thắng
    if (!(await LinkCode.findOneAndDelete({ _id: found._id }))) throw bad("Mã liên kết không đúng hoặc đã hết hạn");
    try {
        const link = await FamilyLink.create({ guardianId: me, childId: found.childId, status: "pending" });
        return { _id: link._id.toString(), status: link.status, user: personView(child) };
    } catch (error) {
        if (isDuplicate(error)) throw conflict("Bạn đã gửi yêu cầu, hãy chờ con đồng ý");
        throw error;
    }
};

// Chỉ con mới đồng ý được yêu cầu gửi tới mình
export const acceptLink = async (me: Id, linkId: unknown) => {
    if (typeof linkId !== "string" || !isValidObjectId(linkId)) throw notFound();
    const updated = await FamilyLink.findOneAndUpdate(
        { _id: linkId, childId: me, status: "pending" },
        { $set: { status: "active", acceptedAt: new Date() } },
        { new: true },
    );
    if (!updated) throw notFound("Không tìm thấy yêu cầu đang chờ");
    return { _id: updated._id.toString(), status: updated.status };
};

// Từ chối, huỷ yêu cầu hoặc gỡ liên kết: bên nào trong liên kết cũng làm được
export const removeLink = async (me: Id, linkId: unknown) => {
    if (typeof linkId !== "string" || !isValidObjectId(linkId)) throw notFound();
    const result = await FamilyLink.deleteOne({ _id: linkId, $or: [{ guardianId: me }, { childId: me }] });
    if (result.deletedCount !== 1) throw notFound();
};

export const sendInvite = async (me: Id, rawEmail: unknown, mailer: MailService = smtpMailService) => {
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Email không hợp lệ");
    const child = await assertActiveUser(me);
    if (child.email === email) throw bad("Hãy nhập email của ba mẹ, không phải email của bạn");
    await assertGuardianSlot(me);
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    if (await FamilyInvite.countDocuments({ childId: me, createdAt: { $gte: since } }) >= INVITES_PER_DAY) {
        throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, `Mỗi ngày chỉ gửi được ${INVITES_PER_DAY} lời mời`);
    }
    const token = randomBytes(32).toString("base64url");
    const invite = await FamilyInvite.create({ childId: me, email, tokenHash: digest(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
    // Token nằm sau dấu # nên không bị gửi lên server hay ghi vào log khi mở link
    const link = `${env.CLIENT_URL.replace(/\/+$/, "")}/family/invite#token=${token}`;
    try {
        await mailer.send({
            to: email,
            subject: `${child.username} mời bạn đồng hành trên Memio`,
            text: `${child.username} mời bạn theo dõi tiến độ luyện trí nhớ trên Memio. Mở liên kết sau (hiệu lực 7 ngày): ${link}`,
            html: `<p><strong>${escapeHtml(child.username)}</strong> mời bạn theo dõi tiến độ luyện trí nhớ trên Memio.</p>`
                + `<p><a href="${link}">Chấp nhận lời mời</a></p><p>Liên kết có hiệu lực 7 ngày. Nếu bạn không quen người gửi, hãy bỏ qua email này.</p>`,
        });
    } catch (error) {
        await FamilyInvite.deleteOne({ _id: invite._id });
        throw error;
    }
    return { sent: true };
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const readInviteToken = (body: unknown) => {
    const token = typeof body === "object" && body !== null ? (body as Record<string, unknown>).token : undefined;
    if (typeof token !== "string" || !/^[\w-]{40,80}$/.test(token)) throw bad("Lời mời không hợp lệ");
    return digest(token);
};

// Xem trước lời mời (ai mời) mà không dùng mất lời mời
export const inspectInvite = async (body: unknown) => {
    const invite = await FamilyInvite.findOne({ tokenHash: readInviteToken(body), expiresAt: { $gt: new Date() } }).lean();
    if (!invite) throw bad("Lời mời không hợp lệ, đã hết hạn hoặc đã được dùng");
    const child = await User.findById(invite.childId).select("username avatarUrl").lean();
    if (!child) throw bad("Lời mời không hợp lệ, đã hết hạn hoặc đã được dùng");
    return { child: personView(child) };
};

// Con là người gửi lời mời nên liên kết có hiệu lực ngay, không cần con đồng ý thêm
export const acceptInvite = async (me: Id, body: unknown) => {
    const tokenHash = readInviteToken(body);
    const invite = await FamilyInvite.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).lean();
    if (!invite) throw bad("Lời mời không hợp lệ, đã hết hạn hoặc đã được dùng");
    if (invite.childId.toString() === me.toString()) throw bad("Đây là lời mời bạn gửi đi. Hãy đăng nhập bằng tài khoản của ba mẹ");
    const child = await assertActiveUser(invite.childId);
    const existing = await FamilyLink.findOne({ guardianId: me, childId: invite.childId }).lean();
    if (!existing) await assertGuardianSlot(invite.childId);
    if (!(await FamilyInvite.findOneAndDelete({ _id: invite._id }))) throw bad("Lời mời không hợp lệ, đã hết hạn hoặc đã được dùng");
    const now = new Date();
    try {
        await FamilyLink.updateOne(
            { guardianId: me, childId: invite.childId },
            { $set: { status: "active", acceptedAt: now }, $setOnInsert: { ageGroup: null } },
            { upsert: true },
        );
    } catch (error) {
        if (!isDuplicate(error)) throw error;
    }
    return { child: personView(child) };
};

// Ba mẹ chỉ xem được con đã đồng ý liên kết và tài khoản con vẫn đang hoạt động
export const requireChildOf = async (me: Id, childId: unknown) => {
    if (typeof childId !== "string" || !isValidObjectId(childId)) throw notFound("Không tìm thấy tài khoản của con");
    const link = await FamilyLink.findOne({ guardianId: me, childId, status: "active" });
    if (!link) throw notFound("Không tìm thấy tài khoản của con");
    const child = await User.findById(childId).select("-passwordHash");
    if (!child || child.status !== "active") throw notFound("Không tìm thấy tài khoản của con");
    return { link, child };
};

export const updateChildAgeGroup = async (me: Id, childId: unknown, value: unknown) => {
    if (value !== null && !(typeof value === "string" && (AGE_GROUPS as readonly string[]).includes(value))) {
        throw bad("Nhóm tuổi không hợp lệ");
    }
    const { link } = await requireChildOf(me, childId);
    link.ageGroup = value as AgeGroup | null;
    await link.save();
    return { ageGroup: link.ageGroup };
};

export const deleteFamilyDataOf = async (userId: Id) => {
    await Promise.all([
        FamilyLink.deleteMany({ $or: [{ guardianId: userId }, { childId: userId }] }),
        LinkCode.deleteMany({ childId: userId }),
        FamilyInvite.deleteMany({ childId: userId }),
    ]);
};
