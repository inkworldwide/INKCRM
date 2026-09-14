import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import { authenticate } from '../middleware/authMiddleware';
import { requireTenant } from '../middleware/tenantMiddleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// Global Search endpoint
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const rawQ = String(req.query.q || '').trim();

    if (!rawQ || rawQ.length < 1) {
      res.status(200).json([]);
      return;
    }

    // Strip prefix like "LND-" or "#" or "lnd-"
    const cleanQ = rawQ.replace(/^(lnd-|#)/i, '').trim();
    if (!cleanQ) {
      res.status(200).json([]);
      return;
    }

    // Fetch active modules for this organization
    const modules = await ModuleDefinition.find({ organizationId: orgId }).lean();
    if (!modules || modules.length === 0) {
      res.status(200).json([]);
      return;
    }

    // Check if query is 24-hex ObjectId or a 4-8 hex suffix
    const isObjectId = mongoose.Types.ObjectId.isValid(cleanQ) && cleanQ.length === 24;
    const isHexSuffix = cleanQ.length >= 4 && cleanQ.length <= 12 && /^[0-9a-fA-F]+$/.test(cleanQ);
    const isLeadCodeSearch = /^lnd-/i.test(rawQ);

    // Fast-path: if looking up by lead code or hex suffix, check Lead module first
    const leadModule = modules.find(m => m.apiPath === 'leads' || m.singularLabel?.toLowerCase() === 'lead');

    // 1. If it's a 24-char ObjectId
    if (isObjectId) {
      const objId = new mongoose.Types.ObjectId(cleanQ);
      const directRecord = await CustomRecord.findOne({
        _id: objId,
        organizationId: orgId
      }).lean();

      if (directRecord) {
        const matchedModule = modules.find(m => String(m._id) === String(directRecord.moduleId));
        if (matchedModule) {
          res.status(200).json([{
            module: {
              _id: matchedModule._id,
              apiPath: matchedModule.apiPath,
              pluralLabel: matchedModule.pluralLabel,
              singularLabel: matchedModule.singularLabel,
              icon: matchedModule.icon || 'Layers'
            },
            records: [directRecord]
          }]);
          return;
        }
      }
    }

    // 2. Build regexes for fields
    const escapedQ = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQ, 'i');

    // Common search conditions across indexed data fields
    const baseConditions: any[] = [
      { 'data.leadNo': `LND-${cleanQ.toUpperCase()}` },
      { 'data.leadNo': rawQ.toUpperCase() },
      { 'data.leadNo': cleanQ.toUpperCase() },
      { 'data.dataCode': cleanQ },
      { 'data.data_code': cleanQ },
      { 'data.customer': regex },
      { 'data.customerName': regex },
      { 'data.fullName': regex },
      { 'data.firstName': regex },
      { 'data.lastName': regex },
      { 'data.phone': regex },
      { 'data.mobile': regex },
      { 'data.contactNumber': regex },
      { 'data.contact_num': regex },
      { 'data.contact num': regex },
      { 'data.contact': regex },
      { 'data.dataCode': regex },
      { 'data.data_code': regex },
      { 'data.Data Code': regex },
      { 'data.campaignName': regex },
      { 'data.campaign': regex },
      { 'data.allocatedNo': regex },
      { 'data.allocatedNumber': regex },
      { 'data.leadNo': regex },
      { 'data.company': regex },
      { 'data.firmName': regex },
      { 'data.firm': regex },
      { 'data.email': regex },
      { 'data.city': regex }
    ];

    // Parallel search across prioritized modules with time limits
    // Prioritize leads, deals, companies/contacts first
    const prioritizedModules = [...modules].sort((a, b) => {
      const priorityOrder = ['leads', 'deals', 'companies', 'contacts', 'campaigns'];
      const indexA = priorityOrder.indexOf(a.apiPath);
      const indexB = priorityOrder.indexOf(b.apiPath);
      const valA = indexA === -1 ? 99 : indexA;
      const valB = indexB === -1 ? 99 : indexB;
      return valA - valB;
    });

    const searchPromises = prioritizedModules.map(async (moduleDef) => {
      const isLeadMod = leadModule && String(moduleDef._id) === String(leadModule._id);
      
      // If user typed "LND-..." explicitly and this is NOT leads module, skip to avoid slow scans
      if (isLeadCodeSearch && !isLeadMod) {
        return null;
      }

      // Fast-path for lead module: check indexed leadNo or dataCode directly first
      if (isLeadMod && (isHexSuffix || isLeadCodeSearch)) {
        const directLead = await CustomRecord.find({
          organizationId: orgId,
          moduleId: moduleDef._id,
          $or: [
            { 'data.leadNo': `LND-${cleanQ.toUpperCase()}` },
            { 'data.leadNo': rawQ.toUpperCase() },
            { 'data.leadNo': cleanQ.toUpperCase() },
            { 'data.dataCode': cleanQ },
            { 'data.data_code': cleanQ }
          ]
        }).limit(8).lean();

        if (directLead && directLead.length > 0) {
          return {
            module: {
              _id: moduleDef._id,
              apiPath: moduleDef.apiPath,
              pluralLabel: moduleDef.pluralLabel,
              singularLabel: moduleDef.singularLabel,
              icon: moduleDef.icon || 'Layers'
            },
            records: directLead
          };
        }
      }

      const matchConditions: any[] = [...baseConditions];

      // If hex suffix, match end of ObjectId using $expr only on relevant modules
      if (isHexSuffix) {
        if (isLeadMod || !isLeadCodeSearch) {
          matchConditions.push({
            $expr: {
              $regexMatch: {
                input: { $toString: '$_id' },
                regex: escapedQ + '$',
                options: 'i'
              }
            }
          });
        }
      }

      try {
        const records = await CustomRecord.find({
          organizationId: orgId,
          moduleId: moduleDef._id,
          $or: matchConditions
        })
          .sort({ updatedAt: -1 })
          .limit(8)
          .maxTimeMS(2500)
          .lean();

        if (records && records.length > 0) {
          return {
            module: {
              _id: moduleDef._id,
              apiPath: moduleDef.apiPath,
              pluralLabel: moduleDef.pluralLabel,
              singularLabel: moduleDef.singularLabel,
              icon: moduleDef.icon || 'Layers'
            },
            records
          };
        }
      } catch (err: any) {
        // Query timeout or regex error - return null without failing entire search
        console.warn(`Search timeout or error in module ${moduleDef.apiPath}:`, err.message);
      }
      return null;
    });

    const results = await Promise.all(searchPromises);
    const searchResults = results.filter(Boolean);

    res.status(200).json(searchResults);
  } catch (error) {
    console.error('Global Search Error:', error);
    res.status(500).json({ error: 'Failed to perform search.' });
  }
});

export default router;
