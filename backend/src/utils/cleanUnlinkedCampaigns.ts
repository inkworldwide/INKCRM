import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbName = process.env.MONGODB_DB_NAME || 'inkcrm_bank';
const MONGODB_URI = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`;

export async function cleanUnlinkedCampaigns() {
  console.log(`Connecting to MongoDB (${MONGODB_URI})...`);
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB Connected.');

  // 1. Get Campaign Module
  const campaignModule = await ModuleDefinition.findOne({
    $or: [
      { apiPath: 'campaigns' },
      { apiPath: 'campaign' },
      { name: new RegExp('^campaigns?$', 'i') }
    ]
  });

  // 2. Get Lead Module
  const leadModule = await ModuleDefinition.findOne({
    $or: [
      { apiPath: 'leads' },
      { apiPath: 'lead' },
      { name: new RegExp('^leads?$', 'i') }
    ]
  });

  if (!campaignModule || !leadModule) {
    console.log('Campaign or Lead module definition not found.');
    return;
  }

  // 3. Find all registered Campaign records
  const registeredCampaigns = await CustomRecord.find({ moduleId: campaignModule._id }).lean();
  console.log(`Total registered campaign records in database: ${registeredCampaigns.length}`);

  // 4. Find all campaign names actually referenced in leads data
  const leadCampaignNames = new Set<string>();

  const leadRecords = await CustomRecord.find({ moduleId: leadModule._id }).select('data').lean();
  leadRecords.forEach(l => {
    const d = l.data || {};
    const cName = (d.campaignName || d.campaign || d.campaign_name || d.source || '').toString().trim().toLowerCase();
    if (cName) {
      leadCampaignNames.add(cName);
    }
  });

  console.log(`Active campaign names referenced by leads: Array(${leadCampaignNames.size}) ->`, Array.from(leadCampaignNames));

  // 5. Identify unlinked campaign records to delete
  const unlinkedCampaignIds: mongoose.Types.ObjectId[] = [];
  const keptCampaigns: string[] = [];

  registeredCampaigns.forEach(c => {
    const d = c.data || {};
    const rawName = (d.campaignName || d.name || d.source || '').toString().trim();
    const lowerName = rawName.toLowerCase();

    if (lowerName && leadCampaignNames.has(lowerName)) {
      keptCampaigns.push(rawName || 'Campaign');
    } else {
      unlinkedCampaignIds.push(c._id as mongoose.Types.ObjectId);
    }
  });

  if (unlinkedCampaignIds.length > 0) {
    const result = await CustomRecord.deleteMany({ _id: { $in: unlinkedCampaignIds } });
    console.log(`Purged ${result.deletedCount} unlinked campaign records from database.`);
  } else {
    console.log('No unlinked campaign records found to purge.');
  }

  console.log('\n=============================================================');
  console.log('🎉 UNLINKED CAMPAIGN PURGE COMPLETED!');
  console.log('=============================================================');
  console.log(`Kept ${keptCampaigns.length} Active Campaigns Linked to Leads:`);
  keptCampaigns.forEach((c, idx) => console.log(`  ${idx + 1}. ${c}`));
  console.log('=============================================================\n');
}

if (require.main === module) {
  cleanUnlinkedCampaigns()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error cleaning unlinked campaigns:', err);
      process.exit(1);
    });
}
