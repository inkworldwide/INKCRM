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

export const normalizeStatusName = (rawSt: string): string => {
  if (!rawSt) return 'PENDING';
  const s = rawSt.trim().toUpperCase();

  if (s === 'HOT' || s === 'HOT LEAD' || s === 'HOT LEADS') return 'HOT LEADS';
  if (s === 'WARM' || s === 'WARM LEAD' || s === 'WARM LEADS') return 'WARM LEADS';
  if (s.includes('CEBIL') || s.includes('CEDIL') || s.includes('CIVIL') || s.includes('CIBIL')) return 'CEBIL PENDING';
  if (s.includes('DOCUMENT') || s.includes('DOC PENDING')) return 'DOCUMENT PENDING';
  if (s.includes('APPROVAL PENDING') || s === 'APPROVAL PENDING') return 'APPROVAL PENDING';
  if (s.includes('APPROVED BUT NOT') || s === 'APPROVED BUT NOT DISBUSE' || s === 'APPROVED BUT NOT DISBURSED') return 'APPROVED BUT NOT DISBUSE';
  if (s === 'APPROVED') return 'APPROVED BUT NOT DISBUSE';
  if (s.includes('DISBURS') || s.includes('DISBUS')) return 'DISBUSED';
  if (s.includes('REJECT')) return 'REJECTED';
  if (s.includes('FOLLOW')) return 'FOLLOWUP';
  if (s.includes('DROP')) return 'DROPPED';
  if (s === 'PENDING') return 'PENDING';

  return s;
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
router.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const userReq = req as any;
    const orgId = userReq.organizationId;
    const userIdStr = userReq.user?.id || (userReq.user as any)?._id || 'user';
    const cacheKey = `dashboard_full_${orgId}_${userIdStr}`;
    const cachedDashboard = SummaryService.getCache(cacheKey);
    if (cachedDashboard) {
      res.status(200).json(cachedDashboard);
      return;
    }

    // Find Lead and Deal Module Definitions
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    const dealModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'deals' });

    const leadQuery: Record<string, any> = {
      organizationId: orgId
    };
    if (leadModule) {
      leadQuery.moduleId = leadModule._id;
    }
    const dealQuery: Record<string, any> = {
      organizationId: orgId
    };
    if (dealModule) {
      dealQuery.moduleId = dealModule._id;
    }

    // Apply Dynamic Reporting Manager Hierarchy filtering
    await HierarchyService.modifyRecordQuery(leadQuery, userReq.user, orgId!);
    await HierarchyService.modifyRecordQuery(dealQuery, userReq.user, orgId!);

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

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    if (leadModule) {
      // 1. Group leads count by status using leadQuery (with hierarchy filtering applied)
      const leadAgg = await CustomRecord.aggregate([
        { $match: leadQuery },
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
      
      const canonicalCountsMap: Record<string, number> = {};
      leadAgg.forEach(item => {
        if (item._id) {
          const rawName = item._id.toString().trim();
          const canonical = normalizeStatusName(rawName);
          const count = Number(item.count || 0);
          canonicalCountsMap[canonical] = (canonicalCountsMap[canonical] || 0) + count;
        }
      });

      Object.entries(canonicalCountsMap).forEach(([canonical, totalCount]) => {
        statusCounts[canonical] = totalCount;
        statusCounts[canonical.toUpperCase()] = totalCount;
        if (canonical === 'HOT LEADS') {
          statusCounts['HOT'] = totalCount;
          statusCounts['HOT LEAD'] = totalCount;
          statusCounts['Hot'] = totalCount;
          statusCounts['Hot Lead'] = totalCount;
        } else if (canonical === 'WARM LEADS') {
          statusCounts['WARM'] = totalCount;
          statusCounts['WARM LEAD'] = totalCount;
          statusCounts['Warm'] = totalCount;
          statusCounts['Warm Lead'] = totalCount;
        } else if (canonical === 'APPROVED BUT NOT DISBUSE') {
          statusCounts['APPROVED'] = totalCount;
          statusCounts['APPROVED BUT NOT DISBURSED'] = totalCount;
        }
      });

      leadAgg.forEach(item => {
        if (item._id) {
          const rawName = item._id.toString().trim();
          const canonical = normalizeStatusName(rawName);
          const totalCount = canonicalCountsMap[canonical] || 0;
          statusCounts[rawName] = totalCount;
          statusCounts[rawName.toUpperCase()] = totalCount;
        }
      });

      // 2. Count & fetch Today's followups
      const followUpQuery: any = {
        ...leadQuery
      };
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
        followUpQuery.$and = [
          { $or: existingOr },
          timeFilter
        ];
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
      const upcomingQuery: any = {
        ...leadQuery
      };
      const futureFilter = {
        $or: [
          { 'data.followUpDate': { $gt: endOfToday } },
          { 'data.followUpDate': { $gt: todayStr } }
        ]
      };
      if (upcomingQuery.$or) {
        const existingOr = upcomingQuery.$or;
        delete upcomingQuery.$or;
        upcomingQuery.$and = [
          { $or: existingOr },
          futureFilter
        ];
      } else if (upcomingQuery.$and) {
        upcomingQuery.$and.push(futureFilter);
      } else {
        Object.assign(upcomingQuery, futureFilter);
      }

      const upcomingFollowupsCount = await CustomRecord.countDocuments(upcomingQuery);
      const upcomingFollowupsList = await CustomRecord.find(upcomingQuery)
        .populate('createdBy', 'firstName lastName name email')
        .sort({ 'data.followUpDate': 1 })
        .limit(10)
        .lean();

      let isUpcoming = false;
      if (todayFollowupsCount === 0 && upcomingFollowupsCount > 0) {
        isUpcoming = true;
      }

      if (dealModule) {
        // sum amount grouped by stage for Pipeline
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
        'HOT LEADS',
        'WARM LEADS',
        'CEBIL PENDING',
        'DOCUMENT PENDING',
        'APPROVAL PENDING',
        'APPROVED BUT NOT DISBUSE',
        'DISBUSED',
        'REJECTED',
        'FOLLOWUP',
        'DROPPED',
        'PENDING'
      ];

      CANONICAL_LEAD_STATUSES.forEach(st => {
        if (statusCounts[st] === undefined) {
          statusCounts[st] = 0;
        }
      });

      const totalProcessSum = CANONICAL_LEAD_STATUSES.reduce((sum, st) => sum + (statusCounts[st] || 0), 0);
      let totalLeads = totalProcessSum;
      statusCounts['ALL'] = totalProcessSum;
      statusCounts['ALL LEADS'] = totalProcessSum;

      const activityQuery: Record<string, any> = { organizationId: orgId };
      const isSuper = await HierarchyService.isSuperAdmin(userReq.user?.roleId);
      if (!isSuper) {
        const descendants = await HierarchyService.getSubordinateUserIds(userReq.user?.id as string, orgId!);
        const allowedUserIds = [new mongoose.Types.ObjectId(userReq.user?.id), ...descendants];
        activityQuery.userId = { $in: allowedUserIds };
      }

      const recentActivities = await Activity.find(activityQuery)
        .populate('userId', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(10);

      // 4. Calculate Real-Time Campaign Execution Metrics
      const campaignModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaigns' });
      let campaignRecords: any[] = [];
      if (campaignModule) {
        campaignRecords = await CustomRecord.find({
          organizationId: orgId,
          moduleId: campaignModule._id
        }).lean();
      }

      const registeredCampaignNames = new Set(
        campaignRecords.map((c: any) => {
          const d = c.data || {};
          return (d.campaignName || d.name || d.source || '').toString().trim().toLowerCase();
        }).filter(Boolean)
      );

      const baseLeadFilter = {
        organizationId: orgId,
        moduleId: leadModule._id,
        $or: [
          { 'data.source': { $exists: true, $ne: '' } },
          { 'data.campaignName': { $exists: true, $ne: '' } },
          { 'data.campaign': { $exists: true, $ne: '' } },
          { 'data.campaign_name': { $exists: true, $ne: '' } }
        ]
      };

      const campLeadQuery: Record<string, any> = { ...baseLeadFilter };
      await HierarchyService.modifyRecordQuery(campLeadQuery, userReq.user, orgId!);
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

      // Also include registered campaigns that have 0 leads assigned
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

      const campaignMetrics = {
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
      SummaryService.setCache(cacheKey, metricsPayload);
      res.status(200).json(metricsPayload);
      return;
    }

    res.status(200).json({
      statusCounts,
      pipelineData,
      dealStatus,
      todayFollowupsCount: 0,
      todayFollowupsList: [],
      upcomingFollowupsList: [],
      upcomingFollowupsCount: 0,
      isUpcoming: false,
      totalLeads: 0,
      recentActivities: []
    });
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
