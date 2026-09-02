import React, { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';

export default function TelecallerMonthlyPage() {
  const { showToast } = useToastStore();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());

  const monthNamesShort = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthNamesFull = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const years = ['2024', '2025', '2026', '2027'];

  useEffect(() => {
    fetchMonthlyData();
  }, []);

  const fetchMonthlyData = async () => {
    setLoading(true);
    try {
      const [usersRes, leadsRes] = await Promise.all([
        api.get('/auth/users?purpose=dropdown').catch(() => ({ data: [] })),
        api.get('/records/leads?limit=100000').catch(() => ({ data: [] }))
      ]);

      const fetchedUsers = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.users || [];
      const fetchedLeads = Array.isArray(leadsRes.data) ? leadsRes.data : leadsRes.data?.records || [];

      setUsers(fetchedUsers);
      setLeads(fetchedLeads);
    } catch (err) {
      console.error(err);
      showToast('Failed to load telecaller monthly report data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Build list of all active telecallers / agents
  const allAgentsList = React.useMemo(() => {
    const list: { id: string; name: string; role: string; email: string }[] = [];
    const addedNames = new Set<string>();

    users.forEach((u: any) => {
      const name = u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.name || u.username || u.email?.split('@')[0] || 'Agent';
      list.push({ 
        id: u._id || name, 
        name, 
        role: u.role?.name || u.role || 'Telecaller',
        email: u.email || `${name.toLowerCase().replace(/\s+/g, '')}@inkcrm.com`
      });
      addedNames.add(name.toLowerCase());
    });

    leads.forEach((l: any) => {
      const name = l.assignedTo?.name || l.data?.telecaller || l.data?.assignedAgent || l.data?.assignedTo || l.data?.assignedToName;
      if (name && typeof name === 'string' && !addedNames.has(name.toLowerCase())) {
        list.push({ 
          id: name, 
          name, 
          role: 'Telecaller',
          email: `${name.toLowerCase().replace(/\s+/g, '')}@inkcrm.com`
        });
        addedNames.add(name.toLowerCase());
      }
    });

    return list;
  }, [users, leads]);

  // Compute 12-Month Performance Matrix (Caller Name x Jan-Dec Months for Selected Year)
  const monthlyMatrixData = React.useMemo(() => {
    const targetYearNum = parseInt(selectedYear, 10) || new Date().getFullYear();

    // Map: agentId -> Array of 12 month call counts [Jan, Feb, ... Dec]
    const agentMonthlyCounts = new Map<string, number[]>();
    allAgentsList.forEach(agent => {
      agentMonthlyCounts.set(agent.id, new Array(12).fill(0));
    });

    leads.forEach(l => {
      const data = l.data || {};
      const st = String(data.status || data.dialStatus || l.status || '').trim().toLowerCase();
      const notDialed = ['yet to call', 'not called', 'new', ''];
      const isDialed = (st && !notDialed.includes(st)) || Number(data.callAttempts) > 0 || !!data.dialedAt;

      if (!isDialed) return;

      const dateVal = data.dialedAt || data.lastCallDate || l.updatedAt || l.createdAt || data.date || data.created_at;
      if (!dateVal) return;

      const leadDateObj = new Date(dateVal);
      if (isNaN(leadDateObj.getTime())) return;

      if (leadDateObj.getFullYear() !== targetYearNum) return;

      const monthIdx = leadDateObj.getMonth(); // 0 to 11

      const matchedAgent = allAgentsList.find(a => (
        l.assignedTo?._id === a.id ||
        String(l.assignedTo?.name || '').toLowerCase() === a.name.toLowerCase() ||
        String(data.telecaller || '').toLowerCase() === a.name.toLowerCase() ||
        String(data.assignedAgent || '').toLowerCase() === a.name.toLowerCase() ||
        String(data.assignedTo || '').toLowerCase() === a.name.toLowerCase() ||
        String(data.assignedToName || '').toLowerCase() === a.name.toLowerCase() ||
        String(l.assignedToName || '').toLowerCase() === a.name.toLowerCase()
      ));

      if (matchedAgent) {
        const counts = agentMonthlyCounts.get(matchedAgent.id) || new Array(12).fill(0);
        counts[monthIdx] = (counts[monthIdx] || 0) + 1;
        agentMonthlyCounts.set(matchedAgent.id, counts);
      }
    });

    // Construct matrix rows per agent
    const matrixRows = allAgentsList.map(agent => {
      const counts = agentMonthlyCounts.get(agent.id) || new Array(12).fill(0);
      const annualTotal = counts.reduce((a, b) => a + b, 0);
      const avgPerMonth = Math.round(annualTotal / 12);

      return {
        agentId: agent.id,
        callerName: agent.name,
        role: agent.role,
        monthCounts: counts,
        annualTotal,
        avgPerMonth
      };
    });

    // Sort rows by Annual Total descending
    matrixRows.sort((a, b) => b.annualTotal - a.annualTotal || a.callerName.localeCompare(b.callerName));

    // Calculate Column Monthly Totals
    const monthlyTotals = new Array(12).fill(0);
    let grandAnnualTotal = 0;

    matrixRows.forEach(row => {
      row.monthCounts.forEach((cnt, mIdx) => {
        monthlyTotals[mIdx] += cnt;
      });
      grandAnnualTotal += row.annualTotal;
    });

    // Determine Top Performer & Top Month
    const topPerformerRow = matrixRows[0];
    let topMonthIdx = 0;
    let maxMonthCalls = 0;

    monthlyTotals.forEach((cnt, mIdx) => {
      if (cnt > maxMonthCalls) {
        maxMonthCalls = cnt;
        topMonthIdx = mIdx;
      }
    });

    return {
      yearStr: selectedYear,
      matrixRows,
      monthlyTotals,
      grandAnnualTotal,
      overallMonthlyAvg: Math.round(grandAnnualTotal / 12),
      topPerformer: topPerformerRow ? `${topPerformerRow.callerName} (${topPerformerRow.annualTotal} Dials)` : 'N/A',
      topMonthName: maxMonthCalls > 0 ? `${monthNamesFull[topMonthIdx]} (${maxMonthCalls} Dials)` : 'N/A'
    };
  }, [allAgentsList, leads, selectedYear]);

  // Export 12-Month Matrix to Excel
  const export12MonthExcel = async () => {
    const XLSX = await import('xlsx');
    const { yearStr, matrixRows, monthlyTotals, grandAnnualTotal, overallMonthlyAvg } = monthlyMatrixData;
    
    const workbook = XLSX.utils.book_new();

    const headers = ['Caller Name', ...monthNamesShort, 'Annual Total', 'Avg / Month'];
    
    const dataRows = matrixRows.map(row => {
      const rowObj: Record<string, any> = { 'Caller Name': row.callerName };
      monthNamesShort.forEach((m, mIdx) => {
        const cnt = row.monthCounts[mIdx];
        rowObj[m] = cnt > 0 ? cnt : '';
      });
      rowObj['Annual Total'] = row.annualTotal;
      rowObj['Avg / Month'] = row.avgPerMonth;
      return rowObj;
    });

    // Add summary row
    const summaryRow: Record<string, any> = { 'Caller Name': 'TOTAL MONTHLY DIALS' };
    monthNamesShort.forEach((m, mIdx) => {
      summaryRow[m] = monthlyTotals[mIdx];
    });
    summaryRow['Annual Total'] = grandAnnualTotal;
    summaryRow['Avg / Month'] = overallMonthlyAvg;
    dataRows.push(summaryRow);

    const worksheet = XLSX.utils.json_to_sheet(dataRows, { header: headers });
    worksheet['!cols'] = headers.map(h => ({ wch: h === 'Caller Name' ? 26 : 12 }));
    XLSX.utils.book_append_sheet(workbook, worksheet, `Monthly_Matrix_${yearStr}`);

    XLSX.writeFile(workbook, `Telecaller_12Month_Performance_Matrix_${yearStr}.xlsx`);
    showToast(`Exported 12-Month Telecaller Performance Matrix for Year ${yearStr}!`, 'success');
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto text-left px-4 md:px-8 py-4">
      {/* 4 Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Top Performer (Annual) */}
        <div className="bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-yellow-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Top Performer ({selectedYear})
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-500 flex items-center justify-center text-white shadow-xs">
              <Icons.Trophy className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-lg font-black text-slate-900 dark:text-white truncate">
              {monthlyMatrixData.topPerformer}
            </span>
          </div>
        </div>

        {/* Card 2: Total Annual Dials */}
        <div className="bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Total Annual Dials
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
              <Icons.PhoneCall className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {monthlyMatrixData.grandAnnualTotal.toLocaleString()}
            </span>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md font-mono">
              Year {selectedYear}
            </span>
          </div>
        </div>

        {/* Card 3: Top Performing Month */}
        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Top Month
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-xs">
              <Icons.CalendarDays className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-lg font-black text-slate-900 dark:text-white truncate">
              {monthlyMatrixData.topMonthName}
            </span>
          </div>
        </div>

        {/* Card 4: Monthly Average Dials */}
        <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Monthly Avg Dials
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
              <Icons.TrendingUp className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {monthlyMatrixData.overallMonthlyAvg.toLocaleString()}
            </span>
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md font-mono">
              Dials / Month
            </span>
          </div>
        </div>
      </div>

      {/* 12-MONTH MONTH-WISE PERFORMANCE MATRIX TABLE */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600" />
        
        {/* Header Bar */}
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
              <Icons.Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              12-Month Telecaller Call Performance Matrix ({selectedYear})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              12-Month dial breakdown matrix from January to December {selectedYear}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Select Year Dropdown */}
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl">
              <span className="text-xs font-bold uppercase text-slate-500">Year:</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="bg-transparent text-xs font-black text-slate-900 dark:text-white focus:outline-none cursor-pointer font-mono"
              >
                {years.map(y => (
                  <option key={y} value={y} className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                    {y}
                  </option>
                ))}
              </select>
            </div>

            {/* Export Button */}
            <button
              onClick={export12MonthExcel}
              className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Icons.FileSpreadsheet className="w-4 h-4" />
              <span>Export Monthly Excel</span>
            </button>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-16 text-center text-xs text-slate-400 font-semibold flex items-center justify-center gap-2">
            <Icons.Loader className="w-5 h-5 animate-spin text-indigo-600" />
            <span>Loading 12-Month Performance Matrix...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-[#000080] text-white text-[11px] font-black uppercase tracking-wider h-11">
                  <th className="py-3 px-4 sticky left-0 z-10 bg-[#000080] border-r border-indigo-900 min-w-[200px] shadow-sm">
                    Caller Name
                  </th>
                  {monthNamesShort.map((m, idx) => (
                    <th key={m} className="py-3 px-3 text-center border-r border-indigo-900 min-w-[70px] whitespace-nowrap font-mono">
                      {m}
                    </th>
                  ))}
                  <th className="py-3 px-4 text-center bg-indigo-950 min-w-[110px] whitespace-nowrap border-r border-indigo-900">
                    Annual Total
                  </th>
                  <th className="py-3 px-4 text-center bg-indigo-950 min-w-[100px] whitespace-nowrap">
                    Avg / Mo
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {monthlyMatrixData.matrixRows.map((row, idx) => (
                  <tr 
                    key={row.agentId || idx} 
                    className={`${idx % 2 === 0 ? 'bg-slate-50/70 dark:bg-slate-900/60' : 'bg-white dark:bg-slate-900'} hover:bg-indigo-50/50 dark:hover:bg-slate-800/60 transition-colors h-12`}
                  >
                    {/* Caller Name Column */}
                    <td className={`py-3 px-4 font-bold text-slate-900 dark:text-slate-100 sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 shadow-sm ${idx % 2 === 0 ? 'bg-slate-100/90 dark:bg-slate-850' : 'bg-slate-50 dark:bg-slate-900'}`}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-[11px] uppercase flex-shrink-0">
                          {row.callerName.substring(0, 2)}
                        </div>
                        <span className="capitalize block truncate max-w-[160px]" title={row.callerName}>
                          {row.callerName}
                        </span>
                      </div>
                    </td>

                    {/* 12 Months Columns */}
                    {row.monthCounts.map((cnt, mIdx) => (
                      <td 
                        key={mIdx} 
                        className="py-3 px-3 text-center border-r border-slate-200/60 dark:border-slate-800/60 font-mono text-xs"
                      >
                        {cnt > 0 ? (
                          <span className="font-extrabold text-slate-900 dark:text-slate-100 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800/60">
                            {cnt}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-700">-</span>
                        )}
                      </td>
                    ))}

                    {/* Annual Total Column */}
                    <td className="py-3 px-4 text-center font-mono font-black text-indigo-700 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/40 border-r border-slate-200 dark:border-slate-800 text-xs">
                      {row.annualTotal > 0 ? (
                        <span className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white shadow-3xs">
                          {row.annualTotal}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal">0</span>
                      )}
                    </td>

                    {/* Avg / Month Column */}
                    <td className="py-3 px-4 text-center font-mono font-bold text-teal-700 dark:text-teal-400 bg-teal-50/40 dark:bg-teal-950/30 text-xs">
                      {row.avgPerMonth}
                    </td>
                  </tr>
                ))}

                {monthlyMatrixData.matrixRows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="py-14 text-center text-slate-400">
                      No telecaller performance records found for Year {selectedYear}.
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Bottom Grand Summary Row */}
              {monthlyMatrixData.matrixRows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 dark:bg-slate-800 font-black text-slate-900 dark:text-white border-t-2 border-slate-300 dark:border-slate-700 h-12">
                    <td className="py-3 px-4 sticky left-0 z-10 bg-slate-200 dark:bg-slate-750 border-r border-slate-300 dark:border-slate-700 uppercase tracking-wider font-extrabold text-[11px]">
                      TOTAL MONTHLY DIALS
                    </td>

                    {monthlyMatrixData.monthlyTotals.map((tot, mIdx) => (
                      <td key={mIdx} className="py-3 px-3 text-center border-r border-slate-300 dark:border-slate-700 font-mono text-xs font-black text-indigo-700 dark:text-indigo-300">
                        {tot > 0 ? tot : 0}
                      </td>
                    ))}

                    <td className="py-3 px-4 text-center font-mono font-black text-white bg-indigo-700 border-r border-indigo-800 text-sm">
                      {monthlyMatrixData.grandAnnualTotal}
                    </td>

                    <td className="py-3 px-4 text-center font-mono font-black text-white bg-teal-700 text-xs">
                      {monthlyMatrixData.overallMonthlyAvg}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
