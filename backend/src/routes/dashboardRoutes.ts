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
    // Attempt to locate a user-specific dashboard layout
    let layout = await DashboardLayout.findOne({
      organizationId: req.organizationId,
      userId: req.user?.id
    });

    // Fallback: locate the organization's default dashboard layout
    if (!layout) {
      layout = await DashboardLayout.findOne({
        organizationId: req.organizationId,
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
    const { widgets } = req.body;

    let layout = await DashboardLayout.findOne({
      organizationId: req.organizationId,
      userId: req.user?.id
    });

    if (layout) {
      layout.widgets = widgets;
      await layout.save();
    } else {
      layout = await DashboardLayout.create({
        organizationId: req.organizationId,
        userId: req.user?.id,
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
    const orgId = req.organizationId;
    
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
    await HierarchyService.modifyRecordQuery(leadQuery, req.user as any, orgId!);
    await HierarchyService.modifyRecordQuery(dealQuery, req.user as any, orgId!);

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
      // 1. Group leads count by status dynamically (checking normalizedStatus first)
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
      
      leadAgg.forEach(item => {
        if (item._id) {
          const rawName = item._id.toString().trim();
          const canonical = normalizeStatusName(rawName);
          const uppercaseName = rawName.toUpperCase();
          const count = Number(item.count || 0);

          // Use a Set to ensure item.count is added EXACTLY ONCE to each distinct key!
          const uniqueKeys = new Set<string>([canonical, uppercaseName, rawName]);
          uniqueKeys.forEach(k => {
            statusCounts[k] = (statusCounts[k] || 0) + count;
          });
        }
      });

      // 2. Count & fetch Today's followups
      const followUpQuery: any = {
        ...leadQuery
      };
      const timeFilter = {
        $or: [
          { 'data.followUpDate': { $gte: startOfToday, $lte: endOfToday } },
          { 'data.followUpDate': { $regex: '^' + startOfToday.toISOString().split('T')[0] } }
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
        .limit(10);

      // 3. Count & fetch Upcoming followups (future dates)
      const upcomingQuery: any = {
        ...leadQuery
      };
      const futureFilter = {
        $or: [
          { 'data.followUpDate': { $gt: endOfToday } },
          { 'data.followUpDate': { $gt: endOfToday.toISOString().split('T')[0] } }
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

      const upcomingFollowupsList = await CustomRecord.find(upcomingQuery)
        .populate('createdBy', 'firstName lastName name email')
        .sort({ 'data.followUpDate': 1 })
        .limit(10);
      const upcomingFollowupsCount = upcomingFollowupsList.length;

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
      const isSuper = await HierarchyService.isSuperAdmin(req.user?.roleId);
      if (!isSuper) {
        const descendants = await HierarchyService.getSubordinateUserIds(req.user?.id as string, orgId!);
        const allowedUserIds = [new mongoose.Types.ObjectId(req.user?.id), ...descendants];
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
      await HierarchyService.modifyRecordQuery(campLeadQuery, req.user as any, orgId!);
      const allCampaignLeads = await CustomRecord.find(campLeadQuery).lean();

      // Group leads by campaign name
      const campaignGroups: Record<string, any[]> = {};
      allCampaignLeads.forEach((lead: any) => {
        const d = lead.data || {};
        const rawSource = (d.campaignName || d.campaign || d.campaign_name || d.source)?.toString().trim();
        if (rawSource) {
          const lower = rawSource.toLowerCase();
          const genericSources = ['website', 'referral', 'cold call', 'social media', 'google ads', 'facebook ads', 'walk-in', 'direct'];
          const isRegistered = registeredCampaignNames.size === 0 || registeredCampaignNames.has(lower);
          if (isRegistered && (registeredCampaignNames.has(lower) || !genericSources.includes(lower))) {
            const canonical = campaignRecords.find(c => {
              const cd = c.data || {};
              return (cd.campaignName || cd.name || cd.source || '').toString().trim().toLowerCase() === lower;
            });
            const campName = canonical ? (canonical.data?.campaignName || canonical.data?.name || rawSource) : rawSource;
            if (!campaignGroups[campName]) {
              campaignGroups[campName] = [];
            }
            campaignGroups[campName].push(lead);
          }
        }
      });

      // Also include registered campaigns that have 0 leads assigned
      campaignRecords.forEach(c => {
        const d = c.data || {};
        const name = (d.campaignName || d.name || d.source || '').toString().trim();
        if (name && !campaignGroups[name]) {
          campaignGroups[name] = [];
        }
      });

      let totalCampaignsCount = Object.keys(campaignGroups).length;
      let completedCampaignsCount = 0;
      let inProgressCampaignsCount = 0;
      let yetToStartCampaignsCount = 0;
      let totalLeadsAllocated = 0;
      let totalLeadsDialed = 0;

      const activeNamesList: string[] = [];

      Object.keys(campaignGroups).forEach(campName => {
        const gLeads = campaignGroups[campName];
        const assigned = gLeads.length;
        const dialedCount = gLeads.filter(l => {
          const d = l.data || {};
          const dialSt = (d.dialStatus || '').toString().trim().toLowerCase();
          const st = (d.status || '').toString().trim().toLowerCase();
          const hasDialStatus = dialSt && dialSt !== 'yet to call' && dialSt !== 'not called' && dialSt !== 'new';
          const hasDialedStatus = st && st !== 'new' && st !== 'yet to call' && st !== 'not called';
          const hasCalls = (d.callAttempts && Number(d.callAttempts) > 0) || !!d.dialedAt;
          return hasDialedStatus || (hasCalls && hasDialStatus);
        }).length;

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

      res.status(200).json({
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
      });
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

export default router;
