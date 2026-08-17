import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import * as Icons from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { TableHorizontalScrollWrapper } from '../components/TableHorizontalScrollWrapper';

export default function UsersManagement() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { showToast } = useToastStore();

  const [users, setUsers] = useState<any[]>([]);
  const [allManagers, setAllManagers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search and Filter state
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');

  // Add / Edit Modal state
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userEditing, setUserEditing] = useState(false);
  const [userForm, setUserForm] = useState({
    id: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    roleId: '',
    department: '',
    skipFace: false,
    skipLocation: false,
    isActive: true
  });
  const [showPassword, setShowPassword] = useState(false);

  // Quick Password Reset Modal
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  // Manager Assignment Modal state
  const [managerModalOpen, setManagerModalOpen] = useState(false);
  const [selectedUserForManager, setSelectedUserForManager] = useState<any>(null);

  // Location Detail Modal state
  const [selectedUserForLocation, setSelectedUserForLocation] = useState<any>(null);

  // Safe Delete User Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedUserForDelete, setSelectedUserForDelete] = useState<any>(null);
  const [assignedLeadCount, setAssignedLeadCount] = useState<number>(0);
  const [checkingLeadCount, setCheckingLeadCount] = useState<boolean>(false);
  const [targetAgentId, setTargetAgentId] = useState<string>('');
  const [transferringLeads, setTransferringLeads] = useState<boolean>(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>('');
  const [deletingUser, setDeletingUser] = useState<boolean>(false);

  // Copied code feedback
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const formatDate = (dateInput: any) => {
    if (!dateInput) return 'N/A';
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return 'N/A';
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch {
      return 'N/A';
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);

      const [resUsers, resDropdownUsers, resRoles, resDepts] = await Promise.all([
        api.get('/auth/users').catch(() => ({ data: [] })),
        api.get('/auth/users?purpose=dropdown').catch(() => ({ data: [] })),
        api.get('/auth/roles').catch(() => ({ data: [] })),
        api.get('/records/departments').catch(() => ({ data: [] }))
      ]);

      setUsers(resUsers.data || []);
      setAllManagers(resDropdownUsers.data || []);
      setRoles(resRoles.data || []);
      setDepartments(resDepts.data?.records || resDepts.data || []);

      if (isManualRefresh) {
        showToast('Team roster refreshed successfully.', 'success');
      }
    } catch (err) {
      console.error('Failed to load users management data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleCopyCode = (code: string) => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    showToast(`Copied ID: ${code}`, 'success');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleApproveUser = async (userId: string, approve: boolean) => {
    try {
      await api.put(`/auth/users/${userId}`, {
        isApproved: approve,
        approvalStatus: approve ? 'approved' : 'rejected',
        isActive: approve
      });
      showToast(approve ? 'User approved! User can now log in.' : 'User registration rejected.', approve ? 'success' : 'warning');
      loadData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update user approval status.', 'error');
    }
  };

  const handleToggleUserSetting = async (userId: string, field: 'skipFace' | 'skipLocation' | 'isActive', currentValue: boolean) => {
    try {
      await api.put(`/auth/users/${userId}`, { [field]: !currentValue });
      showToast(`User ${field} setting updated.`, 'success');
      loadData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update user setting.', 'error');
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (userEditing) {
        const payload: any = {
          email: userForm.email,
          firstName: userForm.firstName,
          lastName: userForm.lastName,
          roleId: userForm.roleId,
          department: userForm.department,
          skipFace: userForm.skipFace,
          skipLocation: userForm.skipLocation,
          isActive: userForm.isActive
        };
        if (userForm.password && userForm.password.trim()) payload.password = userForm.password;
        await api.put(`/auth/users/${userForm.id}`, payload);
        showToast('User details updated successfully.', 'success');
      } else {
        await api.post('/auth/register', userForm);
        showToast('New user account created successfully.', 'success');
      }
      setUserModalOpen(false);
      loadData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save user.', 'error');
    }
  };

  const handleEditUser = (u: any) => {
    setUserForm({
      id: u._id,
      email: u.email,
      password: u.plainPassword || '',
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      roleId: u.roleId?._id || u.roleId || '',
      department: u.department || '',
      skipFace: !!u.skipFace,
      skipLocation: !!u.skipLocation,
      isActive: u.isActive !== false
    });
    setUserEditing(true);
    setUserModalOpen(true);
  };

  const handleOpenPasswordModal = (u: any) => {
    setSelectedUserForPassword(u);
    setNewPassword('');
    setShowNewPassword(false);
    setPasswordModalOpen(true);
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForPassword || !newPassword.trim()) return;
    if (newPassword.length < 8) {
      showToast('Password must be at least 8 characters long.', 'warning');
      return;
    }

    setResettingPassword(true);
    try {
      await api.put(`/auth/users/${selectedUserForPassword._id}`, {
        password: newPassword
      });
      showToast(`Password successfully updated for ${selectedUserForPassword.firstName || selectedUserForPassword.email}.`, 'success');
      setPasswordModalOpen(false);
      setSelectedUserForPassword(null);
      setNewPassword('');
      loadData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to reset password.', 'error');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleOpenDeleteModal = async (u: any) => {
    setSelectedUserForDelete(u);
    setTargetAgentId('');
    setDeleteConfirmText('');
    setDeleteModalOpen(true);
    setCheckingLeadCount(true);
    try {
      const res = await api.get(`/auth/users/${u._id}/assigned-leads-count`).catch(() => ({ data: { count: 0 } }));
      const count = res.data?.count ?? res.data?.assignedCount ?? 0;
      setAssignedLeadCount(count);
    } catch {
      setAssignedLeadCount(0);
    } finally {
      setCheckingLeadCount(false);
    }
  };

  const handleTransferLeadsBeforeDelete = async () => {
    if (!selectedUserForDelete || !targetAgentId) {
      showToast('Please select a target agent to receive the leads.', 'warning');
      return;
    }
    setTransferringLeads(true);
    try {
      const res = await api.post('/records/leads/transfer', {
        fromUserId: selectedUserForDelete._id,
        toUserId: targetAgentId
      });
      showToast(`Successfully transferred ${res.data?.transferredCount || assignedLeadCount} leads!`, 'success');
      setAssignedLeadCount(0);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to transfer leads. Please try again.', 'error');
    } finally {
      setTransferringLeads(false);
    }
  };

  const handleExecuteUserDelete = async () => {
    if (!selectedUserForDelete) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      showToast('Please type DELETE to confirm.', 'warning');
      return;
    }
    setDeletingUser(true);
    try {
      await api.delete(`/auth/users/${selectedUserForDelete._id}`);
      showToast(`User '${selectedUserForDelete.firstName} ${selectedUserForDelete.lastName}' removed successfully.`, 'success');
      setDeleteModalOpen(false);
      setSelectedUserForDelete(null);
      loadData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete user.', 'error');
    } finally {
      setDeletingUser(false);
    }
  };

  const handleAssignManager = async (managerId: string) => {
    if (!selectedUserForManager) return;
    try {
      await api.put(`/auth/users/${selectedUserForManager._id}`, {
        reportingManager: managerId
      });
      showToast('Reporting manager assigned successfully.', 'success');
      setManagerModalOpen(false);
      setSelectedUserForManager(null);
      loadData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to assign manager.', 'error');
    }
  };

  const exportUsersToCSV = () => {
    if (filteredUsers.length === 0) {
      showToast('No users to export.', 'warning');
      return;
    }

    const headers = ['User Code', 'First Name', 'Last Name', 'Email', 'Role', 'Department', 'Status', 'Face MFA', 'Location Geofence', 'Joined Date'];
    const rows = filteredUsers.map(u => [
      `"${u.userCode || ''}"`,
      `"${u.firstName || ''}"`,
      `"${u.lastName || ''}"`,
      `"${u.email || ''}"`,
      `"${roles.find(r => r._id === (u.roleId?._id || u.roleId))?.name || 'User'}"`,
      `"${u.department || ''}"`,
      `"${u.approvalStatus === 'pending' || u.isApproved === false ? 'Pending Approval' : u.isActive ? 'Active' : 'Disabled'}"`,
      `"${u.skipFace ? 'Skipped' : 'Enforced'}"`,
      `"${u.skipLocation ? 'Skipped' : 'Enforced'}"`,
      `"${u.createdAt ? new Date(u.createdAt).toISOString().split('T')[0] : ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `inkcrm_users_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${filteredUsers.length} user records to CSV.`, 'success');
  };

  // Summary Metrics calculations
  const totalUsersCount = users.length;
  const pendingUsersCount = users.filter(u => u.approvalStatus === 'pending' || u.isApproved === false).length;
  const activeUsersCount = users.filter(u => u.isActive !== false && u.isApproved !== false && u.approvalStatus !== 'pending').length;
  const biometricEnrolledCount = users.filter(u => u.faceRecognition?.enabled || !u.skipFace).length;
  const geofencedCount = users.filter(u => !u.skipLocation && !u.locationVerificationSkipped).length;

  // Filtered Users computation
  const filteredUsers = users.filter(u => {
    // Status filter
    if (statusFilter === 'pending' && !(u.approvalStatus === 'pending' || u.isApproved === false)) return false;
    if (statusFilter === 'active' && !(u.isActive !== false && u.isApproved !== false && u.approvalStatus !== 'pending')) return false;
    if (statusFilter === 'inactive' && (u.isActive !== false || u.approvalStatus === 'pending')) return false;

    // Role filter
    if (roleFilter !== 'all') {
      const uRoleId = u.roleId?._id || u.roleId;
      if (uRoleId !== roleFilter) return false;
    }

    // Department filter
    if (deptFilter !== 'all') {
      if ((u.department || '').toLowerCase() !== deptFilter.toLowerCase()) return false;
    }

    // Search query
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.toLowerCase().trim();
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const email = (u.email || '').toLowerCase();
      const userCode = (u.userCode || '').toLowerCase();
      const roleName = (roles.find(r => r._id === (u.roleId?._id || u.roleId))?.name || '').toLowerCase();
      const deptName = (u.department || '').toLowerCase();
      const address = (u.registeredLocation?.address || u.currentLocation?.address || '').toLowerCase();
      return fullName.includes(q) || email.includes(q) || userCode.includes(q) || roleName.includes(q) || deptName.includes(q) || address.includes(q);
    }
    return true;
  });

  const getRoleBadgeStyle = (roleName: string) => {
    const r = (roleName || '').toLowerCase();
    if (r.includes('super admin') || r.includes('admin')) {
      return 'bg-indigo-50 text-indigo-700 border-indigo-200/80 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/60';
    }
    if (r.includes('sales') || r.includes('manager')) {
      return 'bg-amber-50 text-amber-800 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60';
    }
    if (r.includes('teli') || r.includes('caller') || r.includes('agent')) {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60';
    }
    return 'bg-slate-100 text-slate-700 border-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  };

  const getInitials = (first?: string, last?: string, email?: string) => {
    if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
    if (first) return first.slice(0, 2).toUpperCase();
    if (email) return email.slice(0, 2).toUpperCase();
    return 'US';
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-8 animate-pulse text-left">
        <div className="h-20 bg-slate-100 dark:bg-slate-800 rounded-2xl"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800 rounded-2xl"></div>
          ))}
        </div>
        <div className="h-96 bg-slate-100 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-left pb-16 font-['Plus_Jakarta_Sans',sans-serif] px-4 md:px-8 py-4">
      
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 via-indigo-500 to-blue-600" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 flex-shrink-0">
            <Icons.Users className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider font-mono px-2.5 py-0.5 rounded-full border bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/60">
                Team & Personnel Directory
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Enterprise Access
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase flex items-center gap-3">
              Users Management
              {pendingUsersCount > 0 && (
                <button
                  onClick={() => setStatusFilter('pending')}
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 animate-pulse hover:scale-105 transition-transform cursor-pointer"
                >
                  {pendingUsersCount} Pending Approval
                </button>
              )}
            </h1>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3.5 h-10 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
            title="Refresh Directory"
          >
            <Icons.RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            type="button"
            onClick={exportUsersToCSV}
            className="flex items-center gap-1.5 px-3.5 h-10 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
            title="Export Roster to CSV"
          >
            <Icons.Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setUserEditing(false);
              setUserForm({
                id: '',
                email: '',
                password: '',
                firstName: '',
                lastName: '',
                roleId: '',
                department: '',
                skipFace: false,
                skipLocation: false,
                isActive: true
              });
              setUserModalOpen(true);
            }}
            className="flex items-center gap-2 px-5 h-10 bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 hover:opacity-95 text-white rounded-xl text-xs font-black shadow-md shadow-sky-500/20 transition-all cursor-pointer flex-shrink-0 active:scale-95"
          >
            <Icons.UserPlus className="w-4 h-4" /> Add New User
          </button>
        </div>
      </div>

      {/* KPI Metrics Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Total Staff */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Total Staff</span>
            <Icons.Users className="w-4 h-4 text-sky-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {totalUsersCount}
          </div>
          <div className="text-[10px] font-semibold text-slate-400 mt-0.5">
            Registered Profiles
          </div>
        </div>

        {/* Active Team */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Active Team</span>
            <Icons.CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {activeUsersCount}
          </div>
          <div className="text-[10px] font-semibold text-slate-400 mt-0.5">
            Enabled & Verified
          </div>
        </div>

        {/* Pending Approvals */}
        <div 
          onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
          className={`border p-4 rounded-2xl shadow-xs cursor-pointer transition-all ${
            pendingUsersCount > 0 
              ? 'bg-amber-50/70 border-amber-300 dark:bg-amber-950/40 dark:border-amber-800 hover:shadow-md' 
              : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Pending Action</span>
            <Icons.Clock className={`w-4 h-4 ${pendingUsersCount > 0 ? 'animate-bounce' : ''}`} />
          </div>
          <div className={`text-2xl font-black mt-1 ${pendingUsersCount > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white'}`}>
            {pendingUsersCount}
          </div>
          <div className="text-[10px] font-semibold text-amber-800/80 dark:text-amber-400/80 mt-0.5">
            {pendingUsersCount > 0 ? 'Requires Admin Review' : 'All Clear'}
          </div>
        </div>

        {/* Biometrics Enrolled */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 rounded-2xl shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">Face Biometric</span>
            <Icons.ShieldCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
            {biometricEnrolledCount}
          </div>
          <div className="text-[10px] font-semibold text-slate-400 mt-0.5">
            MFA Enforced / Active
          </div>
        </div>

        {/* Geofence Verified */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 rounded-2xl shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-black uppercase tracking-wider">GPS Geofence</span>
            <Icons.MapPin className="w-4 h-4 text-sky-500" />
          </div>
          <div className="text-2xl font-black text-sky-600 dark:text-sky-400 mt-1">
            {geofencedCount}
          </div>
          <div className="text-[10px] font-semibold text-slate-400 mt-0.5">
            Location Verified
          </div>
        </div>
      </div>

      {/* Advanced Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-3 sm:p-4 rounded-2xl shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        
        {/* Status Filter Tabs */}
        <div className="flex items-center bg-slate-100/80 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/60 overflow-x-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              statusFilter === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-3xs font-extrabold'
                : 'text-slate-500 hover:text-slate-850 dark:hover:text-slate-200'
            }`}
          >
            All Users <span className="px-1.5 py-0.2 bg-slate-200/70 dark:bg-slate-700 rounded-full text-[10px] font-mono">{totalUsersCount}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              statusFilter === 'pending'
                ? 'bg-amber-500 text-white shadow-3xs font-extrabold'
                : 'text-slate-500 hover:text-amber-600'
            }`}
          >
            <Icons.Clock className="w-3.5 h-3.5" /> Pending
            {pendingUsersCount > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${statusFilter === 'pending' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-800 font-extrabold'}`}>
                {pendingUsersCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              statusFilter === 'active'
                ? 'bg-emerald-600 text-white shadow-3xs font-extrabold'
                : 'text-slate-500 hover:text-emerald-600'
            }`}
          >
            <Icons.CheckCircle className="w-3.5 h-3.5" /> Active
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${statusFilter === 'active' ? 'bg-white/30 text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
              {activeUsersCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('inactive')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              statusFilter === 'inactive'
                ? 'bg-rose-600 text-white shadow-3xs font-extrabold'
                : 'text-slate-500 hover:text-rose-600'
            }`}
          >
            <Icons.UserX className="w-3.5 h-3.5" /> Disabled
          </button>
        </div>

        {/* Dropdown Filters & Search */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value="all">All Roles</option>
            {roles.map(r => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>

          {/* Department Filter */}
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="h-9 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value="all">All Depts</option>
            {departments.map(d => {
              const name = d.data?.name || d.name || '';
              return <option key={d._id} value={name}>{name}</option>;
            })}
          </select>

          {/* Search input */}
          <div className="relative flex-1 min-w-[200px]">
            <Icons.Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search name, code, email, role..."
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-8 text-xs bg-slate-50/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-sky-500 text-slate-800 dark:text-white font-medium placeholder:text-slate-400 transition-all"
            />
            {userSearchQuery && (
              <button
                onClick={() => setUserSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500/80 via-blue-500/70 to-indigo-500/60" />
        
        <TableHorizontalScrollWrapper>
          <table className="w-full min-w-[1280px] text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur-md text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 h-12 sticky top-0 z-10">
                <th className="py-2.5 px-4">EMPLOYEE</th>
                <th className="py-2.5 px-3">EMPLOYEE ID</th>
                <th className="py-2.5 px-4">LOCATION & GEOFENCE</th>
                <th className="py-2.5 px-3 text-center">SKIP FACE</th>
                <th className="py-2.5 px-3 text-center">SKIP LOCATION</th>
                <th className="py-2.5 px-4 text-center min-w-[150px]">ACCOUNT STATUS</th>
                <th className="py-2.5 px-4">ROLE</th>
                <th className="py-2.5 px-4">DEPARTMENT</th>
                <th className="py-2.5 px-4">REPORTING MANAGER</th>
                <th className="py-2.5 px-4 text-center w-36">ACTIONS</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Icons.UserX className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-sm font-bold text-slate-600 dark:text-slate-300">No personnel found</p>
                    <p className="text-xs text-slate-400 mt-0.5">Try adjusting your search or active filters.</p>
                  </td>
                </tr>
              ) : (
                filteredUsers.map(u => {
                  const roleName = roles.find(r => r._id === (u.roleId?._id || u.roleId))?.name || 'Staff';
                  const initials = getInitials(u.firstName, u.lastName, u.email);
                  const isPending = u.approvalStatus === 'pending' || u.isApproved === false;
                  const isRejected = u.approvalStatus === 'rejected';
                  const isEnabled = u.isActive !== false && !isPending && !isRejected;

                  return (
                    <tr key={u._id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors h-16">
                      
                      {/* Employee Profile */}
                      <td className="px-4 py-2 font-semibold">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-sky-500/10 to-indigo-500/20 border border-sky-200/80 dark:border-indigo-800/60 flex items-center justify-center font-black text-sky-700 dark:text-sky-300 text-xs select-none shadow-xs">
                              {initials}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                              isPending ? 'bg-amber-400' : isEnabled ? 'bg-emerald-500' : 'bg-rose-500'
                            }`} />
                          </div>
                          <div className="text-left min-w-0">
                            <div className="font-bold text-slate-900 dark:text-white text-sm leading-tight truncate">
                              {u.firstName || ''} {u.lastName || ''}
                            </div>
                            <div className="text-xs text-slate-400 dark:text-slate-400 font-medium truncate mt-0.5">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Monospace User ID / Code */}
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleCopyCode(u.userCode || u._id)}
                          className="group inline-flex items-center gap-1.5 font-mono text-xs font-bold bg-slate-50 dark:bg-slate-800/90 hover:bg-sky-50 dark:hover:bg-sky-950/40 border border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-700 px-2.5 py-1 rounded-xl text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
                          title="Click to copy employee code"
                        >
                          <span>{u.userCode || 'N/A'}</span>
                          {copiedCode === (u.userCode || u._id) ? (
                            <Icons.Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Icons.Copy className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </button>
                      </td>

                      {/* Location & Geofencing */}
                      <td className="px-4 py-2 text-left cursor-pointer group" onClick={() => setSelectedUserForLocation(u)}>
                        {(() => {
                          const isSkipped = !!(u.skipLocation || u.locationVerificationSkipped);
                          const regLoc = u.registeredLocation || u.registrationLocation;
                          const curLoc = u.currentLocation;

                          if (isSkipped) {
                            const addressText = curLoc?.address || (curLoc?.latitude ? `${curLoc.latitude.toFixed(4)}°, ${curLoc.longitude.toFixed(4)}°` : 'Location Not Available');
                            return (
                              <div className="flex flex-col gap-0.5 max-w-[200px]">
                                <div className="flex items-center gap-1">
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 flex items-center gap-1">
                                    <Icons.MapPin className="w-2.5 h-2.5" /> Remote / Current
                                  </span>
                                </div>
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-indigo-600 transition-colors" title={addressText}>
                                  {addressText}
                                </span>
                              </div>
                            );
                          } else {
                            const addressText = regLoc?.address || (regLoc?.latitude ? `${regLoc.latitude.toFixed(4)}°, ${regLoc.longitude.toFixed(4)}°` : 'Location Not Available');
                            return (
                              <div className="flex flex-col gap-0.5 max-w-[200px]">
                                <div className="flex items-center gap-1">
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                                    <Icons.Lock className="w-2.5 h-2.5" /> Registered Geofence
                                  </span>
                                </div>
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-indigo-600 transition-colors" title={addressText}>
                                  {addressText}
                                </span>
                              </div>
                            );
                          }
                        })()}
                      </td>

                      {/* Skip Face Toggle */}
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleUserSetting(u._id, 'skipFace', u.skipFace || false)}
                          className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            u.skipFace ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
                          }`}
                          title={`Click to ${u.skipFace ? 'enforce' : 'skip'} face biometric`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              u.skipFace ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </td>

                      {/* Skip Location Toggle */}
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleUserSetting(u._id, 'skipLocation', u.skipLocation || false)}
                          className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            u.skipLocation ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
                          }`}
                          title={`Click to ${u.skipLocation ? 'enforce' : 'skip'} GPS geofencing`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              u.skipLocation ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </td>

                      {/* Account Status & 1-Click Approvals */}
                      <td className="px-4 py-2 text-center">
                        {isPending ? (
                          <div className="flex flex-col items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800 flex items-center gap-1 animate-pulse">
                              <Icons.Clock className="w-2.5 h-2.5" /> PENDING APPROVAL
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <button
                                type="button"
                                onClick={() => handleApproveUser(u._id, true)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] shadow-xs flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                                title="Approve User for Login"
                              >
                                <Icons.Check className="w-3 h-3" /> Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApproveUser(u._id, false)}
                                className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800 font-bold text-[10px] flex items-center transition-all cursor-pointer active:scale-95"
                                title="Reject Registration"
                              >
                                <Icons.X className="w-3 h-3" /> Reject
                              </button>
                            </div>
                          </div>
                        ) : isRejected ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 flex items-center gap-1">
                              <Icons.XCircle className="w-2.5 h-2.5" /> REJECTED
                            </span>
                            <button
                              type="button"
                              onClick={() => handleApproveUser(u._id, true)}
                              className="px-2.5 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[9px] shadow-xs flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Icons.Check className="w-2.5 h-2.5" /> Re-Approve
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleToggleUserSetting(u._id, 'isActive', u.isActive !== false)}
                              className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                u.isActive !== false ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  u.isActive !== false ? 'translate-x-5' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <span className={`text-[8px] font-black uppercase tracking-wider ${u.isActive !== false ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
                              {u.isActive !== false ? 'ACTIVE' : 'DISABLED'}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Role Pill */}
                      <td className="px-4 py-2 font-medium">
                        <span className={`px-2.5 py-1 rounded-xl text-[10px] font-extrabold border uppercase tracking-wider ${getRoleBadgeStyle(roleName)}`}>
                          {roleName}
                        </span>
                      </td>

                      {/* Department */}
                      <td className="px-4 py-2 font-medium text-slate-700 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300">
                          <Icons.Briefcase className="w-3 h-3 text-slate-400" />
                          {u.department || 'Operations'}
                        </span>
                      </td>

                      {/* Reporting Manager */}
                      <td className="px-4 py-2 cursor-pointer" onClick={() => {
                        setSelectedUserForManager(u);
                        setManagerModalOpen(true);
                      }}>
                        <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl transition-all w-max group">
                          <Icons.UserCheck className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 transition-colors">
                            {u.reportingManager ? `${u.reportingManager.firstName} ${u.reportingManager.lastName}` : 'Assign Manager'}
                          </span>
                        </div>
                      </td>

                      {/* Action Buttons */}
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Location Audit */}
                          <button
                            type="button"
                            onClick={() => setSelectedUserForLocation(u)}
                            className="p-1.5 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-950/50 text-slate-400 hover:text-sky-600 transition-colors cursor-pointer"
                            title="View GPS Location Audit"
                          >
                            <Icons.MapPin className="w-3.5 h-3.5" />
                          </button>

                          {/* Password Reset */}
                          <button
                            type="button"
                            onClick={() => handleOpenPasswordModal(u)}
                            className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/50 text-slate-400 hover:text-amber-600 transition-colors cursor-pointer"
                            title="Reset User Password"
                          >
                            <Icons.Key className="w-3.5 h-3.5" />
                          </button>

                          {/* Edit User */}
                          <button
                            type="button"
                            onClick={() => handleEditUser(u)}
                            className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                            title="Edit User Details"
                          >
                            <Icons.Pencil className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete User */}
                          <button
                            type="button"
                            onClick={() => handleOpenDeleteModal(u)}
                            className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                            title="Remove User"
                          >
                            <Icons.Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableHorizontalScrollWrapper>
      </div>

      {/* ─── MODAL 1: ADD / EDIT USER MODAL ────────────────────────────────────── */}
      {userModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-7 w-full max-w-lg border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Icons.UserCog className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {userEditing ? 'Edit User Profile' : 'Create New User Account'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">
                    {userEditing ? 'Update access privileges and credentials' : 'Add team member to workspace'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4 text-left">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">First Name *</label>
                  <input
                    required
                    type="text"
                    value={userForm.firstName}
                    onChange={e => setUserForm({ ...userForm, firstName: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                    placeholder="First Name"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Last Name *</label>
                  <input
                    required
                    type="text"
                    value={userForm.lastName}
                    onChange={e => setUserForm({ ...userForm, lastName: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                    placeholder="Last Name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Email Address *</label>
                <input
                  required
                  type="email"
                  value={userForm.email}
                  onChange={e => setUserForm({ ...userForm, email: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  placeholder="employee@inkcrm.com"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                  {userEditing ? 'Change Password (leave empty to keep current)' : 'Password *'}
                </label>
                <div className="relative">
                  <input
                    required={!userEditing}
                    type={showPassword ? 'text' : 'password'}
                    value={userForm.password}
                    onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                    className="w-full pl-3.5 pr-10 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                    placeholder={userEditing ? 'Enter new password...' : 'Minimum 8 characters'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Role Type *</label>
                  <select
                    required
                    value={userForm.roleId}
                    onChange={e => setUserForm({ ...userForm, roleId: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="">Select Role</option>
                    {roles.map(r => (
                      <option key={r._id} value={r._id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Department</label>
                  <select
                    value={userForm.department}
                    onChange={e => setUserForm({ ...userForm, department: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="">Select Department</option>
                    {departments.map(d => {
                      const deptName = d.data?.name || d.name || '';
                      return <option key={d._id} value={deptName}>{deptName}</option>;
                    })}
                  </select>
                </div>
              </div>

              {/* Security & Access Controls */}
              <div className="border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 bg-slate-50/50 dark:bg-slate-800/40 space-y-3">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Access Permissions & Controls</span>
                
                {/* Active Account Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-white">Active Account</div>
                    <div className="text-[10px] text-slate-400">User is permitted to authenticate into the system</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUserForm({ ...userForm, isActive: !userForm.isActive })}
                    className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      userForm.isActive ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        userForm.isActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Skip Face Toggle */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-white">Skip Face Biometric</div>
                    <div className="text-[10px] text-slate-400">Allow login without webcam facial verification</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUserForm({ ...userForm, skipFace: !userForm.skipFace })}
                    className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      userForm.skipFace ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        userForm.skipFace ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Skip Location Toggle */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-white">Skip Location Verification</div>
                    <div className="text-[10px] text-slate-400">Allow remote login outside registered geofence</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUserForm({ ...userForm, skipLocation: !userForm.skipLocation })}
                    className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      userForm.skipLocation ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        userForm.skipLocation ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md shadow-indigo-600/20 transition-all cursor-pointer active:scale-95 uppercase tracking-wider"
                >
                  {userEditing ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: PASSWORD RESET MODAL ─────────────────────────────────────── */}
      {passwordModalOpen && selectedUserForPassword && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200 text-left">
            
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Icons.Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    Reset User Password
                  </h3>
                  <p className="text-xs text-slate-400 font-medium truncate max-w-[240px]">
                    {selectedUserForPassword.firstName} {selectedUserForPassword.lastName} ({selectedUserForPassword.email})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                  New Secure Password *
                </label>
                <div className="relative">
                  <input
                    required
                    type={showNewPassword ? 'text' : 'password'}
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter at least 8 characters..."
                    className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showNewPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resettingPassword || newPassword.length < 8}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-md shadow-amber-600/20 transition-all cursor-pointer uppercase tracking-wider flex items-center gap-2"
                >
                  {resettingPassword ? <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icons.Check className="w-3.5 h-3.5" />}
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL 3: REPORTING MANAGER ASSIGNMENT MODAL ───────────────────────── */}
      {managerModalOpen && selectedUserForManager && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 text-left">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                Assign Reporting Manager
              </h3>
              <button
                type="button"
                onClick={() => {
                  setManagerModalOpen(false);
                  setSelectedUserForManager(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 font-medium">
              Select supervisor for <strong>{selectedUserForManager.firstName} {selectedUserForManager.lastName}</strong>:
            </p>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-visible-scrollbar">
              {(allManagers.length > 0 ? allManagers : users)
                .filter(u => u._id !== selectedUserForManager._id)
                .map(manager => (
                  <button
                    key={manager._id}
                    type="button"
                    onClick={() => handleAssignManager(manager._id)}
                    className="w-full text-left px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/40 transition-all flex items-center gap-3 cursor-pointer group"
                  >
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-bold text-xs flex items-center justify-center uppercase">
                      {manager.firstName ? manager.firstName[0] : 'M'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors truncate">
                        {manager.firstName} {manager.lastName}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {manager.roleId?.name || 'Manager'} • {manager.email}
                      </div>
                    </div>
                  </button>
                ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  setManagerModalOpen(false);
                  setSelectedUserForManager(null);
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 4: LOCATION AUDIT & MAP MODAL ──────────────────────────────── */}
      {selectedUserForLocation && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-2xl border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col text-left">
            
            <div className="flex justify-between items-start border-b border-slate-100 dark:border-slate-800 pb-3 flex-shrink-0">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                  <Icons.MapPin className="w-5 h-5 text-indigo-600" /> Location Audit & Geofence Verification
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  {selectedUserForLocation.firstName} {selectedUserForLocation.lastName} ({selectedUserForLocation.email})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserForLocation(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>

            {(() => {
              const u = selectedUserForLocation;
              const isSkipped = !!(u.skipLocation || u.locationVerificationSkipped);
              const regLoc = u.registeredLocation || u.registrationLocation;
              const curLoc = u.currentLocation;
              const activeLoc = isSkipped ? curLoc : regLoc;
              const hasCoordinates = typeof activeLoc?.latitude === 'number' && typeof activeLoc?.longitude === 'number';
              const addressStr = activeLoc?.address || (hasCoordinates ? `${activeLoc.latitude.toFixed(6)}°, ${activeLoc.longitude.toFixed(6)}°` : 'Location Not Available');
              const mapsUrl = hasCoordinates ? `https://www.google.com/maps?q=${activeLoc.latitude},${activeLoc.longitude}` : null;
              const historyList = u.loginHistory || [];

              return (
                <div className="space-y-4 text-xs overflow-y-auto pr-1 flex-1 custom-visible-scrollbar">
                  {/* Status Banner */}
                  <div className={`p-4 rounded-2xl border ${
                    isSkipped ? 'bg-amber-50/70 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800' : 'bg-emerald-50/70 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-black uppercase text-[10px] tracking-wider flex items-center gap-1.5 ${isSkipped ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
                        {isSkipped ? <Icons.MapPin className="w-4 h-4" /> : <Icons.Lock className="w-4 h-4" />}
                        {isSkipped ? 'Remote Access / Verification Skipped' : 'Mandatory Registered Geofence'}
                      </span>
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold text-[10px] hover:bg-indigo-700 transition-colors shadow-xs"
                        >
                          <Icons.ExternalLink className="w-3 h-3" /> View in Maps
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Coordinates & Address Card */}
                  <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 space-y-3">
                    <div>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                        Active Physical Address
                      </span>
                      <p className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                        {addressStr}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60">
                      <div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Latitude</span>
                        <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                          {hasCoordinates ? activeLoc.latitude.toFixed(6) : 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Longitude</span>
                        <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                          {hasCoordinates ? activeLoc.longitude.toFixed(6) : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Complete Login History */}
                  <div className="space-y-2 pt-2">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
                      <Icons.History className="w-4 h-4 text-indigo-600" /> Recent Session Logs ({historyList.length})
                    </h4>

                    {historyList.length === 0 ? (
                      <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-center text-slate-400 text-xs font-medium">
                        No login history recorded yet.
                      </div>
                    ) : (
                      <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold uppercase text-[9px] tracking-wider border-b border-slate-200 dark:border-slate-700">
                            <tr>
                              <th className="py-2.5 px-3">Date & Time</th>
                              <th className="py-2.5 px-3">Location / GPS</th>
                              <th className="py-2.5 px-3">Device / IP</th>
                              <th className="py-2.5 px-3 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {historyList.slice(0, 10).map((h: any, idx: number) => {
                              const loc = h.address || (typeof h.latitude === 'number' ? `${h.latitude.toFixed(4)}°, ${h.longitude.toFixed(4)}°` : 'Location Not Available');
                              return (
                                <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                  <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                    {formatDate(h.loginAt)}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200 max-w-[200px] truncate" title={loc}>
                                    {loc}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                                    <div className="font-semibold text-slate-800 dark:text-slate-200">{h.browser || 'Browser'} on {h.os || 'OS'}</div>
                                    <div className="text-[9px] font-mono text-slate-400">IP: {h.ip || '127.0.0.1'}</div>
                                  </td>
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black ${
                                      h.locationVerificationSkipped ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    }`}>
                                      {h.locationVerificationSkipped ? 'Skipped' : 'Verified'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
              <button
                type="button"
                onClick={() => setSelectedUserForLocation(null)}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold uppercase transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 5: SAFE USER DELETION WITH LEAD TRANSFER ───────────────────── */}
      {deleteModalOpen && selectedUserForDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-7 w-full max-w-lg border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 text-left animate-in fade-in zoom-in-95 duration-200">
            
            <div className="flex items-start gap-4">
              <div className={`p-3.5 rounded-2xl flex-shrink-0 ${
                assignedLeadCount > 0 
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' 
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}>
                {assignedLeadCount > 0 ? (
                  <Icons.AlertTriangle className="w-6 h-6 animate-pulse" />
                ) : (
                  <Icons.UserX className="w-6 h-6" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    Remove User Account
                  </h3>
                  <button
                    onClick={() => {
                      setDeleteModalOpen(false);
                      setSelectedUserForDelete(null);
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <Icons.X className="w-5 h-5" />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {selectedUserForDelete.firstName} {selectedUserForDelete.lastName}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-400">
                    ({selectedUserForDelete.email})
                  </span>
                </div>
              </div>
            </div>

            {/* Lead Count Check Status */}
            {checkingLeadCount ? (
              <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-center space-y-2">
                <Icons.Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400 mx-auto" />
                <p className="text-xs font-semibold text-slate-500">Checking assigned lead records...</p>
              </div>
            ) : assignedLeadCount > 0 ? (
              /* STEP 1: MUST TRANSFER LEADS BEFORE DELETION */
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl text-left space-y-2">
                  <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-xs">
                    <Icons.AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Action Required: Transfer Active Leads ({assignedLeadCount})</span>
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed font-medium">
                    This user currently has <strong>{assignedLeadCount} assigned lead(s)</strong>. You must transfer all leads to another agent before this user account can be deleted.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-left space-y-3">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Select Target Agent to Receive Leads:
                  </label>
                  <select
                    value={targetAgentId}
                    onChange={(e) => setTargetAgentId(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- Choose Agent --</option>
                    {users
                      .filter((u) => u._id !== selectedUserForDelete._id)
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.firstName} {u.lastName} ({u.email})
                        </option>
                      ))}
                  </select>

                  <button
                    type="button"
                    disabled={!targetAgentId || transferringLeads}
                    onClick={handleTransferLeadsBeforeDelete}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                  >
                    {transferringLeads ? (
                      <>
                        <Icons.Loader2 className="w-4 h-4 animate-spin" />
                        Transferring {assignedLeadCount} Leads...
                      </>
                    ) : (
                      <>
                        <Icons.Send className="w-4 h-4" />
                        Transfer {assignedLeadCount} Leads Now
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* STEP 2: LEADS TRANSFERRED / 0 LEADS -> TYPE "DELETE" TO CONFIRM */
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-2xl text-left flex items-center gap-3">
                  <Icons.CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <p className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold">
                    Verified: 0 active leads assigned. User is ready for deletion.
                  </p>
                </div>

                <div className="text-left space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    To confirm permanent deletion, please type <span className="text-rose-600 dark:text-rose-400 font-mono">DELETE</span> below:
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder='Type "DELETE" to confirm'
                    className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 uppercase tracking-widest"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setDeleteModalOpen(false);
                  setSelectedUserForDelete(null);
                }}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  assignedLeadCount > 0 || 
                  deleteConfirmText.trim().toUpperCase() !== 'DELETE' || 
                  deletingUser
                }
                onClick={handleExecuteUserDelete}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer uppercase tracking-wider active:scale-95"
              >
                {deletingUser ? (
                  <>
                    <Icons.Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Icons.Trash2 className="w-4 h-4" />
                    Permanently Remove User
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
