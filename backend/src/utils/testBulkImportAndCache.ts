import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

import CustomRecord from '../models/CustomRecord';
import ModuleDefinition from '../models/ModuleDefinition';
import Organization from '../models/Organization';
import User from '../models/User';
import { SummaryService } from './summaryService';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbName = process.env.MONGODB_DB_NAME || 'inkcrm_bank';
const MONGODB_URI = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`;

export async function runTestBulkImport() {
  console.log('==================================================================');
  console.log('⚡ STEP 2 — 5,000 BULK IMPORT & CACHE INVALIDATION LIVE VERIFICATION');
  console.log('==================================================================');

  await mongoose.connect(MONGODB_URI);
  console.log(`[CONNECTED] MongoDB: ${MONGODB_URI}`);

  const org = await Organization.findOne();
  if (!org) {
    console.error('No Organization found.');
    return;
  }
  const orgId = org._id;

  const leadModule = await ModuleDefinition.findOne({
    $or: [
      { organizationId: orgId, apiPath: 'leads' },
      { apiPath: 'leads' },
      { name: new RegExp('^leads?$', 'i') }
    ]
  });
  if (!leadModule) {
    console.error('No Lead Module found.');
    return;
  }
  const leadModuleId = leadModule._id;

  // 1. Initial State Measurement
  const initialTotal = await CustomRecord.countDocuments({ organizationId: orgId, moduleId: leadModuleId });
  console.log(`\n[BEFORE IMPORT] Total Leads in Database: ${initialTotal.toLocaleString()}`);

  const initialMetrics = await SummaryService.getDashboardMetrics(orgId, leadModuleId);
  const initialHotCount = initialMetrics['HOT LEADS'] || 0;
  console.log(`[BEFORE IMPORT] Pre-computed HOT LEADS count: ${initialHotCount.toLocaleString()}`);

  // 2. Generate 5,000 new HOT LEADS
  console.log('\n[BULK IMPORT] Generating and inserting 5,000 new HOT LEADS...');
  const bulkRecords: any[] = [];
  const PHONE_NUMBER = '9916102542';

  const user = await User.findOne();
  const userId = user ? user._id : orgId;

  const timestamp = Date.now();
  for (let i = 1; i <= 5000; i++) {
    const codeNum = String(i).padStart(5, '0');
    const dataCode = `LND-BLK-${timestamp}-${codeNum}`;

    bulkRecords.push({
      organizationId: orgId,
      moduleId: leadModuleId,
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      data: {
        dataCode,
        data_code: dataCode,
        customerName: `Bulk Test Lead ${codeNum}`,
        phone: PHONE_NUMBER,
        mobile: PHONE_NUMBER,
        status: 'HOT LEADS',
        dialStatus: 'YET TO CALL',
        normalizedStatus: 'HOT LEADS',
        source: 'Bulk Import Verifier',
        campaignName: 'Bulk Import Campaign 2026',
        assignedTo: 'K. Tanaz K',
        assignedToName: 'K. Tanaz K'
      }
    });
  }

  const importStart = Date.now();
  const insertResult = await CustomRecord.insertMany(bulkRecords, { ordered: false });
  const importDuration = Date.now() - importStart;

  console.log(`✓ Inserted ${insertResult.length.toLocaleString()} leads in ${importDuration}ms (Chunked High-Throughput Batch)`);

  // 3. Trigger Cache Invalidation & Summary Refresh
  console.log('\n[CACHE INVALIDATION] Firing SummaryService.invalidateCache(orgId)...');
  SummaryService.invalidateCache(orgId);
  await SummaryService.refreshSummaryAggregates(orgId, leadModuleId);

  // 4. Post-Import Measurement
  const finalTotal = await CustomRecord.countDocuments({ organizationId: orgId, moduleId: leadModuleId });
  console.log(`\n[AFTER IMPORT] Total Leads in Database: ${finalTotal.toLocaleString()} (Delta: +${(finalTotal - initialTotal).toLocaleString()})`);

  const updatedMetrics = await SummaryService.getDashboardMetrics(orgId, leadModuleId);
  const updatedHotCount = updatedMetrics['HOT LEADS'] || 0;
  console.log(`[AFTER IMPORT] Updated HOT LEADS count:    ${updatedHotCount.toLocaleString()} (Delta: +${(updatedHotCount - initialHotCount).toLocaleString()})`);

  if (updatedHotCount === initialHotCount + 5000) {
    console.log('\n==================================================================');
    console.log('🎉 VERIFICATION SUCCESSFUL: CACHE INVALIDATION & NUMBERS ACCURATE!');
    console.log('==================================================================\n');
  } else {
    console.error('Mismatch in post-import cache verification numbers!');
  }
}

if (require.main === module) {
  runTestBulkImport()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error running test bulk import:', err);
      process.exit(1);
    });
}
