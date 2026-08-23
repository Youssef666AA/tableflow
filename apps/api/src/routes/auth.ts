import { Router } from 'express';
import { changePasswordSchema, loginSchema, refreshSchema, registerSchema } from '@tableflow/shared';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { changePassword, getSessionUser, login, logout, refresh, register } from '../services/auth.js';

export const authRouter: Router = Router();

const REFRESH_COOKIE = 'tf_refresh';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.isProduction,
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
};

authRouter.post(
  '/login',
  rateLimits.login,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login({ email: req.body.email, password: req.body.password, req });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  }),
);

authRouter.post(
  '/register',
  rateLimits.login,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await register({ ...req.body, req });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.status(201).json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  }),
);

authRouter.post(
  '/refresh',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const token = req.body.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (!token) throw AppError.unauthorized('No refresh token provided.');

    const result = await refresh({ token, req });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.body?.refreshToken as string | undefined) ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    await logout({ token, userId: req.auth?.userId ?? null, req });
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: await getSessionUser(req.auth!.membershipId) });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await changePassword({
      userId: req.auth!.userId,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      req,
    });
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  }),
);
