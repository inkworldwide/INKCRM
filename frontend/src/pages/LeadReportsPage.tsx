import React, { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import MultiSelectDropdown from '../components/MultiSelectDropdown';

import { exportLeadReportXLSX } from '../utils/exportLeadReportXLSX';
import { maskPhoneNumber } from '../utils/phoneUtils';

export const normalizeStatusName = (rawSt: string): string => {
  if (!rawSt) return 'PENDING';
  const s = rawSt.trim().toUpperCase();

  if (s === 'HOT' || s === 'HOT LEAD' || s === 'HOT LEADS') return 'HOT LEADS';
  if (s === 'WARM' || s === 'WARM LEAD' || s === 'WARM LEADS') return 'WARM LEADS';
  if (s.includes('CEBIL') || s.includes('CEDIL') || s.includes('CIVIL') || s.includes('CIBIL')) return 'CEBIL PENDING';
  if (s.includes('DOCUMENT') || s.includes('DOC PENDING')) return 'DOCUMENT PENDING';
  if (s.includes('APPROVAL PENDING') || s === 'APPROVAL PENDING') return 'APPROVAL PENDING';
  if (s.includes('APPROVED BUT NOT') || s === 'APPROVED BUT NOT DISBUSE' || s === 'APPROVED BUT NOT DISBURSED') return 'APPROVED BUT NOT DISBUSE';
  if (s === 'APPROVED') return 'APPROVED BUT NOT DISBUSE';
  if (s.includes('DISBURS') || s.includes('DISBUS')) return 'DISBUSED';
  if (s.includes('REJECT')) return 'REJECTED';
  if (s.includes('FOLLOW')) return 'FOLLOWUP';
  if (s.includes('DROP')) return 'DROPPED';
  if (s === 'PENDING') return 'PENDING';

  return s;
};

export default function LeadReportsPage() {
  const { showToast } = useToastStore();
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);

  // Search & Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedLoanTypes, setSelectedLoanTypes] = useState<string[]>([]);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const years = ['2024', '2025', '2026', '2027'];
  
  const statusOptions = [
    'Hot', 'Warm', 'Cedil Pending', 'Document Pending',
    'Approval Pending', 'Approved', 'Disbursed', 'Rejected', 'Followup', 'Dropped', 'Pending', 'New'
  ];

  // Master Product Names matching website database (from Products module)
  const loanTypes = [
    'SALARIED PERSONAL LOAN',
    'BUSINESS LOAN',
    'HOME LOAN',
    'LAP'
  ];

  useEffect(() => {
    fetchReportData();
  }, []);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      const leadsRes = await api.get('/records/leads?limit=10000').catch(() => ({ data: [] }));
      const allRecords = leadsRes.data?.records || leadsRes.data || [];
      setLeads(allRecords);
    } catch (err) {
      console.error(err);
      showToast('Failed to load lead report data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterClick = () => {
    fetchReportData();
    showToast('Applied multi-select filter conditions.', 'info');
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedMonths([]);
    setSelectedYears([]);
    setSelectedStatuses([]);
    setSelectedLoanTypes([]);
    showToast('Cleared all report filters.', 'info');
  };

  // Filter leads based on selected criteria and search term
  const filteredLeads = leads.filter((item) => {
    const data = item.data || {};

    // Search term matching across all lead attributes
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      const rawName = ([data.firstName, data.lastName].filter(Boolean).join(' ') || data.customerName || data.customer || data.fullName || data.name || '').toLowerCase();
      const phone = String(data.phone || data.mobile || data.contactNum || data.contact_num || data.contact || '').toLowerCase();
      const email = String(data.email || '').toLowerCase();
      const dataCode = String(data.dataCode || data.data_code || data['Data Code'] || item._id || '').toLowerCase();
      const firm = String(data.firmName || data.company || data.firm_name || '').toLowerCase();
      const location = String(data.city || data.location || data.address || '').toLowerCase();
      const status = String(data.status || data.dialStatus || '').toLowerCase();

      const searchMatch = rawName.includes(term) ||
        phone.includes(term) ||
        email.includes(term) ||
        dataCode.includes(term) ||
        firm.includes(term) ||
        location.includes(term) ||
        status.includes(term);

      if (!searchMatch) return false;
    }

    // Month & Year match (only filter if explicit months/years are selected)
    if (selectedMonths.length > 0 || selectedYears.length > 0) {
      const dateVal = data.dialedAt || data.lastCallDate || item.createdAt || item.updatedAt || data.createdAt || data.date;
      if (dateVal) {
        const dateObj = new Date(dateVal);
        if (!isNaN(dateObj.getTime())) {
          const monthName = months[dateObj.getMonth()];
          const yearStr = dateObj.getFullYear().toString();
          
          if (selectedMonths.length > 0 && !selectedMonths.includes(monthName)) return false;
          if (selectedYears.length > 0 && !selectedYears.includes(yearStr)) return false;
        }
      }
    }

    // Status match with robust status normalization
    const statusMatch = selectedStatuses.length === 0 || selectedStatuses.some(s => {
      const targetNorm = normalizeStatusName(s);
      const rawSt = data.normalizedStatus || data.status || data.dialStatus || data.leadStatus || '';
      const itemNorm = normalizeStatusName(rawSt);
      return targetNorm === itemNorm || rawSt.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(rawSt.toLowerCase());
    });

    // Match product/loanType with tolerance for defaults & substrings
    const rawLoan = (data.loanType || data.serviceType || data.product || 'SALARIED PERSONAL LOAN').trim().toLowerCase();
    const loanMatch = selectedLoanTypes.length === 0 || selectedLoanTypes.some(l => {
      const selected = l.trim().toLowerCase();
      if (selected.includes('personal') && (rawLoan.includes('personal') || rawLoan.includes('salaried'))) return true;
      if (selected.includes('lap') && (rawLoan.includes('lap') || rawLoan.includes('property'))) return true;
      return rawLoan.includes(selected) || selected.includes(rawLoan);
    });

    return statusMatch && loanMatch;
  });

  const exportCSV = () => {
    if (filteredLeads.length === 0) {
      showToast('No lead data available for export.', 'warning');
      return;
    }
    exportLeadReportXLSX(filteredLeads, 'Lead_Report');
    showToast(`Exported ${filteredLeads.length} lead records to Excel!`, 'success');
  };

  // Compute summary stats for the hero cards
  const totalAmount = filteredLeads.reduce((acc, item) => {
    const data = item.data || {};
    const amt = Number(data.amount || data.loanAmount || 250000);
    return acc + (isNaN(amt) ? 0 : amt);
  }, 0);

  const hotAndConvertedCount = filteredLeads.filter((item) => {
    const st = (item.data?.status || item.status || item.data?.dialStatus || '').toLowerCase();
    return st.includes('hot') || st.includes('approved') || st.includes('disbursed');
  }).length;

  const hotRate = filteredLeads.length > 0 ? Math.round((hotAndConvertedCount / filteredLeads.length) * 100) : 0;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto text-left px-4 md:px-8 py-4">
      {/* 3 Vibrant Metric Hero Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Total Filtered Leads */}
        <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Filtered Leads
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
              <Icons.Users className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {filteredLeads.length}
            </span>
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md font-mono">
              of {leads.length} Loaded
            </span>
          </div>
        </div>

        {/* Card 2: Hot & High Intent */}
        <div className="bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Hot & Approved
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
              <Icons.Flame className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {hotAndConvertedCount}
            </span>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md font-mono">
              {hotRate}% High Intent
            </span>
          </div>
        </div>

        {/* Card 3: Pipeline Value */}
        <div className="bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Pipeline Volume
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
              <Icons.IndianRupee className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              ₹{(totalAmount / 100000).toFixed(1)}L
            </span>
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md font-mono">
              Est. Value
            </span>
          </div>
        </div>
      </div>

      {/* FILTER CONTROL CARD (Clean Lead-Only Filters) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-visible z-20">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex items-center justify-between gap-2 mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Icons.Filter className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Lead Analytics Filter Parameters
            </h3>
          </div>
          <button
            onClick={exportCSV}
            className="h-9 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Icons.Download className="w-3.5 h-3.5" />
            Export Excel
          </button>
        </div>

        {/* Global Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <Icons.Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search leads by Client Name, Data Code, Phone, Email, Location, or Firm..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Select Month */}
          <MultiSelectDropdown
            label="Select Month"
            options={months}
            selectedValues={selectedMonths}
            onChange={setSelectedMonths}
            placeholder="-All Months-"
          />

          {/* Select Year */}
          <MultiSelectDropdown
            label="Select Year"
            options={years}
            selectedValues={selectedYears}
            onChange={setSelectedYears}
            placeholder="-All Years-"
          />

          {/* Lead Status */}
          <MultiSelectDropdown
            label="Lead Status"
            options={statusOptions}
            selectedValues={selectedStatuses}
            onChange={setSelectedStatuses}
            placeholder="-All Statuses-"
          />

          {/* Loan Type */}
          <MultiSelectDropdown
            label="Loan Type"
            options={loanTypes}
            selectedValues={selectedLoanTypes}
            onChange={setSelectedLoanTypes}
            placeholder="-All Loan Types-"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={handleResetFilters}
            className="h-10 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Icons.RotateCcw className="w-3.5 h-3.5" />
            Reset Filters
          </button>

          <button
            onClick={handleFilterClick}
            className="h-11 px-6 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Icons.PieChart className="w-4 h-4" />
            Apply Report Filter
          </button>
        </div>
      </div>

      {/* DETAILED DATA TABLE */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
        
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
              Detailed Lead Audit Matrix
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Showing {filteredLeads.length} record entries with live data attributes
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-14 text-center text-xs text-slate-400">Loading lead report data...</div>
        ) : filteredLeads.length === 0 ? (
          <div className="py-14 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-500/20">
              <Icons.Inbox className="w-6 h-6" />
            </div>
            <p className="font-extrabold text-sm text-slate-800 dark:text-slate-200">No lead records found</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Try modifying your filter parameters above to view more leads.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[950px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider h-11 bg-slate-50/90 dark:bg-slate-800/80">
                  <th className="py-3.5 px-6">Lead ID</th>
                  <th className="py-3.5 px-6">Client Name</th>
                  <th className="py-3.5 px-6">Contact Info</th>
                  <th className="py-3.5 px-6">Firm / Location</th>
                  <th className="py-3.5 px-6">Loan Type</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6">Amount</th>
                  <th className="py-3.5 px-6">Period</th>
                  <th className="py-3.5 px-6">Assigned Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredLeads.map((item, idx) => {
                  const data = item.data || {};
                  
                  // Client name resolver
                  const rawName = [data.firstName, data.lastName].filter(Boolean).join(' ') || data.customerName || data.customer || data.fullName || data.name || data.companyName || data.company;
                  const name = rawName || 'N/A';

                  // Data code resolver
                  const dataCode = data.dataCode || data.data_code || data['Data Code'] || (item._id ? `#${item._id.substring(item._id.length - 6).toUpperCase()}` : `LD-100${idx}`);

                  // Contact info resolver
                  const rawPhone = data.phone || data.mobile || data.contactNum || data.contact_num || data.contact || data['CONTACT NUM'] || data['contact num'] || data.phoneNumber || data.mobileNo || '';
                  const phone = rawPhone || 'N/A';

                  const rawEmail = data.email || '';
                  const email = rawEmail || 'N/A';

                  // Firm & Location
                  const firm = data.firmName || data.company || data.firm_name || '';
                  const location = data.city || data.location || data.address || '';
                  const firmLocationStr = [firm, location].filter(Boolean).join(' • ') || 'N/A';

                  const loanType = data.loanType || data.leadCategory || data.serviceType || data.product || 'SALARIED PERSONAL LOAN';
                  const status = data.status || data.dialStatus || 'New';
                  const amount = data.amount || data.loanAmount || data.budget || 'N/A';
                  const agent = item.assignedTo?.name || data.assignedTo || data.assignedToName || data.psm || data.telecaller || 'Unassigned';

                  // Format created date period
                  const dateObj = item.createdAt ? new Date(item.createdAt) : new Date();
                  const period = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                  return (
                    <tr key={item._id || idx} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors h-14">
                      <td className="py-3.5 px-6 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-bold">
                        {dataCode}
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-3xs">
                            {name[0]}
                          </div>
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {name}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{maskPhoneNumber(phone)}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{email}</div>
                      </td>
                      <td className="py-3.5 px-6 text-slate-700 dark:text-slate-300 font-medium">
                        {firmLocationStr}
                      </td>
                      <td className="py-3.5 px-6">
                        <span className="px-2.5 py-1 rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/80 dark:border-purple-800/50 text-[11px] font-bold">
                          {loanType}
                        </span>
                      </td>
                      <td className="py-3.5 px-6">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border font-mono ${
                          status.toLowerCase() === 'disbursed' || status.toLowerCase() === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                            : status.toLowerCase() === 'hot' || status.toLowerCase() === 'hot leads'
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                            : status.toLowerCase() === 'followup' || status.toLowerCase() === 'warm'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                            : 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800'
                        }`}>
                          {status}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 font-bold text-slate-900 dark:text-white font-mono">
                        {(() => {
                          const numAmt = Number(amount);
                          return (amount !== 'N/A' && amount !== undefined && amount !== null && !isNaN(numAmt) && numAmt > 0)
                            ? `₹${numAmt.toLocaleString('en-IN')}`
                            : 'N/A';
                        })()}
                      </td>
                      <td className="py-3.5 px-6 font-medium text-slate-500 dark:text-slate-400 text-[11px]">
                        {period}
                      </td>
                      <td className="py-3.5 px-6">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
                          {agent}
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
}
