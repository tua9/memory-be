import { asyncHandler } from '../middlewares/asyncHandler.js'
import { StatusCodes } from 'http-status-codes'
import { env } from '../config/environment.js'
import { authService } from '../services/user.service.js'

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.BUILD_MODE === 'production',
  sameSite: 'lax',
  path: '/',
}

const setAuthCookies = (res, tokens) => {
  res.cookie('accessToken', tokens.accessToken, {
    ...BASE_COOKIE_OPTIONS, expires: tokens.accessExpiresAt,
  })
  res.cookie('refreshToken', tokens.refreshToken, {
    ...BASE_COOKIE_OPTIONS, expires: tokens.refreshExpiresAt,
  })
}

export const signUp = asyncHandler(async (req, res) => {
  const userInfo = await authService.signUp(req.body)
  res.status(StatusCodes.CREATED).json({
    status: 'success', message: 'Sign up successful', data: { userInfo },
  })
})

export const signIn = asyncHandler(async (req, res) => {
  const tokens = await authService.signIn(req.body)
  setAuthCookies(res, tokens)
  res.status(StatusCodes.OK).json({
    status: 'success', message: 'Sign in successful', data: { userInfo: tokens.userInfo },
  })
})

export const refresh = asyncHandler(async (req, res) => {
  const tokens = await authService.refreshToken(req.cookies?.refreshToken)
  setAuthCookies(res, tokens)
  res.status(StatusCodes.OK).json({
    status: 'success', message: 'Token refreshed', data: { userInfo: tokens.userInfo },
  })
})

export const signOut = asyncHandler(async (req, res) => {
  await authService.signOut(req.cookies?.refreshToken)
  res.clearCookie('accessToken', BASE_COOKIE_OPTIONS)
  res.clearCookie('refreshToken', BASE_COOKIE_OPTIONS)
  res.status(StatusCodes.OK).json({ status: 'success', message: 'Sign out successful' })
})
