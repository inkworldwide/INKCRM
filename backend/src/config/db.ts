import mongoose from 'mongoose';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

let localDbProcess: any = null;

export const connectDB = async (): Promise<void> => {
  const dbName = process.env.MONGODB_DB_NAME || 'inkcrm_bank';
  let connUri = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${dbName}`;

  // Safety check: block any cloud Atlas connection strings
  if (connUri.includes('mongodb.net') || connUri.includes('mongodb+srv://') || connUri.includes('atlas')) {
    console.log('Warning: Cloud database connection string detected. Forcing fallback to local isolated database.');
    connUri = `mongodb://127.0.0.1:27017/${dbName}`;
  }

  mongoose.set('strictQuery', true);

  try {
    // Attempt standard connection to local server with optimized connection pool
    await mongoose.connect(connUri, {
      maxPoolSize: 100,
      minPoolSize: 10,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000
    });
    console.log(`MongoDB Connected: ${mongoose.connection.host}`);
  } catch (err) {
    console.log('Local MongoDB service not running. Attempting to launch local mongod inside project...');
    
    // Path to the project database folder
    const dbPath = path.resolve(__dirname, '../../../../mongodb-data');
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath, { recursive: true });
    }

    // Default paths for Windows MongoDB installation (only searched on Windows platforms)
    const mongodPaths = process.platform === 'win32' ? [
      'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe',
      'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
      'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
      'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe',
    ] : [];

    let mongodBinary = '';
    for (const p of mongodPaths) {
      if (fs.existsSync(p)) {
        mongodBinary = p;
        break;
      }
    }

    if (!mongodBinary) {
      console.error('\n==================================================================');
      console.error('❌ FATAL ERROR: Local MongoDB Community Server is not installed!');
      console.error('==================================================================');
      console.error('Please download and install MongoDB Community Server to run inkCRM.');
      console.error('Download Link: https://www.mongodb.com/try/download/community');
      console.error('==================================================================\n');
      process.exit(1);
    }

    // Spawn mongod as a child process pointing to our project folder
    localDbProcess = spawn(mongodBinary, [
      '--dbpath', dbPath,
      '--port', '27017'
    ], { stdio: 'ignore', detached: false });

    // Wait a brief moment for the database to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/inkcrm', {
        maxPoolSize: 100,
        minPoolSize: 10,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 5000
      });
      console.log(`MongoDB Connected (Project Folder): ${mongoose.connection.host}`);
    } catch (connectErr) {
      console.error('Failed to connect to the automatically started local database process:', connectErr);
      process.exit(1);
    }
  }
};

export const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    console.log('MongoDB Disconnected.');
    if (localDbProcess) {
      localDbProcess.kill();
      console.log('Project database process terminated.');
    }
  } catch (error) {
    console.error('Error disconnecting from MongoDB:', error);
  }
};
