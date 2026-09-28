import bcrypt from 'bcrypt'
import { createHash, randomUUID } from 'node:crypto'
import { StatusCodes } from 'http-status-codes'
import User from '../models/user.js'
import Session from '../models/sessions.js'
import { JwtProvider } from '../providers/JwtProvider.js'
import { env } from '../config/environment.js'
import ApiError from '../utils/ApiError.js'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')
const buildUserInfo = (user) => ({
  _id: user._id.toString(), email: user.email, fullName: user.fullName,
  status: user.status, role: user.role,
})

const validateCredentials = (body) => {
  const { email, password } = body ?? {}
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'A valid email is required')
  }
  if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is required and must not exceed 72 bytes')
  }
  return { email: email.trim().toLowerCase(), password }
}

const ensureAccountCanSignIn = (user) => {
  if (user.status !== 'active') {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Account is not active')
  }
}

const generateTokens = async (user) => {
  if (!env.ACCESS_TOKEN_SECRET || !env.REFRESH_TOKEN_SECRET ||
      env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Distinct JWT secrets must be configured')
  }
  const sub = user._id.toString()
  const accessToken = await JwtProvider.generateToken(
    { sub, role: user.role, tokenType: 'access', jti: randomUUID() },
    env.ACCESS_TOKEN_SECRET, env.ACCESS_TOKEN_TTL,
  )
  const refreshToken = await JwtProvider.generateToken(
    { sub, tokenType: 'refresh', jti: randomUUID() },
    env.REFRESH_TOKEN_SECRET, env.REFRESH_TOKEN_TTL,
  )
  const access = await JwtProvider.verifyToken(accessToken, env.ACCESS_TOKEN_SECRET)
  const refresh = await JwtProvider.verifyToken(refreshToken, env.REFRESH_TOKEN_SECRET)
  return {
    accessToken, refreshToken,
    accessExpiresAt: new Date(access.exp * 1000),
    refreshExpiresAt: new Date(refresh.exp * 1000),
    userInfo: buildUserInfo(user),
  }
}

const signUp = async (body) => {
  const { email, password } = validateCredentials(body)
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (fullName.length < 2 || fullName.length > 100 || password.length < 8) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Full name must be 2-100 characters and password at least 8 characters')
  }
  if (await User.findOne({ email })) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email already exists')
  }
  const passwordHash = await bcrypt.hash(password, 10)
  try {
    const user = await User.create({ email, fullName, passwordHash, role: 'user', status: 'active' })
    return buildUserInfo(user)
  } catch (error) {
    if (error.code === 11000) throw new ApiError(StatusCodes.CONFLICT, 'Email already exists')
    throw error
  }
}

const signIn = async (body) => {
  const { email, password } = validateCredentials(body)
  const user = await User.findOne({ email })
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid email or password')
  }
  ensureAccountCanSignIn(user)
  const tokens = await generateTokens(user)
  await Session.create({
    userId: user._id, refreshToken: hashToken(tokens.refreshToken),
    expiresAt: tokens.refreshExpiresAt,
  })
  return tokens
}

const refreshToken = async (token) => {
  if (typeof token !== 'string' || !token) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Refresh token is required')
  }
  let payload
  try {
    payload = await JwtProvider.verifyToken(token, env.REFRESH_TOKEN_SECRET)
  } catch (error) {
    if (['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError'].includes(error.name)) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or expired refresh token')
    }
    throw error
  }
  if (payload.tokenType !== 'refresh' || typeof payload.sub !== 'string' || !/^[a-f\d]{24}$/i.test(payload.sub)) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid refresh token')
  }
  const user = await User.findById(payload.sub)
  if (!user) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Account is unavailable')
  ensureAccountCanSignIn(user)
  const tokens = await generateTokens(user)
  // Atomic rotation: only one request can use the old refresh token.
  const session = await Session.findOneAndUpdate(
    { userId: user._id, refreshToken: hashToken(token), expiresAt: { $gt: new Date() } },
    { $set: { refreshToken: hashToken(tokens.refreshToken), expiresAt: tokens.refreshExpiresAt } },
    { new: true, runValidators: true },
  )
  if (!session) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Session expired or revoked')
  return tokens
}

const signOut = async (token) => {
  // Missing or already revoked tokens still allow logout.
  if (typeof token === 'string' && token) {
    await Session.deleteOne({ refreshToken: hashToken(token) })
  }
}

export const authService = { signUp, signIn, signOut, refreshToken }
