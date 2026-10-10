import mongoose, { type Document } from "mongoose";

export type UserStatus = "active" | "inactive" | "banned";
export type UserRole = "user" | "admin";

export interface UserDocument extends Document {
    username: string;
    email: string;
    passwordHash: string | null;
    status: UserStatus;
    role: UserRole;
}

const userSchema = new mongoose.Schema<UserDocument>(
    {
        username: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 100,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        passwordHash: { type: String, default: null },
        status: {
            type: String,
            enum: ["active", "inactive", "banned"],
            default: "active",
        },
        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user",
        },
    },
    { timestamps: true },
);

const User = mongoose.model<UserDocument>("user", userSchema);
export default User;