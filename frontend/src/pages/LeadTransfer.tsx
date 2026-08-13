import React, { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useThemeStore } from '../store/themeStore';
import { useToastStore } from '../store/toastStore';

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
}

interface Lead {
  _id: string;
  data: {
    assignedTo?: string;
    [key: string]: any;
  };
}

export default function LeadTransfer() {
  const { branding } = useThemeStore();
  const { showToast, showAlertModal, showConfirm } = useToastStore();
  const [users, setUsers] = useState<User[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDestinations, setSelectedDestinations] = useState<Record<string, string>>({});
  const [checkedMoves, setCheckedMoves] = useState<Record<string, boolean>>({});
  const [transferring, setTransferring] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const usersRes = await api.get('/auth/users?purpose=dropdown');
      setUsers(usersRes.data);
      const leadsRes = await api.get('/records/leads?limit=10000');
      setLeads(leadsRes.data.records || leadsRes.data || []);
    } catch (err) {
      console.error('Failed to fetch data for lead transfer:', err);
    } finally {
      setLoading(false);
    }
  };

  const getLeadCount = (user: User) => {
    const fullName = `${user.firstName} ${user.lastName}`.trim().toLowerCase();
    return leads.filter((lead) => {
      const assigned = String(lead.data?.assignedTo || '').trim().toLowerCase();
      return assigned === fullName || assigned === user._id;
    }).length;
  };

  const handleTransfer = async (fromUser: User) => {
    const toUserId = selectedDestinations[fromUser._id];
    if (!toUserId) {
      showToast('Please select a destination agent in the "Move To" dropdown.', 'warning');
      return;
    }
    const toUser = users.find((u) => u._id === toUserId);
    if (!toUser) return;

    const fromName = `${fromUser.firstName} ${fromUser.lastName}`.trim();
    const toName = `${toUser.firstName} ${toUser.lastName}`.trim();
    const count = getLeadCount(fromUser);

    if (count === 0) {
      showToast(`Agent ${fromName} has no assigned leads to transfer.`, 'warning');
      return;
    }

    showConfirm({
      title: 'Transfer Leads',
      message: `Are you sure you want to transfer ${count} lead(s) from ${fromName} to ${toName}?`,
      onConfirm: async () => {
        try {
          setTransferring(fromUser._id);
          await api.post('/records/transfer/leads', {
            fromAgentId: fromUser._id,
            fromAgentName: fromName,
            toAgentId: toUser._id,
            toAgentName: toName,
          });
          showAlertModal({
            title: 'Transferred Successfully',
            message: `Successfully transferred ${count} lead(s) to ${toName}.`,
            type: 'success'
          });
          setCheckedMoves(prev => ({ ...prev, [fromUser._id]: false }));
          setSelectedDestinations((prev) => {
            const copy = { ...prev };
            delete copy[fromUser._id];
            return copy;
          });
          await fetchData();
        } catch (err) {
          console.error('Transfer failed:', err);
          showToast('Failed to transfer leads. Please try again.', 'error');
        } finally {
          setTransferring(null);
        }
      }
    });
  };

  const handleClearLeads = async (fromUser: User) => {
    const fromName = `${fromUser.firstName} ${fromUser.lastName}`.trim();
    const count = getLeadCount(fromUser);
    if (count === 0) {
      showToast(`Agent ${fromName} has no assigned leads.`, 'warning');
      return;
    }

    showConfirm({
      title: 'Unassign Leads',
      message: `Are you sure you want to unassign all ${count} lead(s) from ${fromName}?`,
      type: 'warning',
      onConfirm: async () => {
        try {
          setTransferring(fromUser._id);
          await api.post('/records/transfer/leads', {
            fromAgentId: fromUser._id,
            fromAgentName: fromName,
            toAgentId: 'unassigned',
            toAgentName: 'Unassigned',
          });
          showAlertModal({
            title: 'Unassigned Successfully',
            message: `Successfully unassigned ${count} lead(s) from ${fromName}.`,
            type: 'success'
          });
          await fetchData();
        } catch (err) {
          console.error('Clear failed:', err);
          showToast('Failed to unassign leads.', 'error');
        } finally {
          setTransferring(null);
        }
      }
    });
  };

  const filteredUsers = users.filter((user) => {
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
    return fullName.includes(searchQuery.toLowerCase());
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-left pb-16 font-['Plus_Jakarta_Sans',sans-serif] px-4 md:px-8 py-4">
      {/* Page Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500/80 via-blue-500/70 to-indigo-500/60" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20 flex-shrink-0">
            <Icons.ArrowLeftRight className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider font-mono px-2.5 py-0.5 rounded-full border bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300 border-cyan-200/80 dark:border-cyan-800/60">
                Lead Distribution
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Reallocation
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              Lead Transfer & Reassignment
            </h1>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-3xs transition-all cursor-pointer flex-shrink-0"
        >
          <Icons.RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Main Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500/60 to-blue-500/60" />
        
        {/* Card Header with Search */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <h2 className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Icons.Users className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            Agent Lead Allocation Overview ({filteredUsers.length} Agents)
          </h2>
          <div className="relative">
            <Icons.Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search agent by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 h-9 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 w-64 transition-all"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading && leads.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400">
              <div className="w-8 h-8 border-[3px] border-cyan-500 border-t-transparent rounded-full animate-spin mb-3" />
              <span className="text-sm font-medium">Loading agent allocation data...</span>
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-800/80 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 h-11">
                  <th className="py-2.5 px-6">Agent Name</th>
                  <th className="py-2.5 px-6 text-center">Lead Count</th>
                  <th className="py-2.5 px-6">Move To</th>
                  <th className="py-2.5 px-6 text-center">Select</th>
                  <th className="py-2.5 px-6 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400 font-semibold italic">
                      No agents found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const fullName = `${user.firstName} ${user.lastName}`.trim();
                    const count = getLeadCount(user);
                    const destinationOptions = users.filter((u) => u._id !== user._id);
                    const isTransferring = transferring === user._id;

                    return (
                      <tr
                        key={user._id}
                        className="hover:bg-slate-50/30 transition-colors h-16"
                      >
                        {/* Agent Name */}
                        <td className="py-3 px-6">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-50 border border-[#E8ECF4] text-indigo-650 flex items-center justify-center text-xs font-[800] uppercase shrink-0">
                              {fullName.charAt(0)}
                            </div>
                            <span className="font-bold text-slate-800 text-sm">{fullName}</span>
                          </div>
                        </td>

                        {/* Lead Count Badge */}
                        <td className="py-3 px-6 text-center">
                          <span className={`inline-flex items-center px-2.5 py-1.5 rounded-xl text-[10px] font-[800] tracking-wider border ${
                            count > 0
                              ? 'bg-indigo-50 border-indigo-150 text-indigo-650 shadow-sm'
                              : 'bg-slate-50 border-slate-150 text-slate-400'
                          }`}>
                            {count}
                          </span>
                        </td>

                        {/* Move To Dropdown */}
                        <td className="py-3 px-6">
                          <select
                            value={selectedDestinations[user._id] || ''}
                            onChange={(e) =>
                              setSelectedDestinations((prev) => ({
                                ...prev,
                                [user._id]: e.target.value,
                              }))
                            }
                            className="h-10 px-3 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer w-48 transition-all"
                          >
                            <option value="">-- Select Agent --</option>
                            {destinationOptions.map((opt) => (
                              <option key={opt._id} value={opt._id}>
                                {opt.firstName} {opt.lastName}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Checkbox */}
                        <td className="py-3 px-6 text-center">
                          <input
                            type="checkbox"
                            checked={!!checkedMoves[user._id]}
                            onChange={(e) =>
                              setCheckedMoves((prev) => ({
                                ...prev,
                                [user._id]: e.target.checked,
                              }))
                            }
                            className="w-4 h-4 rounded text-indigo-650 focus:ring-0 border-[#E8ECF4] bg-white cursor-pointer transition-all"
                          />
                        </td>

                        {/* Action Buttons */}
                        <td className="py-3 px-6">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleTransfer(user)}
                              disabled={isTransferring || !selectedDestinations[user._id] || count === 0}
                              title="Transfer Leads"
                              className="btn-primary-premium h-10 px-3.5 text-xs font-bold"
                            >
                              {isTransferring ? (
                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Icons.ArrowLeftRight className="w-3.5 h-3.5" />
                              )}
                              Transfer
                            </button>
                            <button
                              onClick={() => handleClearLeads(user)}
                              disabled={isTransferring || count === 0}
                              title="Unassign All Leads"
                              className="btn-delete-premium h-10 px-3.5 text-xs font-bold text-rose-600"
                            >
                              <Icons.Trash2 className="w-3.5 h-3.5" />
                              Clear
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer summary */}
        {!loading && filteredUsers.length > 0 && (
          <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>
              Showing <span className="font-bold text-slate-700">{filteredUsers.length}</span> agent{filteredUsers.length !== 1 ? 's' : ''}
            </span>
            <span>
              Total leads: <span className="font-bold text-indigo-650">{leads.length}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
