import "./helpers/testEnv.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import mongoose from "mongoose";
import FamilyInvite from "../src/models/familyInvite.js";
import FamilyLink from "../src/models/familyLink.js";
import GameRoom from "../src/models/gameRoom.js";
import LinkCode from "../src/models/linkCode.js";
import RoomResult from "../src/models/roomResult.js";
import User, { type UserDocument } from "../src/models/user.js";
import UserGameProgress from "../src/models/userGameProgress.js";
import GameSession from "../src/models/gameSession.js";
import { authService } from "../src/services/user.service.js";
import * as family from "../src/services/family.service.js";
import { getChildReport } from "../src/services/familyReport.service.js";
import * as rooms from "../src/services/gameRoom.service.js";
import type { MailMessage } from "../src/services/mail.service.js";
import { connectTestDB } from "./helpers/testDbGuard.js";

const password = "FamilyPassword-2026!";

test("family links and game rooms on isolated MongoDB", { skip: !process.env.MONGODB_TEST_CONNECTION_STRING }, async (context) => {
    await connectTestDB();
    const marker = randomUUID();
    const signUp = async (name: string) => {
        const info = await authService.signUp({ email: `${name}-${marker}@test.invalid`, password, username: name });
        return (await User.findById(info._id)) as UserDocument;
    };
    const child = await signUp("con");
    const guardian = await signUp("me");
    const stranger = await signUp("nguoi-la");
    const ids = [child._id, guardian._id, stranger._id];
    const sent: MailMessage[] = [];
    const mailer = { send: async (message: MailMessage) => { sent.push(message); } };

    try {
        await context.test("a link code needs the child's approval and works only once", async () => {
            const { code } = await family.createLinkCode(child._id);
            assert.match(code, /^[A-Z2-9]{6}$/);
            assert.equal((await family.getFamily(child._id)).code?.code, code);
            await assert.rejects(family.requestLink(child._id, code), /chính bạn/);
            const request = await family.requestLink(guardian._id, code.toLowerCase());
            assert.equal(request.status, "pending");
            await assert.rejects(family.requestLink(stranger._id, code), /không đúng hoặc đã hết hạn/);
            // Chưa đồng ý thì ba mẹ chưa xem được gì
            await assert.rejects(family.requireChildOf(guardian._id, child._id.toString()));
            await assert.rejects(family.acceptLink(guardian._id, request._id), /đang chờ/);
            await family.acceptLink(child._id, request._id);
            const { link } = await family.requireChildOf(guardian._id, child._id.toString());
            assert.equal(link.status, "active");
            await assert.rejects(family.requireChildOf(stranger._id, child._id.toString()));
            const view = await family.getFamily(child._id);
            assert.equal(view.guardians[0].user?.username, "me");
            assert.equal(view.code, null);
        });

        await context.test("the child can remove a guardian, and an email invite links immediately", async () => {
            const linkId = (await family.getFamily(child._id)).guardians[0]._id;
            await family.removeLink(child._id, linkId);
            await assert.rejects(family.requireChildOf(guardian._id, child._id.toString()));
            await assert.rejects(family.sendInvite(child._id, child.email, mailer), /không phải email của bạn/);
            await family.sendInvite(child._id, guardian.email, mailer);
            const token = sent.at(-1)?.text.match(/#token=([\w-]+)/)?.[1];
            assert.ok(token);
            assert.equal((await family.inspectInvite({ token })).child?.username, "con");
            await assert.rejects(family.acceptInvite(child._id, { token }), /lời mời bạn gửi/);
            await family.acceptInvite(guardian._id, { token });
            await assert.rejects(family.acceptInvite(stranger._id, { token }));
            assert.equal((await family.requireChildOf(guardian._id, child._id.toString())).link.status, "active");
            assert.deepEqual(await family.updateChildAgeGroup(guardian._id, child._id.toString(), "9-12"), { ageGroup: "9-12" });
            const report = await getChildReport(child._id.toString(), "9-12", { period: "week", date: "2026-11-09" }, new Date("2026-11-09T12:00:00+07:00"));
            assert.equal(report.start.toISOString(), "2026-11-08T17:00:00.000Z");
            assert.match(report.suggestions[0].reason, /9-12/);
        });

        await context.test("anyone can host or join a two-player room; polling does not write", async () => {
            const created = await rooms.createRoom(stranger, { gameName: "card", mode: "level", gameLevel: 3, roundCount: 1 });
            const code = created.code;
            assert.equal(created.isHost, true);
            await assert.rejects(rooms.getRoom(code, guardian), /Không tìm thấy phòng/);
            await rooms.joinRoom(code, guardian);
            await assert.rejects(rooms.joinRoom(code, child), /đủ người/);
            await assert.rejects(rooms.startRoom(code, stranger), /sẵn sàng/);
            await rooms.setReady(code, stranger, {});
            await rooms.setReady(code, guardian, {});
            await assert.rejects(rooms.startRoom(code, guardian), /chủ phòng/);
            const started = await rooms.startRoom(code, stranger);
            assert.equal(started.round?.items?.length, started.rules.totalItems);
            const revision = (await rooms.getRoom(code, guardian)).revision;
            assert.equal((await rooms.getRoom(code, stranger)).revision, revision);

            const answers = started.round!.items!.map((item) => item.code);
            const hidden = await rooms.enterRecallPhase(code, guardian);
            assert.equal(hidden.round?.items, undefined);
            await rooms.enterRecallPhase(code, stranger);
            await rooms.submitAnswers(code, stranger, { answers });
            // Nộp ngay sau khi hết giờ vẫn được nhận nhờ thời gian gia hạn
            const late = new Date(Date.now() - 1_000);
            await GameRoom.updateOne({ code }, { $set: { "rounds.0.memorizeEndsAt": late, "rounds.0.recallEndsAt": late } });
            const result = await rooms.submitAnswers(code, guardian, { answers });
            assert.equal(result.state, "round_result");
            assert.equal(result.round?.result?.players.length, 2);
            assert.ok(result.round?.result?.players.every((player) => player.correct === player.total && player.marks.every(Boolean)));
            const done = await rooms.finishRoom(code, stranger);
            assert.equal(done.state, "completed");
            assert.equal(done.pointsEarned, rooms.ROOM_POINTS);
            await rooms.finishRoom(code, stranger);
            assert.equal(await RoomResult.countDocuments({ roomId: (await GameRoom.findOne({ code }))!._id }), 2);
            assert.equal((await rooms.getRoomStats(guardian)).points, rooms.ROOM_POINTS);
            // Phòng đấu không đụng tới tiến độ cá nhân
            assert.equal(await GameSession.countDocuments({ userId: { $in: ids } }), 0);
            assert.equal(await UserGameProgress.countDocuments({ userId: { $in: ids } }), 0);
        });

        await context.test("a missing answer is filled after the grace period; the host leaving cancels", async () => {
            const { code } = await rooms.createRoom(guardian, { gameName: "number", mode: "level", gameLevel: 1, roundCount: 2 });
            await rooms.joinRoom(code, child);
            await rooms.setReady(code, guardian, {});
            await rooms.setReady(code, child, {});
            await rooms.startRoom(code, guardian);
            const expired = new Date(Date.now() - 10_000);
            await GameRoom.updateOne({ code }, { $set: { "rounds.0.memorizeEndsAt": expired, "rounds.0.recallEndsAt": expired } });
            const timeout = await rooms.getRoom(code, child);
            assert.equal(timeout.round?.result?.outcome, "draw");
            await rooms.finishRoom(code, guardian);
            assert.equal((await rooms.getRoom(code, child)).state, "cancelled");
            const overview = (await import("../src/services/familyReport.service.js")).getChildOverview;
            assert.equal((await overview(guardian._id.toString(), child, null)).together.matches, 0);

            const waiting = await rooms.createRoom(child, { gameName: "card", mode: "level", gameLevel: 1, roundCount: 1 });
            await rooms.joinRoom(waiting.code, stranger);
            await rooms.leaveRoom(waiting.code, stranger);
            assert.equal((await rooms.getRoom(waiting.code, child)).players.length, 1);
            await rooms.leaveRoom(waiting.code, child);
            assert.equal((await rooms.getRoom(waiting.code, child)).state, "cancelled");
        });

        await context.test("deleting an account removes its links, codes, invites and rooms", async () => {
            await family.createLinkCode(child._id);
            await authService.deleteAccount(child._id.toString(), { password });
            assert.equal(await FamilyLink.countDocuments({ $or: [{ childId: child._id }, { guardianId: child._id }] }), 0);
            assert.equal(await LinkCode.countDocuments({ childId: child._id }), 0);
            assert.equal(await GameRoom.countDocuments({ "players.userId": child._id }), 0);
        });
    } finally {
        await Promise.all([
            FamilyLink.deleteMany({ $or: [{ childId: { $in: ids } }, { guardianId: { $in: ids } }] }),
            LinkCode.deleteMany({ childId: { $in: ids } }),
            FamilyInvite.deleteMany({ childId: { $in: ids } }),
            GameRoom.deleteMany({ "players.userId": { $in: ids } }),
            RoomResult.deleteMany({ userId: { $in: ids } }),
            User.deleteMany({ _id: { $in: ids } }),
        ]);
        await mongoose.disconnect();
    }
});
