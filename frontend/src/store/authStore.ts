import { create } from 'zustand';
import api from '../services/api';

export interface ModulePermission {
  moduleName: string;
  create: boolean;
  read: 'all' | 'own' | 'none';
  update: 'all' | 'own' | 'none';
  delete: 'all' | 'own' | 'none';
}

export interface UserRole {
  _id: string;
  name: string;
  description?: string;
  isSystem?: boolean;
  permissions?: {
    modules?: ModulePermission[];
    menus?: string[];
    fields?: any[];
  };
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roleId: string | UserRole;
  organizationId: string;
}

interface AuthState {
  user: User | null;
  role: UserRole | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  setAuth: (user: User, token: string, refreshToken?: string) => void;
  setRole: (role: UserRole) => void;
  fetchProfile: () => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => void;
  canAccessMenu: (menuKey: string) => boolean;
  canAccessModule: (moduleName: string, action?: 'create' | 'read' | 'update' | 'delete') => boolean;
  canExportCampaigns: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  role: null,
  token: null,
  isAuthenticated: false,
  isInitializing: true,

  setAuth: (user, token, refreshToken) => {
    localStorage.setItem('token', token);
    if (refreshToken) {
      localStorage.setItem('refreshToken', refreshToken);
    }
    localStorage.setItem('tenantId', user.organizationId);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, token, isAuthenticated: true, isInitializing: false });
    // Fetch full role details in background
    get().fetchProfile();
  },

  setRole: (role) => {
    set({ role });
  },

  fetchProfile: async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await api.get('/auth/me');
      if (res.data?.role) {
        set({ role: res.data.role });
      }
      if (res.data?.user) {
        set({
          user: {
            id: res.data.user._id || res.data.user.id,
            firstName: res.data.user.firstName,
            lastName: res.data.user.lastName,
            email: res.data.user.email,
            roleId: res.data.user.roleId,
            organizationId: res.data.user.organizationId
          }
        });
      }
    } catch (err) {
      console.warn('Failed to load user profile & permissions:', err);
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // Ignore network errors on logout
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      set({ user: null, role: null, token: null, isAuthenticated: false });
    }
  },

  initialize: async () => {
    const token = localStorage.getItem('token');
    const tenantId = localStorage.getItem('tenantId');
    const userStr = localStorage.getItem('user');

    if (token && tenantId && userStr) {
      try {
        const user = JSON.parse(userStr);
        set({ user, token, isAuthenticated: true, isInitializing: false });
        get().fetchProfile();
      } catch (e) {
        set({ isInitializing: false });
      }
    } else {
      set({ isInitializing: false });
    }
  },

  canAccessMenu: (menuKey: string) => {
    const state = get();
    const role = state.role;
    const user = state.user;

    const roleName = (role?.name || (typeof user?.roleId === 'object' ? (user.roleId as any)?.name : '') || '').toLowerCase();
    const userEmail = (user?.email || '').toLowerCase();
    
    // 1. Super Admin and Admin ALWAYS have full access to all menus
    if (roleName.includes('super admin') || roleName.includes('admin') || userEmail === 'ink@crm.com') {
      return true;
    }

    if (!role) {
      // If role not yet loaded, allow during initial render
      return true;
    }

    const allowedMenus = role.permissions?.menus;
    // If no explicit menu list is defined on role (undefined/null), default to true
    if (!Array.isArray(allowedMenus)) {
      return true;
    }

    const normalizedKey = (menuKey || '').toLowerCase().replace(/[-_\s]/g, '');

    // 2. Strictly check if the menu key or its alias is present in the role's allowedMenus list
    return allowedMenus.some((m: string) => {
      const norm = (m || '').toLowerCase().replace(/[-_\s]/g, '');
      if (norm === normalizedKey) return true;

      // Group / Alias Mappings
      if (norm === 'exportcampaigns' && (normalizedKey === 'mycampaign' || normalizedKey === 'exportcampaigns')) return true;
      if (norm === 'mycampaign' && (normalizedKey === 'exportcampaigns' || normalizedKey === 'mycampaign')) return true;
      if (norm === 'leads' && (normalizedKey === 'lead' || normalizedKey === 'leadsprocess')) return true;
      if (norm === 'campaigns' && (normalizedKey === 'campaign' || normalizedKey === 'campaignlist')) return true;
      return false;
    });
  },

  canAccessModule: (moduleName: string, action: 'create' | 'read' | 'update' | 'delete' = 'read') => {
    const state = get();
    const role = state.role;
    const user = state.user;

    const roleName = (role?.name || (typeof user?.roleId === 'object' ? (user.roleId as any)?.name : '') || '').toLowerCase();
    const userEmail = (user?.email || '').toLowerCase();

    // 1. Super Admin and Admin ALWAYS have full module permissions for all actions
    if (roleName.includes('super admin') || roleName.includes('admin') || userEmail === 'ink@crm.com') {
      return true;
    }

    if (!role) return true;

    const modules = role.permissions?.modules;
    if (!Array.isArray(modules) || modules.length === 0) return true;

    const mod = modules.find(
      (m) => m.moduleName.toLowerCase() === moduleName.toLowerCase()
    );
    if (!mod) return true;

    if (action === 'create') return mod.create !== false;
    if (action === 'read') return mod.read !== 'none';
    if (action === 'update') return mod.update !== 'none';
    if (action === 'delete') return mod.delete !== 'none';

    return true;
  },

  canExportCampaigns: () => {
    const state = get();
    const role = state.role;
    const user = state.user;

    const roleName = (role?.name || (typeof user?.roleId === 'object' ? (user.roleId as any)?.name : '') || '').toLowerCase();
    const userEmail = (user?.email || '').toLowerCase();

    // 1. Admin and Super Admin always have export permission
    if (roleName.includes('super admin') || roleName.includes('admin') || userEmail === 'ink@crm.com') {
      return true;
    }

    // 2. Check if role has explicit export_campaigns permission in allowedMenus
    if (!role) return false;
    const allowedMenus = role.permissions?.menus;
    if (!Array.isArray(allowedMenus)) return false;

    return allowedMenus.some((m: string) => {
      const norm = (m || '').toLowerCase().replace(/[-_\s]/g, '');
      return norm === 'exportcampaigns' || norm === 'exportcampaign' || norm === 'export_campaigns' || norm === 'mycampaign';
    });
  }
}));
