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
import * as matchmaking from "../src/services/matchmaking.service.js";
import MatchTicket from "../src/models/matchTicket.js";
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

        await context.test("rooms hold 2 to 5 players; when everyone is ready the match starts 5 seconds later", async () => {
            const setup = { gameName: "number", mode: "level", gameLevel: 1, roundCount: 1 };
            await assert.rejects(rooms.createRoom(stranger, { ...setup, capacity: 6 }), /từ 2 đến 5/);
            const created = await rooms.createRoom(stranger, { ...setup, capacity: 3 });
            const code = created.code;
            assert.equal(created.isHost, true);
            assert.equal(created.capacity, 3);
            // Phòng tự tạo không đếm ngược và không mở cho ghép trận nhanh
            assert.equal(created.searchEndsAt, null);
            await assert.rejects(rooms.getRoom(code, guardian), /Không tìm thấy phòng/);
            await rooms.joinRoom(code, guardian);
            assert.equal((await rooms.setReady(code, stranger, {})).startsAt, null);
            const twoReady = await rooms.setReady(code, guardian, {});
            const wait = new Date(twoReady.startsAt!).getTime() - Date.now();
            assert.ok(wait > 3_000 && wait <= 5_000, String(wait));
            // Người mới vào chưa sẵn sàng thì huỷ hẹn giờ; sẵn sàng thì hẹn lại
            assert.equal((await rooms.joinRoom(code, child)).startsAt, null);
            assert.ok((await rooms.setReady(code, child, {})).startsAt);
            await GameRoom.updateOne({ code }, { $set: { startsAt: new Date(Date.now() - 1_000) } });
            const started = await rooms.getRoom(code, child);
            assert.equal(started.state, "memorizing");
            assert.equal(started.round?.items?.length, started.rules.totalItems);
            const revision = (await rooms.getRoom(code, guardian)).revision;
            assert.equal((await rooms.getRoom(code, stranger)).revision, revision);

            // Chủ phòng rời giữa trận: người vào sớm nhất còn lại làm chủ phòng, trận chơi tiếp
            const digits = started.round!.items!.map((item) => item.code);
            await rooms.leaveRoom(code, stranger);
            const playing = await rooms.getRoom(code, guardian);
            assert.equal(playing.isHost, true);
            assert.equal(playing.state, "memorizing");
            assert.equal(playing.players.find((player) => player._id === stranger._id.toString())?.left, true);
            await rooms.enterRecallPhase(code, guardian);
            await rooms.enterRecallPhase(code, child);
            await rooms.submitAnswers(code, guardian, { answers: digits });
            // Có trả lời nhưng sai hết: vẫn tính là có thi đấu
            const result = await rooms.submitAnswers(code, child, { answers: digits.map((digit) => String((Number(digit) + 1) % 10)) });
            assert.equal(result.state, "round_result");
            assert.equal(result.round?.result?.players.length, 2);
            await assert.rejects(rooms.finishRoom(code, child), /chủ phòng/);
            const done = await rooms.finishRoom(code, guardian);
            assert.equal(done.state, "completed");
            assert.equal(done.history[0].winner, guardian._id.toString());
            // 3 người: hạng 1 +2, hạng 2 giữ nguyên, người rời trận xếp cuối -1
            const standing = Object.fromEntries(done.players.map((player) => [player.username, [player.place, player.cups]]));
            assert.deepEqual(standing, { me: [1, 2], con: [2, 0], "nguoi-la": [3, -1] });
            const matchId = (await GameRoom.findOne({ code }))!.matchId;
            assert.equal(await RoomResult.countDocuments({ roomId: matchId }), 3);
            assert.equal((await rooms.getRoomStats(stranger)).cups, -1);
            assert.equal((await rooms.getRoomStats(guardian)).cups, 2);
            const overview = (await import("../src/services/familyReport.service.js")).getChildOverview;
            assert.equal((await overview(guardian._id.toString(), child, null)).together.matches, 1);
            const board = await rooms.getLeaderboard(guardian);
            const mine = board.entries.find((entry) => entry.isMe);
            assert.ok(mine && mine.cups === 2);
            assert.equal(board.me.rank, mine.rank);

            // Chơi lại: chỉ chủ phòng mở được, người đã rời không vào trận mới
            await assert.rejects(rooms.rematch(code, child, {}), /chủ phòng/);
            const again = await rooms.rematch(code, guardian, { gameName: "card", mode: "level", gameLevel: 1, roundCount: 1 });
            assert.equal(again.state, "waiting");
            assert.equal(again.gameName, "card");
            assert.deepEqual(again.players.map((player) => player.username).sort(), ["con", "me"]);
            assert.ok(again.players.every((player) => !player.ready && !player.left));

            // Phòng đấu không đụng tới tiến độ cá nhân
            assert.equal(await GameSession.countDocuments({ userId: { $in: ids } }), 0);
            assert.equal(await UserGameProgress.countDocuments({ userId: { $in: ids } }), 0);
        });

        await context.test("blank answers are filled after the grace period; the last player left ends the match", async () => {
            const { code } = await rooms.createRoom(guardian, { gameName: "number", mode: "level", gameLevel: 1, roundCount: 2 });
            await rooms.joinRoom(code, child);
            await rooms.setReady(code, guardian, {});
            await rooms.setReady(code, child, {});
            await GameRoom.updateOne({ code }, { $set: { startsAt: new Date(Date.now() - 1_000) } });
            assert.equal((await rooms.getRoom(code, child)).state, "memorizing");
            const expired = new Date(Date.now() - 10_000);
            await GameRoom.updateOne({ code }, { $set: { "rounds.0.memorizeEndsAt": expired, "rounds.0.recallEndsAt": expired } });
            const timeout = await rooms.getRoom(code, child);
            assert.equal(timeout.round?.result?.outcome, "draw");
            // Không dừng giữa chừng được: ai muốn thôi thì rời trận
            await assert.rejects(rooms.finishRoom(code, guardian), /vòng cuối/);
            await rooms.leaveRoom(code, guardian);
            const end = await rooms.getRoom(code, child);
            assert.equal(end.state, "completed");
            assert.equal(end.isHost, true);
            // Không ai thi đấu thật (bài trắng) nên không ai được cộng; người rời vẫn bị trừ
            assert.deepEqual(Object.fromEntries(end.players.map((player) => [player.username, player.cups])), { me: -1, con: 0 });

            // Phòng đang chờ: chủ phòng rời thì người còn lại làm chủ; người cuối cùng rời thì phòng đóng
            const waiting = await rooms.createRoom(child, { gameName: "card", mode: "level", gameLevel: 1, roundCount: 1 });
            await rooms.joinRoom(waiting.code, stranger);
            await rooms.leaveRoom(waiting.code, child);
            const moved = await rooms.getRoom(waiting.code, stranger);
            assert.equal(moved.state, "waiting");
            assert.equal(moved.isHost, true);
            assert.equal(moved.players.length, 1);
            await assert.rejects(rooms.getRoom(waiting.code, child), /Không tìm thấy phòng/);
            assert.equal((await rooms.leaveRoom(waiting.code, stranger)).state, "cancelled");
        });

        await context.test("quick match joins an open room at random, otherwise pairs searchers into a 5-seat room", async () => {
            assert.deepEqual(await matchmaking.pollMatch(child), { status: "idle" });
            assert.equal((await matchmaking.findMatch(child, { gameName: "card" })).status, "searching");
            // Khác trò thì không ghép
            assert.equal((await matchmaking.findMatch(stranger, { gameName: "word" })).status, "searching");
            const paired = await matchmaking.findMatch(stranger, { gameName: "card" });
            assert.equal(paired.status, "matched");
            const code = (paired as { code: string }).code;
            assert.deepEqual(await matchmaking.pollMatch(child), { status: "matched", code });
            assert.deepEqual(await matchmaking.pollMatch(child), { status: "idle" });
            const room = await rooms.getRoom(code, child);
            assert.equal(room.players.length, 2);
            assert.equal(room.capacity, 5);
            assert.equal(room.isHost, true);
            assert.equal(room.startsAt, null);
            assert.equal(room.rules.gameLevel, 1);
            // Phòng ghép còn mở 60 giây: người tìm cùng trò vào thẳng phòng này
            assert.ok(room.searchEndsAt && new Date(room.searchEndsAt).getTime() - Date.now() > 55_000);
            assert.deepEqual(await matchmaking.findMatch(guardian, { gameName: "card" }), { status: "matched", code });
            assert.equal((await rooms.getRoom(code, child)).players.length, 3);
            // Chủ phòng thôi tìm thì phòng không nhận người ghép nhanh nữa
            assert.equal((await rooms.setSearching(code, child, { searching: false })).searchEndsAt, null);

            // Huỷ tìm trận
            await matchmaking.findMatch(guardian, { gameName: "number" });
            assert.deepEqual(await matchmaking.cancelMatch(guardian), { status: "idle" });
            assert.deepEqual(await matchmaking.pollMatch(guardian), { status: "idle" });

            // Phòng tự tạo: bấm tìm người chơi thì mở 60 giây, bấm lại không gia hạn
            const own = await rooms.createRoom(stranger, { gameName: "image", mode: "level", gameLevel: 2, roundCount: 1, capacity: 4 });
            await assert.rejects(rooms.setSearching(own.code, child, {}), /Không tìm thấy phòng/);
            const hosting = await rooms.setSearching(own.code, stranger, {});
            const window = new Date(hosting.searchEndsAt!).getTime() - Date.now();
            assert.ok(window > 55_000 && window <= 60_000, String(window));
            const again = await rooms.setSearching(own.code, stranger, {});
            assert.equal(new Date(again.searchEndsAt!).getTime(), new Date(hosting.searchEndsAt!).getTime());
            // Khác trò thì không vào phòng này; bất kỳ trò nào thì vào
            assert.equal((await matchmaking.findMatch(child, { gameName: "word" })).status, "searching");
            assert.deepEqual(await matchmaking.findMatch(guardian, { gameName: "any" }), { status: "matched", code: own.code });
            const joined = await rooms.getRoom(own.code, stranger);
            assert.equal(joined.players.length, 2);
            assert.equal(new Date(joined.searchEndsAt!).getTime(), new Date(hosting.searchEndsAt!).getTime());
            // Hết 60 giây: phòng thôi nhận người ghép nhanh
            await GameRoom.updateOne({ code: own.code }, { $set: { searchEndsAt: new Date(Date.now() - 1_000) } });
            await matchmaking.cancelMatch(child);
            assert.equal((await matchmaking.findMatch(child, { gameName: "image" })).status, "searching");
            await MatchTicket.deleteMany({ userId: { $in: ids } });

            // Bất kỳ trò nào: ghép với người đang tìm một trò cụ thể, phòng lấy trò của người kia
            assert.equal((await matchmaking.findMatch(guardian, { gameName: "word" })).status, "searching");
            const anyPair = await matchmaking.findMatch(child, { gameName: "any" });
            assert.equal(anyPair.status, "matched");
            const anyRoom = await rooms.getRoom((anyPair as { code: string }).code, child);
            assert.equal(anyRoom.gameName, "word");
            assert.equal(anyRoom.players.length, 2);
            // Mỗi người chơi kèm số trận và số cúp của mình
            assert.ok(anyRoom.players.every((player) => Number.isInteger(player.stats.matches) && Number.isInteger(player.stats.cups)));
            assert.equal(anyRoom.players.find((player) => player._id === stranger._id.toString()), undefined);
            await matchmaking.pollMatch(guardian);
            await rooms.setSearching(anyRoom.code, guardian, { searching: false });

            // Ba người tìm cùng lúc: hai người ghép thành phòng, người thứ ba vào luôn phòng đang mở đó
            const first = await matchmaking.findMatch(guardian, { gameName: "facename" });
            const racing = await Promise.all([matchmaking.findMatch(child, { gameName: "facename" }), matchmaking.findMatch(stranger, { gameName: "facename" })]);
            const polled = await Promise.all([guardian, child, stranger].map((user) => matchmaking.pollMatch(user)));
            // Mã phòng đến từ câu trả lời lúc tìm (người ghép người khác) hoặc lúc hỏi lại (người được ghép)
            const outcome = [first, ...racing].map((item, index) => item.status === "matched" ? item : polled[index]);
            const codes = outcome.filter((item) => item.status === "matched").map((item) => (item as { code: string }).code);
            assert.equal(codes.length, 3, JSON.stringify(outcome));
            assert.equal(new Set(codes).size, 1);
            assert.equal((await rooms.getRoom(codes[0], guardian)).players.length, 3);
            await MatchTicket.deleteMany({ userId: { $in: ids } });
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
            MatchTicket.deleteMany({ userId: { $in: ids } }),
            User.deleteMany({ _id: { $in: ids } }),
        ]);
        await mongoose.disconnect();
    }
});
