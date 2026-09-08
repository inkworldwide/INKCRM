import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import User from '../models/User';
import { logger } from './logger';

export const autoFixLeadSources = async (): Promise<void> => {
  try {
    const leadModules = await ModuleDefinition.find({
      $or: [
        { apiPath: 'leads' },
        { apiPath: 'lead' },
        { name: new RegExp('^leads?$', 'i') }
      ]
    }).select('_id');

    const leadModuleIds = leadModules.map(m => m._id);
    if (leadModuleIds.length === 0) return;

    const users = await User.find({}).select('_id firstName lastName name email').lean();
    const userMap = new Map<string, string>();
    users.forEach((u: any) => {
      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || (u.email ? u.email.split('@')[0] : '');
      if (name) {
        userMap.set(u._id.toString(), name);
      }
    });

    const leads = await CustomRecord.find({ moduleId: { $in: leadModuleIds } }).select('_id createdBy data').lean();

    const bulkOps: any[] = [];
    for (const lead of leads) {
      const dataObj = lead.data || {};
      const topCreatedById = String(lead.createdBy || '');
      let resolvedCreator = userMap.get(topCreatedById) || '';

      if (!resolvedCreator) {
        const cName = dataObj.createdByName || dataObj.createdBy;
        if (typeof cName === 'string' && cName.trim() && cName !== 'undefined' && !/^[0-9a-fA-F]{24}$/.test(cName.trim())) {
          resolvedCreator = cName.trim();
        }
      }

      if (!resolvedCreator) {
        const aBy = dataObj.assignedBy || dataObj.assignedByName;
        if (typeof aBy === 'string' && aBy.trim() && aBy !== 'undefined' && !/^[0-9a-fA-F]{24}$/.test(aBy.trim())) {
          resolvedCreator = aBy.trim();
        }
      }

      if (!resolvedCreator) {
        resolvedCreator = 'System';
      }

      const currentSource = String(dataObj.source || '').trim();
      const currentCreatedBy = String(dataObj.createdBy || '').trim();
      const currentCreatedByName = String(dataObj.createdByName || '').trim();

      if (currentSource !== resolvedCreator || currentCreatedBy !== resolvedCreator || currentCreatedByName !== resolvedCreator) {
        bulkOps.push({
          updateOne: {
            filter: { _id: lead._id },
            update: {
              $set: {
                'data.source': resolvedCreator,
                'data.createdBy': resolvedCreator,
                'data.createdByName': resolvedCreator
              }
            }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      const CHUNK_SIZE = 1000;
      for (let i = 0; i < bulkOps.length; i += CHUNK_SIZE) {
        const chunk = bulkOps.slice(i, i + CHUNK_SIZE);
        await CustomRecord.bulkWrite(chunk, { ordered: false });
      }
      logger.info(`autoFixLeadSources: Corrected lead source/creator for ${bulkOps.length} records.`);
    }
  } catch (err) {
    logger.error('Non-fatal warning during autoFixLeadSources:', err);
  }
};
