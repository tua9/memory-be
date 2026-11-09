import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import LoginIdentity from "../models/loginIdentity.js";
import Parent from "../models/parent.js";
import User from "../models/user.js";
import ApiError from "../utils/ApiError.js";

export const reserveLoginEmail = async (email: string, accountType: "user" | "parent", accountId: Types.ObjectId): Promise<void> => {
    await LoginIdentity.init();
    try {
        await LoginIdentity.create({ email, accountType, accountId, expiresAt: new Date(Date.now() + 10 * 60_000) });
    } catch (error) {
        if ((error as { code?: number }).code === 11000) throw new ApiError(StatusCodes.CONFLICT, "Email already exists");
        throw error;
    }
    // Legacy accounts predate login_identities. The reservation blocks all new
    // registrations while this check and account creation run.
    if (await User.exists({ email }) || await Parent.exists({ email })) {
        await LoginIdentity.deleteOne({ email, accountId });
        throw new ApiError(StatusCodes.CONFLICT, "Email already exists");
    }
};

export const releaseLoginEmail = async (email: string, accountId: Types.ObjectId): Promise<void> => {
    await LoginIdentity.deleteOne({ email, accountId });
};

export const confirmLoginEmail = async (email: string, accountId: Types.ObjectId): Promise<void> => {
    await LoginIdentity.updateOne({ email, accountId }, { $unset: { expiresAt: "" } });
};
