import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import CustomRecord from '../models/CustomRecord';
import { normalizeStatusName } from '../routes/recordRoutes';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/inkcrm';

export async function runBackfill() {
  const startTime = Date.now();
  console.log('[BACKFILL] Starting status normalization backfill...');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }

  const cursor = CustomRecord.find({}).cursor();
  let totalProcessed = 0;
  let totalUpdated = 0;
  let bulkOps: any[] = [];
  const BATCH_SIZE = 1000;

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    totalProcessed++;
    const data = doc.data instanceof Map ? Object.fromEntries(doc.data) : (doc.data || {});
    if (data.isCampaignDialOnly || data.normalizedStatus === 'CAMPAIGN_DIAL') {
      continue;
    }
    const rawSt = data.status || data.dialStatus || data.leadStatus || 'PENDING';
    const normalized = normalizeStatusName(rawSt);

    if (data.normalizedStatus !== normalized) {
      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { 'data.normalizedStatus': normalized } }
        }
      });
      totalUpdated++;
    }

    if (bulkOps.length >= BATCH_SIZE) {
      await CustomRecord.bulkWrite(bulkOps);
      console.log(`[BACKFILL] Processed ${totalProcessed} records... (${totalUpdated} updated)`);
      bulkOps = [];
    }
  }

  if (bulkOps.length > 0) {
    await CustomRecord.bulkWrite(bulkOps);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[BACKFILL COMPLETE] Processed: ${totalProcessed}, Updated: ${totalUpdated}, Duration: ${durationSec}s`);
  
  return { totalProcessed, totalUpdated, durationSec };
}

if (require.main === module) {
  runBackfill()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[BACKFILL ERROR]', err);
      process.exit(1);
    });
}
