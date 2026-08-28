import React, { useEffect, useState, useMemo } from 'react';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useModuleStore } from '../store/moduleStore';
import { useToastStore } from '../store/toastStore';
import { useAuthStore, ModulePermission } from '../store/authStore';

export interface MenuItemDefinition {
  key: string;
  label: string;
  category: 'Main Menu' | 'Reports & Analytics' | 'Funnel' | 'Administration' | 'Modules';
  path: string;
  icon: string;
  description: string;
  isRecordModule?: boolean;
  moduleName?: string;
}

const SYSTEM_MENU_CONFIG: MenuItemDefinition[] = [
  // 1. MAIN MENU
  {
    key: 'dashboard',
    label: 'Dashboard',
    category: 'Main Menu',
    path: '/',
    icon: 'LayoutDashboard',
    description: 'Overview KPI cards, stage funnel, follow-up alerts, and daily metrics.'
  },
  {
    key: 'leads',
    label: 'Leads Process',
    category: 'Main Menu',
    path: '/modules/leads',
    icon: 'Layers',
    description: 'Leads table, status stages, lead timeline, and customer records.',
    isRecordModule: true,
    moduleName: 'leads'
  },
  {
    key: 'campaigns',
    label: 'Campaign List',
    category: 'Main Menu',
    path: '/modules/campaigns',
    icon: 'Target',
    description: 'Campaign tracking, lead allocation metrics, and progress summaries.',
    isRecordModule: true,
    moduleName: 'campaigns'
  },
  {
    key: 'campaignassignments',
    label: 'Assign Campaign',
    category: 'Main Menu',
    path: '/modules/campaignassignments',
    icon: 'UserCheck',
    description: 'Batch lead assignment to telecallers and telemarketing agents.',
    isRecordModule: true,
    moduleName: 'campaignassignments'
  },
  {
    key: 'export_campaigns',
    label: 'Export Campaign Data',
    category: 'Main Menu',
    path: '/my-campaign',
    icon: 'Download',
    description: 'Permission to export campaign lead records and Excel reports in My Campaign.'
  },

  // 2. REPORTS & ANALYTICS
  {
    key: 'lead_reports',
    label: 'Lead Reports',
    category: 'Reports & Analytics',
    path: '/reports/lead-reports',
    icon: 'ListFilter',
    description: 'Comprehensive lead reports with advanced filters and 18-col Excel exports.'
  },
  {
    key: 'telecaller_reports',
    label: "Telecaller's Reports",
    category: 'Reports & Analytics',
    path: '/reports/telecaller-reports',
    icon: 'PhoneCall',
    description: 'Daily agent performance, call connectivity, and conversion metrics.'
  },
  {
    key: 'telecaller_monthly',
    label: "Telecaller's Monthly",
    category: 'Reports & Analytics',
    path: '/reports/telecaller-monthly',
    icon: 'Calendar',
    description: 'Month-on-month telecaller conversion velocity and disposition analysis.'
  },

  // 3. FUNNEL
  {
    key: 'funnel_daily',
    label: 'Daily Funnel',
    category: 'Funnel',
    path: '/reports/funnel-daily',
    icon: 'CalendarRange',
    description: 'Monday through Sunday day-wise lead distribution and conversion breakdown.'
  },
  {
    key: 'funnel_monthly',
    label: 'Monthly Funnel',
    category: 'Funnel',
    path: '/reports/funnel-monthly',
    icon: 'CalendarDays',
    description: 'Monthly lead progression across all active pipeline stages.'
  },
  {
    key: 'funnel_annual',
    label: 'Annual Funnel',
    category: 'Funnel',
    path: '/reports/funnel-annual',
    icon: 'TrendingUp',
    description: 'Yearly business trajectory, pipeline volumes, and closed deal performance.'
  },

  // 4. ADMINISTRATION
  {
    key: 'settings',
    label: 'Settings',
    category: 'Administration',
    path: '/settings',
    icon: 'Settings',
    description: 'System configurations, branding, custom status stages, and module definitions.'
  },
  {
    key: 'access_privilege',
    label: 'Access Privilege',
    category: 'Administration',
    path: '/access-privilege',
    icon: 'ShieldCheck',
    description: 'Role-Based Access Control (RBAC) and navigation menu permissions.'
  },
  {
    key: 'lead_transfer',
    label: 'Lead Transfer',
    category: 'Administration',
    path: '/lead-transfer',
    icon: 'Send',
    description: 'Reassign leads and bulk transfers across telecallers and sales managers.'
  },
  {
    key: 'users_management',
    label: 'Users Management',
    category: 'Administration',
    path: '/users-management',
    icon: 'Users',
    description: 'Manage users, roles, departments, locations, and reporting hierarchies.'
  }
];

interface Role {
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

export default function AccessPrivilege() {
  const { modules } = useModuleStore();
  const { showToast, showAlertModal } = useToastStore();
  const { fetchProfile, setRole, role, user } = useAuthStore();

  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Working state for currently selected role
  const [allowedMenus, setAllowedMenus] = useState<string[]>([]);
  const [modulePermissions, setModulePermissions] = useState<ModulePermission[]>([]);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    try {
      setLoading(true);
      const res = await api.get('/auth/roles');
      const fetchedRoles: Role[] = res.data || [];
      setRoles(fetchedRoles);
      if (fetchedRoles.length > 0) {
        const currentUserRoleId = (typeof user?.roleId === 'object' ? (user?.roleId as any)?._id : user?.roleId) || role?._id;
        const initialRoleId = (selectedRoleId && fetchedRoles.some(r => r._id === selectedRoleId))
          ? selectedRoleId
          : (currentUserRoleId && fetchedRoles.some(r => r._id === currentUserRoleId))
            ? currentUserRoleId
            : fetchedRoles[0]._id;
        
        setSelectedRoleId(initialRoleId);
        loadRoleData(initialRoleId, fetchedRoles);
      }
    } catch (err) {
      console.error('Failed to load roles:', err);
      showToast('Failed to load roles list.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadRoleData = (roleId: string, rolesList: Role[] = roles) => {
    const r = rolesList.find((role) => role._id === roleId);
    if (r) {
      const roleName = (r.name || '').toLowerCase();
      const isSuperAdminOrAdmin = roleName.includes('super admin') || roleName.includes('admin');

      let rMenus: string[] = [];
      if (isSuperAdminOrAdmin) {
        // Super Admin & Admin default to full 100% menu access
        rMenus = fullMenuItems.map(m => m.key);
      } else if (Array.isArray(r.permissions?.menus) && r.permissions.menus.length > 0) {
        rMenus = r.permissions.menus;
      } else {
        // Default telecaller operational menus
        rMenus = [
          'dashboard', 'leads', 'campaigns', 'campaignassignments', 'export_campaigns',
          'telecaller_reports', 'telecaller_monthly',
          'funnel_daily', 'funnel_monthly', 'funnel_annual'
        ];
      }
      
      setAllowedMenus(rMenus);

      // Ensure all custom modules have an entry in modulePermissions
      const existingPerms = r.permissions?.modules || [];
      const mergedPerms: ModulePermission[] = [...existingPerms];

      // Add missing modules with defaults
      modules.forEach(mod => {
        if (!mergedPerms.some(p => p.moduleName.toLowerCase() === mod.name.toLowerCase())) {
          mergedPerms.push({
            moduleName: mod.name,
            create: true,
            read: 'all',
            update: 'all',
            delete: 'all'
          });
        }
      });

      setModulePermissions(mergedPerms);
    }
  };

  const handleRoleSelectChange = (roleId: string) => {
    setSelectedRoleId(roleId);
    loadRoleData(roleId);
  };

  // Combine SYSTEM_MENU_CONFIG with any active custom modules not covered in system config
  const fullMenuItems: MenuItemDefinition[] = useMemo(() => {
    const list = [...SYSTEM_MENU_CONFIG];

    modules.forEach(m => {
      const path = m.apiPath.toLowerCase();
      const isAlreadyInConfig = list.some(
        item => item.key === path || (item.moduleName && item.moduleName.toLowerCase() === m.name.toLowerCase())
      );

      if (!isAlreadyInConfig) {
        const hiddenModules = ['departments', 'products', 'bankmasters', 'bankingpartners'];
        if (!hiddenModules.includes(path)) {
          list.push({
            key: path,
            label: m.pluralLabel || m.name,
            category: 'Modules',
            path: `/modules/${m.apiPath}`,
            icon: m.icon || 'Folder',
            description: `Manage ${m.pluralLabel || m.name} records and database fields.`,
            isRecordModule: true,
            moduleName: m.name
          });
        }
      }
    });

    return list;
  }, [modules]);

  // Filtered menu items
  const filteredMenus = useMemo(() => {
    return fullMenuItems.filter(item => {
      const matchCategory = activeCategory === 'All' || item.category === activeCategory;
      const matchSearch = !searchQuery.trim() || 
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchCategory && matchSearch;
    });
  }, [fullMenuItems, activeCategory, searchQuery]);

  // Toggle single menu access
  const handleToggleMenu = (menuKey: string, allowed: boolean) => {
    if (allowed) {
      if (!allowedMenus.includes(menuKey)) {
        setAllowedMenus([...allowedMenus, menuKey]);
      }
    } else {
      setAllowedMenus(allowedMenus.filter(k => k !== menuKey));
    }
  };

  // Grant / Revoke all in current view or all menus
  const handleSetAllCurrentView = (allowed: boolean) => {
    const currentKeys = filteredMenus.map(m => m.key);
    if (allowed) {
      const newAllowed = Array.from(new Set([...allowedMenus, ...currentKeys]));
      setAllowedMenus(newAllowed);
    } else {
      setAllowedMenus(allowedMenus.filter(k => !currentKeys.includes(k)));
    }
  };

  const handleGrantAll = () => {
    setAllowedMenus(fullMenuItems.map(m => m.key));
    showToast('Granted access to all menus.', 'success');
  };

  const handleRevokeAll = () => {
    setAllowedMenus([]);
    showToast('Restricted all menus for this role.', 'info');
  };

  // Module CRUD handlers
  const handleModulePermissionChange = (moduleName: string, field: keyof ModulePermission, val: any) => {
    const updated = [...modulePermissions];
    const idx = updated.findIndex(p => p.moduleName.toLowerCase() === moduleName.toLowerCase());
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], [field]: val };
    } else {
      updated.push({
        moduleName,
        create: field === 'create' ? val : true,
        read: field === 'read' ? val : 'all',
        update: field === 'update' ? val : 'all',
        delete: field === 'delete' ? val : 'all'
      });
    }
    setModulePermissions(updated);
  };

  const getModulePerm = (moduleName: string): ModulePermission => {
    return (
      modulePermissions.find(p => p.moduleName.toLowerCase() === moduleName.toLowerCase()) || {
        moduleName,
        create: true,
        read: 'all',
        update: 'all',
        delete: 'all'
      }
    );
  };

  // Save changes to backend
  const handleSavePermissions = async () => {
    if (!selectedRoleId) return;
    try {
      setSaving(true);
      await api.put(`/auth/roles/${selectedRoleId}`, {
        permissions: {
          menus: allowedMenus,
          modules: modulePermissions
        }
      });

      showAlertModal({
        title: 'Saved Successfully',
        message: 'Access privileges and role permissions have been saved successfully.',
        type: 'success'
      });

      // Update local state list
      const updatedRoles = roles.map(r => {
        if (r._id === selectedRoleId) {
          return {
            ...r,
            permissions: {
              ...r.permissions,
              menus: allowedMenus,
              modules: modulePermissions
            }
          };
        }
        return r;
      });
      setRoles(updatedRoles);

      // Immediately sync current role permissions in auth store if editing active role
      if (role && (role._id === selectedRoleId || role.name?.toLowerCase() === selectedRole?.name?.toLowerCase())) {
        setRole({
          ...role,
          permissions: {
            ...role.permissions,
            menus: allowedMenus,
            modules: modulePermissions
          }
        });
      }

      // Refresh current user's profile and permissions from backend
      await fetchProfile();
    } catch (err) {
      console.error('Failed to save permissions:', err);
      showToast('Failed to update role permissions.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedRole = roles.find(r => r._id === selectedRoleId);
  const categories = ['All', 'Main Menu', 'Reports & Analytics', 'Funnel', 'Administration', 'Modules'];

  const allowedCount = fullMenuItems.filter(m => allowedMenus.includes(m.key)).length;
  const totalCount = fullMenuItems.length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-left pb-16 font-['Plus_Jakarta_Sans',sans-serif] px-4 md:px-8 py-4">
      {/* Page Header with Subtle Accent */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500/80 via-purple-500/70 to-blue-500/60" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 flex-shrink-0">
            <Icons.ShieldCheck className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider font-mono px-2.5 py-0.5 rounded-full border bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60">
                Security & RBAC
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Role Permissions
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              Access Privilege
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchRoles}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-3xs transition-all cursor-pointer"
          >
            <Icons.RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            onClick={handleSavePermissions}
            disabled={saving || loading}
            className="flex items-center gap-2 px-6 h-10 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 hover:opacity-95 text-white rounded-xl text-xs font-black shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <Icons.Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Icons.Check className="w-4 h-4" />
            )}
            Save Permissions
          </button>
        </div>
      </div>


      {/* Role Selection & Statistics Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500/60 to-purple-500/60" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          {/* Role Dropdown */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Select Role to Edit Privileges
            </label>
            {loading ? (
              <div className="h-11 w-full bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ) : (
              <div className="relative">
                <select
                  value={selectedRoleId}
                  onChange={(e) => handleRoleSelectChange(e.target.value)}
                  className="w-full h-11 px-4 text-xs font-black uppercase text-slate-900 dark:text-white bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 cursor-pointer shadow-3xs appearance-none"
                >
                  {roles.map((r) => {
                    const currentUserRoleId = (typeof user?.roleId === 'object' ? (user?.roleId as any)?._id : user?.roleId) || role?._id;
                    const isMyRole = r._id === currentUserRoleId || r.name?.toLowerCase() === role?.name?.toLowerCase();
                    return (
                      <option key={r._id} value={r._id} className="py-2">
                        {r.name.toUpperCase()} {isMyRole ? '👤 (YOUR ACTIVE ROLE)' : r.isSystem ? '★ (SYSTEM ROLE)' : ''}
                      </option>
                    );
                  })}
                </select>
                <Icons.ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Role Status Summary */}
          <div className="space-y-1.5 bg-slate-50/80 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
                Menu Access Ratio
              </span>
              <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 font-mono">
                {allowedCount} / {totalCount} Active
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${(allowedCount / totalCount) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold block truncate">
              {selectedRole?.description || 'Custom access privilege role'}
            </span>
          </div>

          {/* Quick Batch Actions */}
          <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
            <button
              onClick={handleGrantAll}
              type="button"
              className="px-3.5 h-9 bg-indigo-50/80 hover:bg-indigo-100/80 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-3xs"
            >
              <Icons.Check className="w-3.5 h-3.5" />
              Allow All Menus
            </button>
            <button
              onClick={handleRevokeAll}
              type="button"
              className="px-3.5 h-9 bg-rose-50/80 hover:bg-rose-100/80 text-rose-700 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-3xs"
            >
              <Icons.Lock className="w-3.5 h-3.5" />
              Restrict All
            </button>
          </div>
        </div>

        {/* Search & Category Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          {/* Category Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {categories.map((cat) => {
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-3xs font-extrabold'
                      : 'bg-slate-100/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Icons.Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search menu or module..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-3 text-xs bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-800 dark:text-white font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Permissions Table / Matrix */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/80 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 h-12">
                <th className="py-3 px-5 w-72">Menu / Module Name</th>
                <th className="py-3 px-4 text-center w-36">Menu Access</th>
                <th className="py-3 px-4 text-center w-40">Read Permission</th>
                <th className="py-3 px-4 text-center w-32">Create Record</th>
                <th className="py-3 px-4 text-center w-40">Update Permission</th>
                <th className="py-3 px-4 text-center w-28">Route Path</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {filteredMenus.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 font-medium">
                    No menus found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredMenus.map((item) => {
                  const isAllowed = allowedMenus.includes(item.key);
                  const IconComp = (Icons as any)[item.icon] || Icons.Circle;
                  const modPerm = item.moduleName ? getModulePerm(item.moduleName) : null;

                  return (
                    <tr
                      key={item.key}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors h-16 ${
                        !isAllowed ? 'opacity-65 bg-slate-50/40 dark:bg-slate-950/20' : ''
                      }`}
                    >
                      {/* 1. Menu Name & Info */}
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-2 rounded-xl border transition-all ${
                              isAllowed
                                ? 'bg-indigo-50 text-indigo-600 border-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-400 dark:border-indigo-900/50'
                                : 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-500'
                            }`}
                          >
                            <IconComp className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-slate-900 dark:text-white uppercase tracking-tight text-xs">
                                {item.label}
                              </span>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase">
                                {item.category}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 max-w-sm">
                              {item.description}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* 2. Menu Access Toggle */}
                      <td className="py-3 px-4 text-center">
                        {selectedRole?.name?.toLowerCase().includes('super admin') && (item.key === 'access_privilege' || item.key === 'accessprivilege') ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-black bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 rounded-full border border-indigo-200 dark:border-indigo-800 select-none">
                            <Icons.Lock className="w-3 h-3" />
                            LOCKED (SUPER ADMIN)
                          </span>
                        ) : (
                          <label className="relative inline-flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isAllowed}
                              onChange={(e) => handleToggleMenu(item.key, e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600 relative"></div>
                            <span
                              className={`text-[10px] font-black uppercase ${
                                isAllowed
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {isAllowed ? 'Allowed' : 'Restricted'}
                            </span>
                          </label>
                        )}
                      </td>

                      {/* Granular CRUD Columns for Record Modules OR Spanning Scope Badge for Functional Pages */}
                      {item.isRecordModule && modPerm ? (
                        <>
                          {/* 3. Read Permission */}
                          <td className="py-3 px-4 text-center">
                            <select
                              disabled={!isAllowed}
                              value={modPerm.read}
                              onChange={(e) =>
                                handleModulePermissionChange(
                                  item.moduleName!,
                                  'read',
                                  e.target.value as any
                                )
                              }
                              className="h-8.5 px-2.5 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-[#EAE4DA] dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-white cursor-pointer disabled:opacity-40"
                            >
                              <option value="all">All Records</option>
                              <option value="own">Own Records Only</option>
                              <option value="none">No Access</option>
                            </select>
                          </td>

                          {/* 4. Create Permission */}
                          <td className="py-3 px-4 text-center">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                disabled={!isAllowed}
                                checked={modPerm.create}
                                onChange={(e) =>
                                  handleModulePermissionChange(
                                    item.moduleName!,
                                    'create',
                                    e.target.checked
                                  )
                                }
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-0 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer disabled:opacity-40"
                              />
                              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                Create
                              </span>
                            </label>
                          </td>

                          {/* 5. Update Permission */}
                          <td className="py-3 px-4 text-center">
                            <select
                              disabled={!isAllowed}
                              value={modPerm.update}
                              onChange={(e) =>
                                handleModulePermissionChange(
                                  item.moduleName!,
                                  'update',
                                  e.target.value as any
                                )
                              }
                              className="h-8.5 px-2.5 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-[#EAE4DA] dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-white cursor-pointer disabled:opacity-40"
                            >
                              <option value="all">All Records</option>
                              <option value="own">Own Records Only</option>
                              <option value="none">No Access</option>
                            </select>
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="py-3 px-4 text-center">
                          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 shadow-2xs">
                            <Icons.CheckCircle2 className={`w-3.5 h-3.5 ${isAllowed ? 'text-emerald-500' : 'text-slate-400'}`} />
                            <span className="text-[10.5px] font-bold uppercase tracking-wide">
                              {isAllowed
                                ? (item.category === 'Reports & Analytics' || item.category === 'Funnel'
                                    ? 'Full Analytics & Report View'
                                    : 'Full Page & Feature Access')
                                : 'Access Restricted'}
                            </span>
                            <span className="text-[9px] font-extrabold text-slate-400 px-1.5 py-0.5 bg-white dark:bg-slate-900 rounded border border-slate-200/80 dark:border-slate-700 uppercase">
                              Page Level
                            </span>
                          </div>
                        </td>
                      )}

                      {/* 6. Route Path */}
                      <td className="py-3 px-4 text-center">
                        <code className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 bg-[#F8F5F1] dark:bg-slate-800 px-2 py-1 rounded border border-[#EAE4DA] dark:border-slate-700">
                          {item.path}
                        </code>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Save Bar */}
        <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-[#EAE4DA] dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Icons.Info className="w-4 h-4 text-indigo-500" />
            <span>
              Privileges are enforced live across the sidebar and direct page routes.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSavePermissions}
              disabled={saving || loading}
              className="flex items-center gap-2 px-8 h-11 bg-[#17223B] hover:bg-[#1E2E4F] dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Icons.Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icons.Check className="w-4 h-4" />
              )}
              Save Permissions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
