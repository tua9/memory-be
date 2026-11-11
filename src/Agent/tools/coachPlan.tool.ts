import { StatusCodes } from "http-status-codes";
import User, { type SavedCoachPlan } from "../../models/user.js";
import ApiError from "../../utils/ApiError.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export const parseCoachPlanContent = (value: unknown): string => {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== "content")) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "A plan content field is required");
    }
    if (typeof value.content !== "string") {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Plan content must be text");
    }
    const content = value.content.trim();
    if (!content || content.length > 3000) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Plan content must contain 1 to 3000 characters");
    }
    return content;
};

const getSavedPlan = async (userId: string): Promise<SavedCoachPlan | null> => {
    const user = await User.findById(userId).select("coachPlan").lean<{ coachPlan?: SavedCoachPlan | null }>().exec();
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User was not found");
    return user.coachPlan ?? null;
};

const savePlan = async (userId: string, rawBody: unknown): Promise<SavedCoachPlan> => {
    const content = parseCoachPlanContent(rawBody);
    const user = await User.findByIdAndUpdate(
        userId,
        { $set: { coachPlan: { content, savedAt: new Date() } } },
        { new: true, runValidators: true },
    ).select("coachPlan").lean<{ coachPlan?: SavedCoachPlan | null }>().exec();
    if (!user?.coachPlan) throw new ApiError(StatusCodes.NOT_FOUND, "User was not found");
    return user.coachPlan;
};

export const coachPlanTool = {
    getSavedPlan,
    savePlan,
};
