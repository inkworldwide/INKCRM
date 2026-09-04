import { Request, Response, NextFunction } from 'express';
import Organization from '../models/Organization';
import mongoose from 'mongoose';

export const resolveTenant = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let tenantIdentifier = req.headers['x-tenant-id'] as string;
    let organization = null;

    // 1. Try to resolve by tenant ID header
    if (tenantIdentifier && mongoose.Types.ObjectId.isValid(tenantIdentifier)) {
      organization = await Organization.findById(tenantIdentifier);
    }

    // 2. Try to resolve by subdomain from Host header if not resolved
    if (!organization) {
      const host = req.headers.host || '';
      // sales.localhost:5000 -> ["sales", "localhost:5000"]
      const parts = host.split('.');
      if (parts.length > 1 && parts[0] !== 'www' && parts[0] !== 'localhost') {
        const subdomain = parts[0].toLowerCase();
        organization = await Organization.findOne({ subdomain });
      }
    }

    // 3. Fallback: try checking a query param or request body
    if (!organization && req.query.tenantId && typeof req.query.tenantId === 'string' && mongoose.Types.ObjectId.isValid(req.query.tenantId)) {
      organization = await Organization.findById(req.query.tenantId);
    }

    if (!organization) {
      // If we are hit from a public route (e.g., auth login/register) we might not have tenant yet
      // but if the route requires a tenant context, we throw.
      // We will allow continuing, but route handlers will check if req.organizationId is set.
      return next();
    }

    (req as any).organizationId = organization._id as mongoose.Types.ObjectId;
    next();
  } catch (error) {
    console.error('Error resolving tenant:', error);
    res.status(500).json({ error: 'Internal server error resolving tenant.' });
  }
};

// Middleware to force a tenant to be loaded for protected tenant routes
export const requireTenant = (req: Request, res: Response, next: NextFunction): void => {
  if (!(req as any).organizationId) {
    res.status(400).json({ error: 'Tenant context (x-tenant-id header or subdomain) is required for this operation.' });
    return;
  }
  next();
};
