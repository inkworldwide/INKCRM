import mongoose from 'mongoose';
import User from '../models/User';
import Role from '../models/Role';
import ModuleDefinition from '../models/ModuleDefinition';

export class HierarchyService {
  public static async isSuperAdmin(roleId: any): Promise<boolean> {
    if (!roleId) return false;
    try {
      const role = await Role.findById(roleId);
      if (!role) return false;
      const lower = (role.name || '').toLowerCase();
      return lower === 'super admin' || lower === 'admin' || lower === 'administrator' || lower === 'org admin' || lower === 'organization admin';
    } catch (e) {
      return false;
    }
  }

  public static async getSubordinateUserIds(
    userId: string | mongoose.Types.ObjectId,
    orgId: string | mongoose.Types.ObjectId
  ): Promise<mongoose.Types.ObjectId[]> {
    const allUsers = await User.find({ organizationId: orgId }).select('_id reportingManager');
    
    const userMap = new Map<string, string[]>();
    allUsers.forEach(u => {
      if (u.reportingManager) {
        const managerIdStr = u.reportingManager.toString();
        if (!userMap.has(managerIdStr)) {
          userMap.set(managerIdStr, []);
        }
        userMap.get(managerIdStr)!.push(u._id.toString());
      }
    });

    const descendants: string[] = [];
    const queue: string[] = [userId.toString()];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const subs = userMap.get(current) || [];
      subs.forEach(s => {
        if (!descendants.includes(s)) {
          descendants.push(s);
          queue.push(s);
        }
      });
    }

    return descendants.map(id => new mongoose.Types.ObjectId(id));
  }

  public static async modifyRecordQuery(
    query: Record<string, any>,
    reqUser: { id: string; roleId: string },
    orgId: string | mongoose.Types.ObjectId
  ): Promise<void> {
    // Skip hierarchy filtering for settings/metadata modules
    if (query.moduleId) {
      try {
        const moduleDef = await ModuleDefinition.findById(query.moduleId);
        if (moduleDef && moduleDef.apiPath) {
          const settingsPaths = ['bankmasters', 'bankingpartners', 'products', 'departments'];
          if (settingsPaths.includes(moduleDef.apiPath.toLowerCase())) {
            return;
          }
        }
      } catch (e) {
        // ignore and continue
      }
    }

    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [new mongoose.Types.ObjectId(reqUser.id), ...descendants];

    const allowedUsers = await User.find({ _id: { $in: allowedUserIds } }).select('_id firstName lastName email userCode');

    const strIds = allowedUserIds.map(id => id.toString());
    const searchCriteria: any[] = [
      { createdBy: { $in: allowedUserIds } },
      { 'data.assignedTo': { $in: strIds } },
      { 'data.telecaller': { $in: strIds } },
      { 'data.assignedAgent': { $in: strIds } },
      { 'data.psm': { $in: strIds } },
      { 'data.assignedToUserId': { $in: strIds } },
      { assignedTo: { $in: allowedUserIds } }
    ];

    allowedUsers.forEach(u => {
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
      const terms: string[] = [];
      if (fullName) terms.push(fullName);
      if (u.email) {
        terms.push(u.email.trim());
        const emailPrefix = u.email.trim().split('@')[0];
        if (emailPrefix && emailPrefix !== u.email.trim()) {
          terms.push(emailPrefix);
        }
      }
      if (u.userCode) terms.push(u.userCode.trim());

      terms.forEach(term => {
        const escTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp('^\\s*' + escTerm + '\\s*$', 'i');
        searchCriteria.push({ 'data.assignedTo': regex });
        searchCriteria.push({ 'data.telecaller': regex });
        searchCriteria.push({ 'data.assignedAgent': regex });
        searchCriteria.push({ 'data.assignedToName': regex });
        searchCriteria.push({ 'data.psm': regex });
      });
    });

    const hierarchyFilter = { $or: searchCriteria };

    if (query.$or) {
      const existingOr = query.$or;
      delete query.$or;
      query.$and = [
        { $or: existingOr },
        hierarchyFilter
      ];
    } else if (query.$and) {
      query.$and.push(hierarchyFilter);
    } else {
      Object.assign(query, hierarchyFilter);
    }
  }

  public static async modifyUserQuery(
    query: Record<string, any>,
    reqUser: { id: string; roleId: string },
    orgId: string | mongoose.Types.ObjectId
  ): Promise<void> {
    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [new mongoose.Types.ObjectId(reqUser.id), ...descendants];

    query._id = { $in: allowedUserIds };
  }

  public static async modifyAuditLogQuery(
    query: Record<string, any>,
    reqUser: { id: string; roleId: string },
    orgId: string | mongoose.Types.ObjectId
  ): Promise<void> {
    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [new mongoose.Types.ObjectId(reqUser.id), ...descendants];

    query.userId = { $in: allowedUserIds };
  }

  public static async modifyDocumentQuery(
    query: Record<string, any>,
    reqUser: { id: string; roleId: string },
    orgId: string | mongoose.Types.ObjectId
  ): Promise<void> {
    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [new mongoose.Types.ObjectId(reqUser.id), ...descendants];

    query.uploadedBy = { $in: allowedUserIds };
  }

  public static async checkRecordAccess(
    record: any,
    reqUser: { id: string; roleId: string },
    orgId: string | mongoose.Types.ObjectId
  ): Promise<boolean> {
    // Skip hierarchy check for settings/metadata modules
    if (record.moduleId) {
      try {
        const moduleDef = await ModuleDefinition.findById(record.moduleId);
        if (moduleDef && moduleDef.apiPath) {
          const settingsPaths = ['bankmasters', 'bankingpartners', 'products', 'departments'];
          if (settingsPaths.includes(moduleDef.apiPath.toLowerCase())) {
            return true;
          }
        }
      } catch (e) {
        // ignore and continue
      }
    }

    const isSuper = await this.isSuperAdmin(reqUser.roleId);
    if (isSuper) return true;

    const descendants = await this.getSubordinateUserIds(reqUser.id, orgId);
    const allowedUserIds = [reqUser.id.toString(), ...descendants.map(id => id.toString())];

    const creatorId = record.createdBy ? record.createdBy.toString() : '';
    if (allowedUserIds.includes(creatorId)) return true;

    const assignedValues = [
      record.data?.get ? record.data.get('assignedTo') : record.data?.assignedTo,
      record.data?.get ? record.data.get('telecaller') : record.data?.telecaller,
      record.data?.get ? record.data.get('assignedAgent') : record.data?.assignedAgent,
      record.data?.get ? record.data.get('assignedToName') : record.data?.assignedToName,
      record.data?.get ? record.data.get('psm') : record.data?.psm,
      record.assignedTo ? record.assignedTo.toString() : null
    ].filter(Boolean).map(v => String(v).trim().toLowerCase());

    if (assignedValues.length === 0) return false;

    const allowedUsers = await User.find({ _id: { $in: allowedUserIds } }).select('_id firstName lastName email userCode');

    for (const u of allowedUsers) {
      const uId = u._id.toString().toLowerCase();
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
      const email = (u.email || '').trim().toLowerCase();
      const emailPrefix = email ? email.split('@')[0] : '';
      const userCode = (u.userCode || '').trim().toLowerCase();

      for (const val of assignedValues) {
        if (val === uId) return true;
        if (fullName && val === fullName) return true;
        if (email && val === email) return true;
        if (emailPrefix && val === emailPrefix) return true;
        if (userCode && val === userCode) return true;
      }
    }

    return false;
  }
}
