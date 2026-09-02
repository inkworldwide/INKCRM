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

// ── In-Memory Role Cache (60s TTL + Instant Invalidation) ─────────────────────
interface CachedRole {
  role: any;
  expiresAt: number;
}
const roleCacheMap = new Map<string, CachedRole>();
const ROLE_CACHE_TTL_MS = 60 * 1000; // 60 seconds

export const invalidateRoleCache = (roleId?: string) => {
  if (roleId) {
    roleCacheMap.delete(String(roleId));
  } else {
    roleCacheMap.clear();
  }
};

export const clearRoleCache = () => {
  roleCacheMap.clear();
};

const getCachedRole = async (roleId?: any) => {
  if (!roleId) return null;
  const idStr = String(roleId);
  const now = Date.now();
  const cached = roleCacheMap.get(idStr);

  if (cached && cached.expiresAt > now) {
    return cached.role;
  }

  const role = await Role.findById(roleId);
  if (role) {
    roleCacheMap.set(idStr, { role, expiresAt: now + ROLE_CACHE_TTL_MS });
  }
  return role;
};

// Helper: Check Role Permission dynamically
const authorizeModuleAction = async (
  req: Request,
  res: Response,
  moduleName: string,
  action: 'create' | 'read' | 'update' | 'delete'
): Promise<{ allowed: boolean; scope: 'all' | 'own' }> => {
  try {
    const role = await getCachedRole(req.user?.roleId);
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
      (m: any) => matchModuleName(m.moduleName, moduleName)
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
    const campaignName = (req.query.campaignName as string || '').trim();
    
    // Find Lead Module Definition
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(200).json({ stats: {}, dialedStats: {} });
      return;
    }

    let matchCriteria: any = { organizationId: orgId, moduleId: leadModule._id };
    
    if (campaignName) {
      matchCriteria.$or = [
        { 'data.source': new RegExp(`^${campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') },
        { 'data.campaignName': new RegExp(`^${campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') },
        { 'data.campaign': new RegExp(`^${campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') },
        { 'data.campaign_name': new RegExp(`^${campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') }
      ];
    }

    // Aggregate count of leads grouped by assignedTo
    const stats = await CustomRecord.aggregate([
      { $match: matchCriteria },
      { $group: { _id: '$data.assignedTo', count: { $sum: 1 } } }
    ]);

    let dialedMatchCriteria: any = {
      organizationId: orgId,
      moduleId: leadModule._id,
      $and: [
        {
          $or: [
            { 'data.dialedAt': { $exists: true, $ne: null } },
            { 'data.lastCallDate': { $exists: true, $ne: null } },
            { 'data.callAttempts': { $gt: 0 } },
            { 
              'data.dialStatus': { 
                $in: [
                  'HOT LEAD', 'WARM LEAD', 'COOL LEAD', 'CAL BACK', 'GIVEN LOGIN', 
                  'FOLLOWUP', 'not intrested', 'no answer', 'call reject', 'call not connect', 
                  'wrong num', 'NUM NOT EXIT', 'repeated num', 'no business',
                  'Called', 'Ringing', 'Answered', 'Connected', 'Busy', 'No Answer', 
                  'Call Back', 'Scheduled', 'Interested', 'Not Interested', 'Converted', 
                  'Disbursed', 'Approved', 'Rejected', 'Wrong Number'
                ] 
              } 
            }
          ]
        }
      ]
    };

    if (campaignName) {
      dialedMatchCriteria.$and.push({
        $or: [
          { 'data.source': new RegExp(`^${campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') },
          { 'data.campaignName': new RegExp(`^${campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') },
          { 'data.campaign': new RegExp(`^${campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') },
          { 'data.campaign_name': new RegExp(`^${campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') }
        ]
      });
    }

    // Aggregate count of dialed leads
    const dialedStats = await CustomRecord.aggregate([
      { $match: dialedMatchCriteria },
      { $group: { _id: '$data.assignedTo', count: { $sum: 1 } } }
    ]);

    const statsMap: Record<string, number> = {};
    stats.forEach(item => {
      if (item._id) {
        statsMap[item._id.toString()] = item.count;
      }
    });

    const dialedMap: Record<string, number> = {};
    if (campaignName) {
      dialedStats.forEach(item => {
        if (item._id) {
          dialedMap[item._id.toString()] = item.count;
        }
      });
    }

    // Aggregated campaign-level stats via fast MongoDB pipeline
    const campaignAllocatedStats: Record<string, number> = {};
    const campaignDialedStats: Record<string, number> = {};

    const campAllocAgg = await CustomRecord.aggregate([
      {
        $match: {
          organizationId: orgId,
          moduleId: leadModule._id,
          $or: [
            { 'data.campaignName': { $exists: true, $ne: '' } },
            { 'data.source': { $exists: true, $ne: '' } },
            { 'data.campaign': { $exists: true, $ne: '' } }
          ]
        }
      },
      {
        $project: {
          campName: {
            $toLower: {
              $ifNull: ['$data.campaignName', { $ifNull: ['$data.source', '$data.campaign'] }]
            }
          }
        }
      },
      { $group: { _id: '$campName', count: { $sum: 1 } } }
    ]);

    campAllocAgg.forEach(item => {
      if (item._id) {
        campaignAllocatedStats[item._id.toString().trim()] = item.count;
      }
    });

    const campDialedAgg = await CustomRecord.aggregate([
      {
        $match: {
          organizationId: orgId,
          moduleId: leadModule._id,
          $and: [
            {
              $or: [
                { 'data.campaignName': { $exists: true, $ne: '' } },
                { 'data.source': { $exists: true, $ne: '' } },
                { 'data.campaign': { $exists: true, $ne: '' } }
              ]
            },
            {
              $or: [
                { 'data.dialedAt': { $exists: true, $ne: null } },
                { 'data.lastCallDate': { $exists: true, $ne: null } },
                { 'data.callAttempts': { $gt: 0 } },
                { 
                  'data.dialStatus': { 
                    $in: [
                      'Called', 'Ringing', 'Answered', 'Connected', 'Busy', 'No Answer', 
                      'Call Back', 'Scheduled', 'Interested', 'Not Interested', 'Converted', 
                      'Disbursed', 'Approved', 'Rejected', 'Wrong Number'
                    ] 
                  } 
                }
              ]
            }
          ]
        }
      },
      {
        $project: {
          campName: {
            $toLower: {
              $ifNull: ['$data.campaignName', { $ifNull: ['$data.source', '$data.campaign'] }]
            }
          }
        }
      },
      { $group: { _id: '$campName', count: { $sum: 1 } } }
    ]);

    campDialedAgg.forEach(item => {
      if (item._id) {
        campaignDialedStats[item._id.toString().trim()] = item.count;
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
      let codeVal = extractFuzzyField(
        lead,
        ['dataCode', 'data_code', 'Data Code', 'data code', 'DataCode', 'datacode', 'code', 'leadCode', 'lead_code', 'lead code'],
        ['datacode', 'leadcode', 'code']
      );

      if (!codeVal) {
        // Direct property check on raw lead object
        const leadKeys = Object.keys(lead || {});
        for (const k of leadKeys) {
          const lowerK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (lowerK.includes('datacode') || lowerK.includes('data_code') || lowerK === 'code' || lowerK.includes('leadcode')) {
            const v = String(lead[k] || '').trim();
            if (v && v !== 'N/A' && v !== 'Unnamed') {
              codeVal = v;
              break;
            }
          }
        }
        // Fallback to Column B (2nd property in row) if data code column header was customized
        if (!codeVal && leadKeys.length >= 2) {
          const colBVal = String(lead[leadKeys[1]] || '').trim();
          if (colBVal && colBVal !== 'N/A' && colBVal !== 'Unnamed' && !colBVal.startsWith('http')) {
            codeVal = colBVal;
          }
        }
      }

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

      const finalDataCode = codeVal || lead.dataCode || lead.data_code || lead['Data Code'] || lead['data code'] || lead.datacode || '';

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
          dataCode: finalDataCode,
          data_code: finalDataCode,
          'Data Code': finalDataCode,
          'data code': finalDataCode,
          datacode: finalDataCode,
          DataCode: finalDataCode,
          caseDetails: caseVal,
          case_details: caseVal,
          notes: remarksVal,
          remarks: remarksVal,
          status: lead.status || lead.Status || lead.leadStatus || lead.dialStatus || 'New',
          normalizedStatus: normalizeStatusName(lead.status || lead.Status || lead.leadStatus || lead.dialStatus || 'New'),
          dialStatus: lead.dialStatus || 'Yet To Call',
          callAttempts: 0,
          dialedAt: null,
          lastCallDate: null,
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

// Helper to build user-assignment filter for My Campaigns
const buildUserAssignmentFilter = (user: any) => {
  const uId = String(user._id || user.id || '');
  const uEmail = (user.email || '').toString().trim();
  const uName = (user.name || `${user.firstName || ''} ${user.lastName || ''}`).toString().trim();
  const uCode = (user.userCode || '').toString().trim();

  const userOrConditions: any[] = [
    { 'data.assignedTo': uId },
    { 'data.assignedToUserId': uId },
    { 'data.telecaller': uId },
    { 'data.assignedAgent': uId }
  ];

  if (mongoose.Types.ObjectId.isValid(uId)) {
    userOrConditions.push({ assignedTo: new mongoose.Types.ObjectId(uId) });
  }

  const textMatchTerms = [uName, uEmail, uCode].filter(Boolean);
  textMatchTerms.forEach(term => {
    const escTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp('^\\s*' + escTerm + '\\s*$', 'i');
    userOrConditions.push({ 'data.assignedTo': regex });
    userOrConditions.push({ 'data.telecaller': regex });
    userOrConditions.push({ 'data.assignedAgent': regex });
    userOrConditions.push({ 'data.assignedToName': regex });
  });

  return { $or: userOrConditions };
};

// GET my campaigns (assigned to logged in user)
router.get('/campaigns/my-campaigns', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const userDoc = await User.findById(userId).select('_id firstName lastName email userCode name role');
    const userObj = userDoc ? userDoc.toObject() : { id: userId, ...req.user };

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

    const isAdmin = (await HierarchyService.isSuperAdmin(userObj.roleId)) ||
      ['super admin', 'admin', 'administrator', 'org admin'].includes(String((userObj as any).role || '').toLowerCase()) ||
      (userObj.email && userObj.email.toLowerCase().includes('ink@crm'));

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

    let leads: any[] = [];
    if (isAdmin) {
      const leadQuery: Record<string, any> = { ...baseLeadFilter };
      await HierarchyService.modifyRecordQuery(leadQuery, req.user as any, orgId!);
      leads = await CustomRecord.find(leadQuery).lean();
    } else {
      const userFilter = buildUserAssignmentFilter(userObj);
      leads = await CustomRecord.find({
        $and: [baseLeadFilter, userFilter]
      }).lean();

      if (leads.length === 0) {
        const leadQuery: Record<string, any> = { ...baseLeadFilter };
        await HierarchyService.modifyRecordQuery(leadQuery, req.user as any, orgId!);
        leads = await CustomRecord.find(leadQuery).lean();
      }
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
    const pageNum = parseInt(req.query.page as string || '1', 10);
    const limitNum = parseInt(req.query.limit as string || '100000', 10);
    const skipNum = (pageNum - 1) * limitNum;
    const isExport = req.query.export === 'true';

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const userDoc = await User.findById(userId).select('_id firstName lastName email userCode name role');
    const userObj = userDoc ? userDoc.toObject() : { id: userId, ...req.user };

    // Get the leads module
    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(404).json({ error: 'Leads module not found.' });
      return;
    }

    const decodedCampaignName = decodeURIComponent(campaignName).trim();
    const escName = decodedCampaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const campaignRegex = new RegExp('^\\s*' + escName + '\\s*$', 'i');

    const campaignFilter = {
      $or: [
        { 'data.source': campaignRegex },
        { 'data.campaignName': campaignRegex },
        { 'data.campaign': campaignRegex },
        { 'data.campaign_name': campaignRegex }
      ]
    };

    // Handle full export request (returns exact campaign leads matching campaign card total)
    if (isExport) {
      const isAdmin = (await HierarchyService.isSuperAdmin(userObj.roleId)) ||
        ['super admin', 'admin', 'administrator', 'org admin'].includes(String((userObj as any).role || '').toLowerCase()) ||
        (userObj.email && userObj.email.toLowerCase().includes('ink@crm'));

      let exportQuery: Record<string, any> = {};

      if (isAdmin) {
        exportQuery = {
          organizationId: orgId,
          moduleId: leadModule._id,
          ...campaignFilter
        };
        await HierarchyService.modifyRecordQuery(exportQuery, req.user as any, orgId!);
      } else {
        const userFilter = buildUserAssignmentFilter(userObj);
        exportQuery = {
          organizationId: orgId,
          moduleId: leadModule._id,
          $and: [
            campaignFilter,
            userFilter
          ]
        };

        const directCount = await CustomRecord.countDocuments(exportQuery);
        if (directCount === 0) {
          exportQuery = {
            organizationId: orgId,
            moduleId: leadModule._id,
            ...campaignFilter
          };
          await HierarchyService.modifyRecordQuery(exportQuery, req.user as any, orgId!);
        }
      }

      const exportLeads = await CustomRecord.find(exportQuery).sort({ createdAt: -1 }).lean();

      res.status(200).json({
        leads: exportLeads,
        pagination: {
          total: exportLeads.length,
          dialed: exportLeads.filter(l => {
            const d = l.data || {};
            const dialSt = (d.dialStatus || '').toString().trim().toLowerCase();
            const st = (d.status || '').toString().trim().toLowerCase();
            const hasDialStatus = dialSt && dialSt !== 'yet to call' && dialSt !== 'not called' && dialSt !== 'new';
            const hasDialedStatus = st && st !== 'new' && st !== 'yet to call' && st !== 'not called';
            const hasCalls = (d.callAttempts && Number(d.callAttempts) > 0) || !!d.dialedAt;
            return hasDialedStatus || (hasCalls && hasDialStatus);
          }).length,
          yetToDial: exportLeads.filter(l => {
            const d = l.data || {};
            const st = (d.status || d.dialStatus || '').toString().trim().toLowerCase();
            return !st || st === 'yet to call' || st === 'not called' || st === 'new';
          }).length,
          page: 1,
          limit: exportLeads.length,
          totalPages: 1
        }
      });
      return;
    }

    const isAdmin = (await HierarchyService.isSuperAdmin(userObj.roleId)) ||
      ['super admin', 'admin', 'administrator', 'org admin'].includes(String((userObj as any).role || '').toLowerCase()) ||
      (userObj.email && userObj.email.toLowerCase().includes('ink@crm'));

    let finalQuery: Record<string, any> = {};

    if (isAdmin) {
      finalQuery = {
        organizationId: orgId,
        moduleId: leadModule._id,
        ...campaignFilter
      };
      await HierarchyService.modifyRecordQuery(finalQuery, req.user as any, orgId!);
    } else {
      const userFilter = buildUserAssignmentFilter(userObj);
      const query: Record<string, any> = {
        organizationId: orgId,
        moduleId: leadModule._id,
        $and: [
          campaignFilter,
          userFilter
        ]
      };

      const directCount = await CustomRecord.countDocuments(query);
      if (directCount > 0) {
        finalQuery = query;
      } else {
        finalQuery = {
          organizationId: orgId,
          moduleId: leadModule._id,
          ...campaignFilter
        };
        await HierarchyService.modifyRecordQuery(finalQuery, req.user as any, orgId!);
      }
    }

    let totalAllocated = await CustomRecord.countDocuments(finalQuery);

    // Calculate dialed count for the filtered leads
    const totalDialed = await CustomRecord.countDocuments({
      ...finalQuery,
      $or: [
        { 'data.dialedAt': { $exists: true, $ne: null } },
        { 'data.lastCallDate': { $exists: true, $ne: null } },
        { 'data.callAttempts': { $gt: 0 } },
        { 
          'data.dialStatus': { 
            $in: [
              'Called', 'Ringing', 'Answered', 'Connected', 'Busy', 'No Answer', 
              'Call Back', 'Scheduled', 'Interested', 'Not Interested', 'Converted', 
              'Disbursed', 'Approved', 'Rejected', 'Wrong Number'
            ] 
          } 
        }
      ]
    });

    const leadsQuery = CustomRecord.find(finalQuery).sort({ createdAt: -1 }).skip(skipNum).limit(limitNum);
    const leads = await leadsQuery.lean();

    res.status(200).json({ 
      leads,
      pagination: {
        total: totalAllocated,
        dialed: totalDialed,
        yetToDial: Math.max(0, totalAllocated - totalDialed),
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalAllocated / limitNum) || 1
      }
    });
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

    // Support ?status=HOT LEADS or ?data.status=HOT LEADS or ?followup=today
    const USE_INDEXED_STATUS_QUERY = process.env.USE_INDEXED_STATUS_QUERY !== 'false';

    const rawStatusParam = req.query.status || req.query.leadStatus || req.query['data.status'] || req.query['data.normalizedStatus'];
    if (typeof rawStatusParam === 'string' && rawStatusParam.trim()) {
      const cleanVal = rawStatusParam.trim();
      const normVal = normalizeStatusName(cleanVal);
      const statusFilter = USE_INDEXED_STATUS_QUERY
        ? { 'data.normalizedStatus': normVal }
        : {
            $or: [
              { 'data.normalizedStatus': normVal },
              { 'data.status': new RegExp(`^\\s*${cleanVal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`, 'i') },
              { 'data.leadStatus': new RegExp(`^\\s*${cleanVal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`, 'i') }
            ]
          };

      if (query.$and) {
        query.$and.push(statusFilter);
      } else {
        query.$and = [statusFilter];
      }
    } else if (apiPath.toLowerCase() === 'leads' && !req.query.followup && (!search || typeof search !== 'string' || !search.trim())) {
      // When viewing ALL LEADS without a status filter, restrict to lead process statuses for 100% count alignment
      const CANONICAL_PROCESS_STATUSES = [
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

      const leadProcessFilter = {
        $or: [
          { 'data.normalizedStatus': { $in: CANONICAL_PROCESS_STATUSES } },
          { 'data.status': { $in: ['Hot', 'HOT', 'HOT LEADS', 'Warm', 'WARM', 'WARM LEADS', 'Document Pending', 'DOCUMENT PENDING', 'Disbursed', 'DISBUSED', 'Followup', 'FOLLOWUP', 'Dropped', 'DROPPED', 'Rejected', 'REJECTED', 'CEBIL PENDING', 'APPROVAL PENDING', 'APPROVED BUT NOT DISBUSE', 'PENDING'] } }
        ]
      };

      if (query.$and) {
        query.$and.push(leadProcessFilter);
      } else {
        query.$and = [leadProcessFilter];
      }
    }

    if (req.query.followup) {
      const followupVal = String(req.query.followup).trim().toLowerCase();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      if (followupVal === 'today') {
        const timeFilter = {
          $or: [
            { 'data.followUpDate': { $gte: startOfToday, $lte: endOfToday } },
            { 'data.followUpDate': { $regex: '^' + startOfToday.toISOString().split('T')[0] } }
          ]
        };
        if (query.$and) {
          query.$and.push(timeFilter);
        } else {
          query.$and = [timeFilter];
        }
      } else if (followupVal === 'upcoming') {
        const futureFilter = {
          $or: [
            { 'data.followUpDate': { $gt: endOfToday } },
            { 'data.followUpDate': { $gt: endOfToday.toISOString().split('T')[0] } }
          ]
        };
        if (query.$and) {
          query.$and.push(futureFilter);
        } else {
          query.$and = [futureFilter];
        }
      }
    }

    // Parse other fields for inline filters, e.g. ?data.city=Mumbai
    Object.keys(req.query).forEach((q) => {
      if (q.startsWith('data.')) {
        if (q === 'data.status' || q === 'data.leadStatus' || q === 'data.normalizedStatus') return; // Handled above
        const val = req.query[q];
        if (typeof val === 'string' && val.trim()) {
          const cleanVal = val.trim();
          const escVal = cleanVal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          query[q] = { $regex: new RegExp(`^${escVal}$`, 'i') };
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

    // Resolve createdBy, assignedBy, and assignedTo metadata
    const currentUserDoc = await User.findById(req.user?.id).select('_id firstName lastName email');
    const currentUserName = currentUserDoc 
      ? `${currentUserDoc.firstName || ''} ${currentUserDoc.lastName || ''}`.trim() || (currentUserDoc as any).name || currentUserDoc.email 
      : req.user?.email || 'System';

    if (!recordData.createdBy) {
      recordData.createdBy = currentUserName;
      recordData.createdByName = currentUserName;
    }
    if (!recordData.assignedBy) {
      recordData.assignedBy = currentUserName;
      recordData.assignedByName = currentUserName;
    }

    if (recordData.assignedTo) {
      if (/^[0-9a-fA-F]{24}$/.test(String(recordData.assignedTo))) {
        const assignedUser = await User.findById(recordData.assignedTo).select('firstName lastName email');
        if (assignedUser) {
          const aName = `${assignedUser.firstName || ''} ${assignedUser.lastName || ''}`.trim() || (assignedUser as any).name || assignedUser.email;
          recordData.assignedToName = aName;
          recordData.assignedTo = aName;
          recordData.telecaller = aName;
          recordData.assignedAgent = aName;
        }
      } else {
        recordData.assignedToName = recordData.assignedTo;
        recordData.telecaller = recordData.assignedTo;
        recordData.assignedAgent = recordData.assignedTo;
      }
    }

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

    // Fetch target record first by ID and Organization
    let record = await CustomRecord.findOne({
      _id: id,
      organizationId: req.organizationId
    });

    if (!record) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }

    // Determine authorization for Super Admin, Admin, Telecaller & Hierarchy
    const userDoc = await User.findById(req.user?.id).select('_id roleId firstName lastName email userCode name role');
    const userObj = userDoc ? userDoc.toObject() : { id: req.user?.id, ...req.user };
    const isAdmin = (await HierarchyService.isSuperAdmin(userObj.roleId)) ||
      ['super admin', 'admin', 'administrator', 'org admin'].includes(String((userObj as any).role || '').toLowerCase()) ||
      (userObj.email && userObj.email.toLowerCase().includes('ink@crm'));

    if (!isAdmin) {
      // Check RBAC update permission
      const { allowed } = await authorizeModuleAction(req, res, moduleDef.name, 'update');
      if (!allowed) {
        res.status(403).json({ error: `Access Denied: Update permission absent for module ${moduleDef.name}` });
        return;
      }

      // Allow update if user created record OR if record is assigned to user OR if hierarchy grants access
      const isCreator = record.createdBy?.toString() === String(req.user?.id);
      
      const assignmentFilter = buildUserAssignmentFilter(userObj);
      const isAssigned = await CustomRecord.exists({
        _id: id,
        organizationId: req.organizationId,
        ...assignmentFilter
      });

      const hierarchyQuery: Record<string, any> = { _id: id, organizationId: req.organizationId };
      await HierarchyService.modifyRecordQuery(hierarchyQuery, req.user as any, req.organizationId!);
      const hasHierarchyAccess = await CustomRecord.exists(hierarchyQuery);

      if (!isCreator && !isAssigned && !hasHierarchyAccess) {
        res.status(403).json({ error: 'Access Denied: You do not have permission to update this record.' });
        return;
      }
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

      // Normalize status fields to canonical status names so metrics and card counts update perfectly
      if (updateData.isCampaignDialOnly || updateData.normalizedStatus === 'CAMPAIGN_DIAL') {
        updateData.normalizedStatus = 'CAMPAIGN_DIAL';
      } else if (updateData.status) {
        const canonical = normalizeStatusName(updateData.status);
        if (canonical === 'FOLLOWUP') {
          if (oldValues.status && oldValues.status !== 'FOLLOWUP' && oldValues.status !== 'Followup') {
            updateData.originalStatus = oldValues.status;
            updateData.stageStatus = oldValues.status;
          } else if (oldValues.originalStatus) {
            updateData.originalStatus = oldValues.originalStatus;
            updateData.stageStatus = oldValues.stageStatus || oldValues.originalStatus;
          } else {
            updateData.originalStatus = 'HOT LEADS';
            updateData.stageStatus = 'HOT LEADS';
          }
        } else {
          updateData.originalStatus = canonical;
          updateData.stageStatus = canonical;
        }
        updateData.status = canonical;
        updateData.dialStatus = canonical;
        updateData.normalizedStatus = canonical;
      }
    }

    // Resolve createdBy, assignedBy, and assignedTo metadata on update
    const currentUserDoc = await User.findById(req.user?.id).select('_id firstName lastName email');
    const currentUserName = currentUserDoc 
      ? `${currentUserDoc.firstName || ''} ${currentUserDoc.lastName || ''}`.trim() || (currentUserDoc as any).name || currentUserDoc.email 
      : req.user?.email || 'System';

    if (!updateData.createdBy) {
      updateData.createdBy = oldValues.createdBy || currentUserName;
      updateData.createdByName = oldValues.createdByName || oldValues.createdBy || currentUserName;
    }

    if (updateData.assignedTo && updateData.assignedTo !== oldValues.assignedTo) {
      updateData.assignedBy = currentUserName;
      updateData.assignedByName = currentUserName;
    } else if (!updateData.assignedBy && oldValues.assignedBy) {
      updateData.assignedBy = oldValues.assignedBy;
      updateData.assignedByName = oldValues.assignedByName || oldValues.assignedBy;
    }

    if (updateData.assignedTo) {
      if (/^[0-9a-fA-F]{24}$/.test(String(updateData.assignedTo))) {
        const assignedUser = await User.findById(updateData.assignedTo).select('firstName lastName email');
        if (assignedUser) {
          const aName = `${assignedUser.firstName || ''} ${assignedUser.lastName || ''}`.trim() || (assignedUser as any).name || assignedUser.email;
          updateData.assignedToName = aName;
          updateData.assignedTo = aName;
          updateData.telecaller = aName;
          updateData.assignedAgent = aName;
        }
      } else {
        updateData.assignedToName = updateData.assignedTo;
        updateData.telecaller = updateData.assignedTo;
        updateData.assignedAgent = updateData.assignedTo;
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
    const updaterObj = userDoc ? userDoc.toObject() : (req.user as any);
    const updaterName = (updaterObj as any)?.firstName ? `${(updaterObj as any).firstName} ${(updaterObj as any).lastName || ''}`.trim() : ((updaterObj as any)?.email || 'System');

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

// Bulk Delete Count for Leads
router.post('/leads/bulk-delete-count', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const { campaignName, assignedTo, status, createdDate, startDate, endDate } = req.body;

    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(200).json({ count: 0 });
      return;
    }

    const query: Record<string, any> = {
      organizationId: orgId,
      moduleId: leadModule._id
    };

    const andConditions: any[] = [];

    if (campaignName) {
      const esc = String(campaignName).trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      andConditions.push({
        $or: [
          { 'data.source': new RegExp('^' + esc + '$', 'i') },
          { 'data.campaignName': new RegExp('^' + esc + '$', 'i') },
          { 'data.campaign': new RegExp('^' + esc + '$', 'i') },
          { 'data.campaign_name': new RegExp('^' + esc + '$', 'i') }
        ]
      });
    }

    if (assignedTo) {
      const esc = String(assignedTo).trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      andConditions.push({
        $or: [
          { 'data.assignedTo': new RegExp(esc, 'i') },
          { 'data.assignedAgent': new RegExp(esc, 'i') },
          { 'data.telecaller': new RegExp(esc, 'i') },
          { 'data.assignedToName': new RegExp(esc, 'i') },
          { 'data.psm': new RegExp(esc, 'i') }
        ]
      });
    }

    if (status) {
      const esc = String(status).trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      andConditions.push({
        $or: [
          { 'data.status': new RegExp('^' + esc + '$', 'i') },
          { 'data.dialStatus': new RegExp('^' + esc + '$', 'i') },
          { 'data.normalizedStatus': new RegExp('^' + esc + '$', 'i') }
        ]
      });
    }

    if (createdDate) {
      const dayStart = new Date(createdDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(createdDate);
      dayEnd.setHours(23, 59, 59, 999);

      andConditions.push({
        $or: [
          { createdAt: { $gte: dayStart, $lte: dayEnd } },
          { 'data.created_at': { $regex: '^' + createdDate } },
          { 'data.date': { $regex: '^' + createdDate } },
          { 'data.dialedAt': { $gte: dayStart, $lte: dayEnd } }
        ]
      });
    } else if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) {
        const endD = new Date(endDate);
        endD.setHours(23, 59, 59, 999);
        dateFilter.$lte = endD;
      }
      andConditions.push({ createdAt: dateFilter });
    }

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    const count = await CustomRecord.countDocuments(query);
    res.status(200).json({ count });
  } catch (error) {
    console.error('Count bulk delete leads error:', error);
    res.status(200).json({ count: 0 });
  }
});

// Bulk Delete Leads
router.post('/leads/bulk-delete', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const { campaignName, assignedTo, status, createdDate, startDate, endDate } = req.body;

    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(404).json({ error: 'Leads module not found.' });
      return;
    }

    const query: Record<string, any> = {
      organizationId: orgId,
      moduleId: leadModule._id
    };

    const andConditions: any[] = [];

    if (campaignName) {
      const esc = String(campaignName).trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      andConditions.push({
        $or: [
          { 'data.source': new RegExp('^' + esc + '$', 'i') },
          { 'data.campaignName': new RegExp('^' + esc + '$', 'i') },
          { 'data.campaign': new RegExp('^' + esc + '$', 'i') },
          { 'data.campaign_name': new RegExp('^' + esc + '$', 'i') }
        ]
      });
    }

    if (assignedTo) {
      const esc = String(assignedTo).trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      andConditions.push({
        $or: [
          { 'data.assignedTo': new RegExp(esc, 'i') },
          { 'data.assignedAgent': new RegExp(esc, 'i') },
          { 'data.telecaller': new RegExp(esc, 'i') },
          { 'data.assignedToName': new RegExp(esc, 'i') },
          { 'data.psm': new RegExp(esc, 'i') }
        ]
      });
    }

    if (status) {
      const esc = String(status).trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      andConditions.push({
        $or: [
          { 'data.status': new RegExp('^' + esc + '$', 'i') },
          { 'data.dialStatus': new RegExp('^' + esc + '$', 'i') },
          { 'data.normalizedStatus': new RegExp('^' + esc + '$', 'i') }
        ]
      });
    }

    if (createdDate) {
      const dayStart = new Date(createdDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(createdDate);
      dayEnd.setHours(23, 59, 59, 999);

      andConditions.push({
        $or: [
          { createdAt: { $gte: dayStart, $lte: dayEnd } },
          { 'data.created_at': { $regex: '^' + createdDate } },
          { 'data.date': { $regex: '^' + createdDate } },
          { 'data.dialedAt': { $gte: dayStart, $lte: dayEnd } }
        ]
      });
    } else if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) {
        const endD = new Date(endDate);
        endD.setHours(23, 59, 59, 999);
        dateFilter.$lte = endD;
      }
      andConditions.push({ createdAt: dateFilter });
    }

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    const result = await CustomRecord.deleteMany(query);

    res.status(200).json({
      message: `Successfully deleted ${result.deletedCount} leads.`,
      deletedCount: result.deletedCount
    });
  } catch (error: any) {
    console.error('Bulk delete leads error:', error);
    res.status(500).json({ error: 'Failed to bulk delete leads.' });
  }
});

// Count Duplicate Leads (Keeping 1 original lead per phone, targeting extra duplicates)
router.post('/leads/duplicates-count', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const { status, user, date, month, year } = req.body;

    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(200).json({ duplicateGroups: 0, extraDuplicatesCount: 0, idsToDelete: [] });
      return;
    }

    const query: Record<string, any> = {
      organizationId: orgId,
      moduleId: leadModule._id
    };

    const andConditions: any[] = [];

    if (status) {
      const esc = String(status).trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      andConditions.push({
        $or: [
          { 'data.status': new RegExp('^' + esc + '$', 'i') },
          { 'data.dialStatus': new RegExp('^' + esc + '$', 'i') },
          { 'data.normalizedStatus': new RegExp('^' + esc + '$', 'i') }
        ]
      });
    }

    if (user) {
      const esc = String(user).trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      andConditions.push({
        $or: [
          { 'data.assignedTo': new RegExp(esc, 'i') },
          { 'data.assignedAgent': new RegExp(esc, 'i') },
          { 'data.telecaller': new RegExp(esc, 'i') },
          { 'data.assignedToName': new RegExp(esc, 'i') }
        ]
      });
    }

    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      andConditions.push({
        $or: [
          { createdAt: { $gte: dayStart, $lte: dayEnd } },
          { 'data.created_at': { $regex: '^' + date } },
          { 'data.date': { $regex: '^' + date } }
        ]
      });
    } else {
      if (year) {
        const y = parseInt(year, 10);
        if (!isNaN(y)) {
          if (month) {
            const monthsNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const mIdx = monthsNames.findIndex(m => m.toLowerCase() === month.toLowerCase());
            if (mIdx >= 0) {
              const startM = new Date(y, mIdx, 1);
              const endM = new Date(y, mIdx + 1, 0, 23, 59, 59, 999);
              andConditions.push({ createdAt: { $gte: startM, $lte: endM } });
            }
          } else {
            const startY = new Date(y, 0, 1);
            const endY = new Date(y, 11, 31, 23, 59, 59, 999);
            andConditions.push({ createdAt: { $gte: startY, $lte: endY } });
          }
        }
      }
    }

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    // Fetch matching leads from MongoDB
    const records = await CustomRecord.find(query).sort({ createdAt: 1 }).lean();

    // Multi-attribute composite grouping map matching: Lead No, Lead Name, Created Date, Phone, Assigned To, Assigned By
    const dupMap = new Map<string, any[]>();

    records.forEach(r => {
      const data = r.data || {};

      const leadNo = (data.leadNo || data.lead_no || data.leadId || data.leadNumber || data.caseNo || '').toString().trim().toLowerCase();
      const leadName = (data.customerName || data.customer || data.fullName || (data.firstName ? `${data.firstName} ${data.lastName || ''}`.trim() : '') || '').toString().trim().toLowerCase();
      const phone = (data.phone || data.mobile || data.contactNum || data.contact_num || data.contact || data.phoneNumber || '').toString().replace(/[\s\-\+\(\)]/g, '');
      
      const createdDateObj = r.createdAt ? new Date(r.createdAt) : null;
      const createdDate = createdDateObj && !isNaN(createdDateObj.getTime())
        ? createdDateObj.toISOString().slice(0, 10)
        : String(data.created_at || data.date || '').slice(0, 10);

      const assignedTo = (data.assignedToName || data.assignedTo || data.telecaller || data.assignedAgent || '').toString().trim().toLowerCase();
      const assignedBy = (data.assignedByName || data.assignedBy || '').toString().trim().toLowerCase();

      let groupKey = '';
      if (req.body.scanMode === 'phone_only') {
        groupKey = phone ? `phone_${phone}` : '';
      } else {
        // Full matching key: Lead No + Lead Name + Phone + Created Date + Assigned To + Assigned By
        const parts = [
          `no:${leadNo}`,
          `name:${leadName}`,
          `ph:${phone}`,
          `dt:${createdDate}`,
          `to:${assignedTo}`,
          `by:${assignedBy}`
        ];
        groupKey = parts.join('|');
      }

      if (groupKey) {
        if (!dupMap.has(groupKey)) {
          dupMap.set(groupKey, []);
        }
        dupMap.get(groupKey)!.push(r);
      }
    });

    let duplicateGroups = 0;
    let extraDuplicatesCount = 0;
    const idsToDelete: string[] = [];

    dupMap.forEach((groupLeads) => {
      if (groupLeads.length > 1) {
        duplicateGroups++;
        // Keep 1st original lead, mark 2nd, 3rd, etc. extra duplicate copies for deletion
        const extraLeads = groupLeads.slice(1);
        extraDuplicatesCount += extraLeads.length;
        extraLeads.forEach(el => idsToDelete.push(el._id.toString()));
      }
    });

    res.status(200).json({
      duplicateGroups,
      extraDuplicatesCount,
      idsToDelete
    });
  } catch (error) {
    console.error('Count duplicate leads error:', error);
    res.status(200).json({ duplicateGroups: 0, extraDuplicatesCount: 0, idsToDelete: [] });
  }
});

// Delete Extra Duplicate Leads
router.post('/leads/delete-duplicates', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const { idsToDelete } = req.body;

    if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
      res.status(400).json({ error: 'No extra duplicate lead IDs provided for deletion.' });
      return;
    }

    const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
    if (!leadModule) {
      res.status(404).json({ error: 'Leads module not found.' });
      return;
    }

    const objectIds = idsToDelete.map(id => new mongoose.Types.ObjectId(id));

    const result = await CustomRecord.deleteMany({
      organizationId: orgId,
      moduleId: leadModule._id,
      _id: { $in: objectIds }
    });

    res.status(200).json({
      message: `Successfully purged ${result.deletedCount} extra duplicate leads (1 original lead kept per contact).`,
      deletedCount: result.deletedCount
    });
  } catch (error: any) {
    console.error('Delete duplicate leads error:', error);
    res.status(500).json({ error: 'Failed to delete duplicate leads.' });
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
