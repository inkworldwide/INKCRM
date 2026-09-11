const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const mongoose = require('../backend/node_modules/mongoose');

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
        await db.collection(colName).insertMany(docs);
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
          batch.push(JSON.parse(line));
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

  console.log('Database restore complete!');
  await mongoose.disconnect();
}

restore().catch(console.error);
