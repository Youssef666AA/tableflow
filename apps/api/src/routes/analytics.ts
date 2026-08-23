import { Router } from 'express';
import { dateRangeSchema, resolveRange } from '@tableflow/shared';
import type { Request } from 'express';
import { AppError } from '../lib/errors.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler, validate } from '../middleware/common.js';
import {
  getBranchComparison,
  getCategoryRevenue,
  getInventoryConsumption,
  getKitchenPerformance,
  getOrdersByHour,
  getOverview,
  getProductPerformance,
  getReviewSummary,
  getSalesSeries,
  getServiceResponse,
  getTableAnalytics,
  getWasteAnalytics,
} from '../services/analytics.js';

export const analyticsRouter: Router = Router();

analyticsRouter.use(authenticate, requirePermission('analytics:view'));

/**
 * `branchId=all` fans out across every branch the caller can see; anything else
 * must be a branch they are actually scoped to.
 */
function scopeOf(req: Request): { branchIds: string[]; from: Date; to: Date } {
  const query = req.query as unknown as { range: 'today' | '7d' | '30d' | '90d' | 'custom'; from?: Date; to?: Date; branchId?: string };
  const requested = typeof req.query.branchId === 'string' ? req.query.branchId : 'all';

  const branchIds =
    requested === 'all'
      ? req.auth!.branchIds
      : req.auth!.branchIds.includes(requested)
        ? [requested]
        : (() => {
            throw AppError.forbidden('You do not have access to this branch.');
          })();

  if (branchIds.length === 0) throw AppError.forbidden('Your account is not assigned to any branch.');

  const { from, to } = resolveRange(query.range, query.from, query.to);
  return { branchIds, from, to };
}

const rangeValidator = validate(dateRangeSchema.passthrough(), 'query');

analyticsRouter.get(
  '/overview',
  rangeValidator,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const [overview, sales, ordersByHour, products, categories, alerts] = await Promise.all([
      getOverview(scope),
      getSalesSeries(scope),
      getOrdersByHour(scope),
      getProductPerformance({ ...scope, limit: 6 }),
      getCategoryRevenue(scope),
      getReviewSummary(scope),
    ]);

    res.json({
      scope: { branchIds: scope.branchIds, from: scope.from, to: scope.to },
      overview,
      sales,
      ordersByHour,
      topProducts: products.best,
      categories,
      reviews: alerts,
    });
  }),
);

analyticsRouter.get(
  '/sales',
  rangeValidator,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const granularity = req.query.granularity === 'hour' ? 'hour' : req.query.granularity === 'day' ? 'day' : undefined;
    const [series, ordersByHour, products, categories, branches] = await Promise.all([
      getSalesSeries({ ...scope, granularity }),
      getOrdersByHour(scope),
      getProductPerformance({ ...scope, limit: 10 }),
      getCategoryRevenue(scope),
      getBranchComparison(scope),
    ]);
    res.json({ series, ordersByHour, products, categories, branches });
  }),
);

analyticsRouter.get(
  '/kitchen',
  rangeValidator,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const [kitchen, service] = await Promise.all([getKitchenPerformance(scope), getServiceResponse(scope)]);
    res.json({ kitchen, service });
  }),
);

analyticsRouter.get(
  '/tables',
  rangeValidator,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.json({ tables: await getTableAnalytics(scope) });
  }),
);

analyticsRouter.get(
  '/inventory',
  rangeValidator,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const [waste, consumption] = await Promise.all([getWasteAnalytics(scope), getInventoryConsumption(scope)]);
    res.json({ waste, consumption });
  }),
);

analyticsRouter.get(
  '/reviews',
  rangeValidator,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    res.json({ summary: await getReviewSummary(scope) });
  }),
);
