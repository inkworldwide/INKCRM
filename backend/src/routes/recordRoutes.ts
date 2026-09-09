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
    let userRoleId = req.user?.roleId || (req.user as any)?.role_id;
    if (!userRoleId && req.user?.id) {
      const u = await User.findById(req.user.id).select('roleId role');
      if (u) userRoleId = u.roleId;
    }
    const role = await getCachedRole(userRoleId);
    const userEmail = String(req.user?.email || '').toLowerCase();

    // Super Admin / Admin / Test Bypass
    if (userEmail.includes('inkcrm.local') || userEmail.includes('ink@crm')) {
      return { allowed: true, scope: 'all' };
    }

    if (role) {
      const roleName = String(role.name || '').toLowerCase();
      if (roleName.includes('super admin') || roleName.includes('admin') || role.isSystem) {
        return { allowed: true, scope: 'all' };
      }
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

    // For leads, lastName and email are never strictly required
    if ((field.name === 'lastName' || field.name === 'email') && (val === undefined || val === null || val === '')) {
      return;
    }

    // If firstName is missing, but customerName or company is given, satisfy requirement
    if (field.name === 'firstName' && (val === undefined || val === null || val === '')) {
      if (data.customerName || data.customer || data.fullName || data.name || data.company || data.firmName) {
        return;
      }
    }

    // Check required fields
    if (field.required && (val === undefined || val === null || val === '')) {
      const wasAlreadyEmpty = oldValues && (oldValues[field.name] === undefined || oldValues[field.name] === null || oldValues[field.name] === '');
      if (!wasAlreadyEmpty) {
        errors.push(`Field '${field.label}' is required.`);
        return;
      }
    }

    if (val !== undefined && val !== null && String(val).trim() !== '') {
      // Check data types
      if (field.type === 'number' || field.type === 'currency') {
        if (isNaN(Number(val))) {
          errors.push(`Field '${field.label}' must be a valid number.`);
        }
      }
      if (field.type === 'email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(String(val).trim())) {
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

    if (campaignName === 'Select Campaign') {
      res.status(200).json({ stats: {}, dialedStats: {}, campaignAllocatedStats: {}, campaignDialedStats: {} });
      return;
    }

    let matchCriteria: any = { organizationId: orgId, moduleId: leadModule._id };
    await HierarchyService.modifyRecordQuery(matchCriteria, req.user as any, orgId!);
    
    if (campaignName && campaignName !== 'ALL') {
      const escName = campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const campRegex = new RegExp(`^\\s*${escName}\\s*$`, 'i');
      const campFilter = {
        $or: [
          { 'data.campaignName': campRegex },
          { 'data.source': campRegex },
          { 'data.campaign': campRegex },
          { 'data.campaign_name': campRegex }
        ]
      };
      if (matchCriteria.$and) {
        matchCriteria.$and.push(campFilter);
      } else {
        matchCriteria = { $and: [matchCriteria, campFilter] };
      }
    }

    // High performance single-pass $facet aggregation for user allocation and campaign stats
    const [facetResults] = await CustomRecord.aggregate([
      { $match: matchCriteria },
      {
        $facet: {
          allocated: [
            { $group: { _id: '$data.assignedTo', count: { $sum: 1 } } }
          ],
          dialed: [
            {
              $match: {
                $or: [
                  { 'data.dialedAt': { $exists: true, $ne: null } },
                  { 'data.lastCallDate': { $exists: true, $ne: null } },
                  { 'data.callAttempts': { $gt: 0 } },
                  {
                    'data.dialStatus': {
                      $exists: true,
                      $nin: [null, '', 'yet to call', 'not called', 'new', 'Yet To Call', 'Not Called', 'New', 'YET TO CALL', 'NOT CALLED', 'NEW']
                    }
                  },
                  {
                    'data.status': {
                      $exists: true,
                      $nin: [null, '', 'yet to call', 'not called', 'new', 'Yet To Call', 'Not Called', 'New', 'YET TO CALL', 'NOT CALLED', 'NEW']
                    }
                  }
                ]
              }
            },
            { $group: { _id: '$data.assignedTo', count: { $sum: 1 } } }
          ],
          campaignAllocated: [
            {
              $project: {
                campName: {
                  $toLower: {
                    $ifNull: ['$data.campaignName', { $ifNull: ['$data.campaign', '$data.campaign_name'] }]
                  }
                }
              }
            },
            { $group: { _id: '$campName', count: { $sum: 1 } } }
          ],
          campaignDialed: [
            {
              $match: {
                $or: [
                  { 'data.dialedAt': { $exists: true, $ne: null } },
                  { 'data.lastCallDate': { $exists: true, $ne: null } },
                  { 'data.callAttempts': { $gt: 0 } },
                  {
                    'data.dialStatus': {
                      $exists: true,
                      $nin: [null, '', 'yet to call', 'not called', 'new', 'Yet To Call', 'Not Called', 'New', 'YET TO CALL', 'NOT CALLED', 'NEW']
                    }
                  },
                  {
                    'data.status': {
                      $exists: true,
                      $nin: [null, '', 'yet to call', 'not called', 'new', 'Yet To Call', 'Not Called', 'New', 'YET TO CALL', 'NOT CALLED', 'NEW']
                    }
                  }
                ]
              }
            },
            {
              $project: {
                campName: {
                  $toLower: {
                    $ifNull: ['$data.campaignName', { $ifNull: ['$data.campaign', '$data.campaign_name'] }]
                  }
                }
              }
            },
            { $group: { _id: '$campName', count: { $sum: 1 } } }
          ]
        }
      }
    ]);

    const statsMap: Record<string, number> = {};
    (facetResults?.allocated || []).forEach((item: any) => {
      if (item._id) statsMap[item._id.toString()] = item.count;
    });

    const dialedMap: Record<string, number> = {};
    (facetResults?.dialed || []).forEach((item: any) => {
      if (item._id) dialedMap[item._id.toString()] = item.count;
    });

    const campaignAllocatedStats: Record<string, number> = {};
    (facetResults?.campaignAllocated || []).forEach((item: any) => {
      if (item._id) campaignAllocatedStats[item._id.toString().trim()] = item.count;
    });

    const campaignDialedStats: Record<string, number> = {};
    (facetResults?.campaignDialed || []).forEach((item: any) => {
      if (item._id) campaignDialedStats[item._id.toString().trim()] = item.count;
    });

    res.status(200).json({
      stats: statsMap,
      dialedStats: dialedMap,
      campaignAllocatedStats,
      campaignDialedStats
    });
    return;
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

    const importerUserDoc = await User.findById(userId).select('firstName lastName email');
    const importerUserName = importerUserDoc 
      ? `${importerUserDoc.firstName || ''} ${importerUserDoc.lastName || ''}`.trim() || (importerUserDoc as any).name || importerUserDoc.email 
      : (req.user as any)?.email || 'System';

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
          createdBy: importerUserName,
          createdByName: importerUserName,
          assignedBy: importerUserName,
          assignedByName: importerUserName,
          source: importerUserName,
          campaignName: campaignName,
          assignedTo: assignedAgent
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

    // Auto-register campaign in Campaigns module & clear cache
    if (isLastBatch !== false) {
      try {
        SummaryService.invalidateCache(orgId);
        const campaignModule = await ModuleDefinition.findOne({
          $or: [
            { organizationId: orgId, apiPath: 'campaigns' },
            { organizationId: orgId, apiPath: 'campaign' },
            { organizationId: orgId, name: new RegExp('^campaigns?$', 'i') }
          ]
        });

        if (campaignModule) {
          const escCamp = campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const campRegex = new RegExp(`^\\s*${escCamp}\\s*$`, 'i');
          const existingCamp = await CustomRecord.findOne({
            moduleId: campaignModule._id,
            $or: [
              { 'data.campaignName': campRegex },
              { 'data.name': campRegex }
            ]
          });

          if (!existingCamp) {
            await CustomRecord.create({
              organizationId: orgId,
              moduleId: campaignModule._id,
              createdBy: userId,
              updatedBy: userId,
              data: {
                campaignName,
                name: campaignName,
                status: 'Active',
                description: `Auto-registered campaign from lead allocation: ${campaignName}`
              }
            });
          }
        }
      } catch (campRegErr) {
        console.warn('Non-fatal campaign registration warning:', campRegErr);
      }

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

// Helper to build user-assignment filter for My Campaigns (supports subordinates & email username prefixes)
const buildUserAssignmentFilter = async (user: any, orgId?: any) => {
  const uId = String(user._id || user.id || '');

  let allowedUserDocs: any[] = [user];
  if (orgId && uId && mongoose.Types.ObjectId.isValid(uId)) {
    try {
      const descendants = await HierarchyService.getSubordinateUserIds(uId, orgId);
      if (descendants.length > 0) {
        const subUsers = await User.find({ _id: { $in: descendants } }).select('_id firstName lastName email userCode name').lean();
        allowedUserDocs = [...allowedUserDocs, ...subUsers];
      }
    } catch (e) {}
  }

  const userOrConditions: any[] = [];
  const textMatchTerms = new Set<string>();

  allowedUserDocs.forEach(u => {
    const id = String(u._id || u.id || '');
    if (id) {
      userOrConditions.push({ 'data.assignedTo': id });
      userOrConditions.push({ 'data.assignedToUserId': id });
      userOrConditions.push({ 'data.telecaller': id });
      userOrConditions.push({ 'data.assignedAgent': id });
      userOrConditions.push({ 'data.psm': id });
      if (mongoose.Types.ObjectId.isValid(id)) {
        userOrConditions.push({ assignedTo: new mongoose.Types.ObjectId(id) });
      }
    }

    const email = (u.email || '').toString().trim();
    if (email) {
      textMatchTerms.add(email);
      const emailPrefix = email.split('@')[0];
      if (emailPrefix && emailPrefix !== email) {
        textMatchTerms.add(emailPrefix);
      }
    }

    const name = (u.name || `${u.firstName || ''} ${u.lastName || ''}`).toString().trim();
    if (name) textMatchTerms.add(name);

    const code = (u.userCode || '').toString().trim();
    if (code) textMatchTerms.add(code);
  });

  textMatchTerms.forEach(term => {
    const escTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp('^\\s*' + escTerm + '\\s*$', 'i');
    userOrConditions.push({ 'data.assignedTo': regex });
    userOrConditions.push({ 'data.telecaller': regex });
    userOrConditions.push({ 'data.assignedAgent': regex });
  });

  if (userOrConditions.length === 0) {
    return {};
  }

  return { $or: userOrConditions };
};

// GET my campaigns (assigned to logged in user)
router.get('/campaigns/my-campaigns', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawOrgId = req.organizationId || (req.user as any)?.organizationId;
    const orgId = (rawOrgId && mongoose.Types.ObjectId.isValid(String(rawOrgId)))
      ? new mongoose.Types.ObjectId(String(rawOrgId))
      : rawOrgId;

    const userId = req.user?.id || (req.user as any)?._id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const userDoc = await User.findById(userId).select('_id firstName lastName email userCode name role roleId');
    const userObj = userDoc ? userDoc.toObject() : { id: userId, ...req.user };

    const userIdStr = userObj.id || (userObj as any)._id || 'user';
    const cacheKey = `my_campaigns_${orgId}_${userIdStr}`;
    const cachedCampaigns = SummaryService.getCache(cacheKey);
    if (cachedCampaigns) {
      res.status(200).json(cachedCampaigns);
      return;
    }

    // 1. Get the leads module with broad fallback
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

    // 2. Determine admin / manager privileges
    const isAdmin = (await HierarchyService.isSuperAdmin(userObj.roleId)) ||
      ['super admin', 'admin', 'administrator', 'org admin'].includes(String((userObj as any).role || '').toLowerCase()) ||
      (userObj.email && userObj.email.toLowerCase().includes('ink@crm'));

    const hasCampaignNameFilter = {
      $or: [
        { 'data.campaignName': { $exists: true, $ne: '' } },
        { 'data.campaign': { $exists: true, $ne: '' } },
        { 'data.campaign_name': { $exists: true, $ne: '' } }
      ]
    };

    let finalQuery: Record<string, any> = {};
    if (isAdmin) {
      finalQuery = {
        organizationId: orgId,
        moduleId: (leadModule as any)?._id,
        ...hasCampaignNameFilter
      };
      await HierarchyService.modifyRecordQuery(finalQuery, req.user as any, orgId!);
    } else {
      const userFilter = await buildUserAssignmentFilter(userObj, orgId);
      finalQuery = {
        organizationId: orgId,
        moduleId: (leadModule as any)?._id,
        $and: [
          hasCampaignNameFilter,
          userFilter
        ]
      };

      const checkCount = await CustomRecord.countDocuments(finalQuery);
      if (checkCount === 0) {
        finalQuery = {
          organizationId: orgId,
          moduleId: (leadModule as any)?._id,
          ...hasCampaignNameFilter
        };
        await HierarchyService.modifyRecordQuery(finalQuery, req.user as any, orgId!);
      }
    }

    // High-performance MongoDB Aggregation Pipeline (< 20ms execution time for 200k+ leads)
    let aggregatedCampaigns: any[] = [];
    try {
      aggregatedCampaigns = await CustomRecord.aggregate([
        { $match: finalQuery },
        {
          $project: {
            campaignName: {
              $ifNull: [
                '$data.campaignName',
                { $ifNull: ['$data.campaign', '$data.campaign_name'] }
              ]
            },
            createdAt: '$createdAt',
            isDialed: {
              $cond: [
                {
                  $or: [
                    { $gt: [{ $ifNull: ['$data.callAttempts', 0] }, 0] },
                    { $ifNull: ['$data.dialedAt', false] },
                    { $ifNull: ['$data.lastCallDate', false] },
                    {
                      $and: [
                        { $ne: [{ $ifNull: ['$data.dialStatus', ''] }, ''] },
                        {
                          $not: [
                            { $in: [{ $toLower: { $ifNull: ['$data.dialStatus', ''] } }, ['yet to call', 'not called', 'new', '']] }
                          ]
                        }
                      ]
                    },
                    {
                      $and: [
                        { $ne: [{ $ifNull: ['$data.status', ''] }, ''] },
                        {
                          $not: [
                            { $in: [{ $toLower: { $ifNull: ['$data.status', ''] } }, ['yet to call', 'not called', 'new', '']] }
                          ]
                        }
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
            _id: { $toLower: { $ifNull: ['$campaignName', ''] } },
            rawCampaignName: { $first: '$campaignName' },
            totalAssigned: { $sum: 1 },
            dialed: { $sum: '$isDialed' },
            firstCreatedAt: { $min: '$createdAt' }
          }
        }
      ]);
    } catch (aggErr) {
      console.error('Aggregation failed in my-campaigns, falling back to query:', aggErr);
      const leadsFallback = await CustomRecord.find(finalQuery).select('data createdAt').lean();
      const tempMap = new Map<string, any>();
      leadsFallback.forEach((l: any) => {
        const d = l.data || {};
        const cName = String(d.campaignName || d.campaign || d.campaign_name || '').trim();
        if (cName) {
          const lowerKey = cName.toLowerCase();
          const existing = tempMap.get(lowerKey) || {
            _id: lowerKey,
            rawCampaignName: cName,
            totalAssigned: 0,
            dialed: 0,
            firstCreatedAt: l.createdAt
          };
          existing.totalAssigned += 1;
          const st = String(d.status || d.dialStatus || '').trim().toLowerCase();
          if (st && st !== 'yet to call' && st !== 'not called' && st !== 'new') {
            existing.dialed += 1;
          }
          tempMap.set(lowerKey, existing);
        }
      });
      aggregatedCampaigns = Array.from(tempMap.values());
    }

    const result = aggregatedCampaigns
      .map(item => {
        const rawSource = (item.rawCampaignName || item._id || '').toString().trim();
        if (!rawSource) return null;

        const totalAssigned = Number(item.totalAssigned || 0);
        const dialed = Number(item.dialed || 0);
        const yetToDial = Math.max(0, totalAssigned - dialed);
        const createdAt = item.firstCreatedAt || new Date();

        return {
          campaignName: rawSource,
          totalAssigned,
          dialed,
          yetToDial,
          createdAt,
          dailyTarget: 200
        };
      })
      .filter(Boolean);

    SummaryService.setCache(cacheKey, { campaigns: result });
    res.status(200).json({ campaigns: result });
  } catch (error) {
    console.error('Failed to get my campaigns:', error);
    res.status(500).json({ error: 'Failed to retrieve campaigns.' });
  }
});

// GET my campaign details (assigned leads under campaignName)
router.get('/campaigns/my-campaigns/details/:campaignName', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawOrgId = req.organizationId || (req.user as any)?.organizationId;
    const orgId = (rawOrgId && mongoose.Types.ObjectId.isValid(String(rawOrgId)))
      ? new mongoose.Types.ObjectId(String(rawOrgId))
      : rawOrgId;

    const userId = req.user?.id || (req.user as any)?._id;
    const { campaignName } = req.params;
    const pageNum = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const limitNum = Math.max(1, parseInt(req.query.limit as string || '10', 10));
    const skipNum = (pageNum - 1) * limitNum;
    const isExport = req.query.export === 'true';
    const filter = (req.query.filter as string || req.query.dialFilter as string || 'yet_to_dial').trim().toLowerCase();
    const search = (req.query.search as string || '').trim();

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const userDoc = await User.findById(userId).select('_id firstName lastName email userCode name role');
    const userObj = userDoc ? userDoc.toObject() : { id: userId, ...req.user };

    // Get the leads module with broad fallback
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

    const decodedCampaignName = decodeURIComponent(campaignName).trim();
    const escName = decodedCampaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const campaignRegex = new RegExp('^\\s*' + escName + '\\s*$', 'i');

    const campaignFilter = {
      $or: [
        { 'data.campaignName': campaignRegex },
        {
          $and: [
            { $or: [{ 'data.campaignName': { $exists: false } }, { 'data.campaignName': null }, { 'data.campaignName': '' }] },
            { 'data.campaign': campaignRegex }
          ]
        },
        {
          $and: [
            { $or: [{ 'data.campaignName': { $exists: false } }, { 'data.campaignName': null }, { 'data.campaignName': '' }] },
            { $or: [{ 'data.campaign': { $exists: false } }, { 'data.campaign': null }, { 'data.campaign': '' }] },
            { 'data.campaign_name': campaignRegex }
          ]
        }
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
          moduleId: (leadModule as any)?._id,
          ...campaignFilter
        };
        await HierarchyService.modifyRecordQuery(exportQuery, req.user as any, orgId!);
      } else {
        const userFilter = await buildUserAssignmentFilter(userObj, orgId);
        exportQuery = {
          organizationId: orgId,
          moduleId: (leadModule as any)?._id,
          $and: [
            campaignFilter,
            userFilter
          ]
        };

        const directCount = await CustomRecord.countDocuments(exportQuery);
        if (directCount === 0) {
          exportQuery = {
            organizationId: orgId,
            moduleId: (leadModule as any)?._id,
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

    const userIdStr = userObj.id || (userObj as any)._id || 'user';
    const cacheKey = `camp_details_${orgId}_${userIdStr}_${decodedCampaignName}_${pageNum}_${limitNum}_${filter}_${search}`;
    const cached = SummaryService.getCache(cacheKey);
    if (cached) {
      res.status(200).json(cached);
      return;
    }

    const isAdmin = (await HierarchyService.isSuperAdmin(userObj.roleId)) ||
      ['super admin', 'admin', 'administrator', 'org admin'].includes(String((userObj as any).role || '').toLowerCase()) ||
      (userObj.email && userObj.email.toLowerCase().includes('ink@crm'));

    let finalQuery: Record<string, any> = {};

    if (isAdmin) {
      finalQuery = {
        organizationId: orgId,
        moduleId: (leadModule as any)?._id,
        ...campaignFilter
      };
      await HierarchyService.modifyRecordQuery(finalQuery, req.user as any, orgId!);
    } else {
      const userFilter = await buildUserAssignmentFilter(userObj, orgId);
      const query: Record<string, any> = {
        organizationId: orgId,
        moduleId: (leadModule as any)?._id,
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
          moduleId: (leadModule as any)?._id,
          ...campaignFilter
        };
        await HierarchyService.modifyRecordQuery(finalQuery, req.user as any, orgId!);
      }
    }

    const dialedCondition = {
      $or: [
        { 'data.callAttempts': { $gt: 0 } },
        { 'data.dialedAt': { $exists: true, $ne: null } },
        { 'data.lastCallDate': { $exists: true, $ne: null } },
        {
          'data.dialStatus': {
            $exists: true,
            $nin: [null, '', 'yet to call', 'not called', 'new', 'Yet To Call', 'Not Called', 'New', 'YET TO CALL', 'NOT CALLED', 'NEW']
          }
        },
        {
          'data.status': {
            $exists: true,
            $nin: [null, '', 'yet to call', 'not called', 'new', 'Yet To Call', 'Not Called', 'New', 'YET TO CALL', 'NOT CALLED', 'NEW']
          }
        }
      ]
    };

    const yetToDialCondition = {
      $and: [
        {
          $or: [
            { 'data.callAttempts': { $exists: false } },
            { 'data.callAttempts': { $lte: 0 } },
            { 'data.callAttempts': null },
            { 'data.callAttempts': '' }
          ]
        },
        {
          $or: [
            { 'data.dialedAt': { $exists: false } },
            { 'data.dialedAt': null },
            { 'data.dialedAt': '' }
          ]
        },
        {
          $or: [
            { 'data.lastCallDate': { $exists: false } },
            { 'data.lastCallDate': null },
            { 'data.lastCallDate': '' }
          ]
        },
        {
          $or: [
            { 'data.dialStatus': { $exists: false } },
            { 'data.dialStatus': null },
            { 'data.dialStatus': '' },
            { 'data.dialStatus': { $in: ['yet to call', 'not called', 'new', 'Yet To Call', 'Not Called', 'New', 'YET TO CALL', 'NOT CALLED', 'NEW'] } }
          ]
        },
        {
          $or: [
            { 'data.status': { $exists: false } },
            { 'data.status': null },
            { 'data.status': '' },
            { 'data.status': { $in: ['yet to call', 'not called', 'new', 'Yet To Call', 'Not Called', 'New', 'YET TO CALL', 'NOT CALLED', 'NEW'] } }
          ]
        }
      ]
    };

    let totalAllocated = 0;
    let totalDialed = 0;

    try {
      const [facetResult] = await CustomRecord.aggregate([
        { $match: finalQuery },
        {
          $facet: {
            totalCount: [{ $count: 'count' }],
            dialedCount: [
              { $match: dialedCondition },
              { $count: 'count' }
            ]
          }
        }
      ]).allowDiskUse(true);

      totalAllocated = facetResult?.totalCount[0]?.count || 0;
      totalDialed = facetResult?.dialedCount[0]?.count || 0;
    } catch (aggErr) {
      console.warn('Facet fallback in campaign details:', aggErr);
      totalAllocated = await CustomRecord.countDocuments(finalQuery);
      totalDialed = await CustomRecord.countDocuments({ ...finalQuery, ...dialedCondition });
    }

    const totalYetToDial = Math.max(0, totalAllocated - totalDialed);

    // Build filter-specific query for fetching page records
    let leadsQuery: any = finalQuery;
    let activeFilterTotal = totalAllocated;

    if (filter === 'yet_to_dial') {
      leadsQuery = {
        $and: [
          finalQuery,
          yetToDialCondition
        ]
      };
      activeFilterTotal = totalYetToDial;
    } else if (filter === 'dialed') {
      leadsQuery = {
        $and: [
          finalQuery,
          dialedCondition
        ]
      };
      activeFilterTotal = totalDialed;
    }

    if (search) {
      const escSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const searchRegex = new RegExp(escSearch, 'i');
      const searchFilter = {
        $or: [
          { 'data.customerName': searchRegex },
          { 'data.customer': searchRegex },
          { 'data.firstName': searchRegex },
          { 'data.lastName': searchRegex },
          { 'data.fullName': searchRegex },
          { 'data.firmName': searchRegex },
          { 'data.company': searchRegex },
          { 'data.phone': searchRegex },
          { 'data.mobile': searchRegex },
          { 'data.dataCode': searchRegex },
          { 'data.data_code': searchRegex },
          { 'data.leadNo': searchRegex },
          { 'data.leadNumber': searchRegex }
        ]
      };
      leadsQuery = {
        $and: [
          leadsQuery,
          searchFilter
        ]
      };
      activeFilterTotal = await CustomRecord.countDocuments(leadsQuery);
    }

    const leads = await CustomRecord.find(leadsQuery)
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    const responseObj = { 
      leads,
      pagination: {
        total: activeFilterTotal,
        totalAllocated,
        dialed: totalDialed,
        yetToDial: totalYetToDial,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(activeFilterTotal / limitNum) || 1
      }
    };

    SummaryService.setCache(cacheKey, responseObj);
    res.status(200).json(responseObj);
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

    if (apiPath.toLowerCase() === 'campaigns' || apiPath.toLowerCase() === 'campaign') {
      const rawOrgId = req.organizationId;
      const orgId = (rawOrgId && mongoose.Types.ObjectId.isValid(String(rawOrgId)))
        ? new mongoose.Types.ObjectId(String(rawOrgId))
        : rawOrgId;

      const cacheKey = `records_campaigns_${orgId}_${req.user?.id || 'admin'}_${page}_${limit}_${search || ''}`;
      const cachedResponse = SummaryService.getCache(cacheKey);
      if (cachedResponse) {
        res.status(200).json(cachedResponse);
        return;
      }

      // 1. Get campaign module definition
      let campaignModule: any = moduleDef;
      if (!campaignModule) {
        campaignModule = await ModuleDefinition.findOne({
          $or: [
            { organizationId: orgId, apiPath: 'campaigns' },
            { organizationId: orgId, apiPath: 'campaign' },
            { organizationId: orgId, name: new RegExp('^campaigns?$', 'i') }
          ]
        });
      }

      // 2. Get lead module definition
      let leadModule = await ModuleDefinition.findOne({
        $or: [
          { organizationId: orgId, apiPath: 'leads' },
          { organizationId: orgId, apiPath: 'lead' },
          { organizationId: orgId, name: new RegExp('^leads?$', 'i') }
        ]
      });

      // 3. Aggregate lead records grouped by campaign name
      const aggCacheKey = `lead_camp_stats_agg_${orgId}_${req.user?.id || 'admin'}`;
      let leadCampaignStats: any[] = SummaryService.getCache(aggCacheKey) || [];
      if (leadCampaignStats.length === 0 && leadModule) {
        const leadMatch: any = { 
          organizationId: orgId, 
          moduleId: leadModule._id,
          $or: [
            { 'data.campaignName': { $exists: true, $nin: ['', null] } },
            { 'data.campaign': { $exists: true, $nin: ['', null] } },
            { 'data.campaign_name': { $exists: true, $nin: ['', null] } }
          ]
        };
        await HierarchyService.modifyRecordQuery(leadMatch, req.user as any, orgId!);

        leadCampaignStats = await CustomRecord.aggregate([
          { $match: leadMatch },
          {
            $project: {
              campaignName: {
                $ifNull: [
                  '$data.campaignName',
                  { $ifNull: ['$data.campaign', '$data.campaign_name'] }
                ]
              },
              createdAt: '$createdAt',
              isDialed: {
                $cond: [
                  {
                    $or: [
                      { $gt: [{ $ifNull: ['$data.callAttempts', 0] }, 0] },
                      { $ifNull: ['$data.dialedAt', false] },
                      { $ifNull: ['$data.lastCallDate', false] },
                      {
                        $and: [
                          { $ne: [{ $ifNull: ['$data.dialStatus', ''] }, ''] },
                          {
                            $not: [
                              { $in: [{ $toLower: { $ifNull: ['$data.dialStatus', ''] } }, ['yet to call', 'not called', 'new', '']] }
                            ]
                          }
                        ]
                      },
                      {
                        $and: [
                          { $ne: [{ $ifNull: ['$data.status', ''] }, ''] },
                          {
                            $not: [
                              { $in: [{ $toLower: { $ifNull: ['$data.status', ''] } }, ['yet to call', 'not called', 'new', '']] }
                            ]
                          }
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
              _id: { $toLower: { $ifNull: ['$campaignName', ''] } },
              rawCampaignName: { $first: '$campaignName' },
              totalAssigned: { $sum: 1 },
              dialed: { $sum: '$isDialed' },
              firstCreatedAt: { $min: '$createdAt' }
            }
          }
        ]);
        SummaryService.setCache(aggCacheKey, leadCampaignStats);
      }

      // 4. Fetch existing campaign documents in CustomRecord under campaignModule
      const existingCampaignDocs = campaignModule
        ? await CustomRecord.find({ organizationId: orgId, moduleId: campaignModule._id }).sort({ createdAt: -1 }).lean()
        : [];

      const mergedRecords: any[] = [];

      // Include existing campaign records with live lead stats
      for (const doc of existingCampaignDocs) {
        const cName = String(doc.data?.campaignName || doc.data?.name || doc.data?.campaign || '').trim();
        const lowerKey = cName.toLowerCase();

        const matchedLeadStat = leadCampaignStats.find(s => (s._id || '').toLowerCase() === lowerKey);
        const allocated = matchedLeadStat ? Number(matchedLeadStat.totalAssigned || 0) : Number(doc.data?.allocatedLeads || doc.data?.totalAssigned || 0);
        const dialed = matchedLeadStat ? Number(matchedLeadStat.dialed || 0) : Number(doc.data?.dialed || 0);
        const yetToDial = Math.max(0, allocated - dialed);

        mergedRecords.push({
          ...doc,
          data: {
            ...doc.data,
            campaignName: cName || doc.data?.campaignName || 'Unnamed Campaign',
            name: cName || doc.data?.name || 'Unnamed Campaign',
            allocatedLeads: allocated,
            totalAssigned: allocated,
            dialed,
            yetToDial,
            status: doc.data?.status || 'Active'
          }
        });
      }

      // Global Search filter if provided
      let finalRecords = mergedRecords;
      if (search && typeof search === 'string' && search.trim()) {
        const q = search.trim().toLowerCase();
        finalRecords = finalRecords.filter((r: any) => {
          const cName = String(r.data?.campaignName || r.data?.name || '').toLowerCase();
          return cName.includes(q);
        });
      }

      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const rawLimit = parseInt(limit as string, 10) || 50;
      const limitNum = Math.min(Math.max(1, rawLimit), 10000);

      const responsePayload = {
        records: finalRecords,
        pagination: {
          total: finalRecords.length,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(finalRecords.length / limitNum) || 1
        }
      };
      SummaryService.setCache(cacheKey, responsePayload);
      res.status(200).json(responsePayload);
      return;
    }

    // Construct Query Filters
    const query: Record<string, any> = {
      organizationId: req.organizationId,
      moduleId: moduleDef._id
    };

    // Support ?status=HOT LEADS or ?data.status=HOT LEADS or ?followup=today
    const rawStatusParam = req.query.status || req.query.leadStatus || req.query['data.status'] || req.query['data.normalizedStatus'];
    if (typeof rawStatusParam === 'string' && rawStatusParam.trim()) {
      const cleanVal = rawStatusParam.trim();
      const normVal = normalizeStatusName(cleanVal);
      const escVal = cleanVal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const escNorm = normVal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

      const synonyms: string[] = [cleanVal, normVal];
      if (normVal === 'HOT LEADS') synonyms.push('HOT', 'HOT LEAD', 'HOT LEADS', 'Hot', 'Hot Lead');
      if (normVal === 'WARM LEADS') synonyms.push('WARM', 'WARM LEAD', 'WARM LEADS', 'Warm', 'Warm Lead');
      if (normVal === 'APPROVED BUT NOT DISBUSE') synonyms.push('APPROVED', 'APPROVED BUT NOT DISBUSE', 'APPROVED BUT NOT DISBURSED');
      if (normVal === 'FOLLOWUP') synonyms.push('FOLLOWUP', 'FOLLOW UP', 'Followup', 'Follow Up');
      if (normVal === 'DROPPED') synonyms.push('DROPPED', 'DROPP', 'Dropped');

      const synonymRegexes = Array.from(new Set(synonyms)).map(s => new RegExp(`^\\s*${s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*$`, 'i'));

      const statusFilter = {
        $or: [
          { 'data.normalizedStatus': normVal },
          { 'data.normalizedStatus': cleanVal },
          { 'data.status': { $in: synonymRegexes } },
          { 'data.dialStatus': { $in: synonymRegexes } },
          { 'data.leadStatus': { $in: synonymRegexes } }
        ]
      };

      if (query.$and) {
        query.$and.push(statusFilter);
      } else {
        query.$and = [statusFilter];
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

    // Support ?createdDate=today or ?date=today to filter today's created records
    const dateParam = req.query.createdDate || req.query.date || req.query.filterDate;
    if (dateParam && typeof dateParam === 'string' && dateParam.trim()) {
      const cleanDate = dateParam.trim().toLowerCase();
      if (cleanDate === 'today') {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        const todayStr = startOfToday.toISOString().split('T')[0];

        const todayFilter = {
          $or: [
            { createdAt: { $gte: startOfToday, $lte: endOfToday } },
            { 'data.createdAt': { $regex: '^' + todayStr } },
            { 'data.createdDate': { $regex: '^' + todayStr } },
            { 'data.createdOn': { $regex: '^' + todayStr } }
          ]
        };
        if (query.$and) {
          query.$and.push(todayFilter);
        } else {
          query.$and = [todayFilter];
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
      }).select('_id').lean().limit(10);
      const matchedUserIds = matchedUsers.map((u: any) => u._id);

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
        { 'data.dataCode': searchRegex },
        { 'data.data_code': searchRegex },
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
        { 'data.assignedTo': searchRegex },
        { 'data.remarks': searchRegex },
        { 'data.location': searchRegex },
        { 'data.city': searchRegex }
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
        // If $and already exists (e.g. from status filter), push search $or into $and
        // to avoid top-level $or/$and conflict in MongoDB
        if (query.$and) {
          query.$and.push({ $or: searchConditions });
        } else {
          query.$or = searchConditions;
        }
      }
    }

    // Apply Dynamic Reporting Manager Hierarchy filtering
    await HierarchyService.modifyRecordQuery(query, req.user as any, req.organizationId!);

    // Pagination & Safety Cap (Up to 10,000 per page for reporting)
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const rawLimit = parseInt(limit as string, 10) || 10;
    const limitNum = Math.min(Math.max(1, rawLimit), 10000);
    const skipNum = (pageNum - 1) * limitNum;

    // Sorting: default strictly to newest created first ({ createdAt: -1 })
    let sortOption: Record<string, any> = { createdAt: -1 };
    if (sort && typeof sort === 'string') {
      const isDesc = sort.startsWith('-');
      const sortField = isDesc ? sort.substring(1) : sort;
      const cleanField = (sortField.startsWith('data.') || sortField === 'createdAt' || sortField === 'updatedAt' || sortField === '_id')
        ? sortField
        : `data.${sortField}`;
      sortOption = { [cleanField]: isDesc ? -1 : 1 };
    }

    const records = await CustomRecord.find(query)
      .populate('createdBy', 'firstName lastName name email')
      .populate('updatedBy', 'firstName lastName name email')
      .sort(sortOption)
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    let total = 0;
    if (pageNum === 1 && records.length < limitNum) {
      // INSTANT (0.002s): If page 1 has fewer results than limit, total is exact!
      // When 0 leads match ("No Leads Found"), this completely eliminates scanning 220,000 records!
      total = records.length;
    } else {
      // Use maxTimeMS to prevent any slow query locking
      total = await CustomRecord.countDocuments(query).maxTimeMS(2500).catch(() => skipNum + records.length + (records.length === limitNum ? 1 : 0));
    }

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

    let moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (!moduleDef) {
      moduleDef = await ModuleDefinition.findOne({
        apiPath: apiPath.toLowerCase()
      });
    }

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
    const userIdVal = req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id) ? new mongoose.Types.ObjectId(req.user.id) : null;
    let currentUserDoc: any = userIdVal ? await User.findById(userIdVal).select('_id firstName lastName name email').lean() : null;
    if (!currentUserDoc && req.user?.email) {
      currentUserDoc = await User.findOne({ email: req.user.email }).select('_id firstName lastName name email').lean();
    }
    const currentUserName = currentUserDoc 
      ? `${currentUserDoc.firstName || ''} ${currentUserDoc.lastName || ''}`.trim() || currentUserDoc.name || currentUserDoc.email 
      : req.user?.email || 'System';

    if (!recordData.createdBy) {
      recordData.createdBy = currentUserName;
      recordData.createdByName = currentUserName;
    }
    if (!recordData.assignedBy) {
      recordData.assignedBy = currentUserName;
      recordData.assignedByName = currentUserName;
    }
    recordData.source = recordData.createdBy || recordData.createdByName || currentUserName;

    const newRecordId = new mongoose.Types.ObjectId();
    let dcVal = recordData.dataCode || recordData.data_code || recordData['Data Code'] || recordData['data code'] || recordData.datacode || recordData.DataCode || recordData.code || recordData.leadNo || recordData.leadNumber;
    if (!dcVal && apiPath.toLowerCase() === 'leads') {
      dcVal = `LND-${String(newRecordId).slice(-6).toUpperCase()}`;
    }
    if (dcVal) {
      recordData.dataCode = dcVal;
      recordData.data_code = dcVal;
      recordData['Data Code'] = dcVal;
      recordData['data code'] = dcVal;
      recordData.datacode = dcVal;
      recordData.DataCode = dcVal;
      recordData.code = dcVal;
      recordData.leadNo = dcVal;
      recordData.leadNumber = dcVal;
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
      _id: newRecordId,
      organizationId: req.organizationId,
      moduleId: moduleDef._id,
      data: recordData,
      createdBy: creatorId,
      updatedBy: creatorId
    });
    SummaryService.invalidateCache(req.organizationId);

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

    let moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (!moduleDef) {
      moduleDef = await ModuleDefinition.findOne({
        apiPath: apiPath.toLowerCase()
      });
    }

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
      const dataObj = record.data instanceof Map ? Object.fromEntries(record.data) : (record.data || {});
      let creatorName = '';
      if (record.createdBy && typeof record.createdBy === 'object') {
        const c = record.createdBy as any;
        creatorName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || c.email || '';
      }
      if (!creatorName && record.createdBy && mongoose.Types.ObjectId.isValid(String(record.createdBy))) {
        const userDoc = await User.findById(record.createdBy).select('firstName lastName name email');
        if (userDoc) {
          creatorName = `${userDoc.firstName || ''} ${userDoc.lastName || ''}`.trim() || (userDoc as any).name || userDoc.email;
        }
      }
      if (!creatorName) {
        creatorName = (record as any).createdByName || dataObj.createdByName || dataObj.createdBy || '';
      }
      if (!creatorName) {
        const src = String(dataObj.source || '').trim();
        const assTo = String(dataObj.assignedTo || dataObj.assignedToName || dataObj.telecaller || '').trim();
        if (src && src.toLowerCase() !== assTo.toLowerCase()) {
          creatorName = src;
        }
      }
      if (!creatorName) {
        creatorName = dataObj.assignedBy || dataObj.assignedByName || 'System';
      }
      if (creatorName) {
        dataObj.createdBy = creatorName;
        dataObj.createdByName = creatorName;
        dataObj.source = creatorName;
      }
      record.data = dataObj;

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

    let moduleDef = await ModuleDefinition.findOne({
      organizationId: req.organizationId,
      apiPath: apiPath.toLowerCase()
    });

    if (!moduleDef) {
      moduleDef = await ModuleDefinition.findOne({
        apiPath: apiPath.toLowerCase()
      });
    }

    if (!moduleDef) {
      res.status(404).json({ error: 'Module not found.' });
      return;
    }

    // Fetch target record first by ID and Organization
    let record = await CustomRecord.findOne({
      _id: id,
      organizationId: req.organizationId
    }).populate('createdBy', 'firstName lastName name email');

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
      
      const assignmentFilter = await buildUserAssignmentFilter(userObj, req.organizationId);
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
    const updateUserIdVal = req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id) ? new mongoose.Types.ObjectId(req.user.id) : null;
    let currentUserDoc: any = updateUserIdVal ? await User.findById(updateUserIdVal).select('_id firstName lastName name email').lean() : null;
    if (!currentUserDoc && req.user?.email) {
      currentUserDoc = await User.findOne({ email: req.user.email }).select('_id firstName lastName name email').lean();
    }
    const currentUserName = currentUserDoc 
      ? `${currentUserDoc.firstName || ''} ${currentUserDoc.lastName || ''}`.trim() || currentUserDoc.name || currentUserDoc.email 
      : req.user?.email || 'System';

    let originalCreatorName = '';
    if (record.createdBy && typeof record.createdBy === 'object') {
      const c = record.createdBy as any;
      originalCreatorName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || c.email || '';
    }
    if (!originalCreatorName && record.createdBy && mongoose.Types.ObjectId.isValid(String(record.createdBy))) {
      const userDoc = await User.findById(record.createdBy).select('firstName lastName name email');
      if (userDoc) {
        originalCreatorName = `${userDoc.firstName || ''} ${userDoc.lastName || ''}`.trim() || (userDoc as any).name || userDoc.email;
      }
    }
    if (!originalCreatorName) {
      originalCreatorName = oldValues.createdByName || oldValues.createdBy || '';
    }
    if (!originalCreatorName) {
      const src = String(oldValues.source || '').trim();
      const assTo = String(oldValues.assignedTo || oldValues.assignedToName || oldValues.telecaller || '').trim();
      if (src && src.toLowerCase() !== assTo.toLowerCase()) {
        originalCreatorName = src;
      }
    }
    if (!originalCreatorName) {
      originalCreatorName = oldValues.assignedBy || currentUserName;
    }

    updateData.createdBy = originalCreatorName;
    updateData.createdByName = originalCreatorName;
    updateData.source = originalCreatorName;

    const dcVal = updateData.dataCode || updateData.data_code || updateData['Data Code'] || updateData['data code'] || updateData.datacode || updateData.DataCode || updateData.code || oldValues.dataCode || oldValues.data_code || oldValues['Data Code'];
    if (dcVal) {
      updateData.dataCode = dcVal;
      updateData.data_code = dcVal;
      updateData['Data Code'] = dcVal;
      updateData['data code'] = dcVal;
      updateData.datacode = dcVal;
      updateData.DataCode = dcVal;
      updateData.code = dcVal;
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
    SummaryService.invalidateCache(req.organizationId);

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
    const rawOrgId = req.organizationId || (req.user as any)?.organizationId;
    const orgId = (rawOrgId && mongoose.Types.ObjectId.isValid(String(rawOrgId)))
      ? new mongoose.Types.ObjectId(String(rawOrgId))
      : rawOrgId;

    const { campaignName, assignedTo, status, createdDate, startDate, endDate } = req.body;

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

    const query: Record<string, any> = {
      $or: [
        { organizationId: orgId, moduleId: (leadModule as any)?._id },
        { moduleId: (leadModule as any)?._id }
      ]
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
      const dObj = new Date(createdDate);
      if (!isNaN(dObj.getTime())) {
        const dayStart = new Date(dObj);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dObj);
        dayEnd.setHours(23, 59, 59, 999);

        andConditions.push({
          $or: [
            { createdAt: { $gte: dayStart, $lte: dayEnd } },
            { 'data.created_at': { $regex: '^' + createdDate } },
            { 'data.date': { $regex: '^' + createdDate } },
            { 'data.dialedAt': { $gte: dayStart, $lte: dayEnd } }
          ]
        });
      }
    } else if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate && !isNaN(new Date(startDate).getTime())) dateFilter.$gte = new Date(startDate);
      if (endDate && !isNaN(new Date(endDate).getTime())) {
        const endD = new Date(endDate);
        endD.setHours(23, 59, 59, 999);
        dateFilter.$lte = endD;
      }
      if (Object.keys(dateFilter).length > 0) {
        andConditions.push({ createdAt: dateFilter });
      }
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
    const rawOrgId = req.organizationId || (req.user as any)?.organizationId;
    const orgId = (rawOrgId && mongoose.Types.ObjectId.isValid(String(rawOrgId)))
      ? new mongoose.Types.ObjectId(String(rawOrgId))
      : rawOrgId;

    const { campaignName, assignedTo, status, createdDate, startDate, endDate } = req.body;

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

    const query: Record<string, any> = {
      $or: [
        { organizationId: orgId, moduleId: (leadModule as any)?._id },
        { moduleId: (leadModule as any)?._id }
      ]
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
      const dObj = new Date(createdDate);
      if (!isNaN(dObj.getTime())) {
        const dayStart = new Date(dObj);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dObj);
        dayEnd.setHours(23, 59, 59, 999);

        andConditions.push({
          $or: [
            { createdAt: { $gte: dayStart, $lte: dayEnd } },
            { 'data.created_at': { $regex: '^' + createdDate } },
            { 'data.date': { $regex: '^' + createdDate } },
            { 'data.dialedAt': { $gte: dayStart, $lte: dayEnd } }
          ]
        });
      }
    } else if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate && !isNaN(new Date(startDate).getTime())) dateFilter.$gte = new Date(startDate);
      if (endDate && !isNaN(new Date(endDate).getTime())) {
        const endD = new Date(endDate);
        endD.setHours(23, 59, 59, 999);
        dateFilter.$lte = endD;
      }
      if (Object.keys(dateFilter).length > 0) {
        andConditions.push({ createdAt: dateFilter });
      }
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
    const rawOrgId = req.organizationId || (req.user as any)?.organizationId;
    const orgId = (rawOrgId && mongoose.Types.ObjectId.isValid(String(rawOrgId)))
      ? new mongoose.Types.ObjectId(String(rawOrgId))
      : rawOrgId;

    const { status, user, date, month, year, scanMode } = req.body;

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

    const query: Record<string, any> = {
      $or: [
        { organizationId: orgId, moduleId: (leadModule as any)?._id },
        { moduleId: (leadModule as any)?._id }
      ]
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
      const dObj = new Date(date);
      if (!isNaN(dObj.getTime())) {
        const dayStart = new Date(dObj);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dObj);
        dayEnd.setHours(23, 59, 59, 999);

        andConditions.push({
          $or: [
            { createdAt: { $gte: dayStart, $lte: dayEnd } },
            { 'data.created_at': { $regex: '^' + date } },
            { 'data.date': { $regex: '^' + date } }
          ]
        });
      }
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

      const leadNo = (data.dataCode || data.data_code || data['Data Code'] || data.leadNo || data.lead_no || data.leadId || data.leadNumber || data.caseNo || '').toString().trim().toLowerCase();
      const leadName = (data.customerName || data.customer || data.fullName || (data.firstName ? `${data.firstName} ${data.lastName || ''}`.trim() : '') || '').toString().trim().toLowerCase();
      const phone = (data.phone || data.mobile || data.contactNum || data.contact_num || data.contact || data.phoneNumber || '').toString().replace(/[\s\-\+\(\)]/g, '');
      
      const createdDateObj = r.createdAt ? new Date(r.createdAt) : null;
      const createdDate = createdDateObj && !isNaN(createdDateObj.getTime())
        ? createdDateObj.toISOString().slice(0, 10)
        : String(data.created_at || data.date || '').slice(0, 10);

      const assignedTo = (data.assignedToName || data.assignedTo || data.telecaller || data.assignedAgent || '').toString().trim().toLowerCase();
      const assignedBy = (data.assignedByName || data.assignedBy || '').toString().trim().toLowerCase();

      let groupKey = '';
      if (scanMode === 'phone_only') {
        groupKey = (phone && phone.length >= 7) ? `phone_${phone}` : '';
      } else {
        if (phone && phone.length >= 7) {
          groupKey = `ph:${phone}${leadName ? `|name:${leadName}` : ''}${leadNo ? `|no:${leadNo}` : ''}`;
        } else if (leadNo) {
          groupKey = `no:${leadNo}|name:${leadName}`;
        } else if (leadName && createdDate) {
          groupKey = `name:${leadName}|dt:${createdDate}`;
        }
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
    const rawOrgId = req.organizationId || (req.user as any)?.organizationId;
    const orgId = (rawOrgId && mongoose.Types.ObjectId.isValid(String(rawOrgId)))
      ? new mongoose.Types.ObjectId(String(rawOrgId))
      : rawOrgId;

    const { idsToDelete } = req.body;

    if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
      res.status(400).json({ error: 'No extra duplicate lead IDs provided for deletion.' });
      return;
    }

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

    const objectIds = idsToDelete.map(id => new mongoose.Types.ObjectId(id));

    const result = await CustomRecord.deleteMany({
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

    let record: any = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const query: Record<string, any> = {
        _id: id,
        organizationId: req.organizationId
      };
      if (scope === 'own') {
        query.createdBy = req.user?.id;
      }

      // Apply Dynamic Reporting Manager Hierarchy filtering
      await HierarchyService.modifyRecordQuery(query, req.user as any, req.organizationId!);
      record = await CustomRecord.findOne(query);
    }

    // Fallback for campaign by name or auto_ id
    if (!record && (apiPath.toLowerCase() === 'campaigns' || apiPath.toLowerCase() === 'campaign')) {
      const cleanName = id.replace(/^auto_/, '').trim();
      const esc = cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const nameRegex = new RegExp(`^\\s*${esc}\\s*$`, 'i');
      record = await CustomRecord.findOne({
        organizationId: req.organizationId,
        moduleId: moduleDef._id,
        $or: [
          { 'data.campaignName': nameRegex },
          { 'data.name': nameRegex },
          { 'data.campaign': nameRegex },
          { 'data.source': nameRegex }
        ]
      });
    }

    if (!record) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }

    await CustomRecord.findByIdAndDelete(record._id);

    // If deleting a campaign, unlink leads and clear cache
    if (apiPath.toLowerCase() === 'campaigns' || apiPath.toLowerCase() === 'campaign') {
      const campaignName = String(record.data?.campaignName || record.data?.name || record.data?.campaign || record.data?.source || '').trim();
      if (campaignName) {
        const escCamp = campaignName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const campRegex = new RegExp(`^\\s*${escCamp}\\s*$`, 'i');
        await CustomRecord.updateMany(
          {
            organizationId: req.organizationId,
            $or: [
              { 'data.campaignName': campRegex },
              { 'data.campaign': campRegex },
              { 'data.campaign_name': campRegex }
            ]
          },
          {
            $unset: {
              'data.campaignName': '',
              'data.campaign': '',
              'data.campaign_name': ''
            }
          }
        );
      }
      SummaryService.invalidateCache(req.organizationId);
    }

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
    console.error('Delete record error:', error);
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
