import JWT, { type JwtPayload, type Secret, type SignOptions } from "jsonwebtoken";

const generateToken = async (
    payload: JwtPayload,
    secretKey: Secret,
    tokenLife: SignOptions["expiresIn"],
): Promise<string> => JWT.sign(payload, secretKey, {
    algorithm: "HS256",
    expiresIn: tokenLife,
});

const verifyToken = async (token: string, secretKey: Secret): Promise<JwtPayload> => {
    const payload = JWT.verify(token, secretKey, { algorithms: ["HS256"] });
    if (typeof payload === "string") {
        throw new Error("JWT payload must be an object");
    }
    return payload;
};

export const JwtProvider = { generateToken, verifyToken };