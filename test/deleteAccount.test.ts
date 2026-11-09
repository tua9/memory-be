import "./helpers/testEnv.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcrypt";
import { authService } from "../src/services/user.service.js";
import User from "../src/models/user.js";
import Session from "../src/models/sessions.js";
import GameSession from "../src/models/gameSession.js";
import NumberSession from "../src/models/numberSession.js";
import UserGameProgress from "../src/models/userGameProgress.js";
import PasswordResetToken from "../src/models/passwordResetToken.js";
import PasswordResetLimit from "../src/models/passwordResetLimit.js";
import LoginIdentity from "../src/models/loginIdentity.js";
import FamilyRoom from "../src/models/familyRoom.js";
import ParentPoints from "../src/models/parentPoints.js";
import ParentVerification from "../src/models/parentVerification.js";
import Parent from "../src/models/parent.js";
import ApiError from "../src/utils/ApiError.js";

const USER_ID = "507f1f77bcf86cd799439011";
const PASSWORD = "current-password-123";

type Patchable = Record<string, unknown>;
const MODELS: [string, Patchable][] = [
    ["session", Session as unknown as Patchable],
    ["gameSession", GameSession as unknown as Patchable],
    ["numberSession", NumberSession as unknown as Patchable],
    ["progress", UserGameProgress as unknown as Patchable],
    ["resetToken", PasswordResetToken as unknown as Patchable],
    ["resetLimit", PasswordResetLimit as unknown as Patchable],
    ["loginIdentity", LoginIdentity as unknown as Patchable],
    ["familyRoom", FamilyRoom as unknown as Patchable],
    ["parentPoints", ParentPoints as unknown as Patchable],
    ["parentVerification", ParentVerification as unknown as Patchable],
];
const PARENT_ID = "507f1f77bcf86cd799439022";

// Giả các model: ghi lại thứ tự xoá, khôi phục sau mỗi test
const withMocks = async (user: unknown, run: (calls: string[]) => Promise<void>, parent: unknown = null) => {
    const calls: string[] = [];
    const originals = MODELS.map(([, model]) => model.deleteMany);
    const userModel = User as unknown as Patchable;
    const original = { findById: userModel.findById, deleteOne: userModel.deleteOne };
    const parentModel = Parent as unknown as Patchable;
    const parentOriginal = { findOne: parentModel.findOne, deleteOne: parentModel.deleteOne };
    MODELS.forEach(([name, model]) => {
        model.deleteMany = async () => calls.push(name);
    });
    userModel.findById = async (id: string) => (id === USER_ID ? user : null);
    userModel.deleteOne = async () => calls.push("user");
    parentModel.findOne = () => ({ select: async () => parent });
    parentModel.deleteOne = async () => calls.push("parent");
    try {
        await run(calls);
    } finally {
        MODELS.forEach(([, model], index) => {
            model.deleteMany = originals[index];
        });
        Object.assign(userModel, original);
        Object.assign(parentModel, parentOriginal);
    }
};

test("deleteAccount: wrong or missing password deletes nothing", async () => {
    const user = { _id: USER_ID, passwordHash: await bcrypt.hash(PASSWORD, 4) };
    await withMocks(user, async (calls) => {
        for (const body of [{}, { password: "wrong-password" }]) {
            await assert.rejects(
                () => authService.deleteAccount(USER_ID, body),
                (error: unknown) => error instanceof ApiError && error.statusCode === 400,
            );
        }
        assert.deepEqual(calls, []);
    });
});

test("deleteAccount: revokes sessions first, removes every user collection, then the user", async () => {
    const user = { _id: USER_ID, passwordHash: await bcrypt.hash(PASSWORD, 4) };
    await withMocks(user, async (calls) => {
        await authService.deleteAccount(USER_ID, { password: PASSWORD });
        assert.equal(calls[0], "session");
        assert.equal(calls.at(-1), "user");
        assert.deepEqual([...calls].sort(), ["familyRoom", "gameSession", "loginIdentity", "numberSession", "progress", "resetLimit", "resetToken", "session", "user"]);
    });
});

test("deleteAccount: also removes the linked parent account and its data", async () => {
    const user = { _id: USER_ID, passwordHash: undefined };
    await withMocks(user, async (calls) => {
        await authService.deleteAccount(USER_ID, {});
        assert.equal(calls[0], "session");
        assert.equal(calls.at(-1), "user");
        for (const name of ["parentPoints", "parentVerification", "parent"]) assert.ok(calls.includes(name), name);
        assert.equal(calls.filter((name) => name === "session").length, 2);
        assert.equal(calls.filter((name) => name === "loginIdentity").length, 2);
        assert.ok(calls.indexOf("parent") < calls.indexOf("user"));
    }, { _id: PARENT_ID });
});

test("deleteAccount: a Google account without a password needs no password", async () => {
    await withMocks({ _id: USER_ID, passwordHash: undefined }, async (calls) => {
        await authService.deleteAccount(USER_ID, {});
        assert.equal(calls.at(-1), "user");
    });
});

test("deleteAccount: unknown user is a 404", async () => {
    await withMocks(null, async () => {
        await assert.rejects(
            () => authService.deleteAccount(USER_ID, { password: PASSWORD }),
            (error: unknown) => error instanceof ApiError && error.statusCode === 404,
        );
    });
});
