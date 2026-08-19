// inkCRM Enterprise Production Server (Reloaded v7)
import app from './app';
import { connectDB, disconnectDB } from './config/db';
import Organization from './models/Organization';
import { seedDatabase } from './utils/seeder';
import { logger } from './utils/logger';
import dotenv from 'dotenv';

dotenv.config();

// 1. Validate Production Environment Variables
const requiredEnvVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI', 'ENCRYPTION_KEY'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingEnvVars.length > 0) {
  logger.error(`FATAL STARTUP ERROR: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// 2. Validate face credentials decryption key length (must be 32 bytes or 32 chars)
const encryptionKey = process.env.ENCRYPTION_KEY || '';
if (encryptionKey.length < 16) {
  logger.error(`FATAL STARTUP ERROR: ENCRYPTION_KEY must be at least 16 characters for cryptographic strength.`);
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

let server: any;

const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // Auto-seed if database is empty
    const count = await Organization.countDocuments();
    if (count === 0) {
      logger.info('No organization tenants detected. Running auto-seeder...');
      await seedDatabase(false);
      logger.info('Auto-seeding completed.');
    }

    server = app.listen(PORT, () => {
      logger.info(`=================================`);
      logger.info(` inkCRM Backend API Server Running`);
      logger.info(` Port: ${PORT}`);
      logger.info(` Mode: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`=================================`);
    });

    // 3. Configure request timeout (5 minutes for massive bulk lead operations)
    server.setTimeout(300000);

  } catch (error: any) {
    logger.error('Fatal error starting the server:', error);
    process.exit(1);
  }
};

// 4. Handle Graceful Shutdown Process
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  if (server) {
    server.close(async () => {
      logger.info('Express server closed.');
      try {
        await disconnectDB();
        logger.info('Database connection closed cleanly.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during database disconnect:', err);
        process.exit(1);
      }
    });

    // Force shutdown after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Forcing shutdown after timeout.');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
