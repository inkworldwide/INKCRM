import React, { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import MultiSelectDropdown from '../components/MultiSelectDropdown';

export default function TelecallerReportsPage() {
  const { showToast } = useToastStore();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [campaignsList, setCampaignsList] = useState<string[]>([]);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const years = ['2024', '2025', '2026', '2027'];

  // Month & Year Filter State (Defaulting to current Month & Year)
  const currentMonthName = months[new Date().getMonth()];
  const currentYearStr = new Date().getFullYear().toString();

  const [selectedMonths, setSelectedMonths] = useState<string[]>([currentMonthName]);
  const [selectedYears, setSelectedYears] = useState<string[]>([currentYearStr]);

  // Multi-Select Filters
  const [selectedRoleTypes, setSelectedRoleTypes] = useState<string[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);

  const roleTypes = ['Super Admin', 'Admin', 'Sales Manager', 'Telecaller', 'Sales Representative'];

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [usersRes, leadsRes, campRes] = await Promise.all([
        api.get('/auth/users').catch(() => ({ data: [] })),
        api.get('/records/leads?limit=10000').catch(() => ({ data: [] })),
        api.get('/records/campaigns?limit=1000').catch(() => ({ data: [] }))
      ]);

      const fetchedUsers = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.users || [];
      const fetchedLeads = Array.isArray(leadsRes.data) ? leadsRes.data : leadsRes.data?.records || [];
      const fetchedCampaigns = (campRes.data?.records || []).map((c: any) => c.data?.campaignName || c.name).filter(Boolean);
      const leadCampaigns = fetchedLeads.map((l: any) => l.data?.campaign || l.data?.campaignName || l.campaignName).filter(Boolean);

      setUsers(fetchedUsers);
      setLeads(fetchedLeads);
      setCampaignsList(Array.from(new Set([...fetchedCampaigns, ...leadCampaigns])));
    } catch (err) {
      console.error(err);
      showToast('Failed to load telecaller report data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterClick = () => {
    fetchInitialData();
    showToast('Updated report with selected month and year filters.', 'info');
  };

  // Build agent list from users DB & lead assigned records
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
      const name = l.assignedTo?.name || l.data?.telecaller || l.data?.assignedAgent || l.data?.assignedTo;
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

  // Build live date-wise telecaller performance list (Grouped by exact Date + Agent)
  const liveAgentReports = React.useMemo(() => {
    const rows: {
      _id: string;
      rawDate: string;
      dateStr: string;
      agentId: string;
      name: string;
      email: string;
      role: string;
      assigned: number;
      connected: number;
      followups: number;
      hotLeads: number;
      yetToCall: number;
      convRate: number;
    }[] = [];

    const filteredAgents = allAgentsList.filter(agent => {
      if (selectedRoleTypes.length > 0 && !selectedRoleTypes.includes(agent.role)) return false;
      if (selectedAgents.length > 0 && !selectedAgents.includes(agent.name)) return false;
      return true;
    });

    // Group map key: `YYYY-MM-DD__agentId`
    const groupMap = new Map<string, { dateStr: string; agent: typeof filteredAgents[0]; leads: any[] }>();

    leads.forEach(l => {
      const data = l.data || {};
      // Campaign filter
      const leadCamp = (data.campaign || data.campaignName || l.campaignName || '').trim();
      const campMatch = selectedCampaigns.length === 0 || selectedCampaigns.some(c => c.toLowerCase() === leadCamp.toLowerCase() || leadCamp.toLowerCase().includes(c.toLowerCase()));
      if (!campMatch) return;

      // Extract date for the lead
      const dateVal = data.dialedAt || data.lastCallDate || l.updatedAt || l.createdAt || data.date || data.created_at;
      if (!dateVal) return;

      const leadDateObj = new Date(dateVal);
      if (isNaN(leadDateObj.getTime())) return;

      const leadMonthName = months[leadDateObj.getMonth()];
      const leadYearStr = leadDateObj.getFullYear().toString();

      // Filter by Selected Month & Year
      if (selectedMonths.length > 0 && !selectedMonths.includes(leadMonthName)) return;
      if (selectedYears.length > 0 && !selectedYears.includes(leadYearStr)) return;

      const leadDateISO = leadDateObj.toISOString().slice(0, 10);

      // Find matching agent
      const matchedAgent = filteredAgents.find(agent => (
        l.assignedTo?._id === agent.id || 
        (l.assignedTo?.name || '').toLowerCase() === agent.name.toLowerCase() ||
        (data.telecaller || '').toLowerCase() === agent.name.toLowerCase() ||
        (data.assignedAgent || '').toLowerCase() === agent.name.toLowerCase() ||
        (data.assignedTo || '').toLowerCase() === agent.name.toLowerCase()
      ));

      if (matchedAgent) {
        const key = `${leadDateISO}__${matchedAgent.id}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, { dateStr: leadDateISO, agent: matchedAgent, leads: [] });
        }
        groupMap.get(key)!.leads.push(l);
      }
    });

    // Transform grouped map into daily performance rows
    groupMap.forEach((val, key) => {
      const { dateStr, agent, leads: agentLeads } = val;

      const formattedDate = new Date(dateStr).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }); // e.g. "27/08/2026"

      const assignedCount = agentLeads.length;

      const connectedCount = agentLeads.filter(l => {
        const data = l.data || {};
        const st = String(data.status || data.dialStatus || l.status || '').trim().toLowerCase();
        const notDialed = ['yet to call', 'not called', 'new', ''];
        const isDialedStatus = st && !notDialed.includes(st);
        const hasCallAttempt = Number(data.callAttempts) > 0 || !!data.dialedAt;
        return isDialedStatus || hasCallAttempt;
      }).length;

      const followupCount = agentLeads.filter(l => {
        const data = l.data || {};
        const st = String(data.status || data.dialStatus || l.status || '').trim().toLowerCase();
        return st.includes('followup') || st.includes('cal back') || st.includes('warm') || st.includes('pending');
      }).length;

      const hotCount = agentLeads.filter(l => {
        const data = l.data || {};
        const st = String(data.status || data.dialStatus || l.status || '').trim().toLowerCase();
        return st.includes('hot');
      }).length;

      const yetToCallCount = agentLeads.filter(l => {
        const data = l.data || {};
        const st = String(data.status || data.dialStatus || l.status || '').trim().toLowerCase();
        return !st || st === 'yet to call' || st === 'not called' || st === 'new';
      }).length;

      const convRate = assignedCount > 0 ? Math.round((connectedCount / assignedCount) * 100) : 0;

      rows.push({
        _id: key,
        rawDate: dateStr,
        dateStr: formattedDate,
        agentId: agent.id,
        name: agent.name,
        email: agent.email,
        role: agent.role,
        assigned: assignedCount,
        connected: connectedCount,
        followups: followupCount,
        hotLeads: hotCount,
        yetToCall: yetToCallCount,
        convRate
      });
    });

    // Sort by Date (newest date first), then by Agent Name
    rows.sort((a, b) => b.rawDate.localeCompare(a.rawDate) || a.name.localeCompare(b.name));

    // Fallback: If no lead records exist yet, render default agent rows with today's date
    if (rows.length === 0) {
      const todayFormatted = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      filteredAgents.forEach(agent => {
        rows.push({
          _id: agent.id,
          rawDate: new Date().toISOString().slice(0, 10),
          dateStr: todayFormatted,
          agentId: agent.id,
          name: agent.name,
          email: agent.email,
          role: agent.role,
          assigned: 0,
          connected: 0,
          followups: 0,
          hotLeads: 0,
          yetToCall: 0,
          convRate: 0
        });
      });
    }

    return rows;
  }, [allAgentsList, leads, selectedMonths, selectedYears]);

  // Date-wise & Day-of-Week Monthly Telecaller Matrix
  const dateWiseMatrix = React.useMemo(() => {
    const targetMonthName = selectedMonths[0] || months[new Date().getMonth()];
    const targetYearStr = selectedYears[0] || new Date().getFullYear().toString();
    const monthIndex = months.findIndex(m => m.toLowerCase() === targetMonthName.toLowerCase());
    const yearNum = parseInt(targetYearStr, 10);

    const safeMonth = monthIndex >= 0 ? monthIndex : new Date().getMonth();
    const safeYear = !isNaN(yearNum) ? yearNum : new Date().getFullYear();

    const daysInMonth = new Date(safeYear, safeMonth + 1, 0).getDate();

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const daysOfWeekShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const dateHeaders: { key: string; label: string; dayNum: number; dayName: string; dayNameShort: string }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = String(d).padStart(2, '0');
      const monthStr = String(safeMonth + 1).padStart(2, '0');
      const isoKey = `${safeYear}-${monthStr}-${dayStr}`;
      
      const dateObj = new Date(safeYear, safeMonth, d);
      const dayIdx = dateObj.getDay();
      const dayName = daysOfWeek[dayIdx];
      const dayNameShort = daysOfWeekShort[dayIdx];

      // Header label includes date + day of week name e.g. "01-07-2026 (Wed)"
      const headerLabel = `${dayStr}-${monthStr}-${safeYear} (${dayNameShort})`;

      dateHeaders.push({ key: isoKey, label: headerLabel, dayNum: d, dayName, dayNameShort });
    }

    const agentCallCounts = new Map<string, Map<string, number>>();
    allAgentsList.forEach(agent => {
      agentCallCounts.set(agent.id, new Map<string, number>());
    });

    leads.forEach(l => {
      const data = l.data || {};
      const st = String(data.status || data.dialStatus || l.status || '').trim().toLowerCase();
      const notDialed = ['yet to call', 'not called', 'new', ''];
      const isDialed = (st && !notDialed.includes(st)) || Number(data.callAttempts) > 0 || !!data.dialedAt;

      if (!isDialed) return;

      const dateVal = data.dialedAt || data.lastCallDate || l.updatedAt || l.createdAt;
      if (!dateVal) return;

      const leadDate = new Date(dateVal);
      if (isNaN(leadDate.getTime())) return;

      if (leadDate.getMonth() !== safeMonth || leadDate.getFullYear() !== safeYear) return;

      const isoKey = leadDate.toISOString().slice(0, 10);

      const agent = allAgentsList.find(a => (
        l.assignedTo?._id === a.id ||
        String(l.assignedTo?.name || '').toLowerCase() === a.name.toLowerCase() ||
        String(data.telecaller || '').toLowerCase() === a.name.toLowerCase() ||
        String(data.assignedAgent || '').toLowerCase() === a.name.toLowerCase() ||
        String(data.assignedTo || '').toLowerCase() === a.name.toLowerCase() ||
        String(l.assignedToName || '').toLowerCase() === a.name.toLowerCase()
      ));

      if (agent) {
        const countsMap = agentCallCounts.get(agent.id) || new Map<string, number>();
        countsMap.set(isoKey, (countsMap.get(isoKey) || 0) + 1);
        agentCallCounts.set(agent.id, countsMap);
      }
    });

    // 1. Daily Date Rows
    const matrixRows = allAgentsList.map(agent => {
      const countsMap = agentCallCounts.get(agent.id) || new Map<string, number>();
      let totalCalls = 0;
      const dailyCounts: Record<string, number> = {};

      dateHeaders.forEach(dh => {
        const cnt = countsMap.get(dh.key) || 0;
        dailyCounts[dh.label] = cnt;
        totalCalls += cnt;
      });

      return {
        agentId: agent.id,
        callerName: agent.name,
        dailyCounts,
        totalCalls
      };
    });

    // 2. Day of Week Summary Rows (Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday)
    const dowMatrixRows = allAgentsList.map(agent => {
      const countsMap = agentCallCounts.get(agent.id) || new Map<string, number>();
      const dowCounts: Record<string, number> = {
        'Sunday': 0,
        'Monday': 0,
        'Tuesday': 0,
        'Wednesday': 0,
        'Thursday': 0,
        'Friday': 0,
        'Saturday': 0
      };
      let totalCalls = 0;

      dateHeaders.forEach(dh => {
        const cnt = countsMap.get(dh.key) || 0;
        dowCounts[dh.dayName] = (dowCounts[dh.dayName] || 0) + cnt;
        totalCalls += cnt;
      });

      return {
        agentId: agent.id,
        callerName: agent.name,
        dowCounts,
        totalCalls
      };
    });

    return {
      monthName: targetMonthName,
      yearStr: targetYearStr,
      dateHeaders,
      matrixRows,
      dowMatrixRows
    };
  }, [allAgentsList, leads, selectedMonths, selectedYears]);

  const agentNamesList = allAgentsList.map(u => u.name);

  const exportCSV = () => {
    const { monthName, yearStr, dateHeaders, matrixRows, dowMatrixRows } = dateWiseMatrix;
    
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Daily Date-Wise Matrix (Caller Name | 01-07-2026 (Wed) | ... | Total Calls)
    const headers1 = ['Caller Name', ...dateHeaders.map(dh => dh.label), 'Total Calls'];
    const dataRows1 = matrixRows.map(row => {
      const rowObj: Record<string, any> = { 'Caller Name': row.callerName };
      dateHeaders.forEach(dh => {
        const cnt = row.dailyCounts[dh.label];
        rowObj[dh.label] = cnt > 0 ? cnt : '';
      });
      rowObj['Total Calls'] = row.totalCalls;
      return rowObj;
    });

    const worksheet1 = XLSX.utils.json_to_sheet(dataRows1, { header: headers1 });
    worksheet1['!cols'] = headers1.map(h => ({ wch: h === 'Caller Name' ? 26 : h === 'Total Calls' ? 14 : 16 }));
    XLSX.utils.book_append_sheet(workbook, worksheet1, 'Daily_Date_Matrix');

    // Sheet 2: Day of Week Summary Matrix (Caller Name | Sunday | Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Total Calls)
    const headers2 = ['Caller Name', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Total Calls'];
    const dataRows2 = dowMatrixRows.map(row => {
      const rowObj: Record<string, any> = { 'Caller Name': row.callerName };
      ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].forEach(day => {
        const cnt = row.dowCounts[day];
        rowObj[day] = cnt > 0 ? cnt : '';
      });
      rowObj['Total Calls'] = row.totalCalls;
      return rowObj;
    });

    const worksheet2 = XLSX.utils.json_to_sheet(dataRows2, { header: headers2 });
    worksheet2['!cols'] = headers2.map(h => ({ wch: h === 'Caller Name' ? 26 : 14 }));
    XLSX.utils.book_append_sheet(workbook, worksheet2, 'Day_of_Week_Summary');

    XLSX.writeFile(workbook, `Telecaller_Reports_DayWise_${monthName}_${yearStr}.xlsx`);
    showToast(`Exported Day-wise telecaller report for ${monthName} ${yearStr}!`, 'success');
  };

  const displayAgents = liveAgentReports;

  const totalAssigned = displayAgents.reduce((sum, ag) => sum + ag.assigned, 0);
  const totalConnected = displayAgents.reduce((sum, ag) => sum + ag.connected, 0);
  const totalFollowups = displayAgents.reduce((sum, ag) => sum + ag.followups, 0);
  const avgConnectionRate = totalAssigned > 0 ? Math.round((totalConnected / totalAssigned) * 100) : 0;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto text-left px-4 md:px-8 py-4">
      {/* 4 Vibrant Metric Hero Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Agents */}
        <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Active Telecallers
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
              <Icons.Users className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {displayAgents.length}
            </span>
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md font-mono">
              Filtered Agents
            </span>
          </div>
        </div>

        {/* Card 2: Calls Connected */}
        <div className="bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Calls Connected
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
              <Icons.PhoneCall className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {totalConnected}
            </span>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md font-mono">
              {avgConnectionRate}% Connected
            </span>
          </div>
        </div>

        {/* Card 3: Total Assigned */}
        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Assigned Leads
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-xs">
              <Icons.ListOrdered className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {totalAssigned}
            </span>
            <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded-md font-mono">
              Lead Pool
            </span>
          </div>
        </div>

        {/* Card 4: Scheduled Followups */}
        <div className="bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Followups Set
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
              <Icons.CalendarClock className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {totalFollowups}
            </span>
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md font-mono">
              Scheduled
            </span>
          </div>
        </div>
      </div>

      {/* FILTER CONTROL CARD WITH DATE-WISE PARAMETERS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-visible z-20 space-y-5">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Icons.SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Telecaller Performance Filter Parameters
              </h3>
              <p className="text-[11px] text-slate-500">Filter metrics by campaign and agent parameters</p>
            </div>
          </div>

          <button
            onClick={exportCSV}
            className="h-9 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center justify-center gap-2"
          >
            <Icons.Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>

        {/* SELECT MONTH & SELECT YEAR FILTERS ONLY */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>

        {/* Apply Action */}
        <div className="flex justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={handleFilterClick}
            className="h-10 px-6 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Icons.CheckCircle className="w-4 h-4" />
            Apply Report Filter
          </button>
        </div>
      </div>

      {/* TELECALLER PERFORMANCE TABLE */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
        
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
              Telecaller Productivity & Conversion Ledger
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live date-wise statistics from database ({displayAgents.length} active telecallers)
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-14 text-center text-xs text-slate-400">Loading live user data...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[950px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider h-11 bg-slate-50/90 dark:bg-slate-800/80">
                  <th className="py-3.5 px-6">Date</th>
                  <th className="py-3.5 px-6">Agent Name</th>
                  <th className="py-3.5 px-6">Role Type</th>
                  <th className="py-3.5 px-6 text-center">Assigned Leads</th>
                  <th className="py-3.5 px-6 text-center">Calls Connected</th>
                  <th className="py-3.5 px-6 text-center">Followups Scheduled</th>
                  <th className="py-3.5 px-6 text-center">Hot Leads</th>
                  <th className="py-3.5 px-6 text-center">Yet To Call</th>
                  <th className="py-3.5 px-6 text-center">Efficiency Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {displayAgents.map((ag) => (
                  <tr key={ag._id} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors h-14">
                    <td className="py-3.5 px-6 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-200/60 dark:border-indigo-900/50">
                        <Icons.Calendar className="w-3.5 h-3.5 text-indigo-500" />
                        {ag.dateStr}
                      </span>
                    </td>

                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-3xs">
                          {ag.name.substring(0, 2)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white">{ag.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{ag.email}</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-6">
                      <span className="px-2.5 py-1 rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-[10px] font-bold uppercase tracking-wider border border-purple-200/80 dark:border-purple-800/50">
                        {ag.role}
                      </span>
                    </td>

                    <td className="py-3.5 px-6 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 min-w-[3rem] shadow-3xs">
                        {ag.assigned}
                      </span>
                    </td>

                    <td className="py-3.5 px-6 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 min-w-[3rem] shadow-3xs">
                        {ag.connected}
                      </span>
                    </td>

                    <td className="py-3.5 px-6 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 min-w-[3rem] shadow-3xs">
                        {ag.followups}
                      </span>
                    </td>

                    <td className="py-3.5 px-6 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 min-w-[3rem] shadow-3xs">
                        {ag.hotLeads}
                      </span>
                    </td>

                    <td className="py-3.5 px-6 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 min-w-[3rem] shadow-3xs">
                        {ag.yetToCall}
                      </span>
                    </td>

                    <td className="py-3.5 px-6 text-center">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 min-w-[3rem] shadow-3xs">
                        {ag.convRate}%
                      </span>
                    </td>
                  </tr>
                ))}

                {displayAgents.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      No telecaller records found matching the selected date range and parameters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DATE-WISE TELECALLER CALL MATRIX TABLE (Matching Image 1 Exact Layout) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600" />
        
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
              <Icons.CalendarDays className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Date-Wise Telecaller Call Performance Matrix ({dateWiseMatrix.monthName} {dateWiseMatrix.yearStr})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Daily dial breakdown matrix from Day 1 to Day {dateWiseMatrix.dateHeaders.length}
            </p>
          </div>

          <button
            onClick={exportCSV}
            className="h-9 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            <Icons.FileSpreadsheet className="w-4 h-4" />
            Export Date-Wise Excel
          </button>
        </div>

        {loading ? (
          <div className="p-14 text-center text-xs text-slate-400">Loading daily call matrix...</div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs border-collapse min-w-[1200px]">
              <thead>
                <tr className="bg-[#000080] text-white text-[11px] font-black uppercase tracking-wider h-11">
                  <th className="py-3 px-4 sticky left-0 z-10 bg-[#000080] border-r border-indigo-900 min-w-[200px] shadow-sm">
                    Caller Name
                  </th>
                  {dateWiseMatrix.dateHeaders.map(dh => (
                    <th key={dh.key} className="py-3 px-3 text-center border-r border-indigo-900 min-w-[90px] whitespace-nowrap font-mono">
                      {dh.label}
                    </th>
                  ))}
                  <th className="py-3 px-4 text-center bg-indigo-950 min-w-[100px] whitespace-nowrap">
                    Total Calls
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {dateWiseMatrix.matrixRows.map((row, idx) => (
                  <tr 
                    key={row.agentId || idx} 
                    className={`${idx % 2 === 0 ? 'bg-slate-50/70 dark:bg-slate-900/60' : 'bg-white dark:bg-slate-900'} hover:bg-indigo-50/50 dark:hover:bg-slate-800/60 transition-colors h-11`}
                  >
                    {/* Sticky Caller Name Column */}
                    <td className={`py-2.5 px-4 font-bold text-slate-900 dark:text-slate-100 sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 shadow-sm ${idx % 2 === 0 ? 'bg-slate-100/90 dark:bg-slate-850' : 'bg-slate-50 dark:bg-slate-900'}`}>
                      <span className="capitalize block truncate max-w-[190px]" title={row.callerName}>
                        {row.callerName}
                      </span>
                    </td>

                    {/* Daily Call Counts */}
                    {dateWiseMatrix.dateHeaders.map(dh => {
                      const count = row.dailyCounts[dh.label];
                      return (
                        <td 
                          key={dh.key} 
                          className="py-2.5 px-3 text-center border-r border-slate-200/60 dark:border-slate-800/60 font-mono text-xs"
                        >
                          {count > 0 ? (
                            <span className="font-extrabold text-slate-800 dark:text-slate-200">
                              {count}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-700">-</span>
                          )}
                        </td>
                      );
                    })}

                    {/* Total Calls Column */}
                    <td className="py-2.5 px-4 text-center font-mono font-black text-indigo-700 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/40">
                      {row.totalCalls > 0 ? row.totalCalls : 0}
                    </td>
                  </tr>
                ))}

                {dateWiseMatrix.matrixRows.length === 0 && (
                  <tr>
                    <td colSpan={dateWiseMatrix.dateHeaders.length + 2} className="py-12 text-center text-slate-400">
                      No telecaller data available for the selected month and year.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
