import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import { exportLeadReportXLSX } from '../utils/exportLeadReportXLSX';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  'Hot': '#EF4444',
  'Warm': '#F59E0B',
  'Not Connected': '#0EA5E9',
  'Invalid Number': '#F43F5E',
  'Not Required': '#8B5CF6',
  'New': '#6366F1',
  'Approved': '#10B981',
  'Disbursed': '#059669',
  'Cedil Pending': '#EC4899',
  'Document Pending': '#14B8A6',
  'Approval Pending': '#F97316',
  'Rejected': '#DC2626',
  'Followup': '#3B82F6',
  'Dropped': '#E11D48',
  'Pending': '#EAB308',
};

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const YEARS = ['2024', '2025', '2026', '2027'];

export default function DailyFunnelPage() {
  const [searchParams] = useSearchParams();
  const initialCamp = searchParams.get('campaign') || 'ALL';

  const { showToast } = useToastStore();
  const [loading, setLoading] = useState(false);

  // Filter States
  const [selectedDay, setSelectedDay] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>('July');
  const [selectedYear, setSelectedYear] = useState<string>('2026');
  const [selectedCampaign, setSelectedCampaign] = useState<string>(initialCamp);
  const [selectedAgent, setSelectedAgent] = useState<string>('ALL');

  // Raw Data
  const [leads, setLeads] = useState<any[]>([]);
  const [campaignsList, setCampaignsList] = useState<string[]>([]);
  const [agentsList, setAgentsList] = useState<any[]>([]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [leadsRes, campRes, usersRes] = await Promise.all([
        api.get('/records/leads?limit=2000').catch(() => ({ data: { records: [] } })),
        api.get('/records/campaigns?limit=1000').catch(() => ({ data: { records: [] } })),
        api.get('/auth/users').catch(() => ({ data: [] }))
      ]);

      const fetchedLeads = leadsRes.data?.records || leadsRes.data || [];
      const fetchedCampaigns = (campRes.data?.records || []).map((c: any) => c.data?.campaignName || c.name).filter(Boolean);
      const fetchedUsers = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.users || [];

      setLeads(fetchedLeads);
      setCampaignsList(Array.from(new Set(fetchedCampaigns)));
      setAgentsList(fetchedUsers);
    } catch (err) {
      console.error(err);
      showToast('Failed to load daily funnel data', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Filter leads by Day of Week, Month, Year, Campaign, Agent
  const filteredLeads = leads.filter(item => {
    const data = item.data || {};

    const rawDate = item.createdAt || data.createdAt || data.date;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const itemYear = String(d.getFullYear());
        const itemMonth = MONTHS[d.getMonth()];

        // 0=Sun, 1=Mon, ..., 6=Sat
        const dayIdx = d.getDay();
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const itemDayName = dayNames[dayIdx];

        if (selectedYear && selectedYear !== 'ALL' && itemYear !== selectedYear) return false;
        if (selectedMonth && selectedMonth !== 'ALL' && itemMonth !== selectedMonth) return false;
        if (selectedDay && selectedDay !== 'ALL' && itemDayName.toLowerCase() !== selectedDay.toLowerCase()) return false;
      }
    }

    if (selectedCampaign !== 'ALL') {
      const itemCamp = data.campaign || data.campaignName || item.campaignName || '';
      if (itemCamp.toLowerCase() !== selectedCampaign.toLowerCase()) return false;
    }

    if (selectedAgent !== 'ALL') {
      const agentId = item.assignedTo?._id || item.assignedTo;
      const agentName = item.assignedTo?.name || data.telecaller || data.assignedAgent || '';
      if (agentId !== selectedAgent && agentName !== selectedAgent) return false;
    }

    return true;
  });

  // Calculate day of week progression data (Mon-Sun)
  const dayOfWeekCounts: Record<string, { total: number; hot: number; warm: number; converted: number }> = {
    'Monday': { total: 0, hot: 0, warm: 0, converted: 0 },
    'Tuesday': { total: 0, hot: 0, warm: 0, converted: 0 },
    'Wednesday': { total: 0, hot: 0, warm: 0, converted: 0 },
    'Thursday': { total: 0, hot: 0, warm: 0, converted: 0 },
    'Friday': { total: 0, hot: 0, warm: 0, converted: 0 },
    'Saturday': { total: 0, hot: 0, warm: 0, converted: 0 },
    'Sunday': { total: 0, hot: 0, warm: 0, converted: 0 },
  };

  const statusCounts: Record<string, number> = {};

  filteredLeads.forEach(item => {
    const data = item.data || {};
    const status = data.status || 'New';
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const rawDate = item.createdAt || data.createdAt || data.date;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[d.getDay()];
        if (dayOfWeekCounts[dayName]) {
          dayOfWeekCounts[dayName].total += 1;

          const stLower = status.toLowerCase();
          if (stLower === 'hot') dayOfWeekCounts[dayName].hot += 1;
          if (stLower === 'warm') dayOfWeekCounts[dayName].warm += 1;
          if (stLower === 'approved' || stLower === 'disbursed') dayOfWeekCounts[dayName].converted += 1;
        }
      }
    }
  });

  const dailyBarChartData = DAYS_OF_WEEK.map(day => ({
    day,
    Total: dayOfWeekCounts[day].total,
    Hot: dayOfWeekCounts[day].hot,
    Warm: dayOfWeekCounts[day].warm,
    Converted: dayOfWeekCounts[day].converted,
  }));

  const pieChartData = Object.keys(statusCounts).map(st => ({
    name: st,
    value: statusCounts[st]
  }));

  const totalLeadsCount = filteredLeads.length;
  const convertedCount = (statusCounts['Approved'] || 0) + (statusCounts['Disbursed'] || 0);
  const conversionRate = totalLeadsCount > 0 ? Math.round((convertedCount / totalLeadsCount) * 100) : 0;

  // Find Peak Day
  let peakDay = 'Monday';
  let maxCount = -1;
  DAYS_OF_WEEK.forEach(day => {
    if (dayOfWeekCounts[day].total > maxCount) {
      maxCount = dayOfWeekCounts[day].total;
      peakDay = day;
    }
  });

  const handleExportCSV = () => {
    if (filteredLeads.length === 0) {
      showToast('No data to export', 'info');
      return;
    }
    exportLeadReportXLSX(filteredLeads, `Daily_Funnel_${selectedDay}_${selectedMonth}_${selectedYear}`);
    showToast('Exported Daily Funnel report to Excel', 'success');
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-6 text-left">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 flex-shrink-0">
            <Icons.CalendarRange className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/60 px-2.5 py-0.5 rounded-full uppercase tracking-wider font-mono">
                Daily Funnel
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Weekday Lead Velocity Matrix
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              Daily Lead Funnel Analytics
            </h1>
          </div>
        </div>

        <button
          onClick={handleExportCSV}
          className="h-11 px-5 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Icons.Download className="w-4 h-4" />
          Export Excel Report
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 rounded-2xl shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Day of Week */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Icons.Calendar className="w-3.5 h-3.5 text-indigo-500" /> Select Day
          </label>
          <select
            value={selectedDay}
            onChange={(e) => setSelectedDay(e.target.value)}
            className="w-full h-10 px-3.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="ALL">All Days (Mon - Sun)</option>
            {DAYS_OF_WEEK.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Month */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Icons.CalendarDays className="w-3.5 h-3.5 text-purple-500" /> Select Month
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full h-10 px-3.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="ALL">All Months</option>
            {MONTHS.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Year */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Icons.CalendarRange className="w-3.5 h-3.5 text-sky-500" /> Select Year
          </label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="w-full h-10 px-3.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="ALL">All Years</option>
            {YEARS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Campaign */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Icons.Layers className="w-3.5 h-3.5 text-emerald-500" /> Filter Campaign
          </label>
          <select
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            className="w-full h-10 px-3.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="ALL">All Campaigns</option>
            {campaignsList.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Telecaller / Agent */}
        <div>
          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Icons.Users className="w-3.5 h-3.5 text-amber-500" /> Filter Agent
          </label>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="w-full h-10 px-3.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="ALL">All Telecallers</option>
            {agentsList.map(a => (
              <option key={a._id} value={a.name || a.email}>{a.name || a.email}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 4 Vibrant KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Filtered Total Leads</span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
              <Icons.CalendarRange className="w-4.5 h-4.5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white mt-3 font-mono">{totalLeadsCount.toLocaleString()}</h3>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Peak Performance Day</span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
              <Icons.Award className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl font-black text-slate-900 dark:text-white">{peakDay}</span>
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md font-mono">
              {maxCount} Leads
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Converted (Approved)</span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
              <Icons.CheckCircle2 className="w-4.5 h-4.5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-3 font-mono">{convertedCount.toLocaleString()}</h3>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Win Conversion Rate</span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-xs">
              <Icons.TrendingUp className="w-4.5 h-4.5" />
            </div>
          </div>
          <h3 className="text-2xl font-black text-sky-600 dark:text-sky-400 mt-3 font-mono">{conversionRate}%</h3>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Day of Week Bar Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden space-y-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">Day of Week Lead Distribution (Mon - Sun)</h3>
            <span className="text-xs font-bold text-slate-400 font-mono">Volume Velocity</span>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyBarChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748B' }} />
                <YAxis tick={{ fontSize: 11, fontWeight: 700, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0F172A', color: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 700 }} />
                <Bar dataKey="Total" fill="#6366F1" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Hot" fill="#EF4444" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Converted" fill="#10B981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Distribution Pie Chart */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden space-y-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-pink-500" />
          <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight border-b border-slate-100 dark:border-slate-800 pb-3">Lead Status Breakdown</h3>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name] || '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#0F172A', color: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 600 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Daily Lead List Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
        
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">Daily Lead Detailed Records ({filteredLeads.length})</h3>
          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 font-mono">Filtered View</span>
        </div>

        {loading ? (
          <div className="p-14 text-center text-slate-400 font-semibold">Loading daily lead records...</div>
        ) : filteredLeads.length === 0 ? (
          <div className="py-14 text-center text-slate-400 font-semibold">No lead records found for the selected day/filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[850px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider h-11 bg-slate-50/90 dark:bg-slate-800/80">
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Mobile</th>
                  <th className="py-3 px-4">Campaign</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Loan Product</th>
                  <th className="py-3 px-4">Assigned Telecaller</th>
                  <th className="py-3 px-4">Date / Day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-semibold text-slate-700 dark:text-slate-300">
                {filteredLeads.slice(0, 100).map((lead: any, idx: number) => {
                  const data = lead.data || {};
                  const custName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.customerName || data.fullName || 'N/A';
                  const mobile = data.phone || data.mobile || 'N/A';
                  const camp = data.campaign || data.campaignName || lead.campaignName || 'N/A';
                  const status = data.status || 'New';
                  const loan = data.loanProduct || data.loanType || 'Salaried Personal Loan';
                  const agent = lead.assignedToUser ? `${lead.assignedToUser.firstName} ${lead.assignedToUser.lastName}` : (data.assignedTo?.name || data.telecaller || 'Unassigned');

                  const rawDate = lead.createdAt || data.createdAt;
                  const dateStr = rawDate ? new Date(rawDate).toLocaleString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  }) : 'N/A';

                  return (
                    <tr key={lead._id || idx} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors h-14">
                      <td className="py-3 px-4 font-bold text-slate-400 font-mono">{idx + 1}</td>
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-3xs">
                            {custName[0]}
                          </div>
                          <span>{custName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono">{mobile}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold text-[11px]">
                          {camp}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase text-white tracking-wider shadow-3xs"
                          style={{ backgroundColor: STATUS_COLORS[status] || '#64748b' }}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="py-3 px-4">{loan}</td>
                      <td className="py-3 px-4 font-bold">{agent}</td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-[11px] font-mono">{dateStr}</td>
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
