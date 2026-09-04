import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

import Organization from '../models/Organization';
import Role from '../models/Role';
import User from '../models/User';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbName = process.env.MONGODB_DB_NAME || 'inkcrm_bank';
const MONGODB_URI = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`;

export async function runSeed45k() {
  console.log(`Connecting to MongoDB for 45k+ leads seeding (${MONGODB_URI})...`);
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB Connected.');

  // 1. Get or create Organization
  let org = await Organization.findOne();
  if (!org) {
    org = await Organization.create({
      name: 'inkSales Enterprises',
      subdomain: 'sales',
      logoUrl: '/logo.png',
      faviconUrl: '/favicon.ico'
    });
  }

  // 2. Get or create Telecaller Role
  let telecallerRole = await Role.findOne({
    $or: [
      { name: new RegExp('^telecaller$', 'i') },
      { name: new RegExp('^teli caller$', 'i') }
    ]
  });

  if (!telecallerRole) {
    telecallerRole = await Role.create({
      organizationId: org._id,
      name: 'Telecaller',
      description: 'Telecaller Agent with access to leads',
      isSystem: false,
      permissions: [
        { resource: 'leads', actions: ['read', 'create', 'update'] },
        { resource: 'reports', actions: ['read'] }
      ]
    });
  }

  // 3. Get or create Leads Module
  let leadModule = await ModuleDefinition.findOne({
    $or: [
      { organizationId: org._id, apiPath: 'leads' },
      { apiPath: 'leads' },
      { name: new RegExp('^leads?$', 'i') }
    ]
  });

  if (!leadModule) {
    leadModule = await ModuleDefinition.create({
      organizationId: org._id,
      name: 'Leads',
      singularLabel: 'Lead',
      apiPath: 'leads',
      fields: [
        { name: 'customerName', label: 'Customer Name', type: 'text' },
        { name: 'phone', label: 'Phone Number', type: 'phone' },
        { name: 'dataCode', label: 'Data Code', type: 'text' },
        { name: 'firmName', label: 'Firm Name', type: 'text' },
        { name: 'status', label: 'Status', type: 'select' },
        { name: 'assignedTo', label: 'Assigned To', type: 'text' },
        { name: 'source', label: 'Source', type: 'text' }
      ]
    });
  }

  // 4. Hash password `admin@123`
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('admin@123', salt);

  const targetTelecallers = [
    {
      firstName: 'K.',
      lastName: 'Tanaz K',
      email: 'ktanazk6@gmail.com',
      prefix: 'TNZ'
    },
    {
      firstName: 'suhana',
      lastName: 'k',
      email: 'suhanasuhana49812@gmail.com',
      prefix: 'SUH'
    },
    {
      firstName: 'Reshma',
      lastName: 'R',
      email: 'saiyyadg91@gmail.com',
      prefix: 'RSH'
    },
    {
      firstName: 'Geetha',
      lastName: 'Geetha Gondabal',
      email: 'geetabavasarai196@gmail.com',
      prefix: 'GTH'
    }
  ];

  const createdUserDocs: any[] = [];

  for (const t of targetTelecallers) {
    let user = await User.findOne({ email: t.email.toLowerCase() });
    if (!user) {
      user = await User.create({
        organizationId: org._id,
        roleId: telecallerRole._id,
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email.toLowerCase(),
        passwordHash,
        plainPassword: 'admin@123',
        isVerified: true,
        skipFace: true,
        skipLocation: true,
        isActive: true,
        isApproved: true,
        approvalStatus: 'approved'
      });
      console.log(`Created user: ${t.firstName} ${t.lastName} (${t.email}) with password admin@123`);
    } else {
      user.passwordHash = passwordHash;
      user.plainPassword = 'admin@123';
      user.skipFace = true;
      user.skipLocation = true;
      user.isActive = true;
      user.isApproved = true;
      user.approvalStatus = 'approved';
      await user.save();
      console.log(`Updated user password to admin@123: ${t.firstName} ${t.lastName} (${t.email})`);
    }
    createdUserDocs.push({ ...t, doc: user });
  }

  // 5. Check existing leads count per telecaller
  const LEADS_PER_TELECALLER = 46000; // >45k leads each!
  const PHONE_NUMBER = '9916102542';

  const statusesList = [
    'HOT LEADS',
    'WARM LEADS',
    'YET TO CALL',
    'DISBUSED',
    'APPROVED BUT NOT DISBUSE',
    'LOGINS',
    'CEBIL PENDING',
    'FOLLOWUP',
    'DROPPED',
    'REJECTED',
    'PENDING'
  ];

  const categoriesList = ['Personal Loan', 'Business Loan', 'Home Loan', 'LAP', 'Mortgage'];

  console.log(`\nGenerating ${LEADS_PER_TELECALLER.toLocaleString()} leads for EACH of the 4 telecallers (Total: ${(LEADS_PER_TELECALLER * 4).toLocaleString()} leads)...`);

  for (const agent of createdUserDocs) {
    const fullName = `${agent.firstName} ${agent.lastName}`.trim();
    const agentEmail = agent.email;
    const userId = agent.doc._id;

    // Count existing leads for this agent
    const existingCount = await CustomRecord.countDocuments({
      organizationId: org._id,
      moduleId: leadModule._id,
      $or: [
        { 'data.assignedTo': fullName },
        { 'data.assignedToName': fullName },
        { 'data.telecaller': fullName },
        { 'data.assignedAgent': fullName },
        { 'data.createdBy': fullName },
        { createdBy: userId }
      ]
    });

    console.log(`Current leads for ${fullName}: ${existingCount.toLocaleString()}`);

    const leadsToGenerate = Math.max(0, LEADS_PER_TELECALLER - existingCount);
    if (leadsToGenerate === 0) {
      console.log(`✓ ${fullName} already has ${existingCount.toLocaleString()} leads (>= 45k). Skipping generation.`);
      continue;
    }

    console.log(`Generating ${leadsToGenerate.toLocaleString()} new leads for ${fullName}...`);

    const BATCH_SIZE = 5000;
    let createdTotal = 0;

    while (createdTotal < leadsToGenerate) {
      const currentBatchSize = Math.min(BATCH_SIZE, leadsToGenerate - createdTotal);
      const batchRecords: any[] = [];

      for (let i = 0; i < currentBatchSize; i++) {
        const leadIndex = existingCount + createdTotal + i + 1;
        const codeNum = String(leadIndex).padStart(5, '0');
        const dataCode = `LND-${agent.prefix}-${codeNum}`;
        const status = statusesList[i % statusesList.length];
        const category = categoriesList[i % categoriesList.length];

        // Distribute dates evenly across 2026 (Jan - Dec)
        const dayOfYear = (i % 365) + 1;
        const leadDate = new Date(2026, 0, dayOfYear, (i % 8) + 9, (i * 7) % 60);

        const isDialed = status !== 'YET TO CALL';
        const dialedAt = isDialed ? leadDate : undefined;

        batchRecords.push({
          organizationId: org._id,
          moduleId: leadModule._id,
          createdBy: userId,
          updatedBy: userId,
          createdAt: leadDate,
          updatedAt: leadDate,
          data: {
            dataCode,
            data_code: dataCode,
            'Data Code': dataCode,
            'data code': dataCode,
            datacode: dataCode,
            DataCode: dataCode,
            code: dataCode,

            customerName: `Lead ${agent.prefix} ${codeNum}`,
            customer: `Lead ${agent.prefix} ${codeNum}`,
            firstName: `Lead`,
            lastName: `${agent.prefix} ${codeNum}`,
            
            phone: PHONE_NUMBER,
            mobile: PHONE_NUMBER,
            contactNum: PHONE_NUMBER,
            phoneNumber: PHONE_NUMBER,

            firmName: `Firm ${agent.prefix} ${codeNum}`,
            company: `Firm ${agent.prefix} ${codeNum}`,
            location: 'Bangalore',
            city: 'Bangalore',

            status: status,
            dialStatus: status,
            normalizedStatus: status,

            leadCategory: category,
            loanType: category,
            budget: String(100000 + (i % 50) * 10000),

            source: fullName,
            campaignName: 'Direct Lead Import',

            assignedTo: fullName,
            assignedToName: fullName,
            telecaller: fullName,
            assignedAgent: fullName,
            createdBy: fullName,
            createdByName: fullName,
            assignedBy: 'System Admin',
            assignedByName: 'System Admin',

            callAttempts: isDialed ? (i % 3) + 1 : 0,
            dialedAt: dialedAt,
            lastCallDate: dialedAt,
            remarks: `Followup note for lead ${codeNum}`
          }
        });
      }

      await CustomRecord.insertMany(batchRecords, { ordered: false });
      createdTotal += currentBatchSize;
      console.log(`  -> Inserted batch: ${createdTotal.toLocaleString()} / ${leadsToGenerate.toLocaleString()} for ${fullName}...`);
    }

    console.log(`✓ Completed generating leads for ${fullName}. Total leads: ${(existingCount + leadsToGenerate).toLocaleString()}`);
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL 4 TELECALLER USERS & 45K+ LEADS SEEDED SUCCESSFULLY!');
  console.log('=============================================================');
  console.log('Login Credentials for all 4 Telecallers:');
  console.log('  1. ktanazk6@gmail.com          -> Password: admin@123 (>45,000 leads)');
  console.log('  2. suhanasuhana49812@gmail.com -> Password: admin@123 (>45,000 leads)');
  console.log('  3. saiyyadg91@gmail.com        -> Password: admin@123 (>45,000 leads)');
  console.log('  4. geetabavasarai196@gmail.com -> Password: admin@123 (>45,000 leads)');
  console.log('=============================================================\n');
}

if (require.main === module) {
  runSeed45k()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error running 45k seed script:', err);
      process.exit(1);
    });
}
