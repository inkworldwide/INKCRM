import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

import CustomRecord from '../models/CustomRecord';
import ModuleDefinition from '../models/ModuleDefinition';
import Organization from '../models/Organization';
import User from '../models/User';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbName = process.env.MONGODB_DB_NAME || 'inkcrm_bank';
const MONGODB_URI = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`;

export async function runBenchmarkAudit() {
  console.log('==================================================================');
  console.log('📊 STEP 1 & STEP 2 — SYSTEM MEASUREMENT & EXPLAIN PLAN AUDIT');
  console.log('==================================================================');

  const startTime = Date.now();
  await mongoose.connect(MONGODB_URI);
  console.log(`[CONNECTED] MongoDB: ${MONGODB_URI}`);

  // 1. Record Counts
  const totalLeadsCount = await CustomRecord.countDocuments({});
  const totalUsersCount = await User.countDocuments({});
  const totalOrgsCount = await Organization.countDocuments({});
  const totalModulesCount = await ModuleDefinition.countDocuments({});

  console.log('\n--- 1. DATABASE ROW / DOCUMENT COUNTS ---');
  console.log(`CustomRecords (Leads & Entities): ${totalLeadsCount.toLocaleString()}`);
  console.log(`Users:                            ${totalUsersCount.toLocaleString()}`);
  console.log(`Organizations:                    ${totalOrgsCount.toLocaleString()}`);
  console.log(`Module Definitions:               ${totalModulesCount.toLocaleString()}`);

  const org = await Organization.findOne();
  const orgId = org ? org._id : new mongoose.Types.ObjectId();

  const leadModule = await ModuleDefinition.findOne({
    $or: [
      { organizationId: orgId, apiPath: 'leads' },
      { apiPath: 'leads' },
      { name: new RegExp('^leads?$', 'i') }
    ]
  });

  const leadModuleId = leadModule ? leadModule._id : new mongoose.Types.ObjectId();

  console.log('\n--- 2. DASHBOARD METRICS QUERY EXPLAIN & TIMING AUDIT ---');
  
  const leadMatchQuery = {
    organizationId: orgId,
    moduleId: leadModuleId
  };

  // Test 1: Status Grouping Aggregation Pipeline
  const statusAggStart = Date.now();
  const statusAggExplain = await CustomRecord.aggregate([
    { $match: leadMatchQuery },
    {
      $project: {
        st: {
          $ifNull: [
            '$data.normalizedStatus',
            { $ifNull: ['$data.status', { $ifNull: ['$data.dialStatus', '$data.leadStatus'] }] }
          ]
        }
      }
    },
    { $group: { _id: '$st', count: { $sum: 1 } } }
  ]).explain('executionStats');

  const statusAggDuration = Date.now() - statusAggStart;
  const statusStats = (statusAggExplain as any).executionStats || {};

  console.log(`Status Aggregation Pipeline Duration: ${statusAggDuration} ms`);
  console.log(`  - Total Docs Examined:   ${(statusStats.totalDocsExamined || 0).toLocaleString()}`);
  console.log(`  - Execution Time Millis: ${statusStats.executionTimeMillis || statusAggDuration} ms`);

  // Test 2: Today's Followups Date Range Query
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const todayStr = startOfToday.toISOString().split('T')[0];

  const followUpQuery = {
    organizationId: orgId,
    moduleId: leadModuleId,
    $or: [
      { 'data.followUpDate': { $gte: startOfToday, $lte: endOfToday } },
      { 'data.followUpDate': todayStr }
    ]
  };

  const followUpStart = Date.now();
  const followUpExplain = await CustomRecord.find(followUpQuery)
    .sort({ 'data.followUpDate': 1 })
    .limit(10)
    .explain('executionStats');
  const followUpDuration = Date.now() - followUpStart;
  const followUpStats = (followUpExplain as any).executionStats || {};

  console.log(`Today's Followups Query Duration: ${followUpDuration} ms`);
  console.log(`  - Total Docs Examined:   ${(followUpStats.totalDocsExamined || 0).toLocaleString()}`);
  console.log(`  - Execution Time Millis: ${followUpStats.executionTimeMillis || followUpDuration} ms`);

  // Test 3: My Campaigns Aggregation Pipeline
  console.log('\n--- 3. MY CAMPAIGNS AGGREGATION EXPLAIN & TIMING AUDIT ---');
  const campAggStart = Date.now();
  const campAggExplain = await CustomRecord.aggregate([
    { $match: leadMatchQuery },
    {
      $project: {
        campaignName: {
          $ifNull: [
            '$data.campaignName',
            { $ifNull: ['$data.campaign', { $ifNull: ['$data.campaign_name', '$data.source'] }] }
          ]
        },
        createdAt: '$createdAt'
      }
    },
    {
      $group: {
        _id: { $toLower: { $ifNull: ['$campaignName', ''] } },
        totalAssigned: { $sum: 1 }
      }
    }
  ]).explain('executionStats');

  const campAggDuration = Date.now() - campAggStart;
  const campStats = (campAggExplain as any).executionStats || {};

  console.log(`My Campaigns Aggregation Duration: ${campAggDuration} ms`);
  console.log(`  - Total Docs Examined:   ${(campStats.totalDocsExamined || 0).toLocaleString()}`);
  console.log(`  - Execution Time Millis: ${campStats.executionTimeMillis || campAggDuration} ms`);

  console.log('\n==================================================================');
  console.log(`✅ BENCHMARK AUDIT COMPLETED IN ${Date.now() - startTime} ms`);
  console.log('==================================================================\n');
}

if (require.main === module) {
  runBenchmarkAudit()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error running benchmark audit:', err);
      process.exit(1);
    });
}
