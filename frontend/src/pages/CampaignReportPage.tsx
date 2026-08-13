import React, { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

interface CampaignStat {
  campaignName: string;
  totalAssigned: number;
  dialed: number;
  yetToDial: number;
  createdAt: string;
  hotCount: number;
  convertedCount: number;
  progressPct: number;
}

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#0EA5E9', '#EC4899'];

export default function CampaignReportPage() {
  const { showToast } = useToastStore();
  const [loading, setLoading] = useState(true);
  const [campaignStats, setCampaignStats] = useState<CampaignStat[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('ALL');
  const [allLeads, setAllLeads] = useState<any[]>([]);

  useEffect(() => {
    fetchCampaignReportData();
  }, []);

  const fetchCampaignReportData = async () => {
    setLoading(true);
    try {
      const [leadsRes, campRes] = await Promise.all([
        api.get('/records/leads?limit=1000').catch(() => ({ data: { records: [] } })),
        api.get('/records/campaigns?limit=1000').catch(() => ({ data: { records: [] } }))
      ]);

      const leadsList = leadsRes.data?.records || leadsRes.data || [];
      const campaignsList = campRes.data?.records || [];
      setAllLeads(leadsList);

      // Group leads by campaign name
      const campaignMap: Record<string, { total: number; dialed: number; yetToDial: number; createdAt: string; hot: number; converted: number }> = {};

      // Seed from campaigns master if available
      campaignsList.forEach((c: any) => {
        const name = c.data?.campaignName || c.name || 'Default Campaign';
        campaignMap[name] = {
          total: 0,
          dialed: 0,
          yetToDial: 0,
          createdAt: c.createdAt || new Date().toISOString(),
          hot: 0,
          converted: 0
        };
      });

      // Aggregate lead records
      leadsList.forEach((lead: any) => {
        const cName = lead.data?.campaign || lead.data?.campaignName || lead.campaignName || 'General Drive';
        if (!campaignMap[cName]) {
          campaignMap[cName] = {
            total: 0,
            dialed: 0,
            yetToDial: 0,
            createdAt: lead.createdAt || new Date().toISOString(),
            hot: 0,
            converted: 0
          };
        }

        campaignMap[cName].total += 1;
        const status = (lead.data?.status || lead.status || '').toLowerCase();
        
        if (status && !['new', 'yet to call', 'unassigned', ''].includes(status)) {
          campaignMap[cName].dialed += 1;
        } else {
          campaignMap[cName].yetToDial += 1;
        }

        if (status.includes('hot') || status.includes('warm')) {
          campaignMap[cName].hot += 1;
        }

        if (status.includes('approved') || status.includes('disbursed')) {
          campaignMap[cName].converted += 1;
        }
      });

      const statsArray: CampaignStat[] = Object.entries(campaignMap).map(([name, data]) => {
        const progressPct = data.total > 0 ? Math.round((data.dialed / data.total) * 100) : 0;
        return {
          campaignName: name,
          totalAssigned: data.total,
          dialed: data.dialed,
          yetToDial: data.yetToDial,
          createdAt: data.createdAt,
          hotCount: data.hot,
          convertedCount: data.converted,
          progressPct
        };
      });

      setCampaignStats(statsArray);
    } catch (err) {
      console.error(err);
      showToast('Failed to load campaign report data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredStats = selectedCampaign === 'ALL'
    ? campaignStats
    : campaignStats.filter(c => c.campaignName.toLowerCase() === selectedCampaign.toLowerCase());

  const totalAssignedLeads = filteredStats.reduce((sum, c) => sum + c.totalAssigned, 0);
  const totalDialedLeads = filteredStats.reduce((sum, c) => sum + c.dialed, 0);
  const totalYetToDialLeads = filteredStats.reduce((sum, c) => sum + c.yetToDial, 0);
  const totalConvertedLeads = filteredStats.reduce((sum, c) => sum + c.convertedCount, 0);
  const overallProgressPct = totalAssignedLeads > 0 ? Math.round((totalDialedLeads / totalAssignedLeads) * 100) : 0;

  // Bar chart data for campaign progress comparison
  const barChartData = filteredStats.map(c => ({
    name: c.campaignName.length > 15 ? c.campaignName.substring(0, 15) + '...' : c.campaignName,
    Dialed: c.dialed,
    'Yet to Dial': c.yetToDial,
    Converted: c.convertedCount
  }));

  // Export CSV
  const handleExportCSV = () => {
    if (filteredStats.length === 0) return;
    const headers = ['Campaign Name', 'Total Leads', 'Dialed', 'Yet to Dial', 'Progress %', 'Hot/Warm Leads', 'Converted'];
    const rows = filteredStats.map(c => [
      c.campaignName,
      c.totalAssigned,
      c.dialed,
      c.yetToDial,
      `${c.progressPct}%`,
      c.hotCount,
      c.convertedCount
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Campaign_Analytics_Report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Exported campaign analytics report to CSV', 'success');
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-6 text-left">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 flex-shrink-0">
            <Icons.Megaphone className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/60 px-2.5 py-0.5 rounded-full uppercase tracking-wider font-mono">
                Reports & Analytics
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Campaign Performance Matrix
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              My Campaign Report
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button 
            onClick={fetchCampaignReportData}
            className="h-10 px-4 bg-white hover:bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center gap-2 cursor-pointer"
          >
            <Icons.RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button 
            onClick={handleExportCSV}
            className="h-10 px-5 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Icons.Download className="w-3.5 h-3.5" /> Export Report CSV
          </button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 rounded-2xl shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full max-w-md">
          <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center gap-1.5">
            <Icons.Layers className="w-3.5 h-3.5 text-indigo-500" />
            Filter Campaign:
          </label>
          <select
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            className="w-full h-10 px-3.5 text-xs font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-all cursor-pointer"
          >
            <option value="ALL">All Active Campaigns ({campaignStats.length})</option>
            {campaignStats.map(c => (
              <option key={c.campaignName} value={c.campaignName}>{c.campaignName}</option>
            ))}
          </select>
        </div>

        <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
          Showing <span className="text-indigo-600 dark:text-indigo-400 font-mono font-black">{filteredStats.length}</span> of {campaignStats.length} Campaigns
        </div>
      </div>

      {/* 4 Vibrant Analytics KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Leads */}
        <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Total Assigned Leads
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
              <Icons.Target className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {totalAssignedLeads}
            </span>
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md font-mono">
              {filteredStats.length} Campaigns
            </span>
          </div>
        </div>

        {/* Card 2: Dialed Calls */}
        <div className="bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Dialed Calls
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
              <Icons.PhoneCall className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
              {totalDialedLeads}
            </span>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md font-mono">
              {overallProgressPct}% Dialed
            </span>
          </div>
        </div>

        {/* Card 3: Yet To Dial */}
        <div className="bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Yet To Dial
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
              <Icons.Clock className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
              {totalYetToDialLeads}
            </span>
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md font-mono">
              Pending
            </span>
          </div>
        </div>

        {/* Card 4: Conversions */}
        <div className="bg-white dark:bg-slate-900 border border-purple-100 dark:border-slate-800 p-5 rounded-2xl shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-pink-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Disbursed / Hot Deals
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-600 flex items-center justify-center text-white shadow-xs">
              <Icons.Award className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-purple-600 dark:text-purple-400 font-mono">
              {totalConvertedLeads}
            </span>
            <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/50 px-2 py-0.5 rounded-md font-mono">
              High Intent
            </span>
          </div>
        </div>
      </div>

      {/* Visual Chart Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex items-center justify-between mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
              Campaign Calling & Conversion Throughput Chart
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
              Dialed vs Yet-To-Dial leads across active campaigns
            </p>
          </div>
          <span className="px-3 py-1 text-xs font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/60 rounded-full font-mono">
            {barChartData.length} Campaigns
          </span>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barChartData} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748B' }} />
              <YAxis tick={{ fontSize: 10, fontWeight: 700, fill: '#64748B' }} />
              <Tooltip contentStyle={{ backgroundColor: '#0F172A', color: '#FFF', borderRadius: '12px', fontSize: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
              <Bar dataKey="Dialed" fill="#10B981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Yet to Dial" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Converted" fill="#6366F1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Campaign Performance Summary Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
        
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
            Campaign Performance Report Matrix
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Full metrics breakdown across all campaign datasets
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse min-w-[850px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider h-11 bg-slate-50/90 dark:bg-slate-800/80">
                <th className="py-3.5 px-6">Campaign Name</th>
                <th className="py-3.5 px-6 text-center">Total Assigned Leads</th>
                <th className="py-3.5 px-6 text-center">Dialed Leads</th>
                <th className="py-3.5 px-6 text-center">Yet to Dial</th>
                <th className="py-3.5 px-6 text-center">Dialing Progress</th>
                <th className="py-3.5 px-6 text-center">Hot / Warm Leads</th>
                <th className="py-3.5 px-6 text-center">Converted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {filteredStats.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-500/20">
                      <Icons.Megaphone className="w-6 h-6" />
                    </div>
                    <p className="font-extrabold text-sm text-slate-800 dark:text-slate-200">No active campaign records</p>
                  </td>
                </tr>
              ) : (
                filteredStats.map((row) => (
                  <tr key={row.campaignName} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors h-14">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-3xs">
                          {row.campaignName[0]}
                        </div>
                        <span className="font-bold text-slate-900 dark:text-white uppercase">
                          {row.campaignName}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 min-w-[3rem] shadow-3xs">
                        {row.totalAssigned}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 min-w-[3rem] shadow-3xs">
                        {row.dialed}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 min-w-[3rem] shadow-3xs">
                        {row.yetToDial}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-20 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
                          <div 
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" 
                            style={{ width: `${Math.max(row.progressPct, 5)}%` }} 
                          />
                        </div>
                        <span className="text-[10px] font-bold font-mono text-slate-600 dark:text-slate-400">{row.progressPct}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 min-w-[2.5rem] shadow-3xs">
                        {row.hotCount}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 min-w-[2.5rem] shadow-3xs">
                        {row.convertedCount}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
