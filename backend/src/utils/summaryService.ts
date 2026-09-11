import mongoose from 'mongoose';
import SummaryStats from '../models/SummaryStats';
import CustomRecord from '../models/CustomRecord';
import ModuleDefinition from '../models/ModuleDefinition';
import { normalizeStatusName } from '../routes/dashboardRoutes';

// In-Memory Fast Cache with TTL & Invalidation Tracker
interface CacheEntry {
  data: any;
  timestamp: number;
  customTtl?: number;
  isStale?: boolean;
}

const memoryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 600000; // 10 minutes default TTL (with background refresh on stale)

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
   * Marks cache entries as stale so clients still get 0ms response while fresh data is generated in background
   */
  public static invalidateCache(organizationId?: string | mongoose.Types.ObjectId, hard = false) {
    if (organizationId) {
      const orgStr = organizationId.toString();
      for (const [key, entry] of memoryCache.entries()) {
        if (key.includes(orgStr)) {
          if (hard) {
            memoryCache.delete(key);
          } else {
            entry.isStale = true;
            entry.timestamp = 0; // Mark stale for background refresh
          }
        }
      }
    } else {
      if (hard) {
        memoryCache.clear();
      } else {
        for (const entry of memoryCache.values()) {
          entry.isStale = true;
          entry.timestamp = 0;
        }
      }
    }
    console.log(`🧹 [CACHE ${hard ? 'CLEARED' : 'MARKED STALE'}] Summary cache for org: ${organizationId || 'all'}`);
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

  /**
   * Generic In-Memory Cache Helper (Fast sub-millisecond retrieval)
   * If allowStale is true, returns cached data even if expired or stale so the response is 0ms instant
   */
  public static getCache(key: string, allowStale = false): any | null {
    const cached = memoryCache.get(key);
    if (!cached) return null;
    const ttl = cached.customTtl || CACHE_TTL_MS;
    const isFresh = !cached.isStale && (Date.now() - cached.timestamp < ttl);
    if (isFresh) {
      this.logCache(key, true, 0);
      return cached.data;
    }
    if (allowStale && cached.data) {
      this.logCache(`${key} (STALE-SERVED)`, true, 0);
      return { data: cached.data, isStale: true };
    }
    memoryCache.delete(key);
    return null;
  }

  public static setCache(key: string, data: any, customTtl?: number) {
    memoryCache.set(key, { data, timestamp: Date.now(), customTtl, isStale: false });
  }
}
