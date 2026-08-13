import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import * as Icons from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';

export default function UsersManagement() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { showConfirm, showToast, showAlertModal } = useToastStore();

  const [users, setUsers] = useState<any[]>([]);
  const [allManagers, setAllManagers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
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
  const [userEditing, setUserEditing] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [managerModalOpen, setManagerModalOpen] = useState(false);
  const [selectedUserForManager, setSelectedUserForManager] = useState<any>(null);
  const [selectedUserForLocation, setSelectedUserForLocation] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedUserForDelete, setSelectedUserForDelete] = useState<any>(null);
  const [assignedLeadCount, setAssignedLeadCount] = useState<number>(0);
  const [checkingLeadCount, setCheckingLeadCount] = useState<boolean>(false);
  const [targetAgentId, setTargetAgentId] = useState<string>('');
  const [transferringLeads, setTransferringLeads] = useState<boolean>(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>('');
  const [deletingUser, setDeletingUser] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'active'>('all');
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');

  const [loading, setLoading] = useState(true);

  const formatDate = (dateInput: any) => {
    if (!dateInput) return 'N/A';
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return 'N/A';
      return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) {
      return 'N/A';
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
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
    } catch (err) {
      console.error('Failed to load users management data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveUser = async (userId: string, approve: boolean) => {
    try {
      await api.put(`/auth/users/${userId}`, {
        isApproved: approve,
        approvalStatus: approve ? 'approved' : 'rejected',
        isActive: approve
      });
      showToast(approve ? 'User approved successfully! User can now log in.' : 'User registration rejected.', approve ? 'success' : 'warning');
      loadData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update user approval status.', 'error');
    }
  };

  const handleToggleUserSetting = async (userId: string, field: 'skipFace' | 'skipLocation' | 'isActive', currentValue: boolean) => {
    try {
      await api.put(`/auth/users/${userId}`, { [field]: !currentValue });
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
        if (userForm.password) payload.password = userForm.password;
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
      firstName: u.firstName,
      lastName: u.lastName,
      roleId: u.roleId?._id || '',
      department: u.department || '',
      skipFace: !!u.skipFace,
      skipLocation: !!u.skipLocation,
      isActive: u.isActive !== false
    });
    setUserEditing(true);
    setUserModalOpen(true);
  };

  const handleOpenDeleteModal = async (u: any) => {
    setSelectedUserForDelete(u);
    setTargetAgentId('');
    setDeleteConfirmText('');
    setDeleteModalOpen(true);
    setCheckingLeadCount(true);
    try {
      const res = await api.get(`/auth/users/${u._id}/assigned-leads-count`).catch(() => ({ data: { count: 0 } }));
      setAssignedLeadCount(res.data?.count || 0);
    } catch (err) {
      setAssignedLeadCount(0);
    } finally {
      setCheckingLeadCount(false);
    }
  };

  const handleTransferLeadsBeforeDelete = async () => {
    if (!selectedUserForDelete || !targetAgentId) {
      showToast('Please select an agent to receive the leads.', 'warning');
      return;
    }

    const targetUser = users.find(u => u._id === targetAgentId);
    if (!targetUser) return;

    try {
      setTransferringLeads(true);
      const fromName = `${selectedUserForDelete.firstName || ''} ${selectedUserForDelete.lastName || ''}`.trim() || selectedUserForDelete.email;
      const toName = `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim() || targetUser.email;

      const res = await api.post('/records/transfer/leads', {
        fromAgentId: selectedUserForDelete._id,
        fromAgentName: fromName,
        toAgentId: targetUser._id,
        toAgentName: toName
      });

      showToast(`Successfully transferred ${res.data.modifiedCount || assignedLeadCount} lead(s) to ${toName}.`, 'success');
      setAssignedLeadCount(0);
      setTargetAgentId('');
    } catch (err: any) {
      console.error('Failed to transfer leads:', err);
      showToast(err.response?.data?.error || 'Failed to transfer leads.', 'error');
    } finally {
      setTransferringLeads(false);
    }
  };

  const handleExecuteUserDelete = async () => {
    if (!selectedUserForDelete) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      showToast('Please type "DELETE" to confirm user removal.', 'warning');
      return;
    }

    try {
      setDeletingUser(true);
      await api.delete(`/auth/users/${selectedUserForDelete._id}`);
      showToast(`User '${selectedUserForDelete.firstName} ${selectedUserForDelete.lastName}' removed successfully.`, 'success');
      setDeleteModalOpen(false);
      setSelectedUserForDelete(null);
      loadData();
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      showToast(err.response?.data?.error || 'Failed to delete user account.', 'error');
    } finally {
      setDeletingUser(false);
    }
  };

  const handleAssignManager = async (managerId: string) => {
    try {
      if (!selectedUserForManager) return;
      await api.put(`/auth/users/${selectedUserForManager._id}`, { reportingManager: managerId });
      showToast('Reporting manager assigned successfully.', 'success');
      setManagerModalOpen(false);
      setSelectedUserForManager(null);
      loadData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to assign reporting manager.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-8 w-64 rounded animate-shimmer"></div>
        <div className="h-40 rounded-lg animate-shimmer"></div>
      </div>
    );
  }

  const pendingUsersCount = users.filter(u => u.approvalStatus === 'pending' || u.isApproved === false).length;
  const activeUsersCount = users.filter(u => u.isActive && u.isApproved !== false).length;

  const filteredUsers = users.filter(u => {
    if (statusFilter === 'pending' && !(u.approvalStatus === 'pending' || u.isApproved === false)) return false;
    if (statusFilter === 'active' && !(u.isActive && u.isApproved !== false)) return false;
    if (userSearchQuery.trim()) {
      const q = userSearchQuery.toLowerCase().trim();
      const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const email = (u.email || '').toLowerCase();
      const userCode = (u.userCode || '').toLowerCase();
      const roleName = (roles.find(r => r._id === u.roleId)?.name || '').toLowerCase();
      const deptName = (u.department || '').toLowerCase();
      return fullName.includes(q) || email.includes(q) || userCode.includes(q) || roleName.includes(q) || deptName.includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-left pb-16 font-['Plus_Jakarta_Sans',sans-serif] px-4 md:px-8 py-4">
      {/* Header Banner with Subtle Sky Blue Accent */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500/80 via-blue-500/70 to-indigo-500/60" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 flex-shrink-0">
            <Icons.Users className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider font-mono px-2.5 py-0.5 rounded-full border bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/60">
                Team & Personnel
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Administration
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase flex items-center gap-3">
              Users Management
              {pendingUsersCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 animate-pulse">
                  {pendingUsersCount} Pending Approval
                </span>
              )}
            </h1>
          </div>
        </div>

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
          className="flex items-center gap-2 px-5 h-10 bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 hover:opacity-95 text-white rounded-xl text-xs font-black shadow-md shadow-sky-500/20 transition-all cursor-pointer flex-shrink-0"
        >
          <Icons.Plus className="w-4 h-4" /> Add New User
        </button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-3 rounded-2xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center bg-slate-100/80 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-3xs font-extrabold'
                : 'text-slate-500 hover:text-slate-850 dark:hover:text-slate-200'
            }`}
          >
            All Users <span className="px-1.5 py-0.2 bg-slate-200/70 dark:bg-slate-700 rounded-full text-[10px] font-mono">{users.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'pending'
                ? 'bg-amber-500 text-white shadow-3xs font-extrabold'
                : 'text-slate-500 hover:text-amber-600'
            }`}
          >
            <Icons.Clock className="w-3.5 h-3.5" /> Pending Approval
            {pendingUsersCount > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${statusFilter === 'pending' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-800 font-extrabold'}`}>
                {pendingUsersCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              statusFilter === 'active'
                ? 'bg-emerald-600 text-white shadow-3xs font-extrabold'
                : 'text-slate-500 hover:text-emerald-600'
            }`}
          >
            <Icons.CheckCircle className="w-3.5 h-3.5" /> Active Team
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${statusFilter === 'active' ? 'bg-white/30 text-white' : 'bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
              {activeUsersCount}
            </span>
          </button>
        </div>

        {/* Real-time search bar */}
        <div className="relative w-full sm:w-72">
          <Icons.Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, email, role, dept..."
            value={userSearchQuery}
            onChange={(e) => setUserSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-8 text-xs bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-sky-500 text-slate-800 dark:text-white font-medium placeholder:text-slate-400 transition-all"
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

      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500/60 via-blue-500/60 to-indigo-500/60" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 dark:bg-slate-800/80 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 h-11">
                <th className="py-2.5 px-4">EMPLOYEE</th>
                <th className="py-2.5 px-4">ID</th>
                <th className="py-2.5 px-4">LOCATION</th>
                <th className="py-2.5 px-4 text-center">SKIP FACE</th>
                <th className="py-2.5 px-4 text-center">SKIP LOCATION</th>
                <th className="py-2.5 px-4 text-center min-w-[140px]">ACCOUNT STATUS</th>
                <th className="py-2.5 px-4">ROLE</th>
                <th className="py-2.5 px-4">DEPARTMENT</th>
                <th className="py-2.5 px-4">REPORTING MANAGER</th>
                <th className="py-2.5 px-4 text-center w-40">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredUsers.map(u => (
                <tr key={u._id} className="hover:bg-slate-50/50 transition-colors h-14">
                  {/* Employee Profile Card */}
                  <td className="px-4 py-2 font-semibold text-slate-700">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-600 uppercase text-sm select-none">
                        {u.firstName ? u.firstName[0] : (u.email ? u.email[0] : 'U')}
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-slate-800 text-sm leading-tight">{u.firstName} {u.lastName}</div>
                        <div className="text-xs text-slate-400 font-normal mt-0.5">{u.email}</div>
                      </div>
                    </div>
                  </td>

                  {/* Unique ID / Code */}
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs font-semibold bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-slate-600">
                      {u.userCode || 'N/A'}
                    </span>
                  </td>

                  {/* Dynamic Location Column */}
                  <td className="px-4 py-2 text-left cursor-pointer" onClick={() => setSelectedUserForLocation(u)}>
                    {(() => {
                      const isSkipped = !!(u.skipLocation || u.locationVerificationSkipped);
                      const regLoc = u.registeredLocation || u.registrationLocation;
                      const curLoc = u.currentLocation;

                      if (isSkipped) {
                        const hasCurLoc = curLoc && (curLoc.address || (typeof curLoc.latitude === 'number' && typeof curLoc.longitude === 'number'));
                        const addressText = curLoc?.address || (curLoc?.latitude ? `${curLoc.latitude.toFixed(4)}°, ${curLoc.longitude.toFixed(4)}°` : 'Location Not Available');
                        const updatedDate = curLoc?.lastUpdated ? formatDate(curLoc.lastUpdated) : null;

                        return (
                          <div className="flex flex-col gap-0.5 max-w-[190px]">
                            <div className="flex items-center gap-1">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                                <Icons.MapPin className="w-2.5 h-2.5" /> Current Location
                              </span>
                            </div>
                            <span className="text-xs font-semibold text-slate-800 truncate" title={addressText}>
                              {addressText}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {hasCurLoc && updatedDate ? `Updated: ${updatedDate}` : 'Location Not Available'}
                            </span>
                          </div>
                        );
                      } else {
                        const hasRegLoc = regLoc && (regLoc.address || (typeof regLoc.latitude === 'number' && typeof regLoc.longitude === 'number'));
                        const addressText = regLoc?.address || (regLoc?.latitude ? `${regLoc.latitude.toFixed(4)}°, ${regLoc.longitude.toFixed(4)}°` : 'Location Not Available');
                        const registeredDate = regLoc?.capturedAt ? formatDate(regLoc.capturedAt) : (u.createdAt ? formatDate(u.createdAt) : null);

                        return (
                          <div className="flex flex-col gap-0.5 max-w-[190px]">
                            <div className="flex items-center gap-1">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                                <Icons.Lock className="w-2.5 h-2.5" /> Registered Location
                              </span>
                            </div>
                            <span className="text-xs font-semibold text-slate-800 truncate" title={addressText}>
                              {addressText}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {hasRegLoc && registeredDate ? `Registered On: ${registeredDate}` : 'Location Not Available'}
                            </span>
                          </div>
                        );
                      }
                    })()}
                  </td>

                  {/* Skip Face Toggle */}
                  <td className="px-4 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleUserSetting(u._id, 'skipFace', u.skipFace || false)}
                      className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        u.skipFace ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          u.skipFace ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>

                  {/* Skip Location Toggle */}
                  <td className="px-4 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleUserSetting(u._id, 'skipLocation', u.skipLocation || false)}
                      className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        u.skipLocation ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          u.skipLocation ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>

                  {/* Account Status & Approval Actions */}
                  <td className="px-4 py-2 text-center">
                    {u.approvalStatus === 'pending' || u.isApproved === false ? (
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-full text-[9.5px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1 animate-pulse">
                          <Icons.Clock className="w-2.5 h-2.5" /> PENDING APPROVAL
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <button
                            type="button"
                            onClick={() => handleApproveUser(u._id, true)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] shadow-xs flex items-center gap-1 transition-all cursor-pointer"
                            title="Approve User for Login"
                          >
                            <Icons.Check className="w-3 h-3" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApproveUser(u._id, false)}
                            className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold text-[10px] flex items-center transition-all cursor-pointer"
                            title="Reject Registration"
                          >
                            <Icons.X className="w-3 h-3" /> Reject
                          </button>
                        </div>
                      </div>
                    ) : u.approvalStatus === 'rejected' ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                          <Icons.XCircle className="w-2.5 h-2.5" /> REJECTED
                        </span>
                        <button
                          type="button"
                          onClick={() => handleApproveUser(u._id, true)}
                          className="px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[9px] shadow-xs flex items-center gap-1 transition-colors cursor-pointer"
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
                            u.isActive !== false ? 'bg-indigo-600' : 'bg-slate-200'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              u.isActive !== false ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                        <span className={`text-[8px] font-bold ${u.isActive !== false ? 'text-indigo-600' : 'text-slate-400'}`}>
                          {u.isActive !== false ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Role (Read Only) */}
                  <td className="px-4 py-2 text-xs font-semibold text-slate-700">
                    {u.roleId?.name || 'No Role'}
                  </td>

                  {/* Department */}
                  <td className="px-4 py-2 text-xs font-semibold text-slate-750">
                    {u.department || 'N/A'}
                  </td>

                  {/* Reporting Manager */}
                  <td className="px-4 py-2 cursor-pointer" onClick={() => {
                    setSelectedUserForManager(u);
                    setManagerModalOpen(true);
                  }}>
                    <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors w-max">
                      <Icons.UserPlus className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs font-semibold text-slate-700">
                        {u.reportingManager ? `${u.reportingManager.firstName} ${u.reportingManager.lastName}` : 'Assign Manager'}
                      </span>
                    </div>
                  </td>

                  {/* Action Buttons */}
                  <td className="px-4 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleEditUser(u)}
                        className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-indigo-600 transition-colors"
                        title="Edit User"
                      >
                        <Icons.Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenDeleteModal(u)}
                        className="p-1 rounded hover:bg-rose-50 text-slate-450 hover:text-rose-600 transition-colors"
                        title="Remove User"
                      >
                        <Icons.Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Add/Edit Modal */}
      {userModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md border border-slate-200 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800">
              {userEditing ? 'Edit User Details' : 'Add New User'}
            </h3>
            <form onSubmit={handleSaveUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">First Name</label>
                  <input required type="text" value={userForm.firstName} onChange={e => setUserForm({ ...userForm, firstName: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Last Name</label>
                  <input required type="text" value={userForm.lastName} onChange={e => setUserForm({ ...userForm, lastName: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Email Address</label>
                <input required type="email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Password</label>
                <div className="relative">
                  <input 
                    required={!userEditing} 
                    type={showPassword ? "text" : "password"} 
                    value={userForm.password} 
                    onChange={e => setUserForm({ ...userForm, password: e.target.value })} 
                    className="w-full pl-4 pr-10 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500" 
                    placeholder={userEditing ? "Enter new password to change..." : "Password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showPassword ? (
                      <Icons.EyeOff className="w-4 h-4" />
                    ) : (
                      <Icons.Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Role Type <span className="text-red-500">*</span></label>
                  <select required value={userForm.roleId} onChange={e => setUserForm({ ...userForm, roleId: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer">
                    <option value="">Select Role</option>
                    {roles.map(r => (
                      <option key={r._id} value={r._id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Department</label>
                  <select value={userForm.department} onChange={e => setUserForm({ ...userForm, department: e.target.value })} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer">
                    <option value="">Select Department</option>
                    {departments.map(d => {
                      const deptName = d.data?.name || d.name || '';
                      return <option key={d._id} value={deptName}>{deptName}</option>;
                    })}
                  </select>
                </div>
              </div>

              {/* Security & Access Controls */}
              <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/50 space-y-4">
                <span className="text-[10px] font-[800] text-slate-405 uppercase tracking-wider block">Access Permissions & Controls</span>
                
                {/* Approve Status Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-2.5">
                    <Icons.CheckCircle2 className="w-4 h-4 text-slate-400 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-slate-700">Approve Account</div>
                      <div className="text-[10px] text-slate-400">Approve/activate user account status</div>
                    </div>
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
              </div>



              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setUserModalOpen(false)} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-sm">
                  {userEditing ? 'Save' : 'Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manager Assignment Modal */}
      {managerModalOpen && selectedUserForManager && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md border border-slate-200 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-800">
              Assign Reporting Manager
            </h3>
            <p className="text-xs text-slate-500">
              Select a manager for {selectedUserForManager.firstName} {selectedUserForManager.lastName}.
            </p>
            <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
              {(allManagers.length > 0 ? allManagers : users).filter(user => user._id !== selectedUserForManager._id).map(manager => (
                <button
                  key={manager._id}
                  type="button"
                  onClick={() => handleAssignManager(manager._id)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 uppercase">
                    {manager.firstName ? manager.firstName[0] : 'U'}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-800">{manager.firstName} {manager.lastName}</div>
                    <div className="text-xs text-slate-500">{manager.roleId?.name || 'No Role'}</div>
                  </div>
                </button>
              ))}
              {(allManagers.length > 0 ? allManagers : users).filter(user => user._id !== selectedUserForManager._id).length === 0 && (
                <div className="text-center text-slate-500 text-xs py-4">No other users available.</div>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setManagerModalOpen(false);
                  setSelectedUserForManager(null);
                }}
                className="px-5 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Location Detail & Complete Login History Modal */}
      {selectedUserForLocation && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-2xl border border-slate-200 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3 flex-shrink-0">
              <div>
                <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                  <Icons.MapPin className="w-5 h-5 text-indigo-600" /> Location & Login History Audit
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {selectedUserForLocation.firstName} {selectedUserForLocation.lastName} ({selectedUserForLocation.email})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserForLocation(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
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
              const timestamp = isSkipped
                ? (curLoc?.lastUpdated ? formatDate(curLoc.lastUpdated) : 'Location Not Available')
                : (regLoc?.capturedAt ? formatDate(regLoc.capturedAt) : (u.createdAt ? formatDate(u.createdAt) : 'Location Not Available'));

              const historyList = u.loginHistory || [];

              return (
                <div className="space-y-4 text-xs overflow-y-auto pr-1 flex-1">
                  {/* Mode Card */}
                  <div className={`p-3.5 rounded-2xl border ${
                    isSkipped ? 'bg-amber-50/60 border-amber-200 text-amber-900' : 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                        {isSkipped ? <Icons.MapPin className="w-3.5 h-3.5 text-amber-600" /> : <Icons.Lock className="w-3.5 h-3.5 text-emerald-600" />}
                        {isSkipped ? 'Location Verification Skipped' : 'Mandatory Location Verification'}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                        isSkipped ? 'bg-amber-200/80 text-amber-900' : 'bg-emerald-200/80 text-emerald-900'
                      }`}>
                        {isSkipped ? 'Current Location Active' : 'Registered Location Active'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] opacity-90 leading-relaxed">
                      {isSkipped
                        ? 'Location verification is skipped for this user. System dynamically captures and displays their latest login location address.'
                        : 'Location verification is mandatory for this user. System verifies login against their permanent registered location.'}
                    </p>
                  </div>

                  {/* Active Address & Details Card */}
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div>
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1">
                        {isSkipped ? 'Current Location Address' : 'Registered Location Address'}
                      </span>
                      <p className="text-sm font-bold text-slate-800 leading-snug">
                        {addressStr}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-slate-200/60">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Latitude</span>
                        <span className="font-mono text-xs font-bold text-slate-700">
                          {hasCoordinates ? activeLoc.latitude.toFixed(6) : 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Longitude</span>
                        <span className="font-mono text-xs font-bold text-slate-700">
                          {hasCoordinates ? activeLoc.longitude.toFixed(6) : 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200/60">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        {isSkipped ? 'Last Updated Timestamp' : 'Registered On Timestamp'}
                      </span>
                      <span className="font-bold text-slate-700">{timestamp}</span>
                    </div>
                  </div>

                  {/* Complete Login History Section */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                        <Icons.History className="w-4 h-4 text-indigo-600" /> Complete Login History Log ({historyList.length})
                      </h4>
                    </div>

                    {historyList.length === 0 ? (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-center text-slate-400 text-xs font-medium">
                        No login history recorded yet.
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-slate-100 text-slate-500 font-bold uppercase text-[9px] tracking-wider border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-3">Date & Time</th>
                              <th className="py-2.5 px-3">Login Address / GPS</th>
                              <th className="py-2.5 px-3">Device / IP</th>
                              <th className="py-2.5 px-3 text-center">Mode</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {historyList.map((h: any, idx: number) => {
                              const locAddress = h.address || (typeof h.latitude === 'number' ? `${h.latitude.toFixed(4)}°, ${h.longitude.toFixed(4)}°` : 'Location Not Available');
                              return (
                                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                  <td className="py-2.5 px-3 font-semibold text-slate-700 whitespace-nowrap">
                                    {formatDate(h.loginAt)}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-800 max-w-[200px] truncate" title={locAddress}>
                                    {locAddress}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600">
                                    <div className="font-semibold text-slate-700">{h.browser || 'Browser'} on {h.os || 'OS'}</div>
                                    <div className="text-[9px] font-mono text-slate-400">IP: {h.ip || '127.0.0.1'}</div>
                                  </td>
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${
                                      h.locationVerificationSkipped ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
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

            <div className="flex justify-end pt-3 border-t border-slate-100 flex-shrink-0">
              <button
                type="button"
                onClick={() => setSelectedUserForLocation(null)}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SAFE DELETE USER MODAL */}
      {deleteModalOpen && selectedUserForDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-lg border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 text-left animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
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

            {/* Modal Actions */}
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
