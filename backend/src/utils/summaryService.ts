import mongoose from 'mongoose';
import SummaryStats from '../models/SummaryStats';
import CustomRecord from '../models/CustomRecord';
import ModuleDefinition from '../models/ModuleDefinition';
import { normalizeStatusName } from '../routes/dashboardRoutes';

// In-Memory Fast Cache with TTL & Invalidation Tracker
interface CacheEntry {
  data: any;
  timestamp: number;
}

const memoryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30000; // 30 seconds TTL

export class SummaryService {
  /**
   * Log Cache Hit / Miss for transparent audit trail
   */
  private static logCache(type: string, hit: boolean, durationMs: number) {
    if (hit) {
      console.log(`⚡ [CACHE HIT] Serviced ${type} in 0ms (In-Memory Cache)`);
    } else {
      console.log(`🔄 [CACHE MISS] Computed ${type} in ${durationMs}ms`);
    }
  }

  /**
   * Invalidate cache for an organization on data change
   */
  public static invalidateCache(organizationId?: string | mongoose.Types.ObjectId) {
    if (organizationId) {
      const orgStr = organizationId.toString();
      for (const key of memoryCache.keys()) {
        if (key.includes(orgStr)) {
          memoryCache.delete(key);
        }
      }
    } else {
      memoryCache.clear();
    }
    console.log(`🧹 [CACHE INVALIDATED] Cleared summary cache for org: ${organizationId || 'all'}`);
  }

  /**
   * Re-sync / rebuild summary aggregates for an organization
   */
  public static async refreshSummaryAggregates(organizationId: mongoose.Types.ObjectId, moduleId: mongoose.Types.ObjectId) {
    const startTime = Date.now();
    
    // 1. Compute Status Counts via Pipeline
    const statusAgg = await CustomRecord.aggregate([
      { $match: { organizationId, moduleId } },
      {
        $project: {
          st: {
            $ifNull: [
              '$data.normalizedStatus',
              { $ifNull: ['$data.status', { $ifNull: ['$data.dialStatus', '$data.leadStatus'] }] }
            ]
          }
        }
      },
      { $group: { _id: '$st', count: { $sum: 1 } } }
    ]);

    const statusCountsMap = new Map<string, number>();
    statusAgg.forEach(item => {
      if (item._id) {
        const rawName = item._id.toString().trim();
        const canonical = normalizeStatusName(rawName);
        statusCountsMap.set(canonical, (statusCountsMap.get(canonical) || 0) + Number(item.count || 0));
      }
    });

    // Write status summaries to DB
    const bulkOps: any[] = [];
    for (const [key, count] of statusCountsMap.entries()) {
      bulkOps.push({
        updateOne: {
          filter: { organizationId, moduleId, type: 'dashboard_status', key },
          update: { $set: { count, lastUpdated: new Date() } },
          upsert: true
        }
      });
    }

    if (bulkOps.length > 0) {
      await SummaryStats.bulkWrite(bulkOps);
    }

    // Invalidate local memory cache
    this.invalidateCache(organizationId);
    console.log(`✅ [SUMMARY REFRESH] Updated aggregates in ${Date.now() - startTime}ms`);
  }

  /**
   * Get Dashboard Status Metrics from Summary Cache or DB
   */
  public static async getDashboardMetrics(organizationId: mongoose.Types.ObjectId, moduleId: mongoose.Types.ObjectId): Promise<Record<string, number>> {
    const cacheKey = `dashboard_metrics_${organizationId}_${moduleId}`;
    const cached = memoryCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      this.logCache('Dashboard Metrics', true, 0);
      return cached.data;
    }

    const startTime = Date.now();
    let statsDocs = await SummaryStats.find({ organizationId, moduleId, type: 'dashboard_status' }).lean();

    // If summary table is empty for this tenant, compute & seed it
    if (statsDocs.length === 0) {
      await this.refreshSummaryAggregates(organizationId, moduleId);
      statsDocs = await SummaryStats.find({ organizationId, moduleId, type: 'dashboard_status' }).lean();
    }

    const result: Record<string, number> = {};
    statsDocs.forEach(d => {
      result[d.key] = d.count;
    });

    const duration = Date.now() - startTime;
    this.logCache('Dashboard Metrics', false, duration);

    memoryCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }
}
