import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

import User from '../models/User';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbName = process.env.MONGODB_DB_NAME || 'inkcrm_bank';
const MONGODB_URI = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`;

export async function purgeOtherUsers() {
  console.log(`Connecting to MongoDB (${MONGODB_URI})...`);
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB Connected.');

  const preservedEmails = [
    'ktanazk6@gmail.com',
    'suhanasuhana49812@gmail.com',
    'saiyyadg91@gmail.com',
    'geetabavasarai196@gmail.com'
  ];

  // Find all users
  const allUsers = await User.find().lean();
  console.log(`Total users in database before purge: ${allUsers.length}`);

  const toDeleteIds: mongoose.Types.ObjectId[] = [];
  const keptUsers: string[] = [];

  allUsers.forEach(u => {
    const email = String(u.email || '').trim().toLowerCase();
    const isInkAdmin = email.includes('ink@crm') || email.includes('admin@ink') || email.includes('inkcrm');
    const isPreservedTelecaller = preservedEmails.includes(email);

    if (isInkAdmin || isPreservedTelecaller) {
      keptUsers.push(`${u.firstName} ${u.lastName} (${email})`);
    } else {
      toDeleteIds.push(u._id as mongoose.Types.ObjectId);
    }
  });

  if (toDeleteIds.length > 0) {
    const result = await User.deleteMany({ _id: { $in: toDeleteIds } });
    console.log(`Deleted ${result.deletedCount} user accounts.`);
  } else {
    console.log('No extra users to delete.');
  }

  console.log('\n=============================================================');
  console.log('🎉 USER CLEANUP COMPLETED!');
  console.log('=============================================================');
  console.log('Preserved Active Users:');
  keptUsers.forEach((usr, idx) => console.log(`  ${idx + 1}. ${usr}`));
  console.log('=============================================================\n');
}

if (require.main === module) {
  purgeOtherUsers()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error purging users:', err);
      process.exit(1);
    });
}
