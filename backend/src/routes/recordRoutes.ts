import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import Role from '../models/Role';
import User from '../models/User';
import Activity from '../models/Activity';
import AuditLog from '../models/AuditLog';
import { FormulaEvaluator } from '../services/formulaEvaluator';
import { WorkflowEngine } from '../services/workflowEngine';
import { createNotification } from '../utils/notificationHelper';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';
import { HierarchyService } from '../utils/hierarchy';

const router = Router();

// Apply security middlewares
router.use(authenticate);
router.use(requireTenant);

// Helper: Check Role Permission dynamically
const matchModuleName = (permName: string, targetName: string): boolean => {
  const p = permName.toLowerCase();
  const t = targetName.toLowerCase();
  if (p === t) return true;
  if (p === t + 's' || t === p + 's') return true;
  if (p === t.replace(/y$/, 'ies') || t === p.replace(/y$/, 'ies')) return true;
  return false;
};

// Helper: Check Role Permission dynamically
const authorizeModuleAction = async (
  req: Request,
  res: Response,
  moduleName: string,
  action: 'create' | 'read' | 'update' | 'delete'
): Promise<{ allowed: boolean; scope: 'all' | 'own' }> => {
  try {
    const role = await Role.findById(req.user?.roleId);
    if (!role) return { allowed: false, scope: 'none' as any };

    // Super Admin bypass
    if (role.name === 'Super Admin' && role.isSystem) {
      return { allowed: true, scope: 'all' };
    }

    // Allow reading settings/metadata modules (Departments, Bank Masters, Products, etc.)
    const settingsModules = ['departments', 'bankmasters', 'bankingpartners', 'products'];
    if (action === 'read' && settingsModules.includes(moduleName.toLowerCase())) {
      return { allowed: true, scope: 'all' };
    }

    const permission = role.permissions.modules.find(
      (m) => matchModuleName(m.moduleName, moduleName)
    );

    if (!permission) return { allowed: false, scope: 'none' as any };

    if (action === 'create') {
      return { allowed: permission.create, scope: 'all' };
    }

    const scope = permission[action]; // 'all' | 'own' | 'none'
    return {
      allowed: scope !== 'none',
      scope: scope === 'none' ? ('none' as any) : scope
    };
  } catch (err) {
    return { allowed: false, scope: 'none' as any };
  }
};

// Helper: Validate dynamic record fields
const validateFields = (fields: any[], data: Record<string, any>, oldValues?: Record<string, any>) => {
  const errors: string[] = [];

  fields.forEach((field) => {
    const val = data[field.name];

    // Check required fields
    if (field.required && (val === undefined || val === null || val === '')) {
      const wasAlreadyEmpty = oldValues && (oldValues[field.name] === undefined || oldValues[field.name] === null || oldValues[field.name] === '');
      if (!wasAlreadyEmpty) {
        errors.push(`Field '${field.label}' is required.`);
        return;
      }
    }

    if (val !== undefined && val !== null && val !== '') {
      // Check data types
      if (field.type === 'number' || field.type === 'currency') {
        if (isNaN(Number(val))) {
          errors.push(`Field '${field.label}' must be a valid number.`);
        }
      }
      if (field.type === 'email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(String(val))) {
          errors.push(`Field '${field.label}' must be a valid email address.`);
        }
      }
      if (field.regexValidation) {
        try {
          const rx = new RegExp(field.regexValidation);
          if (!rx.test(String(val))) {
            errors.push(`Field '${field.label}' does not match validation pattern.`);
          }
        } catch (e) {
          // ignore invalid regex configuration on database side
        }
      }
    }
  });

  return errors;
};

// ── Special Campaign Assignment Aggregations ─────────────────────────────────
router.get('/campaigns/allocation-stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    
    // Find Lead Module Definition
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(200).json({ stats: {}, dialedStats: {} });
      return;
    }

    // Aggregate count of leads grouped by assignedTo
    const stats = await CustomRecord.aggregate([
      { $match: { organizationId: orgId, moduleId: leadModule._id } },
      { $group: { _id: '$data.assignedTo', count: { $sum: 1 } } }
    ]);

    // Aggregate count of dialed leads
    const dialedStats = await CustomRecord.aggregate([
      { 
        $match: { 
          organizationId: orgId, 
          moduleId: leadModule._id,
          $or: [
            { 'data.dialStatus': { $exists: true, $nin: ['Yet To Call', ''] } },
            { 'data.status': { $nin: ['New', 'Yet To Call', ''] } },
            { 'data.callAttempts': { $gt: 0 } }
          ]
        } 
      },
      { $group: { _id: '$data.assignedTo', count: { $sum: 1 } } }
    ]);

    const statsMap: Record<string, number> = {};
    stats.forEach(item => {
      if (item._id) {
        statsMap[item._id.toString()] = item.count;
      }
    });

    const dialedMap: Record<string, number> = {};
    dialedStats.forEach(item => {
      if (item._id) {
        dialedMap[item._id.toString()] = item.count;
      }
    });

    // Campaign-level stats (by campaign name) - only include registered campaigns in org
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

    const allLeads = await CustomRecord.find({
      organizationId: orgId,
      moduleId: leadModule._id,
      $or: [
        { 'data.source': { $exists: true, $ne: '' } },
        { 'data.campaignName': { $exists: true, $ne: '' } },
        { 'data.campaign': { $exists: true, $ne: '' } },
        { 'data.campaign_name': { $exists: true, $ne: '' } }
      ]
    }).lean();

    const campaignAllocatedStats: Record<string, number> = {};
    const campaignDialedStats: Record<string, number> = {};

    allLeads.forEach((lead: any) => {
      const d = lead.data || {};
      const campName = (
        d.campaignName ||
        d.campaign ||
        d.campaign_name ||
        d.source
      )?.toString().trim();

      if (campName) {
        const lower = campName.toLowerCase();
        const genericSources = ['website', 'referral', 'cold call', 'social media', 'google ads', 'facebook ads', 'walk-in', 'direct'];
        const isRegistered = registeredCampaignNames.size === 0 || registeredCampaignNames.has(lower);
        
        if (isRegistered && (registeredCampaignNames.has(lower) || !genericSources.includes(lower))) {
          campaignAllocatedStats[lower] = (campaignAllocatedStats[lower] || 0) + 1;

          const dialSt = (d.dialStatus || '').toString().trim().toLowerCase();
          const st = (d.status || '').toString().trim().toLowerCase();
          const hasDialStatus = dialSt && dialSt !== 'yet to call' && dialSt !== 'not called' && dialSt !== 'new';
          const hasDialedStatus = st && st !== 'new' && st !== 'yet to call' && st !== 'not called';
          const hasCalls = (d.callAttempts && Number(d.callAttempts) > 0) || !!d.dialedAt;
          
          if (hasDialedStatus || (hasCalls && hasDialStatus)) {
            campaignDialedStats[lower] = (campaignDialedStats[lower] || 0) + 1;
          }
        }
      }
    });

    res.status(200).json({
      stats: statsMap,
      dialedStats: dialedMap,
      campaignAllocatedStats,
      campaignDialedStats
    });
  } catch (error) {
    console.error('Failed to get allocation stats:', error);
    res.status(500).json({ error: 'Failed to get allocation stats.' });
  }
});

router.post('/campaigns/bulk-assign', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawOrgId = req.organizationId || (req.user as any)?.organizationId;
    const rawUserId = (req.user as any)?.id || (req.user as any)?._id;
    const { campaignName, agentNames, leads, agentOffset = 0, isLastBatch = true } = req.body;

    if (!campaignName || !agentNames || !Array.isArray(agentNames) || agentNames.length === 0 || !Array.isArray(leads) || leads.length === 0) {
      res.status(400).json({ error: 'campaignName, agentNames, and leads array are required.' });
      return;
    }

    const orgId = (rawOrgId && mongoose.Types.ObjectId.isValid(String(rawOrgId)))
      ? new mongoose.Types.ObjectId(String(rawOrgId))
      : rawOrgId;

    const userId = (rawUserId && mongoose.Types.ObjectId.isValid(String(rawUserId)))
      ? new mongoose.Types.ObjectId(String(rawUserId))
      : new mongoose.Types.ObjectId();

    // Find Leads Module Definition with broad fallback
    let leadModule = await ModuleDefinition.findOne({
      $or: [
        { organizationId: orgId, apiPath: 'leads' },
        { organizationId: orgId, apiPath: 'lead' },
        { organizationId: orgId, name: new RegExp('^leads?$', 'i') },
        { apiPath: 'leads' },
        { apiPath: 'lead' },
        { name: new RegExp('^leads?$', 'i') }
      ]
    });

    if (!leadModule) {
      leadModule = (await ModuleDefinition.findOne()) || ({ _id: new mongoose.Types.ObjectId() } as any);
    }

    // Helper for fuzzy case-insensitive, space/symbol-agnostic field extraction
    const extractFuzzyField = (obj: Record<string, any>, targetKeys: string[], containsKeys: string[] = []): string => {
      if (!obj || typeof obj !== 'object') return '';
      // Direct match
      for (const k of targetKeys) {
        if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
          return String(obj[k]).trim();
        }
      }
      const normKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedTargets = targetKeys.map(normKey);
      const keys = Object.keys(obj);

      for (const k of keys) {
        const nk = normKey(k);
        if (normalizedTargets.includes(nk)) {
          const val = obj[k];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            return String(val).trim();
          }
        }
      }

      if (containsKeys.length > 0) {
        const normalizedContains = containsKeys.map(normKey);
        for (const k of keys) {
          const nk = normKey(k);
          if (normalizedContains.some(c => nk.includes(c))) {
            const val = obj[k];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              return String(val).trim();
            }
          }
        }
      }
      return '';
    };

    // Filter valid agent names
    const validAgents = agentNames.map((a: any) => String(a || '').trim()).filter(Boolean);
    if (validAgents.length === 0) {
      res.status(400).json({ error: 'At least one valid agent name is required.' });
      return;
    }

    // Distribute leads among agents with continuous offset
    const recordsToCreate: any[] = [];
    leads.forEach((lead: any, idx: number) => {
      const assignedAgent = validAgents[(agentOffset + idx) % validAgents.length];
      
      // Extract phone / mobile / contact number
      const phoneVal = extractFuzzyField(
        lead,
        ['phone', 'mobile', 'contact', 'contactNum', 'contact_num', 'contactNumber', 'contact_number', 'phoneNumber', 'phone_number', 'mobileNo', 'mobile_no', 'contactNo', 'contact_no', 'cell', 'telephone', 'phNo', 'mobNo', 'telNo', 'name_contact_num', 'nameContactNum', 'callNo', 'whatsappNo'],
        ['phone', 'mobile', 'contact', 'cell', 'tele']
      );

      // Extract customer name
      let customerVal = extractFuzzyField(
        lead,
        ['customer', 'customerName', 'customer_name', 'custName', 'client', 'clientName', 'firstName', 'name', 'fullName', 'buyer', 'buyerName', 'costomer', 'leadName'],
        ['customer', 'client']
      );
      if (!customerVal || customerVal === 'Unnamed') {
        customerVal = extractFuzzyField(lead, ['name', 'leadName', 'fullName']);
      }
      if (!customerVal) customerVal = 'Unnamed';

      let fName = customerVal;
      let lName = '';
      if (customerVal && customerVal !== 'Unnamed' && customerVal.includes(' ')) {
        const parts = customerVal.split(' ');
        fName = parts[0];
        lName = parts.slice(1).join(' ');
      }

      // Extract firm / company name
      const firmVal = extractFuzzyField(
        lead,
        ['company', 'firmName', 'firm_name', 'firm', 'businessName', 'business', 'agencyName', 'agency', 'shopName', 'shop', 'tradeName', 'treaderName', 'traderName', 'organization'],
        ['firm', 'company', 'agency', 'business', 'treader', 'trader']
      );

      // Extract location / city
      const locationVal = extractFuzzyField(
        lead,
        ['city', 'location', 'district', 'state', 'address', 'place', 'area', 'branch'],
        ['location', 'city', 'district', 'address']
      );

      // Extract lead category / loan type
      const categoryVal = extractFuzzyField(
        lead,
        ['leadCategory', 'lead_category', 'loanType', 'loan_type', 'category', 'product', 'service', 'leadType'],
        ['category', 'loantype']
      );

      // Extract data code
      const codeVal = extractFuzzyField(
        lead,
        ['dataCode', 'data_code', 'Data Code', 'data code', 'DataCode', 'datacode', 'code', 'leadCode', 'lead_code', 'lead code'],
        ['datacode', 'leadcode']
      );

      // Extract case details
      const caseVal = extractFuzzyField(
        lead,
        ['caseDetails', 'case_details', 'caseStatus', 'case_status', 'details', 'description', 'statusDetail'],
        ['case', 'details']
      );

      // Extract remarks / notes
      const remarksVal = extractFuzzyField(
        lead,
        ['notes', 'remarks', 'remark', 'note', 'comment', 'comments', 'feedback'],
        ['remark', 'note', 'comment']
      );

      // Extract email
      const emailVal = extractFuzzyField(
        lead,
        ['email', 'emailAddress', 'email_address', 'mail'],
        ['email', 'mail']
      );

      // Extract budget
      const budgetVal = extractFuzzyField(
        lead,
        ['budget', 'amount', 'loanAmount', 'loan_amount'],
        ['budget', 'amount']
      );

      recordsToCreate.push({
        organizationId: orgId,
        moduleId: leadModule?._id || new mongoose.Types.ObjectId(),
        createdBy: userId,
        updatedBy: userId,
        data: {
          ...lead, // Keep all raw excel headers and custom columns
          firstName: fName,
          lastName: lName,
          customerName: customerVal,
          customer: customerVal,
          phone: phoneVal,
          mobile: phoneVal,
          name_contact_num: phoneVal,
          contactNum: phoneVal,
          contact_num: phoneVal,
          contactNumber: phoneVal,
          email: emailVal,
          loanType: categoryVal,
          leadCategory: categoryVal,
          lead_category: categoryVal,
          budget: budgetVal,
          company: firmVal,
          firmName: firmVal,
          firm_name: firmVal,
          salary: lead.salary || '',
          city: locationVal,
          location: locationVal,
          state: lead.state || '',
          dataCode: codeVal,
          data_code: codeVal,
          caseDetails: caseVal,
          case_details: caseVal,
          notes: remarksVal,
          remarks: remarksVal,
          status: lead.status || 'New',
          dialStatus: 'Yet To Call',
          source: campaignName, // Set source as campaign name
          campaignName: campaignName,
          assignedTo: assignedAgent // Set agent name
        }
      });
    });

    // High-throughput chunked insertion (2,500 docs per chunk)
    const CHUNK_SIZE = 2500;
    let totalInserted = 0;
    for (let i = 0; i < recordsToCreate.length; i += CHUNK_SIZE) {
      const chunk = recordsToCreate.slice(i, i + CHUNK_SIZE);
      const chunkResult = await CustomRecord.insertMany(chunk, { ordered: false });
      totalInserted += (chunkResult ? chunkResult.length : chunk.length);
    }

    // Create Audit Log & notifications safely (non-blocking)
    if (isLastBatch !== false) {
      try {
        await AuditLog.create({
          organizationId: orgId,
          userId: userId,
          action: 'campaign.bulk_assign',
          resource: 'leads',
          newValue: {
            campaignName,
            agentCount: validAgents.length,
            assignedCount: totalInserted
          }
        });
      } catch (auditErr) {
        console.warn('Non-fatal audit log warning:', auditErr);
      }

      try {
        const agentCounts: Record<string, number> = {};
        recordsToCreate.forEach((r: any) => {
          const agent = r.data?.assignedTo;
          if (agent) {
            agentCounts[agent] = (agentCounts[agent] || 0) + 1;
          }
        });

        for (const [agentName, count] of Object.entries(agentCounts)) {
          await createNotification({
            organizationId: orgId,
            recipient: agentName,
            title: 'Campaign Leads Allocated',
            message: `${count} lead(s) from campaign '${campaignName}' were allocated to you.`,
            type: 'info',
            link: '/my-campaign'
          });
        }
      } catch (notifErr) {
        console.warn('Non-fatal notification warning:', notifErr);
      }
    }

    res.status(201).json({ message: `Successfully assigned ${totalInserted} leads to ${validAgents.length} agents.`, count: totalInserted });
  } catch (error: any) {
    console.error('Failed to bulk assign leads:', error);
    res.status(500).json({ error: error.message || 'Failed to bulk assign leads.' });
  }
});

// GET my campaigns (assigned to logged in user)
router.get('/campaigns/my-campaigns', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    // 1. Get registered campaigns from the Campaigns module
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

    // 2. Get the leads module
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(200).json({ campaigns: [] });
      return;
    }

    const leadQuery: Record<string, any> = {
      organizationId: orgId,
      moduleId: leadModule._id,
      $or: [
        { 'data.source': { $exists: true, $ne: '' } },
        { 'data.campaignName': { $exists: true, $ne: '' } },
        { 'data.campaign': { $exists: true, $ne: '' } },
        { 'data.campaign_name': { $exists: true, $ne: '' } }
      ]
    };

    // Filter by reporting hierarchy
    await HierarchyService.modifyRecordQuery(leadQuery, req.user as any, orgId!);

    let leads = await CustomRecord.find(leadQuery).lean();

    // Fallback: If hierarchy query found 0, fetch all leads for org
    if (leads.length === 0) {
      leads = await CustomRecord.find({
        organizationId: orgId,
        moduleId: leadModule._id,
        $or: [
          { 'data.source': { $exists: true, $ne: '' } },
          { 'data.campaignName': { $exists: true, $ne: '' } },
          { 'data.campaign': { $exists: true, $ne: '' } },
          { 'data.campaign_name': { $exists: true, $ne: '' } }
        ]
      }).lean();
    }

    // Group leads by campaign name — only include actual campaigns!
    const campaignGroups: Record<string, any[]> = {};
    leads.forEach((lead: any) => {
      const d = lead.data || {};
      const rawSource = (
        d.campaignName ||
        d.campaign ||
        d.campaign_name ||
        d.source
      )?.toString().trim();

      if (rawSource) {
        const lower = rawSource.toLowerCase();
        const genericSources = ['website', 'referral', 'cold call', 'social media', 'google ads', 'facebook ads', 'walk-in', 'direct'];
        const isRegistered = registeredCampaignNames.size === 0 || registeredCampaignNames.has(lower);

        if (isRegistered && (registeredCampaignNames.has(lower) || !genericSources.includes(lower))) {
          // Find canonical name from registered campaign or use raw
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

    const result = Object.keys(campaignGroups)
      .map(campName => {
        const groupLeads = campaignGroups[campName];
        const totalAssigned = groupLeads.length;
        
        // Accurate calculation of dialed leads:
        const dialed = groupLeads.filter(l => {
          const d = l.data || {};
          const dialSt = (d.dialStatus || '').toString().trim().toLowerCase();
          const st = (d.status || '').toString().trim().toLowerCase();
          const hasDialStatus = dialSt && dialSt !== 'yet to call' && dialSt !== 'not called' && dialSt !== 'new';
          const hasDialedStatus = st && st !== 'new' && st !== 'yet to call' && st !== 'not called';
          const hasCalls = (d.callAttempts && Number(d.callAttempts) > 0) || !!d.dialedAt;
          return hasDialedStatus || (hasCalls && hasDialStatus);
        }).length;
        
        const yetToDial = Math.max(0, totalAssigned - dialed);

        const campRecord = campaignRecords.find(c => {
          const d = c.data || {};
          const name = (d.campaignName || d.name || d.source || '').toString().trim();
          return name.toLowerCase() === campName.toLowerCase();
        });

        const createdAt = campRecord?.createdAt || groupLeads[0]?.createdAt || new Date();

        return {
          campaignName: campName,
          totalAssigned,
          dialed,
          yetToDial,
          createdAt,
          dailyTarget: 200
        };
      });

    res.status(200).json({ campaigns: result });
  } catch (error) {
    console.error('Failed to get my campaigns:', error);
    res.status(500).json({ error: 'Failed to retrieve campaigns.' });
  }
});

// GET my campaign details (assigned leads under campaignName)
router.get('/campaigns/my-campaigns/details/:campaignName', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const userId = req.user?.id;
    const { campaignName } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    // Get the leads module
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(404).json({ error: 'Leads module not found.' });
      return;
    }

    const decodedCampaignName = decodeURIComponent(campaignName).trim();
    const escName = decodedCampaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const campaignRegex = new RegExp('^\\s*' + escName + '\\s*$', 'i');

    const matchFilter = {
      $or: [
        { 'data.source': campaignRegex },
        { 'data.campaignName': campaignRegex },
        { 'data.campaign': campaignRegex },
        { 'data.campaign_name': campaignRegex }
      ]
    };

    const query: Record<string, any> = {
      organizationId: orgId,
      moduleId: leadModule._id,
      ...matchFilter
    };

    // Filter by reporting hierarchy
    await HierarchyService.modifyRecordQuery(query, req.user as any, orgId!);

    let leads = await CustomRecord.find(query).sort({ createdAt: -1 }).lean();

    // Fallback: If hierarchy query returns 0, try org-wide lookup for this campaign
    if (leads.length === 0) {
      const fallbackQuery: Record<string, any> = {
        organizationId: orgId,
        moduleId: leadModule._id,
        ...matchFilter
      };
      leads = await CustomRecord.find(fallbackQuery).sort({ createdAt: -1 }).lean();
    }

    // Ultimate Fallback: Try across all modules in organization matching campaign name
    if (leads.length === 0) {
      leads = await CustomRecord.find({
        organizationId: orgId,
        ...matchFilter
      }).sort({ createdAt: -1 }).lean();
    }

    res.status(200).json({ leads });
  } catch (error) {
    console.error('Failed to get my campaign details:', error);
    res.status(500).json({ error: 'Failed to retrieve campaign details.' });
  }
});

// 1. LIST RECORDS FOR A DYNAMIC MODULE
router.get('/:apiPath', async (req: Request, res: Response): Promise<void> => {
  try {
    const { apiPath } = req.params;
    const { search, page = '1', limit = '50', sort } = req.query;

    const moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (!moduleDef) {
      res.status(404).json({ error: `Module path not found: ${apiPath}` });
      return;
    }

    // RBAC validation
    const { allowed, scope } = await authorizeModuleAction(req, res, moduleDef.name, 'read');
    if (!allowed) {
      res.status(403).json({ error: `Access Denied: Read permission absent for module ${moduleDef.name}` });
      return;
    }

    // Construct Query Filters
    const query: Record<string, any> = {
      organizationId: req.organizationId,
      moduleId: moduleDef._id
    };

    if (scope === 'own') {
      query.createdBy = req.user?.id;
    }


    // Parse other fields for inline filters, e.g. ?data.status=HOT LEADS
    Object.keys(req.query).forEach((q) => {
      if (q.startsWith('data.')) {
        const val = req.query[q];
        if (typeof val === 'string' && val.trim()) {
          const cleanVal = val.trim();
          if (q === 'data.status' || q === 'data.leadStatus') {
            const noLeadsVal = cleanVal.replace(/\s+leads$/i, '');
            const withLeadsVal = noLeadsVal + ' LEADS';
            const variations = Array.from(new Set([cleanVal, noLeadsVal, withLeadsVal]));
            const regexVariations = variations.map(
              (v) => new RegExp(`^\\s*${v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`, 'i')
            );
            const statusFilter = {
              $or: [
                { 'data.status': { $in: regexVariations } },
                { 'data.leadStatus': { $in: regexVariations } }
              ]
            };
            if (query.$and) {
              query.$and.push(statusFilter);
            } else {
              query.$and = [statusFilter];
            }
          } else {
            const escVal = cleanVal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            query[q] = { $regex: new RegExp(`^${escVal}$`, 'i') };
          }
        } else {
          query[q] = val;
        }
      }
    });

    // Global Search across text fields, lead number, created by, and common entity fields
    if (search && typeof search === 'string' && search.trim()) {
      const trimmedSearch = search.trim();
      const escSearch = trimmedSearch.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const searchRegex = { $regex: escSearch, $options: 'i' };

      // 1. Find matching users for createdBy / updatedBy search
      const matchedUsers = await User.find({
        organizationId: req.organizationId,
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { name: searchRegex },
          { email: searchRegex },
          { userCode: searchRegex }
        ]
      }).select('_id');
      const matchedUserIds = matchedUsers.map((u) => u._id);

      const searchConditions: any[] = [
        // Match module dynamic fields
        ...moduleDef.fields
          .filter((f) => ['text', 'email', 'phone', 'rich-text', 'url', 'select', 'number'].includes(f.type))
          .map((f) => ({ [`data.${f.name}`]: searchRegex })),
        // Match standard lead name and number fields
        { 'data.name': searchRegex },
        { 'data.firstName': searchRegex },
        { 'data.lastName': searchRegex },
        { 'data.customerName': searchRegex },
        { 'data.leadName': searchRegex },
        { 'data.applicantName': searchRegex },
        { 'data.clientName': searchRegex },
        { 'data.leadNo': searchRegex },
        { 'data.leadNumber': searchRegex },
        { 'data.lead_no': searchRegex },
        { 'data.leadId': searchRegex },
        { 'data.leadCode': searchRegex },
        { 'data.firmName': searchRegex },
        { 'data.company': searchRegex },
        { 'data.companyName': searchRegex },
        { 'data.phone': searchRegex },
        { 'data.phoneNumber': searchRegex },
        { 'data.mobile': searchRegex },
        { 'data.mobileNumber': searchRegex },
        { 'data.email': searchRegex },
        { 'data.source': searchRegex },
        { 'data.campaign': searchRegex },
        { 'data.campaignName': searchRegex },
        { 'data.assignedTo': searchRegex }
      ];

      // Match createdBy / updatedBy users
      if (matchedUserIds.length > 0) {
        searchConditions.push({ createdBy: { $in: matchedUserIds } });
        searchConditions.push({ updatedBy: { $in: matchedUserIds } });
      }

      // If search query is a valid 24-character MongoDB ObjectId
      if (/^[0-9a-fA-F]{24}$/.test(trimmedSearch)) {
        searchConditions.push({ _id: new mongoose.Types.ObjectId(trimmedSearch) });
      }

      if (searchConditions.length > 0) {
        query.$or = searchConditions;
      }
    }

    // Apply Dynamic Reporting Manager Hierarchy filtering
    await HierarchyService.modifyRecordQuery(query, req.user as any, req.organizationId!);

    // Pagination
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skipNum = (pageNum - 1) * limitNum;

    // Sorting
    let sortOption: Record<string, any> = { createdAt: -1 };
    if (sort && typeof sort === 'string') {
      const isDesc = sort.startsWith('-');
      const sortField = isDesc ? sort.substring(1) : sort;
      sortOption = { [sortField.startsWith('data.') ? sortField : `data.${sortField}`]: isDesc ? -1 : 1 };
    }

    const records = await CustomRecord.find(query)
      .populate('createdBy', 'firstName lastName name email')
      .populate('updatedBy', 'firstName lastName name email')
      .sort(sortOption)
      .skip(skipNum)
      .limit(limitNum);

    // Resolve any User ObjectIds/hashes in data.assignedTo, data.assignedBy, data.psm to real names
    const userIdsToFetch = new Set<string>();
    records.forEach(r => {
      if (r.data?.assignedTo && /^[0-9a-fA-F]{24}$/.test(String(r.data.assignedTo))) {
        userIdsToFetch.add(String(r.data.assignedTo));
      }
      if (r.data?.assignedBy && /^[0-9a-fA-F]{24}$/.test(String(r.data.assignedBy))) {
        userIdsToFetch.add(String(r.data.assignedBy));
      }
      if (r.data?.psm && /^[0-9a-fA-F]{24}$/.test(String(r.data.psm))) {
        userIdsToFetch.add(String(r.data.psm));
      }
    });

    if (userIdsToFetch.size > 0) {
      const userDocs = await User.find({ _id: { $in: Array.from(userIdsToFetch) } }).select('firstName lastName name email');
      const userMap = new Map(userDocs.map(u => [u._id.toString(), `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]));

      records.forEach((r: any) => {
        if (r.data) {
          if (r.data.assignedTo && userMap.has(String(r.data.assignedTo))) {
            r.data.assignedToName = userMap.get(String(r.data.assignedTo));
            r.data.assignedTo = userMap.get(String(r.data.assignedTo));
          }
          if (r.data.assignedBy && userMap.has(String(r.data.assignedBy))) {
            r.data.assignedByName = userMap.get(String(r.data.assignedBy));
            r.data.assignedBy = userMap.get(String(r.data.assignedBy));
          }
          if (r.data.psm && userMap.has(String(r.data.psm))) {
            r.data.psmName = userMap.get(String(r.data.psm));
            r.data.psm = userMap.get(String(r.data.psm));
          }
        }
      });
    }

    const total = await CustomRecord.countDocuments(query);

    res.status(200).json({
      records,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('List Records Error:', error);
    res.status(500).json({ error: 'Failed to retrieve records.' });
  }
});

// 2. CREATE A RECORD
router.post('/:apiPath', async (req: Request, res: Response): Promise<void> => {
  try {
    const { apiPath } = req.params;
    const recordData = req.body.data ? req.body.data : req.body;

    const moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (!moduleDef) {
      res.status(404).json({ error: `Module definition not found: ${apiPath}` });
      return;
    }

    // Check RBAC permissions
    const { allowed } = await authorizeModuleAction(req, res, moduleDef.name, 'create');
    if (!allowed) {
      res.status(403).json({ error: `Access Denied: Create permission absent for module ${moduleDef.name}` });
      return;
    }

    // Normalize field synonyms for leads module (phone/mobile, city/location, company/firm, customer/names, loanType/category)
    if (apiPath.toLowerCase() === 'leads') {
      const extractedPhone = recordData.phone || recordData.mobile || recordData.contact || recordData.contactNum || recordData.contact_num || recordData['CONTACT NUM'] || recordData['contact num'] || recordData.contactNumber || recordData.phoneNumber || '';
      if (extractedPhone) {
        recordData.phone = extractedPhone;
        recordData.mobile = extractedPhone;
        recordData.contactNum = extractedPhone;
        recordData.contact_num = extractedPhone;
      }

      const extractedLocation = recordData.city || recordData.location || recordData['LOCATION'] || recordData['location'] || recordData.presentAddress || recordData.district || recordData.place || '';
      if (extractedLocation) {
        if (!recordData.city) recordData.city = extractedLocation;
        if (!recordData.location) recordData.location = extractedLocation;
      }

      const extractedCompany = recordData.company || recordData.firmName || recordData.firm_name || recordData['FIRM_NAME'] || recordData['firm_name'] || recordData.firm || recordData.businessName || '';
      if (extractedCompany) {
        if (!recordData.company) recordData.company = extractedCompany;
        if (!recordData.firmName) recordData.firmName = extractedCompany;
        if (!recordData.firm_name) recordData.firm_name = extractedCompany;
      }

      if (!recordData.firstName && (recordData.customer || recordData.customerName || recordData.customer_name || recordData['CUSTOMER'] || recordData['customer'] || recordData.fullName || recordData.name)) {
        const full = String(recordData.customer || recordData.customerName || recordData.customer_name || recordData['CUSTOMER'] || recordData['customer'] || recordData.fullName || recordData.name).trim();
        if (full.includes(' ')) {
          const parts = full.split(' ');
          recordData.firstName = parts[0];
          recordData.lastName = parts.slice(1).join(' ');
        } else {
          recordData.firstName = full;
          recordData.lastName = recordData.lastName || '';
        }
      }
      if (recordData.firstName || recordData.lastName) {
        const full = `${recordData.firstName || ''} ${recordData.lastName || ''}`.trim();
        recordData.customerName = full;
        recordData.customer = full;
        recordData.fullName = full;
      }

      const extractedCategory = recordData.loanType || recordData.leadCategory || recordData.lead_category || recordData['LEAD_CATEGORY'] || recordData['lead_category'] || recordData.category || recordData.product || '';
      if (extractedCategory) {
        if (!recordData.loanType) recordData.loanType = extractedCategory;
        if (!recordData.leadCategory) recordData.leadCategory = extractedCategory;
        if (!recordData.lead_category) recordData.lead_category = extractedCategory;
      }
    }

    // Populate default values for missing fields
    moduleDef.fields.forEach((field) => {
      if (field.defaultValue && (recordData[field.name] === undefined || recordData[field.name] === null || recordData[field.name] === '')) {
        recordData[field.name] = field.defaultValue;
      }
    });

    // Validate inputs
    const validationErrors = validateFields(moduleDef.fields, recordData);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Unique field validation
    for (const field of moduleDef.fields) {
      if (field.unique && recordData[field.name]) {
        const duplicate = await CustomRecord.findOne({
          organizationId: req.organizationId,
          moduleId: moduleDef._id,
          [`data.${field.name}`]: recordData[field.name]
        });
        if (duplicate) {
          res.status(400).json({ error: `Duplicate error: Value for '${field.label}' must be unique.` });
          return;
        }
      }
    }

    // Evaluate Calculated / Formula fields
    moduleDef.fields.forEach((field) => {
      if (field.type === 'formula' && field.formulaExpression) {
        const computed = FormulaEvaluator.evaluate(field.formulaExpression, recordData);
        if (computed !== null) {
          recordData[field.name] = computed;
        }
      }
    });

    const creatorId = new mongoose.Types.ObjectId(req.user?.id);
    const newRecord = await CustomRecord.create({
      organizationId: req.organizationId,
      moduleId: moduleDef._id,
      data: recordData,
      createdBy: creatorId,
      updatedBy: creatorId
    });

    // Timeline Logging (Activity)
    await Activity.create({
      organizationId: req.organizationId,
      recordId: newRecord._id,
      userId: creatorId,
      type: 'create',
      details: {}
    });

    // System Auditing
    await AuditLog.create({
      organizationId: req.organizationId,
      userId: creatorId,
      action: 'record.create',
      resource: moduleDef.name,
      resourceId: String(newRecord._id),
      newValue: recordData
    });

    // Generate Notification if assignedTo is set
    if (recordData.assignedTo) {
      const name = `${recordData.firstName || ''} ${recordData.lastName || ''}`.trim() || moduleDef.singularLabel || 'Record';
      await createNotification({
        organizationId: req.organizationId,
        recipient: recordData.assignedTo,
        title: `${moduleDef.singularLabel || 'Lead'} Assigned`,
        message: `${moduleDef.singularLabel || 'Lead'} '${name}' has been assigned to you.`,
        type: 'info',
        link: `/modules/${apiPath.toLowerCase()}/${newRecord._id}`
      });
    }

    // Execute Workflows
    WorkflowEngine.trigger(req.organizationId as any, moduleDef._id as any, 'create', newRecord);

    res.status(201).json(newRecord);
  } catch (error) {
    console.error('Create Record Error:', error);
    res.status(500).json({ error: 'Failed to create record.' });
  }
});

// 3. READ SINGLE RECORD
router.get('/:apiPath/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { apiPath, id } = req.params;

    const moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (!moduleDef) {
      res.status(404).json({ error: 'Module not found.' });
      return;
    }

    const { allowed, scope } = await authorizeModuleAction(req, res, moduleDef.name, 'read');
    if (!allowed) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const query: Record<string, any> = {
      _id: id,
      organizationId: req.organizationId
    };

    if (scope === 'own') {
      query.createdBy = req.user?.id;
    }

    // Apply Dynamic Reporting Manager Hierarchy filtering
    await HierarchyService.modifyRecordQuery(query, req.user as any, req.organizationId!);

    const record = await CustomRecord.findOne(query)
      .populate('createdBy', 'firstName lastName name email')
      .populate('updatedBy', 'firstName lastName name email');
    if (!record) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }

    if (record.data) {
      const ids = [record.data.assignedTo, record.data.assignedBy, record.data.psm]
        .filter(id => id && /^[0-9a-fA-F]{24}$/.test(String(id)));
      if (ids.length > 0) {
        const users = await User.find({ _id: { $in: ids } }).select('firstName lastName name email');
        const userMap = new Map(users.map(u => [u._id.toString(), `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]));
        if (record.data.assignedTo && userMap.has(String(record.data.assignedTo))) {
          record.data.assignedToName = userMap.get(String(record.data.assignedTo));
          record.data.assignedTo = userMap.get(String(record.data.assignedTo));
        }
        if (record.data.assignedBy && userMap.has(String(record.data.assignedBy))) {
          record.data.assignedByName = userMap.get(String(record.data.assignedBy));
          record.data.assignedBy = userMap.get(String(record.data.assignedBy));
        }
        if (record.data.psm && userMap.has(String(record.data.psm))) {
          record.data.psmName = userMap.get(String(record.data.psm));
          record.data.psm = userMap.get(String(record.data.psm));
        }
      }
    }

    res.status(200).json(record);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve record.' });
  }
});

// 4. UPDATE A RECORD
router.put('/:apiPath/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { apiPath, id } = req.params;
    const updateData = req.body.data ? req.body.data : req.body;

    const moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (!moduleDef) {
      res.status(404).json({ error: 'Module not found.' });
      return;
    }

    // Check RBAC permissions
    const { allowed, scope } = await authorizeModuleAction(req, res, moduleDef.name, 'update');
    if (!allowed) {
      res.status(403).json({ error: `Access Denied: Update permission absent for module ${moduleDef.name}` });
      return;
    }

    const recordQuery: Record<string, any> = {
      _id: id,
      organizationId: req.organizationId
    };
    if (scope === 'own') {
      recordQuery.createdBy = req.user?.id;
    }

    // Apply Dynamic Reporting Manager Hierarchy filtering
    await HierarchyService.modifyRecordQuery(recordQuery, req.user as any, req.organizationId!);

    const record = await CustomRecord.findOne(recordQuery);
    if (!record) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }

    const oldValues = record.data instanceof Map ? Object.fromEntries(record.data) : (record.data || {});

    // Normalize field synonyms for leads module (phone/mobile, city/location, company/firm, customer/names, loanType/category)
    if (apiPath.toLowerCase() === 'leads') {
      const extractedPhone = updateData.phone || updateData.mobile || updateData.contact || updateData.contactNum || updateData.contact_num || updateData['CONTACT NUM'] || updateData['contact num'] || updateData.contactNumber || updateData.phoneNumber || '';
      if (extractedPhone) {
        updateData.phone = extractedPhone;
        updateData.mobile = extractedPhone;
        updateData.contactNum = extractedPhone;
        updateData.contact_num = extractedPhone;
      }

      const extractedLocation = updateData.city || updateData.location || updateData['LOCATION'] || updateData['location'] || updateData.presentAddress || updateData.district || updateData.place || '';
      if (extractedLocation) {
        if (!updateData.city) updateData.city = extractedLocation;
        if (!updateData.location) updateData.location = extractedLocation;
      }

      const extractedCompany = updateData.company || updateData.firmName || updateData.firm_name || updateData['FIRM_NAME'] || updateData['firm_name'] || updateData.firm || updateData.businessName || '';
      if (extractedCompany) {
        if (!updateData.company) updateData.company = extractedCompany;
        if (!updateData.firmName) updateData.firmName = extractedCompany;
        if (!updateData.firm_name) updateData.firm_name = extractedCompany;
      }

      if (updateData.customer || updateData.customerName || updateData.customer_name || updateData['CUSTOMER'] || updateData['customer'] || updateData.fullName) {
        const full = String(updateData.customer || updateData.customerName || updateData.customer_name || updateData['CUSTOMER'] || updateData['customer'] || updateData.fullName).trim();
        if (full.includes(' ')) {
          const parts = full.split(' ');
          updateData.firstName = parts[0];
          updateData.lastName = parts.slice(1).join(' ');
        } else {
          updateData.firstName = full;
        }
      }
      if (updateData.firstName || updateData.lastName) {
        const full = `${updateData.firstName || oldValues.firstName || ''} ${updateData.lastName || oldValues.lastName || ''}`.trim();
        updateData.customerName = full;
        updateData.customer = full;
        updateData.fullName = full;
      }

      const extractedCategory = updateData.loanType || updateData.leadCategory || updateData.lead_category || updateData['LEAD_CATEGORY'] || updateData['lead_category'] || updateData.category || updateData.product || '';
      if (extractedCategory) {
        if (!updateData.loanType) updateData.loanType = extractedCategory;
        if (!updateData.leadCategory) updateData.leadCategory = extractedCategory;
        if (!updateData.lead_category) updateData.lead_category = extractedCategory;
      }
    }

    // Validate inputs against the merged data
    const mergedData = {
      ...oldValues,
      ...updateData
    };
    const validationErrors = validateFields(moduleDef.fields, mergedData, oldValues);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Unique field validation (excluding self)
    for (const field of moduleDef.fields) {
      if (field.unique && updateData[field.name]) {
        const duplicate = await CustomRecord.findOne({
          organizationId: req.organizationId,
          moduleId: moduleDef._id,
          _id: { $ne: record._id },
          [`data.${field.name}`]: updateData[field.name]
        });
        if (duplicate) {
          res.status(400).json({ error: `Value for '${field.label}' must be unique.` });
          return;
        }
      }
    }

    // Capture changed fields
    const changedFields: string[] = [];

    Object.keys(updateData).forEach((key) => {
      if (String(oldValues[key]) !== String(updateData[key])) {
        changedFields.push(key);
      }
    });

    // Evaluate Calculated / Formula fields based on updated data values
    moduleDef.fields.forEach((field) => {
      if (field.type === 'formula' && field.formulaExpression) {
        const computed = FormulaEvaluator.evaluate(field.formulaExpression, {
          ...oldValues,
          ...updateData
        });
        if (computed !== null) {
          updateData[field.name] = computed;
        }
      }
    });

    // Perform Update
    const updaterId = new mongoose.Types.ObjectId(req.user?.id);
    record.data = {
      ...oldValues,
      ...updateData
    };
    record.updatedBy = updaterId;
    await record.save();

    // Log Activity logs for status updates or assignments
    for (const fieldName of changedFields) {
      await Activity.create({
        organizationId: req.organizationId,
        recordId: record._id,
        userId: updaterId,
        type: fieldName === 'status' ? 'status_change' : 'edit',
        details: {
          fieldName,
          oldValue: oldValues[fieldName],
          newValue: updateData[fieldName]
        }
      });
    }

    // System Audit Log
    await AuditLog.create({
      organizationId: req.organizationId,
      userId: updaterId,
      action: 'record.update',
      resource: moduleDef.name,
      resourceId: String(record._id),
      oldValue: oldValues,
      newValue: updateData
    });

    // Generate Notifications for assignedTo or status changes
    const recName = `${record.data?.firstName || ''} ${record.data?.lastName || ''}`.trim() || moduleDef.singularLabel || 'Record';
    const userObj = req.user as any;
    const updaterName = userObj?.firstName ? `${userObj.firstName} ${userObj.lastName || ''}`.trim() : (userObj?.email || 'System');

    if (changedFields.includes('assignedTo') && updateData.assignedTo) {
      await createNotification({
        organizationId: req.organizationId,
        recipient: updateData.assignedTo,
        title: `${moduleDef.singularLabel || 'Lead'} Assigned`,
        message: `${moduleDef.singularLabel || 'Lead'} '${recName}' was assigned to you by ${updaterName}.`,
        type: 'info',
        link: `/modules/${apiPath.toLowerCase()}/${record._id}`
      });
    }

    if (changedFields.includes('status') && record.data?.assignedTo) {
      await createNotification({
        organizationId: req.organizationId,
        recipient: record.data.assignedTo,
        title: `${moduleDef.singularLabel || 'Lead'} Status Updated`,
        message: `Status of '${recName}' was updated to '${updateData.status}' by ${updaterName}.`,
        type: 'info',
        link: `/modules/${apiPath.toLowerCase()}/${record._id}`
      });
    }

    // Execute Workflows
    WorkflowEngine.trigger(req.organizationId as any, moduleDef._id as any, 'update', record, changedFields);

    res.status(200).json(record);
  } catch (error) {
    console.error('Update Record Error:', error);
    res.status(500).json({ error: 'Failed to update record.' });
  }
});

// 5. DELETE A RECORD
router.delete('/:apiPath/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { apiPath, id } = req.params;

    const moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (!moduleDef) {
      res.status(404).json({ error: 'Module not found.' });
      return;
    }

    const { allowed, scope } = await authorizeModuleAction(req, res, moduleDef.name, 'delete');
    if (!allowed) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const query: Record<string, any> = {
      _id: id,
      organizationId: req.organizationId
    };
    if (scope === 'own') {
      query.createdBy = req.user?.id;
    }

    // Apply Dynamic Reporting Manager Hierarchy filtering
    await HierarchyService.modifyRecordQuery(query, req.user as any, req.organizationId!);

    const record = await CustomRecord.findOne(query);
    if (!record) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }

    await CustomRecord.findByIdAndDelete(record._id);

    // Audit logs
    await AuditLog.create({
      organizationId: req.organizationId,
      userId: new mongoose.Types.ObjectId(req.user?.id),
      action: 'record.delete',
      resource: moduleDef.name,
      resourceId: String(record._id),
      oldValue: record.data
    });

    // Execute delete workflow triggers
    WorkflowEngine.trigger(req.organizationId as any, moduleDef._id as any, 'delete', record);

    res.status(200).json({ message: 'Record deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete record.' });
  }
});

// Transfer leads between agents
router.post('/transfer/leads', async (req: Request, res: Response): Promise<void> => {
  try {
    const { fromAgentId, fromAgentName, toAgentId, toAgentName } = req.body;

    if (!fromAgentId || !toAgentId || !fromAgentName || !toAgentName) {
      res.status(400).json({ error: 'fromAgentId, fromAgentName, toAgentId, and toAgentName are required.' });
      return;
    }

    const moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: 'leads'
    });

    if (!moduleDef) {
      res.status(404).json({ error: 'Leads module not found.' });
      return;
    }

    // Update all leads matching the source agent's ID or name
    const result = await CustomRecord.updateMany(
      {
        organizationId: req.organizationId,
        moduleId: moduleDef._id,
        $or: [
          { 'data.assignedTo': fromAgentId },
          { 'data.assignedTo': fromAgentName }
        ]
      },
      {
        $set: { 'data.assignedTo': toAgentName } // Store as full name for display compatibility
      }
    );

    // Create Audit Log
    await AuditLog.create({
      organizationId: req.organizationId,
      userId: new mongoose.Types.ObjectId(req.user?.id),
      action: 'leads.transfer',
      resource: 'leads',
      details: {
        fromAgentId,
        fromAgentName,
        toAgentId,
        toAgentName,
        modifiedCount: result.modifiedCount
      }
    });

    // Generate Notification for target agent
    if (result.modifiedCount > 0) {
      await createNotification({
        organizationId: req.organizationId,
        recipient: toAgentId || toAgentName,
        title: 'Leads Transferred to You',
        message: `${result.modifiedCount} lead(s) were transferred to you from ${fromAgentName}.`,
        type: 'info',
        link: '/modules/leads'
      });
    }

    res.status(200).json({ message: 'Leads transferred successfully.', modifiedCount: result.modifiedCount });
  } catch (error: any) {
    console.error('Failed to transfer leads:', error);
    res.status(500).json({ error: 'Failed to transfer leads.' });
  }
});

// GET record activity history
router.get('/:apiPath/:id/activities', async (req: Request, res: Response): Promise<void> => {
  try {
    const recordQuery = {
      _id: req.params.id,
      organizationId: req.organizationId
    };
    await HierarchyService.modifyRecordQuery(recordQuery, req.user as any, req.organizationId!);

    const record = await CustomRecord.findOne(recordQuery);
    if (!record) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const activities = await Activity.find({
      organizationId: req.organizationId,
      recordId: new mongoose.Types.ObjectId(req.params.id)
    })
    .populate('userId', 'firstName lastName email')
    .sort({ createdAt: -1 });

    res.status(200).json(activities);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve record activities.' });
  }
});

export default router;
