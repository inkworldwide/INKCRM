const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

// Dynamically locate mongoose from backend or root node_modules
let mongoose;
try {
  mongoose = require('../backend/node_modules/mongoose');
} catch (e) {
  try {
    mongoose = require('./backend/node_modules/mongoose');
  } catch (e2) {
    mongoose = require('mongoose');
  }
}

const { ObjectId } = mongoose.Types;

function convertTypes(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(convertTypes);

  for (const k of Object.keys(obj)) {
    const val = obj[k];
    if (typeof val === 'string' && /^[0-9a-fA-F]{24}$/.test(val)) {
      if (k === '_id' || k.endsWith('Id') || k.endsWith('By') || k === 'user' || k === 'organization' || k === 'role' || k === 'reportingManager') {
        obj[k] = new ObjectId(val);
      }
    } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
      if (k === 'createdAt' || k === 'updatedAt' || k === 'dialedAt' || k === 'lastCallDate' || k === 'enrolledAt' || k === 'loginAt') {
        const parsed = new Date(val);
        if (!isNaN(parsed.getTime())) obj[k] = parsed;
      }
    } else if (typeof val === 'object') {
      obj[k] = convertTypes(val);
    }
  }
  return obj;
}

async function restore() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/inkcrm_bank';
  console.log('Connecting to MongoDB:', mongoUri);
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const dumpDir = __dirname;
  const files = fs.readdirSync(dumpDir);

  for (const file of files) {
    if (file.endsWith('.json') && file !== 'package.json') {
      const colName = file.replace('.json', '');
      const raw = fs.readFileSync(path.join(dumpDir, file), 'utf8');
      const docs = JSON.parse(raw);
      if (docs.length > 0) {
        console.log(`Restoring ${colName} (${docs.length} docs)...`);
        await db.collection(colName).deleteMany({});
        const typedDocs = docs.map(convertTypes);
        await db.collection(colName).insertMany(typedDocs);
      }
    } else if (file.endsWith('.jsonl.gz')) {
      const colName = file.replace('.jsonl.gz', '');
      console.log(`Restoring ${colName} from compressed archive...`);
      await db.collection(colName).deleteMany({});

      const fileStream = fs.createReadStream(path.join(dumpDir, file));
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

      let batch = [];
      let totalInserted = 0;
      for await (const line of rl) {
        if (line.trim()) {
          const doc = JSON.parse(line);
          batch.push(convertTypes(doc));
          if (batch.length >= 1000) {
            await db.collection(colName).insertMany(batch);
            totalInserted += batch.length;
            process.stdout.write(`\rInserted ${totalInserted} docs into ${colName}...`);
            batch = [];
          }
        }
      }
      if (batch.length > 0) {
        await db.collection(colName).insertMany(batch);
        totalInserted += batch.length;
      }
      console.log(`\nCompleted ${colName} (${totalInserted} docs).`);
    }
  }

  console.log('\nDatabase restore complete! All collections and ObjectIds restored.');
  await mongoose.disconnect();
}

restore().catch(console.error);
