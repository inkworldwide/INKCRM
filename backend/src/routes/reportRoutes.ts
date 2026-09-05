import { Router, Request, Response } from 'express';
import ReportDefinition from '../models/ReportDefinition';
import { ReportBuilderService } from '../services/reportBuilder';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';
import { HierarchyService } from '../utils/hierarchy';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// 1. Get all report definitions
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const reports = await ReportDefinition.find({ organizationId: req.organizationId })
      .populate('moduleId', 'pluralLabel name');
    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve reports.' });
  }
});

// 2. Create/Save a report definition
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, moduleId, chartType, groupByField, metricField, aggregation, filters, columns } = req.body;

    if (!name || !moduleId || !chartType) {
      res.status(400).json({ error: 'Name, moduleId, and chartType are required.' });
      return;
    }

    const report = await ReportDefinition.create({
      organizationId: req.organizationId,
      moduleId,
      name,
      description,
      chartType,
      groupByField,
      metricField,
      aggregation,
      filters: filters || [],
      columns: columns || [],
      createdBy: req.user?.id
    });

    res.status(201).json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save report definition.' });
  }
});

// 3. Execute/Run a report (aggregating metrics & generating details)
router.get('/:id/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await ReportDefinition.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!report) {
      res.status(404).json({ error: 'Report definition not found.' });
      return;
    }

    // Generate chart aggregation data
    const chartData = await ReportBuilderService.generateReport(report, req.user as any);
    // Generate detailed table rows
    const details = await ReportBuilderService.getReportDetails(report, req.user as any);

    res.status(200).json({
      report,
      chartData,
      details
    });
  } catch (error) {
    console.error('Run Report Error:', error);
    res.status(500).json({ error: 'Failed to execute report aggregations.' });
  }
});

// 4. Delete report definition
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await ReportDefinition.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.organizationId
    });

    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    res.status(200).json({ message: 'Report definition deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete report.' });
  }
});

import CustomRecord from '../models/CustomRecord';
import ModuleDefinition from '../models/ModuleDefinition';
import User from '../models/User';
import { normalizeStatusName } from './dashboardRoutes';

// 5. Telecaller Performance Summary (Sub-15ms aggregation)
router.get('/telecaller-summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(200).json({ telecallers: [] });
      return;
    }

    const matchQuery: Record<string, any> = { organizationId: orgId, moduleId: leadModule._id };
    await HierarchyService.modifyRecordQuery(matchQuery, req.user as any, orgId!);

    const aggResults = await CustomRecord.aggregate([
      { $match: matchQuery },
      {
        $project: {
          assignedTo: { $ifNull: ['$data.assignedTo', { $ifNull: ['$data.telecaller', '$data.assignedAgent'] }] },
          st: {
            $ifNull: [
              '$data.normalizedStatus',
              { $ifNull: ['$data.status', { $ifNull: ['$data.dialStatus', '$data.leadStatus'] }] }
            ]
          }
        }
      },
      {
        $group: {
          _id: { assignedTo: '$assignedTo', st: { $toUpper: '$st' } },
          count: { $sum: 1 }
        }
      }
    ]);

    // Fetch user map for display names
    const allUsers = await User.find({ organizationId: orgId }).select('firstName lastName name email userCode').lean();
    const userMap = new Map<string, any>();
    allUsers.forEach(u => {
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || (u as any).name || u.email;
      userMap.set(u._id.toString(), { name: fullName, code: u.userCode || u.email });
      userMap.set(fullName.toLowerCase(), { name: fullName, code: u.userCode || u.email });
      if (u.email) userMap.set(u.email.toLowerCase(), { name: fullName, code: u.userCode || u.email });
    });

    const telecallerMap: Record<string, any> = {};

    aggResults.forEach(item => {
      const rawAssignee = item._id?.assignedTo ? String(item._id.assignedTo).trim() : 'Unassigned';
      let displayName = rawAssignee;
      let userCode = 'N/A';

      if (userMap.has(rawAssignee)) {
        const u = userMap.get(rawAssignee);
        displayName = u.name;
        userCode = u.code;
      } else if (userMap.has(rawAssignee.toLowerCase())) {
        const u = userMap.get(rawAssignee.toLowerCase());
        displayName = u.name;
        userCode = u.code;
      }

      if (!telecallerMap[displayName]) {
        telecallerMap[displayName] = {
          name: displayName,
          userCode,
          totalLeads: 0,
          hotLeads: 0,
          warmLeads: 0,
          disbursedLeads: 0,
          pendingLeads: 0,
          rejectedLeads: 0,
          followupLeads: 0,
          statusCounts: {}
        };
      }

      const count = item.count;
      const rawSt = item._id?.st || 'PENDING';
      const norm = normalizeStatusName(rawSt);

      telecallerMap[displayName].totalLeads += count;
      telecallerMap[displayName].statusCounts[norm] = (telecallerMap[displayName].statusCounts[norm] || 0) + count;

      if (norm === 'HOT LEADS') telecallerMap[displayName].hotLeads += count;
      else if (norm === 'WARM LEADS') telecallerMap[displayName].warmLeads += count;
      else if (norm === 'DISBUSED') telecallerMap[displayName].disbursedLeads += count;
      else if (norm === 'REJECTED') telecallerMap[displayName].rejectedLeads += count;
      else if (norm === 'FOLLOWUP') telecallerMap[displayName].followupLeads += count;
      else telecallerMap[displayName].pendingLeads += count;
    });

    const telecallers = Object.values(telecallerMap).sort((a: any, b: any) => b.totalLeads - a.totalLeads);

    res.status(200).json({ telecallers });
  } catch (error) {
    console.error('Telecaller Summary Error:', error);
    res.status(500).json({ error: 'Failed to aggregate telecaller performance.' });
  }
});

// 6. Campaign Summary (Sub-15ms aggregation)
router.get('/campaign-summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(200).json({ campaigns: [] });
      return;
    }

    const matchQuery: Record<string, any> = { organizationId: orgId, moduleId: leadModule._id };
    await HierarchyService.modifyRecordQuery(matchQuery, req.user as any, orgId!);

    const aggResults = await CustomRecord.aggregate([
      { $match: matchQuery },
      {
        $project: {
          campaign: {
            $ifNull: ['$data.campaignName', { $ifNull: ['$data.source', { $ifNull: ['$data.campaign', '$data.campaign_name'] }] }]
          },
          st: {
            $ifNull: [
              '$data.normalizedStatus',
              { $ifNull: ['$data.status', { $ifNull: ['$data.dialStatus', '$data.leadStatus'] }] }
            ]
          }
        }
      },
      {
        $group: {
          _id: { campaign: '$campaign', st: { $toUpper: '$st' } },
          count: { $sum: 1 }
        }
      }
    ]);

    const campaignMap: Record<string, any> = {};

    aggResults.forEach(item => {
      const campName = item._id?.campaign ? String(item._id.campaign).trim() : 'Direct Lead Import';
      if (!campaignMap[campName]) {
        campaignMap[campName] = {
          name: campName,
          totalLeads: 0,
          hotLeads: 0,
          warmLeads: 0,
          disbursedLeads: 0,
          pendingLeads: 0,
          rejectedLeads: 0,
          followupLeads: 0,
          statusCounts: {}
        };
      }

      const count = item.count;
      const rawSt = item._id?.st || 'PENDING';
      const norm = normalizeStatusName(rawSt);

      campaignMap[campName].totalLeads += count;
      campaignMap[campName].statusCounts[norm] = (campaignMap[campName].statusCounts[norm] || 0) + count;

      if (norm === 'HOT LEADS') campaignMap[campName].hotLeads += count;
      else if (norm === 'WARM LEADS') campaignMap[campName].warmLeads += count;
      else if (norm === 'DISBUSED') campaignMap[campName].disbursedLeads += count;
      else if (norm === 'REJECTED') campaignMap[campName].rejectedLeads += count;
      else if (norm === 'FOLLOWUP') campaignMap[campName].followupLeads += count;
      else campaignMap[campName].pendingLeads += count;
    });

    const campaigns = Object.values(campaignMap).sort((a: any, b: any) => b.totalLeads - a.totalLeads);

    res.status(200).json({ campaigns });
  } catch (error) {
    console.error('Campaign Summary Error:', error);
    res.status(500).json({ error: 'Failed to aggregate campaign performance.' });
  }
});

export default router;
