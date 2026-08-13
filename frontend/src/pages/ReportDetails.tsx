import React, { useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { formatDate } from '../utils/dateFormatter';

import { exportLeadReportXLSX } from '../utils/exportLeadReportXLSX';

const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function ReportDetails() {
  const { id } = useParams<{ id: string }>();

  // Fetch report runner data
  const { data, isLoading } = useQuery({
    queryKey: ['report-run', id],
    queryFn: async () => {
      const res = await api.get(`/reports/${id}/run`);
      return res.data;
    },
    enabled: !!id
  });

  const handleExportCSV = () => {
    if (!data?.details || !data?.report) return;
    exportLeadReportXLSX(data.details, data.report.name || 'Report');
  };

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded animate-shimmer"></div>
        <div className="h-64 rounded animate-shimmer animate-shimmer"></div>
      </div>
    );
  }

  const { report, chartData, details } = data;
  const cols = report.columns.length > 0 ? report.columns : ['name', 'status', 'email']; // fallbacks

  return (
    <div className="space-y-6 max-w-6xl mx-auto text-left print:p-0 p-4 sm:p-6">
      
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 flex-shrink-0">
            <Icons.BarChart2 className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Link to="/reports" className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/60 px-2.5 py-0.5 rounded-full uppercase tracking-wider font-mono hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors">
                Reports Hub
              </Link>
              <Icons.ChevronRight className="w-3 h-3 text-slate-400" />
              <span className="text-xs font-semibold text-slate-400">
                Custom Analytics
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              {report.name}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCSV}
            className="h-10 px-4 bg-white hover:bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center gap-2 cursor-pointer"
          >
            <Icons.Download className="w-4 h-4" /> Export Excel
          </button>
          <button
            onClick={handlePrint}
            className="h-10 px-5 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Icons.Printer className="w-4 h-4" /> Print / PDF
          </button>
        </div>
      </div>

      {/* Render Chart (except if type is table) */}
      {report.chartType !== 'table' && chartData && chartData.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-6 rounded-2xl shadow-xs relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
          <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight mb-6 text-left border-b border-slate-100 dark:border-slate-800 pb-3">
            Aggregated Summary Visualization
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              {['bar'].includes(report.chartType) ? (
                <BarChart data={chartData}>
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0F172A', color: '#FFF', borderRadius: '12px', fontSize: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }} />
                  <Bar dataKey="value" fill="#4F46E5" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              ) : ['line'].includes(report.chartType) ? (
                <LineChart data={chartData}>
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0F172A', color: '#FFF', borderRadius: '12px', fontSize: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }} />
                  <Line type="monotone" dataKey="value" stroke="#4F46E5" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              ) : (
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={report.chartType === 'donut' ? 60 : 0}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  >
                    {chartData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#0F172A', color: '#FFF', borderRadius: '12px', fontSize: '12px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }} />
                </PieChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Row detail dataset */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 text-left bg-slate-50/70 dark:bg-slate-800/60">
          <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight">Detail Row Records ({details?.length || 0})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-650 min-w-[700px]">
            <thead className="bg-slate-50/90 dark:bg-slate-800/80 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase border-b border-slate-200 dark:border-slate-700 h-11">
              <tr>
                {cols.map((colName: string) => (
                  <th key={colName} className="px-6 py-3.5">
                    {colName.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}
                  </th>
                ))}
                <th className="px-6 py-3.5">Created Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {details && details.map((row: any) => (
                <tr key={row._id} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors h-14">
                  {cols.map((colName: string) => (
                    <td key={colName} className="px-6 py-3.5 font-bold text-slate-900 dark:text-white truncate max-w-[200px]">
                      {formatDate(row.data[colName]) || '-'}
                    </td>
                  ))}
                  <td className="px-6 py-3.5 text-xs text-slate-400 font-semibold font-mono">
                    {formatDate(row.createdAt)}
                  </td>
                </tr>
              ))}
              {(!details || details.length === 0) && (
                <tr>
                  <td colSpan={cols.length + 1} className="py-14 text-center text-slate-400 font-semibold italic">
                    No matching detail row records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
