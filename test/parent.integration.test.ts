import "./helpers/testEnv.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import mongoose from "mongoose";
import app from "../src/app.js";
import FamilyRoom from "../src/models/familyRoom.js";
import GameSession from "../src/models/gameSession.js";
import LoginIdentity from "../src/models/loginIdentity.js";
import Parent from "../src/models/parent.js";
import ParentPoints from "../src/models/parentPoints.js";
import ParentVerification from "../src/models/parentVerification.js";
import Session from "../src/models/sessions.js";
import User from "../src/models/user.js";
import UserGameProgress from "../src/models/userGameProgress.js";
import { authService } from "../src/services/user.service.js";
import { getParentReport } from "../src/services/parentReport.service.js";
import {
    confirmParentVerification, inspectParentVerification, registerParent,
    resendParentVerification,
} from "../src/services/parent.service.js";
import {
    createFamilyRoom, decideRoundWinner, finishFamilyRoom, getFamilyRoom, getParentPoints,
    joinFamilyRoom, nextFamilyRound, readyFamilyRoom, recallFamilyRoom,
    startFamilyRoom, submitFamilyRoom,
} from "../src/services/familyRoom.service.js";
import type { MailMessage } from "../src/services/mail.service.js";
import { connectTestDB } from "./helpers/testDbGuard.js";

const password = "ParentPassword-2026!";
const credentials = (email: string) => ({ email, password });
const registration = (email: string) => ({ fullname: "Ba mẹ Memio", email, password, confirmPassword: password });
const tokenFrom = (message: MailMessage) => {
    const token = message.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token);
    return token;
};

test("parent account, verification, permissions and family rooms on isolated MongoDB", { skip: !process.env.MONGODB_TEST_CONNECTION_STRING }, async (context) => {
    await connectTestDB();
    const marker = randomUUID();
    const childEmail = `child-${marker}@test.invalid`;
    const otherEmail = `other-${marker}@test.invalid`;
    const parentEmail = `parent-${marker}@test.invalid`;
    const secondEmail = `second-${marker}@test.invalid`;
    const thirdEmail = `third-${marker}@test.invalid`;
    const emails = [childEmail, otherEmail, parentEmail, secondEmail, thirdEmail];
    const sent: MailMessage[] = [];
    const mailer = { send: async (message: MailMessage) => { sent.push(message); } };
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    let childId = "";
    let otherId = "";
    try {
        await context.test("one child has one parent, with a cross-account email reservation", async () => {
            childId = (await authService.signUp({ ...credentials(childEmail), username: "Con Memio" }))._id;
            otherId = (await authService.signUp({ ...credentials(otherEmail), username: "Con khác" }))._id;
            await assert.rejects(registerParent(childId, registration(childEmail), mailer));
            const created = await registerParent(childId, registration(parentEmail), mailer);
            assert.equal(created.state, "pending");
            assert.equal(sent.length, 1);
            assert.equal(await Parent.countDocuments({ childUserId: childId }), 1);
            const pendingLogin = await authService.signIn(credentials(parentEmail));
            assert.equal(pendingLogin.userInfo.role, "parent");
            assert.equal(pendingLogin.userInfo.isEmailVerified, false);
            const pendingHeaders = { Authorization: `Bearer ${pendingLogin.accessToken}` };
            assert.equal((await fetch(`${base}/parent/overview`, { headers: pendingHeaders })).status, 403);
            assert.equal((await fetch(`${base}/family-rooms`, { method: "POST", headers: { ...pendingHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ gameName: "card", mode: "level", gameLevel: 1, roundCount: 1 }) })).status, 403);
            await authService.signOut(pendingLogin.refreshToken);
            await assert.rejects(authService.signUp({ ...credentials(parentEmail), username: "Trùng email" }));
            await assert.rejects(registerParent(childId, registration(secondEmail), mailer));
            const competing = await Promise.allSettled([
                registerParent(otherId, registration(secondEmail), mailer),
                registerParent(otherId, registration(thirdEmail), mailer),
            ]);
            assert.equal(competing.filter((item) => item.status === "fulfilled").length, 1);
            assert.equal(await Parent.countDocuments({ childUserId: otherId }), 1);
        });

        const parent = await Parent.findOne({ email: parentEmail });
        assert.ok(parent);
        await context.test("verification is single use, rate limited and mail failure preserves the old link", async () => {
            const first = tokenFrom(sent[0]);
            assert.deepEqual(await inspectParentVerification({ token: first }), { valid: true });
            await assert.rejects(resendParentVerification(childId, mailer));
            await ParentVerification.updateOne({ parentId: parent._id }, { $set: { lastSentAt: new Date(Date.now() - 61_000) } });
            await assert.rejects(resendParentVerification(childId, { send: async () => { throw new Error("simulated SMTP failure"); } }));
            assert.deepEqual(await inspectParentVerification({ token: first }), { valid: true });
            await resendParentVerification(childId, mailer);
            const second = tokenFrom(sent.at(-1)!);
            await assert.rejects(inspectParentVerification({ token: first }));
            await confirmParentVerification({ token: second });
            await assert.rejects(confirmParentVerification({ token: second }));
            assert.ok((await Parent.findById(parent._id))?.emailVerifiedAt);
        });

        await context.test("shared login refresh and user-only routes enforce account type", async () => {
            const parentLogin = await authService.signIn({ ...credentials(parentEmail), rememberMe: true });
            assert.equal(parentLogin.userInfo.role, "parent");
            assert.equal(parentLogin.userInfo.isEmailVerified, true);
            assert.equal((await authService.refreshToken(parentLogin.refreshToken)).userInfo.role, "parent");
            const childLogin = await authService.signIn(credentials(childEmail));
            const parentHeaders = { Authorization: `Bearer ${parentLogin.accessToken}` };
            const childHeaders = { Authorization: `Bearer ${childLogin.accessToken}` };
            assert.equal((await fetch(`${base}/profile`, { headers: parentHeaders })).status, 401);
            assert.equal((await fetch(`${base}/parent/overview`, { headers: childHeaders })).status, 401);
            assert.equal((await fetch(`${base}/parent/overview`, { headers: parentHeaders })).status, 200);
            await authService.signOut(parentLogin.refreshToken);
        });

        await context.test("week report uses Vietnam Monday and leaves sparse trends undecided", async () => {
            const report = await getParentReport(parent, { period: "week", date: "2026-11-09" }, new Date("2026-11-09T12:00:00+07:00"));
            assert.equal(report.start.toISOString(), "2026-11-08T17:00:00.000Z");
            assert.equal(report.end.toISOString(), "2026-11-15T17:00:00.000Z");
            assert.equal(report.incomplete, true);
            assert.equal(report.summary.games, 0);
            assert.match(report.comment.trend, /Chưa đủ dữ liệu/);
            assert.match(report.suggestions[0].reason, /chưa khai báo nhóm tuổi/);
        });

        await context.test("all five game engines share a room without EXP, leak or duplicate points", async () => {
            const linked = { role: "parent" as const, parent };
            const child = await User.findById(childId);
            const stranger = await User.findById(otherId);
            assert.ok(child && stranger);
            const player = { role: "child" as const, child };
            for (const gameName of ["card", "image", "number", "facename", "word"] as const) {
                const created = await createFamilyRoom(parent, { gameName, mode: "level", gameLevel: 1, roundCount: 1 });
                const code = created.code;
                await assert.rejects(joinFamilyRoom(code, { role: "child", child: stranger }));
                await joinFamilyRoom(code, player);
                await Promise.all([readyFamilyRoom(code, linked), readyFamilyRoom(code, player)]);
                const started = await startFamilyRoom(code, linked);
                assert.equal(started.round?.items?.length, started.rules.totalItems);
                const answers = started.round!.items!.map((item) => gameName === "facename" || gameName === "word" ? item.label! : item.code);
                const earlyChild = await recallFamilyRoom(code, player);
                assert.equal(earlyChild.round?.items, undefined);
                assert.equal(earlyChild.round?.result, undefined);
                if (gameName === "word") assert.deepEqual(earlyChild.round?.recallOptions, []);
                if (gameName === "facename") assert.ok(earlyChild.round?.recallOptions?.every((item) => !item.label));
                await recallFamilyRoom(code, linked);
                const first = await submitFamilyRoom(code, linked, { answers });
                assert.equal(first.round?.result, undefined);
                assert.equal(first.phase, "waiting_for_other");
                await assert.rejects(submitFamilyRoom(code, linked, { answers }));
                const second = await submitFamilyRoom(code, player, { answers });
                assert.equal(second.state, "round_result");
                assert.equal(second.round?.result?.parent.correct, second.round?.result?.child.correct);
                assert.equal(second.round?.result?.outcome, decideRoundWinner(second.round!.result!.parent, second.round!.result!.child));
                await Promise.all([finishFamilyRoom(code, linked), finishFamilyRoom(code, linked)]);
                assert.equal((await getFamilyRoom(code, player)).state, "completed");
            }
            const abandoned = await createFamilyRoom(parent, { gameName: "card", mode: "level", gameLevel: 1, roundCount: 1 });
            await finishFamilyRoom(abandoned.code, linked);
            assert.equal((await getFamilyRoom(abandoned.code, player)).state, "cancelled");
            const timed = await createFamilyRoom(parent, { gameName: "number", mode: "level", gameLevel: 1, roundCount: 1 });
            await joinFamilyRoom(timed.code, player);
            await Promise.all([readyFamilyRoom(timed.code, linked), readyFamilyRoom(timed.code, player)]);
            await startFamilyRoom(timed.code, linked);
            const expired = new Date(Date.now() - 1_000);
            await FamilyRoom.updateOne({ code: timed.code }, { $set: { "rounds.0.memorizeEndsAt": expired, "rounds.0.recallEndsAt": expired } });
            const timeoutResult = await getFamilyRoom(timed.code, linked);
            assert.equal(timeoutResult.round?.result?.outcome, "draw");
            await finishFamilyRoom(timed.code, linked);
            assert.equal((await getParentPoints(parent)).points, 50);
            assert.equal(await ParentPoints.countDocuments({ parentId: parent._id }), 5);
            assert.equal(await GameSession.countDocuments({ userId: childId }), 0);
            assert.equal(await UserGameProgress.countDocuments({ userId: childId }), 0);
            assert.equal((await User.findById(childId))?.progress.totalGames, 0);
        });
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        const childIds = [childId, otherId].filter(Boolean);
        const parentIds = (await Parent.find({ childUserId: { $in: childIds } }).select("_id")).map((item) => item._id);
        await Promise.all([
            FamilyRoom.deleteMany({ parentId: { $in: parentIds } }), ParentPoints.deleteMany({ parentId: { $in: parentIds } }),
            ParentVerification.deleteMany({ parentId: { $in: parentIds } }), Session.deleteMany({ $or: [{ userId: { $in: childIds } }, { parentId: { $in: parentIds } }] }),
            LoginIdentity.deleteMany({ email: { $in: emails } }), Parent.deleteMany({ _id: { $in: parentIds } }), User.deleteMany({ _id: { $in: childIds } }),
        ]);
        await mongoose.disconnect();
    }
});
