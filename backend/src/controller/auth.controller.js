import user from "../models/user.js"
import asyncHandler from "../middlewares/asyncHandler.js"
import { StatusCodes } from 'http-status-codes'



const isProduction = env.BUILD_MODE === 'production'

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
}

const AUTH_COOKIE_OPTIONS = {
  ...BASE_COOKIE_OPTIONS,
  maxAge: ms(env.REFRESH_TOKEN_TTL),
}

// Gắn access/refresh token vào cookie (chỉ set token nào được truyền vào)
const setAuthCookies = (res, { accessToken, refreshToken } = {}) => {
  if (accessToken) res.cookie('accessToken', accessToken, AUTH_COOKIE_OPTIONS)
  if (refreshToken) res.cookie('refreshToken', refreshToken, AUTH_COOKIE_OPTIONS)
}

// Xoá cookie auth khi đăng xuất
const clearAuthCookies = (res) => {
  res.clearCookie('accessToken')
  res.clearCookie('refreshToken')
}

export const signOut = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken
  await authService.signOut(refreshToken)

  clearAuthCookies(res)
  res.status(StatusCodes.OK).json({ message: 'Sign out successful' })
})

export const signIn = asyncHandler(async (req, res) => {
  const result = await authService.signIn(req.body)
  const { accessToken, refreshToken, fullName } = result.data

  setAuthCookies(res, { accessToken, refreshToken })

  res.status(StatusCodes.OK).json({
    message: `Sign in successful: User[${fullName}]`,
    ...result // Wrap data as status: success
  })
})