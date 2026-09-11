import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import DashboardLayout from '../models/DashboardLayout';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import Activity from '../models/Activity';
import User from '../models/User';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';
import { HierarchyService } from '../utils/hierarchy';
import { SummaryService } from '../utils/summaryService';

import Status from '../models/Status';

export const isCampaignTelephonyStatus = (raw: string): boolean => {
  if (!raw) return false;
  const s = raw.trim().toUpperCase();
  return (
    s === 'CAMPAIGN_DIAL' ||
    s.includes('CALL REJECT') ||
    s.includes('CALL REJECTED') ||
    s.includes('NO ANSWER') ||
    s.includes('NOT INTRESTED') ||
    s.includes('NOT INTERESTED') ||
    s.includes('NOT INTESTED') ||
    s.includes('CALL NOT CONNECT') ||
    s.includes('NOT CONNECTED') ||
    s.includes('WRONG NUM') ||
    s.includes('WRONG NUMBER') ||
    s.includes('NUM NOT EXIT') ||
    s.includes('NOT EXIST') ||
    s.includes('NOT EXISTS') ||
    s.includes('REPEATED NUM') ||
    s.includes('REPEATED NUMBER') ||
    s.includes('NO BUSINESS') ||
    s.includes('COOL LEAD') ||
    s.includes('YET TO CALL') ||
    s.includes('YET TO DIAL')
  );
};

export const normalizeStatusName = (rawSt: string): string => {
  if (!rawSt) return 'PENDING';
  const s = rawSt.trim().toUpperCase();

  // Campaign telephony dial outcomes - strictly separate from loan pipeline stages
  if (s.includes('CALL REJECT') || s.includes('CALL REJECTED')) return 'CALL REJECT';
  if (s.includes('NO ANSWER') || s === 'NO ANSWER') return 'NO ANSWER';
  if (s.includes('NOT INTRESTED') || s.includes('NOT INTERESTED') || s.includes('NOT INTESTED')) return 'NOT INTERESTED';
  if (s.includes('NOT CONNECT') || s.includes('CALL NOT CONNECT')) return 'CALL NOT CONNECT';
  if (s.includes('WRONG NUM') || s.includes('WRONG NUMBER')) return 'WRONG NUM';
  if (s.includes('NUM NOT EXIT') || s.includes('NOT EXIST') || s.includes('NOT EXISTS')) return 'NUM NOT EXIT';
  if (s.includes('REPEATED NUM') || s.includes('REPEATED NUMBER')) return 'REPEATED NUM';
  if (s.includes('NO BUSINESS')) return 'NO BUSINESS';
  if (s.includes('COOL LEAD') || s === 'COOL LEAD') return 'COOL LEAD';

  // Configured Lead Stages
  if (s === 'HOT' || s === 'HOT LEAD' || s === 'HOT LEADS' || s.includes('HOT LEAD')) return 'Hot';
  if (s === 'WARM' || s === 'WARM LEAD' || s === 'WARM LEADS' || s.includes('WARM LEAD')) return 'Warm';
  if (s === 'COLD' || s === 'COLD LEAD' || s === 'COLD LEADS' || s.includes('COLD LEAD')) return 'COLD LEADS';
  if (s.includes('CALL BACK') || s.includes('CAL BACK')) return 'CALL BACK';
  if (s.includes('GIVEN LOGIN')) return 'GIVEN LOGIN';
  if (s.includes('CEBIL') || s.includes('CEDIL') || s.includes('CIVIL') || s.includes('CIBIL')) return 'CIBIL PENDING';
  if (s.includes('DOCUMENT') || s.includes('DOC PENDING')) return 'Document Pending';
  if (s.includes('STATUS PENDING') || s.includes('APPROVAL PENDING') || s === 'APPROVAL PENDING') return 'Status Pending';
  if (s.includes('APPROVED BUT NOT') || s === 'APPROVED BUT NOT DISBUSE' || s === 'APPROVED BUT NOT DISBURSED') return 'Approved';
  if (s === 'APPROVED') return 'Approved';
  if (s.includes('DISBURS') || s.includes('DISBUS')) return 'Disbursed';

  // Strict loan rejection check: Only genuine credit/lead rejections, never telephony calls
  if (s === 'REJECT' || s === 'REJECTED' || s === 'LEAD REJECTED' || s === 'APPLICATION REJECTED' || s === 'CREDIT REJECTED') {
    return 'reject';
  }

  if (s.includes('FOLLOW')) return 'Followup';
  if (s.includes('DROP')) return 'Dropped';
  if (s === 'PENDING') return 'Pending';
  if (s.includes('YET TO CALL') || s.includes('YET TO DIAL')) return 'YET TO CALL';

  return s;
};

export const matchStatusToConfigured = (rawName: string, configuredStatuses: any[]): string | null => {
  if (!rawName) return null;
  const clean = rawName.trim();
  const upper = clean.toUpperCase();

  // 1. Exact name match (case-insensitive)
  const exact = configuredStatuses.find(c => (c.name || '').trim().toUpperCase() === upper);
  if (exact) return exact.name;

  // 2. Canonical synonyms matching configured statuses
  for (const c of configuredStatuses) {
    const cUpper = (c.name || '').trim().toUpperCase();

    // Hot Leads
    if (cUpper.includes('HOT') && (upper.includes('HOT') || upper === 'HOT LEAD' || upper === 'HOT LEADS')) return c.name;
    // Warm Leads
    if (cUpper.includes('WARM') && (upper.includes('WARM') || upper === 'WARM LEAD' || upper === 'WARM LEADS')) return c.name;
    // Call Back
    if ((cUpper.includes('CALL BACK') || cUpper.includes('CAL BACK')) && (upper.includes('CALL BACK') || upper.includes('CAL BACK'))) return c.name;
    // Given Login
    if (cUpper.includes('GIVEN LOGIN') && upper.includes('GIVEN LOGIN')) return c.name;
    // CIBIL / CEBIL Pending
    if ((cUpper.includes('CIBIL') || cUpper.includes('CEBIL') || cUpper.includes('CEDIL') || cUpper.includes('CIVIL')) &&
        (upper.includes('CIBIL') || upper.includes('CEBIL') || upper.includes('CEDIL') || upper.includes('CIVIL'))) {
      return c.name;
    }
    // Document Pending
    if ((cUpper.includes('DOCUMENT') || cUpper.includes('DOC')) && (upper.includes('DOCUMENT') || upper.includes('DOC'))) return c.name;
    // Status Pending / Approval Pending
    if ((cUpper.includes('STATUS PENDING') || cUpper.includes('APPROVAL PENDING') || cUpper.includes('STATUS') || cUpper.includes('APPROVAL')) &&
        (upper.includes('STATUS PENDING') || upper.includes('APPROVAL PENDING') || upper === 'APPROVAL PENDING' || upper === 'STATUS PENDING')) {
      return c.name;
    }
    // Approved
    if (cUpper.startsWith('APPROV') && (upper.startsWith('APPROV') || upper.includes('APPROVED'))) return c.name;
    // Disbursed
    if ((cUpper.includes('DISBURS') || cUpper.includes('DISBUS')) && (upper.includes('DISBURS') || upper.includes('DISBUS'))) return c.name;
    // Reject
    if ((cUpper === 'REJECT' || cUpper === 'REJECTED' || cUpper === 'LEAD REJECTED') &&
        (upper === 'REJECT' || upper === 'REJECTED' || upper === 'LEAD REJECTED' || upper === 'APPLICATION REJECTED')) {
      return c.name;
    }
    // Followup
    if (cUpper.includes('FOLLOW') && upper.includes('FOLLOW')) return c.name;
    // Dropped
    if (cUpper.includes('DROP') && upper.includes('DROP')) return c.name;
    // Pending
    if (cUpper === 'PENDING' && upper === 'PENDING') return c.name;
  }

  return null;
};

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// 1. Get Dashboard Layout for User
router.get('/layout', async (req: Request, res: Response): Promise<void> => {
  try {
    const userReq = req as any;
    let layout = await DashboardLayout.findOne({
      organizationId: userReq.organizationId,
      userId: userReq.user?.id
    });

    if (!layout) {
      layout = await DashboardLayout.findOne({
        organizationId: userReq.organizationId,
        isDefault: true
      });
    }

    res.status(200).json(layout || { widgets: [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve dashboard configuration.' });
  }
});

// 2. Save/Update Dashboard Layout
router.put('/layout', async (req: Request, res: Response): Promise<void> => {
  try {
    const userReq = req as any;
    const { widgets } = req.body;

    let layout = await DashboardLayout.findOne({
      organizationId: userReq.organizationId,
      userId: userReq.user?.id
    });

    if (layout) {
      layout.widgets = widgets;
      await layout.save();
    } else {
      layout = await DashboardLayout.create({
        organizationId: userReq.organizationId,
        userId: userReq.user?.id,
        name: 'My Dashboard',
        widgets
      });
    }

    res.status(200).json(layout);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update dashboard widgets.' });
  }
});

// 3. Fetch Real-time Metadata KPI Counts
// 3. Compute Real-time Metadata KPI Counts (with optimized indexing and SWR cache)
export async function calculateDashboardMetrics(orgId: any, user: any, cacheKey?: string) {
  // Find Lead and Deal Module Definitions
  const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
  const dealModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'deals' });

  const leadQuery: Record<string, any> = { organizationId: orgId };
  if (leadModule) leadQuery.moduleId = leadModule._id;
  const dealQuery: Record<string, any> = { organizationId: orgId };
  if (dealModule) dealQuery.moduleId = dealModule._id;

  // Apply Dynamic Reporting Manager Hierarchy filtering
  await HierarchyService.modifyRecordQuery(leadQuery, user, orgId!);
  await HierarchyService.modifyRecordQuery(dealQuery, user, orgId!);

  const statusCounts: Record<string, number> = {};
  const pipelineData: Record<string, number> = {
    'Prospecting': 0,
    'Qualification': 0,
    'Proposal': 0,
    'Negotiation': 0,
    'Closed Won': 0,
    'Closed Lost': 0
  };

  let dealStatus = { open: 0, won: 0, lost: 0, pending: 0 };
  let todayFollowupsCount = 0;
  let todayFollowupsList: any[] = [];
  let upcomingFollowupsList: any[] = [];
  let upcomingFollowupsCount = 0;
  let isUpcoming = false;
  let totalLeads = 0;
  let recentActivities: any[] = [];
  let campaignMetrics: any = {
    totalCampaigns: 0,
    completedCampaigns: 0,
    inProgressCampaigns: 0,
    yetToStartCampaigns: 0,
    totalLeadsAllocated: 0,
    totalLeadsDialed: 0,
    totalLeadsRemaining: 0,
    dialedPercentage: 0,
    activeCampaignNames: 'Direct Campaigns'
  };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  if (leadModule) {
    // 1. Group leads count by status using leadQuery (with hierarchy filtering applied)
    const leadAgg = await CustomRecord.aggregate([
      {
        $match: {
          ...leadQuery,
          'data.isCampaignDialOnly': { $ne: true },
          'data.normalizedStatus': { $ne: 'CAMPAIGN_DIAL' }
        }
      },
      {
        $project: {
          st: {
            $ifNull: [
              '$data.normalizedStatus',
              {
                $ifNull: [
                  '$data.status',
                  { $ifNull: ['$data.dialStatus', '$data.leadStatus'] }
                ]
              }
            ]
          }
        }
      },
      { $group: { _id: '$st', count: { $sum: 1 } } }
    ]);
    
    const configuredStatuses = await Status.find({ organizationId: orgId }).sort({ order: 1 }).lean();

    // Sum lead counts into their matched configured status or canonical status (each lead counted exactly once)
    const canonicalCounts: Record<string, number> = {};

    leadAgg.forEach(item => {
      if (item._id) {
        const rawName = item._id.toString().trim();
        if (isCampaignTelephonyStatus(rawName)) {
          return; // Strictly exclude pure campaign telephony dial statuses from Dashboard KPI cards
        }

        const count = Number(item.count || 0);
        const matchedName = matchStatusToConfigured(rawName, configuredStatuses) || normalizeStatusName(rawName) || rawName;
        canonicalCounts[matchedName] = (canonicalCounts[matchedName] || 0) + count;
      }
    });

    // Populate statusCounts with exact names, upper, lower, and standard aliases
    Object.entries(canonicalCounts).forEach(([name, count]) => {
      const upper = name.trim().toUpperCase();
      statusCounts[name] = count;
      statusCounts[upper] = count;
      statusCounts[name.toLowerCase()] = count;

      if (upper.includes('HOT')) {
        statusCounts['HOT'] = count;
        statusCounts['HOT LEAD'] = count;
        statusCounts['HOT LEADS'] = count;
        statusCounts['Hot'] = count;
      } else if (upper.includes('WARM')) {
        statusCounts['WARM'] = count;
        statusCounts['WARM LEAD'] = count;
        statusCounts['WARM LEADS'] = count;
        statusCounts['Warm'] = count;
      } else if (upper.includes('CALL BACK') || upper.includes('CAL BACK')) {
        statusCounts['CALL BACK'] = count;
        statusCounts['CAL BACK'] = count;
      } else if (upper.includes('GIVEN LOGIN')) {
        statusCounts['GIVEN LOGIN'] = count;
      } else if (upper.includes('CIBIL') || upper.includes('CEBIL') || upper.includes('CEDIL')) {
        statusCounts['CIBIL PENDING'] = count;
        statusCounts['CEBIL PENDING'] = count;
        statusCounts['CEDIL PENDING'] = count;
      } else if (upper.includes('DOCUMENT') || upper.includes('DOC')) {
        statusCounts['DOCUMENT PENDING'] = count;
        statusCounts['Document Pending'] = count;
      } else if (upper.includes('STATUS PENDING') || upper.includes('APPROVAL PENDING')) {
        statusCounts['STATUS PENDING'] = count;
        statusCounts['Status Pending'] = count;
        statusCounts['APPROVAL PENDING'] = count;
      } else if (upper.startsWith('APPROV')) {
        statusCounts['APPROVED'] = count;
        statusCounts['Approved'] = count;
        statusCounts['APPROVED BUT NOT DISBUSE'] = count;
      } else if (upper.includes('DISBURS') || upper.includes('DISBUS')) {
        statusCounts['DISBURSED'] = count;
        statusCounts['Disbursed'] = count;
        statusCounts['DISBUSED'] = count;
      } else if (upper.includes('REJECT')) {
        statusCounts['REJECT'] = count;
        statusCounts['reject'] = count;
        statusCounts['REJECTED'] = count;
      } else if (upper.includes('FOLLOW')) {
        statusCounts['FOLLOWUP'] = count;
        statusCounts['Followup'] = count;
      } else if (upper.includes('DROP')) {
        statusCounts['DROPPED'] = count;
        statusCounts['Dropped'] = count;
      } else if (upper === 'PENDING') {
        statusCounts['PENDING'] = count;
        statusCounts['Pending'] = count;
      }
    });

    // Ensure all configured statuses in Settings have a defined count (defaulting to 0)
    configuredStatuses.forEach(c => {
      const name = c.name;
      if (statusCounts[name] === undefined) {
        statusCounts[name] = 0;
        statusCounts[name.toUpperCase()] = 0;
        statusCounts[name.toLowerCase()] = 0;
      }
    });

    // 2. Count & fetch Today's followups
    const followUpQuery: any = { ...leadQuery };
    const todayStr = startOfToday.toISOString().split('T')[0];
    const timeFilter = {
      $or: [
        { 'data.followUpDate': { $gte: startOfToday, $lte: endOfToday } },
        { 'data.followUpDate': todayStr }
      ]
    };
    if (followUpQuery.$or) {
      const existingOr = followUpQuery.$or;
      delete followUpQuery.$or;
      followUpQuery.$and = [{ $or: existingOr }, timeFilter];
    } else if (followUpQuery.$and) {
      followUpQuery.$and.push(timeFilter);
    } else {
      Object.assign(followUpQuery, timeFilter);
    }
    
    todayFollowupsCount = await CustomRecord.countDocuments(followUpQuery);
    todayFollowupsList = await CustomRecord.find(followUpQuery)
      .populate('createdBy', 'firstName lastName name email')
      .sort({ 'data.followUpDate': 1 })
      .limit(10)
      .lean();

    // 3. Count & fetch Upcoming followups (future dates)
    const upcomingQuery: any = { ...leadQuery };
    const futureFilter = {
      $or: [
        { 'data.followUpDate': { $gt: endOfToday } },
        { 'data.followUpDate': { $gt: todayStr } }
      ]
    };
    if (upcomingQuery.$or) {
      const existingOr = upcomingQuery.$or;
      delete upcomingQuery.$or;
      upcomingQuery.$and = [{ $or: existingOr }, futureFilter];
    } else if (upcomingQuery.$and) {
      upcomingQuery.$and.push(futureFilter);
    } else {
      Object.assign(upcomingQuery, futureFilter);
    }

    upcomingFollowupsCount = await CustomRecord.countDocuments(upcomingQuery);
    upcomingFollowupsList = await CustomRecord.find(upcomingQuery)
      .populate('createdBy', 'firstName lastName name email')
      .sort({ 'data.followUpDate': 1 })
      .limit(10)
      .lean();

    if (todayFollowupsCount === 0 && upcomingFollowupsCount > 0) {
      isUpcoming = true;
    }

    if (dealModule) {
      const dealAgg = await CustomRecord.aggregate([
        { $match: dealQuery },
        { $group: { _id: '$data.stage', total: { $sum: { $toDouble: '$data.amount' } } } }
      ]);
      dealAgg.forEach(item => {
        if (item._id && pipelineData[item._id] !== undefined) {
          pipelineData[item._id] = item.total;
        }
      });
    }

    const CANONICAL_LEAD_STATUSES = [
      'HOT LEADS', 'WARM LEADS', 'CEBIL PENDING', 'DOCUMENT PENDING',
      'APPROVAL PENDING', 'APPROVED BUT NOT DISBUSE', 'DISBUSED',
      'REJECTED', 'FOLLOWUP', 'DROPPED', 'PENDING'
    ];
    CANONICAL_LEAD_STATUSES.forEach(st => {
      if (statusCounts[st] === undefined) statusCounts[st] = 0;
    });

    const totalProcessSum = CANONICAL_LEAD_STATUSES.reduce((sum, st) => sum + (statusCounts[st] || 0), 0);
    totalLeads = totalProcessSum;
    statusCounts['ALL'] = totalProcessSum;
    statusCounts['ALL LEADS'] = totalProcessSum;

    const activityQuery: Record<string, any> = { organizationId: orgId };
    const isSuper = await HierarchyService.isSuperAdmin(user?.roleId);
    if (!isSuper) {
      const descendants = await HierarchyService.getSubordinateUserIds(user?.id as string, orgId!);
      const allowedUserIds = [new mongoose.Types.ObjectId(user?.id), ...descendants];
      activityQuery.userId = { $in: allowedUserIds };
    }

    recentActivities = await Activity.find(activityQuery)
      .populate('userId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10);

    // 4. Calculate Real-Time Campaign Execution Metrics (Optimized for Instant Speed)
    const campaignModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaigns' });
    let campaignRecords: any[] = [];
    if (campaignModule) {
      campaignRecords = await CustomRecord.find({
        organizationId: orgId,
        moduleId: campaignModule._id
      }).lean();
    }

    const exactCampNames = campaignRecords.map((c: any) => {
      const d = c.data || {};
      return (d.campaignName || d.name || d.source || '').toString().trim();
    }).filter(Boolean);

    const registeredCampaignNames = new Set(exactCampNames.map((n: string) => n.toLowerCase()));

    const campMatchConditions: any[] = [];
    if (exactCampNames.length > 0) {
      campMatchConditions.push(
        { 'data.campaignName': { $in: exactCampNames } },
        { 'data.campaign': { $in: exactCampNames } },
        { 'data.campaign_name': { $in: exactCampNames } }
      );
    } else {
      campMatchConditions.push(
        { 'data.campaignName': { $exists: true, $ne: '' } },
        { 'data.campaign': { $exists: true, $ne: '' } },
        { 'data.campaign_name': { $exists: true, $ne: '' } },
        { 'data.source': { $exists: true, $ne: '' } }
      );
    }

    const campLeadQuery: Record<string, any> = {
      organizationId: orgId,
      moduleId: leadModule._id,
      $or: campMatchConditions
    };
    await HierarchyService.modifyRecordQuery(campLeadQuery, user, orgId!);

    const aggCampaignResults = await CustomRecord.aggregate([
      { $match: campLeadQuery },
      {
        $project: {
          rawName: {
            $ifNull: ['$data.campaignName', { $ifNull: ['$data.campaign', { $ifNull: ['$data.campaign_name', '$data.source'] }] }]
          },
          isDialed: {
            $cond: [
              {
                $or: [
                  { $ifNull: ['$data.dialedAt', false] },
                  { $gt: ['$data.callAttempts', 0] },
                  {
                    $and: [
                      { $ne: [{ $toLower: { $ifNull: ['$data.dialStatus', ''] } }, ''] },
                      { $ne: [{ $toLower: { $ifNull: ['$data.dialStatus', ''] } }, 'yet to call'] },
                      { $ne: [{ $toLower: { $ifNull: ['$data.dialStatus', ''] } }, 'not called'] },
                      { $ne: [{ $toLower: { $ifNull: ['$data.dialStatus', ''] } }, 'new'] }
                    ]
                  },
                  {
                    $and: [
                      { $ne: [{ $toLower: { $ifNull: ['$data.status', ''] } }, ''] },
                      { $ne: [{ $toLower: { $ifNull: ['$data.status', ''] } }, 'new'] },
                      { $ne: [{ $toLower: { $ifNull: ['$data.status', ''] } }, 'yet to call'] },
                      { $ne: [{ $toLower: { $ifNull: ['$data.status', ''] } }, 'not called'] }
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        }
      },
      {
        $group: {
          _id: { $toLower: '$rawName' },
          rawCampName: { $first: '$rawName' },
          total: { $sum: 1 },
          dialed: { $sum: '$isDialed' }
        }
      }
    ]);

    const campaignGroups: Record<string, { total: number; dialed: number }> = {};
    const genericSources = ['website', 'referral', 'cold call', 'social media', 'google ads', 'facebook ads', 'walk-in', 'direct'];

    aggCampaignResults.forEach((item: any) => {
      if (item._id) {
        const rawName = item._id.toString().trim().toLowerCase();
        if (rawName) {
          const isRegistered = registeredCampaignNames.size === 0 || registeredCampaignNames.has(rawName);
          if (isRegistered && (registeredCampaignNames.has(rawName) || !genericSources.includes(rawName))) {
            const canonical = campaignRecords.find((c: any) => {
              const cd = c.data || {};
              return (cd.campaignName || cd.name || cd.source || '').toString().trim().toLowerCase() === rawName;
            });
            const campName = canonical ? (canonical.data?.campaignName || canonical.data?.name || item.rawCampName || rawName) : (item.rawCampName || rawName);
            if (!campaignGroups[campName]) {
              campaignGroups[campName] = { total: 0, dialed: 0 };
            }
            campaignGroups[campName].total += Number(item.total || 0);
            campaignGroups[campName].dialed += Number(item.dialed || 0);
          }
        }
      }
    });

    campaignRecords.forEach((c: any) => {
      const d = c.data || {};
      const name = (d.campaignName || d.name || d.source || '').toString().trim();
      if (name && !campaignGroups[name]) {
        campaignGroups[name] = { total: 0, dialed: 0 };
      }
    });

    let totalCampaignsCount = Object.keys(campaignGroups).length;
    let completedCampaignsCount = 0;
    let inProgressCampaignsCount = 0;
    let yetToStartCampaignsCount = 0;
    let totalLeadsAllocated = 0;
    let totalLeadsDialed = 0;
    const activeNamesList: string[] = [];

    Object.keys(campaignGroups).forEach((campName: string) => {
      const group = campaignGroups[campName];
      const assigned = group.total;
      const dialedCount = group.dialed;
      totalLeadsAllocated += assigned;
      totalLeadsDialed += dialedCount;
      activeNamesList.push(campName);

      if (assigned > 0 && dialedCount >= assigned) {
        completedCampaignsCount++;
      } else if (dialedCount > 0) {
        inProgressCampaignsCount++;
      } else {
        yetToStartCampaignsCount++;
      }
    });

    if (totalCampaignsCount === 0 && campaignRecords.length > 0) {
      totalCampaignsCount = campaignRecords.length;
      yetToStartCampaignsCount = campaignRecords.length;
    }

    const totalLeadsRemaining = Math.max(0, totalLeadsAllocated - totalLeadsDialed);
    const dialedPercentage = totalLeadsAllocated > 0 ? Math.round((totalLeadsDialed / totalLeadsAllocated) * 100) : 0;
    const activeCampaignNames = activeNamesList.length > 0 ? activeNamesList.slice(0, 3).join(' & ') : 'Active Campaigns';

    campaignMetrics = {
      totalCampaigns: totalCampaignsCount,
      completedCampaigns: completedCampaignsCount,
      inProgressCampaigns: inProgressCampaignsCount,
      yetToStartCampaigns: yetToStartCampaignsCount,
      totalLeadsAllocated,
      totalLeadsDialed,
      totalLeadsRemaining,
      dialedPercentage,
      activeCampaignNames
    };
  }

  const metricsPayload = {
    statusCounts,
    pipelineData,
    dealStatus,
    todayFollowupsCount,
    todayFollowupsList,
    upcomingFollowupsList,
    upcomingFollowupsCount,
    isUpcoming,
    totalLeads,
    recentActivities,
    campaignMetrics
  };

  if (cacheKey) {
    SummaryService.setCache(cacheKey, metricsPayload, 600000);
  }
  return metricsPayload;
}

router.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const userReq = req as any;
    const orgId = userReq.organizationId;
    const userIdStr = userReq.user?.id || (userReq.user as any)?._id || 'user';
    const cacheKey = `dashboard_full_${orgId}_${userIdStr}`;
    const cachedDashboard = SummaryService.getCache(cacheKey, true);
    if (cachedDashboard) {
      const data = cachedDashboard.data || cachedDashboard;
      res.status(200).json(data);
      if (cachedDashboard.isStale) {
        setImmediate(async () => {
          try {
            await calculateDashboardMetrics(orgId, userReq.user, cacheKey);
          } catch (e) {}
        });
      }
      return;
    }

    const metricsPayload = await calculateDashboardMetrics(orgId, userReq.user, cacheKey);
    res.status(200).json(metricsPayload);
  } catch (error) {
    console.error('Metrics Error:', error);
    res.status(500).json({ error: 'Failed to retrieve dashboard KPI metrics.' });
  }
});

// 4. Fetch Aggregated Funnel Stats (Daily, Monthly, Annual)
router.get('/funnel-stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const userReq = req as any;
    const orgId = userReq.organizationId;
    const period = (req.query.period as string || 'daily').toLowerCase();

    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(200).json({ total: 0, statusCounts: {}, monthlyMap: {} });
      return;
    }

    const now = new Date();
    let startDate: Date;
    let endDate: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (period === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    } else { // annual
      startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    }

    const matchQuery: any = {
      organizationId: orgId,
      moduleId: leadModule._id,
      createdAt: { $gte: startDate, $lte: endDate }
    };

    await HierarchyService.modifyRecordQuery(matchQuery, userReq.user, orgId!);

    const aggResults = await CustomRecord.aggregate([
      { $match: matchQuery },
      {
        $project: {
          st: {
            $ifNull: [
              '$data.normalizedStatus',
              {
                $ifNull: ['$data.status', { $ifNull: ['$data.dialStatus', '$data.leadStatus'] }]
              }
            ]
          },
          month: { $month: '$createdAt' }
        }
      },
      {
        $group: {
          _id: { st: { $toUpper: '$st' }, month: '$month' },
          count: { $sum: 1 }
        }
      }
    ]);

    const statusCounts: Record<string, number> = {};
    let total = 0;
    const monthlyMap: Record<number, number> = {};

    aggResults.forEach(item => {
      const rawSt = item._id?.st || 'PENDING';
      const norm = normalizeStatusName(rawSt);
      statusCounts[norm] = (statusCounts[norm] || 0) + item.count;
      statusCounts[rawSt] = (statusCounts[rawSt] || 0) + item.count;
      total += item.count;

      const m = item._id?.month;
      if (m) {
        monthlyMap[m] = (monthlyMap[m] || 0) + item.count;
      }
    });

    res.status(200).json({
      period,
      total,
      statusCounts,
      monthlyMap
    });
  } catch (error) {
    console.error('Funnel Stats Error:', error);
    res.status(500).json({ error: 'Failed to compute funnel statistics.' });
  }
});

export default router;
