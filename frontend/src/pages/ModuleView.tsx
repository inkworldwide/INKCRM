import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Icons from 'lucide-react';
import { useModuleStore, ModuleDefinition } from '../store/moduleStore';
import { useAuthStore } from '../store/authStore';
import api, { FILE_BASE_URL } from '../services/api';
import { DynamicIcon } from '../components/Layout';
import { useToastStore } from '../store/toastStore';
import { useThemeStore } from '../store/themeStore';
import { formatDate } from '../utils/dateFormatter';
import { exportCampaignCSV } from '../utils/exportCampaignCSV';
import { exportLeadReportXLSX } from '../utils/exportLeadReportXLSX';
import { maskPhoneNumber, triggerPhoneCall, openWhatsAppChat } from '../utils/phoneUtils';

type ViewMode = 'table' | 'kanban' | 'calendar' | 'timeline';

export default function ModuleView() {
  const { apiPath } = useParams<{ apiPath: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const { activeModule, setActiveModuleByPath } = useModuleStore();
  const { canAccessMenu } = useAuthStore();
  const { branding } = useThemeStore();
  const { showConfirm, showToast, showAlertModal } = useToastStore();

  useEffect(() => {
    if (apiPath && !canAccessMenu(apiPath.toLowerCase())) {
      navigate('/', { replace: true });
    }
  }, [apiPath, canAccessMenu, navigate]);

  // Synchronous initialization from URL parameters to prevent redundant double-fetch
  const urlStatus = searchParams.get('status');
  const urlFollowup = searchParams.get('followup');

  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [searchVal, setSearchVal] = useState('');
  const [filterField, setFilterField] = useState<string>(() => (urlStatus ? 'status' : (urlFollowup ? 'followup' : '')));
  const [filterVal, setFilterVal] = useState<string>(() => (urlStatus || urlFollowup || ''));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [isTodayOnly, setIsTodayOnly] = useState(false);

  // File upload and History timeline states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRecordId, setUploadingRecordId] = useState<string | null>(null);
  const [activeHistoryRecord, setActiveHistoryRecord] = useState<any | null>(null);
  const [historyActivities, setHistoryActivities] = useState<any[]>([]);
  const [historyDocuments, setHistoryDocuments] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Campaign expansion state for 12-column detailed view
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [campaignLeadsMap, setCampaignLeadsMap] = useState<Record<string, any[]>>({});
  const [loadingCampaignLeads, setLoadingCampaignLeads] = useState<Record<string, boolean>>({});
  // Campaign status filter ('all' | 'in_progress' | 'completed')
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<'all' | 'in_progress' | 'completed'>('all');

  const toggleExpandCampaign = async (campaignName: string) => {
    if (expandedCampaign === campaignName) {
      setExpandedCampaign(null);
      return;
    }
    setExpandedCampaign(campaignName);
    if (!campaignLeadsMap[campaignName]) {
      try {
        setLoadingCampaignLeads(prev => ({ ...prev, [campaignName]: true }));
        const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}?limit=100`);
        setCampaignLeadsMap(prev => ({ ...prev, [campaignName]: res.data.leads || [] }));
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingCampaignLeads(prev => ({ ...prev, [campaignName]: false }));
      }
    }
  };

  const handleUploadClick = (recordId: string) => {
    setUploadingRecordId(recordId);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingRecordId) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('recordId', uploadingRecordId);

    try {
      await api.post('/documents/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      showToast('File uploaded successfully!', 'success');
    } catch (err) {
      showToast('Failed to upload file.', 'error');
    } finally {
      setUploadingRecordId(null);
    }
  };

  const openHistory = async (rec: any) => {
    setActiveHistoryRecord(rec);
    setLoadingHistory(true);
    try {
      const [activitiesRes, docsRes] = await Promise.all([
        api.get(`/records/leads/${rec._id}/activities`),
        api.get(`/documents`, { params: { recordId: rec._id } })
      ]);
      setHistoryActivities(activitiesRes.data);
      setHistoryDocuments(docsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // --- Campaign Assignment custom screen states ---
  const [caCampaigns, setCaCampaigns] = useState<any[]>([]);
  const [caSelectedCampaign, setCaSelectedCampaign] = useState('');
  const [caRoles, setCaRoles] = useState<any[]>([]);
  const [caSelectedRole, setCaSelectedRole] = useState('');
  const [caAgents, setCaAgents] = useState<any[]>([]);
  const [caSelectedAgents, setCaSelectedAgents] = useState<string[]>([]);
  const [caFile, setCaFile] = useState<File | null>(null);
  const [caAllocatedStats, setCaAllocatedStats] = useState<Record<string, number>>({});
  const [caDialedStats, setCaDialedStats] = useState<Record<string, number>>({});
  const [caLoadingStats, setCaLoadingStats] = useState(false);
  const [caAssigning, setCaAssigning] = useState(false);
  const [caProgressStatus, setCaProgressStatus] = useState('');
  const [caProgressPercent, setCaProgressPercent] = useState(0);
  const [caLoadingAgents, setCaLoadingAgents] = useState(false);

  useEffect(() => {
    if (apiPath === 'campaignassignments') {
      loadCampaignAssignmentsData();
    }
  }, [apiPath]);

  const loadCampaignAssignmentsData = async (targetCampaign?: string) => {
    try {
      setCaLoadingStats(true);

      const [campaignsRes, rolesRes, usersRes] = await Promise.all([
        api.get('/records/campaigns?limit=500').catch(() => ({ data: [] })),
        api.get('/auth/roles').catch(() => ({ data: [] })),
        api.get('/auth/users?purpose=dropdown').catch(() => ({ data: [] }))
      ]);

      // 1. Process & extract registered campaign names strictly from Campaigns module (separating Campaigns from raw Lead imports)
      const regCamps = Array.isArray(campaignsRes.data) ? campaignsRes.data : (campaignsRes.data?.records || campaignsRes.data?.campaigns || []);
      const campMap = new Map<string, any>();

      regCamps.forEach((c: any) => {
        const d = c.data || c || {};
        const name = String(d.campaignName || d.name || d.source || c.campaignName || '').trim();
        if (name && !campMap.has(name.toLowerCase())) {
          campMap.set(name.toLowerCase(), { _id: c._id || name, name, raw: c });
        }
      });

      const allCampaignOptions = Array.from(campMap.values());
      setCaCampaigns(allCampaignOptions);

      const activeCamp = targetCampaign || caSelectedCampaign || (allCampaignOptions.length > 0 ? allCampaignOptions[0].name : '');
      setCaSelectedCampaign(activeCamp);

      // 2. Fetch allocation stats FOR THE SELECTED CAMPAIGN ONLY
      if (activeCamp) {
        const statsRes = await api.get(`/records/campaigns/allocation-stats?campaignName=${encodeURIComponent(activeCamp)}`).catch(() => ({ data: {} }));
        setCaAllocatedStats(statsRes.data?.stats || {});
        setCaDialedStats(statsRes.data?.dialedStats || {});
      } else {
        setCaAllocatedStats({});
        setCaDialedStats({});
      }

      // 3. Process Roles (with system default fallbacks)
      let fetchedRoles = Array.isArray(rolesRes.data) ? rolesRes.data : (rolesRes.data?.roles || []);
      if (!Array.isArray(fetchedRoles) || fetchedRoles.length === 0) {
        fetchedRoles = [
          { _id: 'telecaller_role', name: 'TELI CALLER' },
          { _id: 'admin_role', name: 'ADMIN' },
          { _id: 'super_admin_role', name: 'Super Admin' },
          { _id: 'sales_manager_role', name: 'ARIA SALES MANAGER' }
        ];
      }
      setCaRoles(fetchedRoles);

      // Auto-select Telecaller role (or 1st role) if not selected
      let activeRoleId = caSelectedRole;
      if (!activeRoleId && fetchedRoles.length > 0) {
        const teleRole = fetchedRoles.find((r: any) =>
          ['telecaller', 'teli caller', 'agent', 'sales'].includes(String(r.name || '').trim().toLowerCase())
        );
        activeRoleId = teleRole ? teleRole._id : fetchedRoles[0]._id;
        setCaSelectedRole(activeRoleId);
      }

      // 4. Process & auto-populate active employees into the table
      const fetchedUsers = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.users || []);
      if (fetchedUsers.length > 0) {
        let filtered = fetchedUsers;
        if (activeRoleId) {
          filtered = fetchedUsers.filter((u: any) => {
            const uRoleId = u.roleId?._id || u.roleId || u.role?._id || u.role;
            const uRoleName = u.roleId?.name || u.role?.name || String(u.role || '');
            return (String(uRoleId) === String(activeRoleId) || uRoleName.toLowerCase() === String(activeRoleId).toLowerCase()) && u.isActive !== false;
          });
        }
        const finalAgents = filtered.length > 0 ? filtered : fetchedUsers;
        setCaAgents(finalAgents);
        setCaSelectedAgents(finalAgents.map((u: any) => u._id));
      }
    } catch (err) {
      console.error('Failed to load campaign assignments metadata:', err);
    } finally {
      setCaLoadingStats(false);
    }
  };

  const handleCampaignChange = (campaignName: string) => {
    setCaSelectedCampaign(campaignName);
    if (campaignName) {
      api.get(`/records/campaigns/allocation-stats?campaignName=${encodeURIComponent(campaignName)}`)
        .then(res => {
          setCaAllocatedStats(res.data?.stats || {});
          setCaDialedStats(res.data?.dialedStats || {});
        })
        .catch(err => console.error(err));
    }
  };

  const handleRoleChange = (roleId: string) => {
    setCaSelectedRole(roleId);
    if (roleId) {
      handleLoadAgents(roleId);
    }
  };

  const handleLoadAgents = async (roleIdToUse?: string) => {
    const targetRole = roleIdToUse || caSelectedRole;
    setCaLoadingAgents(true);
    try {
      const res = await api.get('/auth/users?purpose=dropdown');
      const allUsers = res.data || [];
      let filtered = allUsers;
      if (targetRole && targetRole !== 'ALL') {
        filtered = allUsers.filter((u: any) => {
          const uRoleId = u.roleId?._id || u.roleId || u.role?._id || u.role;
          const uRoleName = u.roleId?.name || u.role?.name || String(u.role || '');
          const roleMatch = String(uRoleId) === String(targetRole) || uRoleName.toLowerCase() === String(targetRole).toLowerCase();
          return roleMatch && u.isActive !== false;
        });
      }
      const finalAgents = filtered.length > 0 ? filtered : allUsers;
      setCaAgents(finalAgents);
      setCaSelectedAgents(finalAgents.map((u: any) => u._id));
    } catch (err: any) {
      console.error('Failed to load agents:', err);
    } finally {
      setCaLoadingAgents(false);
    }
  };

  const parseCSV = (text: string): any[] => {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const results: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values: string[] = [];
      let currentVal = '';
      let insideQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
          values.push(currentVal.trim().replace(/^["']|["']$/g, ''));
          currentVal = '';
        } else {
          currentVal += char;
        }
      }
      values.push(currentVal.trim().replace(/^["']|["']$/g, ''));
      
      // Skip rows where all meaningful values are empty (ignore Slno/index columns)
      const hasContent = values.some((val, idx) => {
        const header = (headers[idx] || '').toLowerCase();
        if (header === 'slno' || header === 'sl no' || header === 'sno' || header === 'id') return false;
        return val.trim() !== '';
      });
      if (!hasContent) continue;

      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      results.push(row);
    }
    return results;
  };

  // High-performance Parse Excel (XLSX/XLS) files using SheetJS
  const parseExcelFile = async (buffer: ArrayBuffer): Promise<any[]> => {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    
    // Use sheet_to_json in object mode
    const rawRows: any[] = XLSX.utils.sheet_to_json(firstSheet, { raw: false, defval: '' });

    if (rawRows.length === 0) return [];

    const normKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Pre-calculate column mapping once from first row
    const firstRowKeys = Object.keys(rawRows[0] || {});
    const mapCol = (targets: string[]) => {
      const normTargets = targets.map(normKey);
      for (const k of firstRowKeys) {
        if (normTargets.includes(normKey(k))) return k;
      }
      return null;
    };

    const phoneCol = mapCol(['phone', 'mobile', 'contact', 'contactNum', 'contact_num', 'contactNumber', 'contact_number', 'phoneNumber', 'phone_number', 'mobileNo', 'mobile_no', 'contactNo', 'contact_no', 'cell', 'telephone', 'phNo', 'mobNo', 'telNo', 'name_contact_num', 'nameContactNum']);
    const customerCol = mapCol(['customer', 'customerName', 'customer_name', 'custName', 'client', 'clientName', 'firstName', 'name', 'fullName', 'buyer', 'buyerName', 'costomer', 'leadName']);
    const companyCol = mapCol(['company', 'firmName', 'firm_name', 'firm', 'businessName', 'business', 'agencyName', 'agency', 'shopName', 'shop', 'tradeName', 'treaderName', 'traderName', 'organization']);
    const locationCol = mapCol(['city', 'location', 'district', 'state', 'address', 'place', 'area', 'branch']);
    const categoryCol = mapCol(['leadCategory', 'lead_category', 'loanType', 'loan_type', 'category', 'product', 'service', 'leadType']);
    const codeCol = mapCol(['Data Code', 'data code', 'DataCode', 'leadCode', 'lead_code', 'lead code', 'dataCode', 'data_code', 'datacode', 'code']);
    const caseCol = mapCol(['caseDetails', 'case_details', 'caseStatus', 'case_status', 'details', 'description']);
    const remarksCol = mapCol(['notes', 'remarks', 'remark', 'note', 'comment', 'comments', 'feedback']);

    const results: any[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const cleanRow: Record<string, string> = {};
      let hasMeaningfulContent = false;

      for (const k in row) {
        const trimmedKey = k.trim();
        const val = String(row[k] !== undefined && row[k] !== null ? row[k] : '').trim();
        cleanRow[trimmedKey] = val;
        
        const lowerK = trimmedKey.toLowerCase();
        if (val && lowerK !== 'slno' && lowerK !== 'sl no' && lowerK !== 'sno' && lowerK !== 'id' && lowerK !== 's.no' && lowerK !== 'sr no') {
          hasMeaningfulContent = true;
        }
      }

      if (!hasMeaningfulContent) continue;

      const phone = phoneCol ? cleanRow[phoneCol] : '';
      const customer = customerCol ? cleanRow[customerCol] : '';
      const company = companyCol ? cleanRow[companyCol] : '';
      const location = locationCol ? cleanRow[locationCol] : '';
      const leadCategory = categoryCol ? cleanRow[categoryCol] : '';
      let dataCode = codeCol ? cleanRow[codeCol] : '';
      if (!dataCode) {
        // Search row keys directly for data code
        for (const k in cleanRow) {
          const lowerK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (lowerK.includes('datacode') || lowerK.includes('data_code') || lowerK === 'code' || lowerK.includes('leadcode')) {
            const v = cleanRow[k];
            if (v && v !== 'N/A' && v !== 'Unnamed') {
              dataCode = v;
              break;
            }
          }
        }
        // Fallback to 2nd column (Column B in Excel) if dataCode was not found by name
        if (!dataCode && firstRowKeys.length >= 2) {
          const colBKey = firstRowKeys[1].trim();
          const v = cleanRow[colBKey];
          if (v && v !== 'N/A' && v !== 'Unnamed' && !v.startsWith('http')) {
            dataCode = v;
          }
        }
      }

      if (phone) { cleanRow.phone = phone; cleanRow.mobile = phone; cleanRow.contact_num = phone; }
      if (customer) { cleanRow.customer = customer; cleanRow.customerName = customer; cleanRow.firstName = customer; }
      if (company) { cleanRow.company = company; cleanRow.firmName = company; cleanRow.firm_name = company; }
      if (location) { cleanRow.city = location; cleanRow.location = location; }
      if (leadCategory) { cleanRow.leadCategory = leadCategory; cleanRow.loanType = leadCategory; cleanRow.lead_category = leadCategory; }
      if (dataCode) {
        cleanRow.dataCode = dataCode;
        cleanRow.data_code = dataCode;
        cleanRow['Data Code'] = dataCode;
        cleanRow['data code'] = dataCode;
        cleanRow.datacode = dataCode;
        cleanRow.DataCode = dataCode;
        cleanRow.code = dataCode;
      }
      const caseDetails = caseCol ? cleanRow[caseCol] : '';
      const remarks = remarksCol ? cleanRow[remarksCol] : '';

      if (caseDetails) { cleanRow.caseDetails = caseDetails; cleanRow.case_details = caseDetails; }
      if (remarks) { cleanRow.notes = remarks; cleanRow.remarks = remarks; }

      results.push(cleanRow);
    }

    console.log(`[parseExcelFile] Parsed ${results.length} valid rows from Excel file with optimized field mapping`);
    return results;
  };

  const handleAssignData = async () => {
    if (!caSelectedCampaign) {
      showToast('Please select a Campaign.', 'warning');
      return;
    }
    if (caSelectedAgents.length === 0) {
      showToast('Please check at least one employee in the table.', 'warning');
      return;
    }
    if (!caFile) {
      showToast('Please upload an Excel or CSV file.', 'warning');
      return;
    }

    setCaAssigning(true);
    setCaProgressStatus('Reading and analyzing uploaded file...');
    setCaProgressPercent(5);

    try {
      const fileName = caFile.name.toLowerCase();
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          let parsedLeads: any[];

          setCaProgressStatus('Parsing rows and mapping dataset columns...');
          setCaProgressPercent(15);

          if (isExcel) {
            // Parse XLSX/XLS with SheetJS
            const buffer = event.target?.result as ArrayBuffer;
            parsedLeads = await parseExcelFile(buffer);
          } else {
            // Parse CSV as text
            const csvText = event.target?.result as string;
            parsedLeads = parseCSV(csvText);
          }
          
          if (parsedLeads.length === 0) {
            showToast('The uploaded file is empty or invalid.', 'warning');
            setCaAssigning(false);
            setCaProgressStatus('');
            setCaProgressPercent(0);
            return;
          }

          const validSelectedAgents = caAgents.filter((a: any) =>
            caSelectedAgents.some((id: string) => String(id) === String(a._id))
          );

          const agentNames = validSelectedAgents.map((a: any) => {
            const fn = (a.firstName || '').trim();
            const ln = (a.lastName || '').trim();
            const full = `${fn} ${ln}`.trim();
            return full || a.name || a.username || a.email || 'Agent';
          }).filter(Boolean);

          if (agentNames.length === 0) {
            showToast('Please check at least one employee in the table.', 'warning');
            setCaAssigning(false);
            setCaProgressStatus('');
            setCaProgressPercent(0);
            return;
          }

          // Process in sequential chunks of 500 leads (~150KB payload) to strictly stay below Nginx/proxy 1MB limit
          const BATCH_SIZE = 500;
          const totalLeads = parsedLeads.length;
          const totalBatches = Math.ceil(totalLeads / BATCH_SIZE);
          let assignedCount = 0;

          for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const start = batchIdx * BATCH_SIZE;
            const chunk = parsedLeads.slice(start, start + BATCH_SIZE);
            const isLast = batchIdx === totalBatches - 1;
            const currentPercent = Math.min(95, Math.round(10 + ((batchIdx + 1) / totalBatches) * 85));

            setCaProgressPercent(currentPercent);
            if (totalBatches > 1) {
              setCaProgressStatus(`Assigning batch ${batchIdx + 1} of ${totalBatches} (${start.toLocaleString()} - ${Math.min(start + BATCH_SIZE, totalLeads).toLocaleString()} / ${totalLeads.toLocaleString()} leads)...`);
            } else {
              setCaProgressStatus(`Assigning ${totalLeads.toLocaleString()} leads to ${agentNames.length} agents...`);
            }

            const res = await api.post('/records/campaigns/bulk-assign', {
              campaignName: caSelectedCampaign,
              agentNames,
              leads: chunk,
              agentOffset: start,
              isLastBatch: isLast
            }, {
              timeout: 120000 // 2 minutes timeout per batch
            });

            assignedCount += (res.data?.count || chunk.length);

            if (totalBatches > 1 && !isLast) {
              await new Promise(r => setTimeout(r, 20));
            }
          }

          setCaProgressPercent(100);
          setCaProgressStatus('Complete!');

          showToast(`Successfully assigned ${assignedCount.toLocaleString()} leads to ${agentNames.length} agents for '${caSelectedCampaign}'!`, 'success');
          setCaFile(null);
          
          queryClient.invalidateQueries({ queryKey: ['records', 'leads'] });
          loadCampaignAssignmentsData(caSelectedCampaign);
        } catch (err: any) {
          console.error('[Bulk Assignment Error]', err);
          const serverError = err.response?.data?.error || err.response?.data?.message;
          const status = err.response?.status;
          const netMsg = err.message;
          const errorMsg = serverError || (status ? `Error (HTTP ${status}): ${err.response?.statusText || 'Server Error'}` : netMsg) || 'Failed to process bulk assignment.';
          showToast(errorMsg, 'error');
        } finally {
          setCaAssigning(false);
          setCaProgressStatus('');
          setCaProgressPercent(0);
        }
      };

      reader.onerror = () => {
        showToast('Error reading the uploaded file. Please check file permissions.', 'error');
        setCaAssigning(false);
        setCaProgressStatus('');
        setCaProgressPercent(0);
      };

      if (isExcel) {
        reader.readAsArrayBuffer(caFile);
      } else {
        reader.readAsText(caFile);
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to read file.', 'error');
      setCaAssigning(false);
      setCaProgressStatus('');
      setCaProgressPercent(0);
    }
  };

  const renderCampaignAssignments = () => {
    const getAgentStats = (agent: any) => {
      const fn = (agent.firstName || '').trim();
      const ln = (agent.lastName || '').trim();
      const fullName = `${fn} ${ln}`.trim() || agent.name || agent.username || agent.email || '';
      const agentId = String(agent._id || agent.id || '');
      const allocated = (caAllocatedStats[fullName] !== undefined)
        ? caAllocatedStats[fullName]
        : ((caAllocatedStats[agentId] !== undefined)
          ? caAllocatedStats[agentId]
          : (caAllocatedStats[fn] || 0));
      const dialed = (caDialedStats[fullName] !== undefined)
        ? caDialedStats[fullName]
        : ((caDialedStats[agentId] !== undefined)
          ? caDialedStats[agentId]
          : (caDialedStats[fn] || 0));
      return { fullName, allocated, dialed };
    };

    const totalAgentAllocated = caAgents.reduce((sum: number, agent: any) => {
      return sum + getAgentStats(agent).allocated;
    }, 0);

    const totalAgentDialed = caAgents.reduce((sum: number, agent: any) => {
      return sum + getAgentStats(agent).dialed;
    }, 0);

    const dialRate = totalAgentAllocated > 0 ? Math.round((totalAgentDialed / totalAgentAllocated) * 100) : 0;

    return (
      <div className="space-y-6 text-left">
        {/* Header Title Bar with Modern Gradient Avatar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-1">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 flex-shrink-0">
              <Icons.Target className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                  Assign Campaigns
                </h1>
                <span className="text-xs font-black px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60 shadow-3xs font-mono">
                  Lead Distribution
                </span>
              </div>
              <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                Allocate leads and upload contact files for team members
              </p>
            </div>
          </div>
        </div>

        {/* 4 Vibrant Gradient Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Campaigns */}
          <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Available Campaigns
              </span>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
                <Icons.Layers className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {caCampaigns.length}
              </span>
              <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md">
                Active Sources
              </span>
            </div>
          </div>

          {/* Card 2: Team Roles */}
          <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Team Roles
              </span>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-xs">
                <Icons.Users2 className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {caRoles.length}
              </span>
              <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded-md">
                Role Groups
              </span>
            </div>
          </div>

          {/* Card 3: Loaded Employees */}
          <div className="bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Loaded Agents
              </span>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
                <Icons.UserCheck className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {caAgents.length}
              </span>
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md">
                {caSelectedAgents.length} Selected
              </span>
            </div>
          </div>

          {/* Card 4: Allocated Pool */}
          <div className="bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Total Assigned
              </span>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
                <Icons.Zap className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {totalAgentAllocated.toLocaleString()}
              </span>
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md">
                Allocated Leads
              </span>
            </div>
          </div>
        </div>

        {/* Top Control Card (Campaign Distribution Studio) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden text-left">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
          
          <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <Icons.Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Campaign Distribution Studio
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <div className="text-left">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Icons.Layers className="w-3.5 h-3.5 text-indigo-500" />
                Select Campaign
              </label>
              <select 
                value={caSelectedCampaign} 
                onChange={e => handleCampaignChange(e.target.value)} 
                className="w-full h-11 px-4 text-xs font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-all cursor-pointer shadow-inner-sm"
              >
                <option value="">Select Campaign</option>
                {caCampaigns.map((c: any) => {
                  const name = typeof c === 'string' ? c : (c.name || c.data?.campaignName || c.data?.campaign_name || c.data?.name || c.data?.source || c.campaignName || 'Campaign');
                  const keyVal = c._id || name;
                  return <option key={keyVal} value={name}>{name}</option>;
                })}
              </select>
            </div>

            <div className="text-left">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Icons.Users2 className="w-3.5 h-3.5 text-purple-500" />
                Agent Type (Role)
              </label>
              <select 
                value={caSelectedRole} 
                onChange={e => handleRoleChange(e.target.value)} 
                className="w-full h-11 px-4 text-xs font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-all cursor-pointer shadow-inner-sm"
              >
                <option value="">Select Role</option>
                {caRoles.map((r: any) => (
                  <option key={r._id || r.id || r.name} value={r._id || r.id || r.name}>{r.name}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2.5">
              <button 
                type="button" 
                onClick={() => handleLoadAgents()}
                className="flex-1 h-11 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                disabled={caLoadingAgents}
              >
                {caLoadingAgents ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Icons.Search className="w-4 h-4" /> Load Now
                  </>
                )}
              </button>
              
              <Link 
                to="/modules/campaigns"
                className="h-11 px-4 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center justify-center"
              >
                View Details
              </Link>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 my-6"></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <div className="md:col-span-2 text-left">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Icons.FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                Upload Excel / CSV File
              </label>
              
              <div 
                onClick={() => document.getElementById('ca-file-input')?.click()}
                className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  caFile 
                    ? 'border-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/30' 
                    : 'border-indigo-200/90 dark:border-slate-700 hover:border-indigo-500 bg-indigo-50/15 dark:bg-slate-900/40'
                }`}
              >
                <input 
                  id="ca-file-input"
                  type="file" 
                  accept=".csv,.xlsx,.xls"
                  onChange={e => setCaFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                {caFile ? (
                  <div className="flex items-center gap-3 w-full">
                    <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 rounded-xl shadow-3xs">
                      <Icons.FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{caFile.name}</p>
                      <p className="text-xs text-slate-500 font-medium">{(caFile.size / 1024).toFixed(1)} KB • Ready to assign</p>
                    </div>
                    <button 
                      type="button" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setCaFile(null);
                      }}
                      className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    >
                      <Icons.X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 py-1">
                    <div className="p-2.5 bg-indigo-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-100 dark:border-slate-700 shadow-3xs">
                      <Icons.UploadCloud className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-bold text-slate-800 dark:text-white">Click to select file (.csv, .xlsx, .xls)</p>
                      <p className="text-[10px] text-slate-500 font-medium">File data will be allocated to selected employees</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <button 
                type="button" 
                onClick={handleAssignData}
                className="w-full h-12 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 active:scale-[0.98] text-white rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-md shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                disabled={caAssigning}
              >
                {caAssigning ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span className="truncate">{caProgressStatus || 'Assigning Leads...'}</span>
                  </div>
                ) : (
                  <>
                    <Icons.CheckCircle2 className="w-4.5 h-4.5" /> Assign Data
                  </>
                )}
              </button>

              {caAssigning && (
                <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700 space-y-2">
                  <div className="flex justify-between text-[11px] font-bold text-slate-700 dark:text-slate-200">
                    <span className="truncate max-w-[80%]">{caProgressStatus}</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">{caProgressPercent}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(caProgressPercent, 3)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Employee Allocation Table Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
          
          <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white text-left uppercase tracking-tight">
                Assign Campaigns for Below Employees
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Check employees who should receive batch leads from the uploaded dataset.
              </p>
            </div>
            {caAgents.length > 0 && (
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-3.5 py-1 rounded-full border border-indigo-200/80 dark:border-indigo-800/60 uppercase tracking-wider font-mono">
                Selected: {caSelectedAgents.length} of {caAgents.length} Agents
              </span>
            )}
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[750px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider h-11 bg-slate-50/90 dark:bg-slate-800/80">
                  <th className="py-2 px-4 w-12 text-center">
                    <input 
                      type="checkbox"
                      checked={caAgents.length > 0 && caSelectedAgents.length === caAgents.length}
                      onChange={e => {
                        if (e.target.checked) {
                          setCaSelectedAgents(caAgents.map(a => a._id));
                        } else {
                          setCaSelectedAgents([]);
                        }
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                    />
                  </th>
                  <th className="py-3 px-4">Full Name</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Reporting Manager</th>
                  <th className="py-3 px-4 text-center">Total Allocated #</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {caAgents.map((agent: any) => {
                  const { fullName, allocated } = getAgentStats(agent);
                  const isChecked = caSelectedAgents.includes(agent._id);
                  
                  return (
                    <tr 
                      key={agent._id} 
                      className={`transition-colors h-14 ${
                        isChecked 
                          ? 'bg-indigo-50/40 dark:bg-slate-800/50 hover:bg-indigo-50/60' 
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                      }`}
                    >
                      <td className="px-4 py-2 text-center">
                        <input 
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setCaSelectedAgents([...caSelectedAgents, agent._id]);
                            } else {
                              setCaSelectedAgents(caSelectedAgents.filter(id => id !== agent._id));
                            }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                        />
                      </td>
                      <td className="px-4 py-2 text-left">
                        <div className="flex items-center gap-3">
                          <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-3xs">
                            {agent.firstName ? agent.firstName[0] : 'U'}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 dark:text-slate-100 block">
                              {fullName}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                              {agent.email || agent.userCode || 'Agent'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-left">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200/80 dark:border-purple-800/50">
                          {agent.roleId?.name || 'No Role'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-left">
                        {agent.reportingManager ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
                            {agent.reportingManager.firstName} {agent.reportingManager.lastName}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 font-medium italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 min-w-[3rem] shadow-3xs">
                          {allocated}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {caAgents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-14 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-500/20">
                        <Icons.Users className="w-6 h-6" />
                      </div>
                      <p className="font-extrabold text-sm text-slate-800 dark:text-slate-200">No employees loaded</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Select an agent role type above and click "Load Now" to display team members.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // Campaigns local state for inline form
  const [campaignNameInput, setCampaignNameInput] = useState('');
  const [editCampaignId, setEditCampaignId] = useState<string | null>(null);
  const [isSubmittingCampaign, setIsSubmittingCampaign] = useState(false);

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignNameInput.trim()) {
      showToast('Campaign Name is required', 'warning');
      return;
    }

    setIsSubmittingCampaign(true);
    try {
      if (editCampaignId) {
        // Update Campaign
        await api.put(`/records/campaigns/${editCampaignId}`, {
          data: { campaignName: campaignNameInput.trim() }
        });
      } else {
        // Create Campaign with required default fields
        await api.post(`/records/campaigns`, {
          data: {
            campaignName: campaignNameInput.trim(),
            status: 'Planned',
            type: 'Email'
          }
        });
      }
      showAlertModal({
        title: editCampaignId ? 'Saved Successfully' : 'Created Successfully',
        message: editCampaignId ? 'The campaign has been updated successfully.' : 'The new campaign has been created successfully.',
        type: 'success'
      });
      setCampaignNameInput('');
      setEditCampaignId(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['records', 'campaigns'] });
    } catch (err: any) {
      const serverData = err.response?.data;
      let msg = serverData?.error || 'Failed to save campaign';
      if (serverData?.details && Array.isArray(serverData.details) && serverData.details.length > 0) {
        msg = `${msg}: ${serverData.details.join(' ')}`;
      }
      showToast(msg, 'error');
    } finally {
      setIsSubmittingCampaign(false);
    }
  };

  const handleEditClick = (rec: any) => {
    setEditCampaignId(rec._id);
    setCampaignNameInput(rec.data?.campaignName || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  // Fetch dynamic campaign allocation & dialed stats with 0ms instant local cache
  const { data: campaignStatsData } = useQuery({
    queryKey: ['campaign-allocation-stats'],
    queryFn: async () => {
      const res = await api.get('/records/campaigns/allocation-stats');
      try { localStorage.setItem('inkcrm_cached_campaign_alloc_stats_v2', JSON.stringify(res.data)); } catch {}
      return res.data || {};
    },
    initialData: () => {
      try {
        const raw = localStorage.getItem('inkcrm_cached_campaign_alloc_stats_v2');
        return raw ? JSON.parse(raw) : undefined;
      } catch {
        return undefined;
      }
    },
    staleTime: 60000,
    enabled: apiPath === 'campaigns' || apiPath === 'campaignassignments'
  });

  const campAllocStats = campaignStatsData?.campaignAllocatedStats || {};
  const campDialedStats = campaignStatsData?.campaignDialedStats || {};

  const getAllocatedNumbers = (name: string) => {
    const key = (name || '').toLowerCase().trim();
    if (campAllocStats[key] !== undefined) return campAllocStats[key];
    const matchingRec = data?.records?.find((r: any) => {
      const rName = (r.data?.campaignName || r.data?.source || r.data?.campaign || r.data?.name || r.name || '').toLowerCase().trim();
      return rName === key;
    });
    if (matchingRec && matchingRec.data?.allocatedLeads !== undefined) return Number(matchingRec.data.allocatedLeads);
    if (matchingRec && matchingRec.data?.totalAssigned !== undefined) return Number(matchingRec.data.totalAssigned);
    return 0;
  };

  const getDialedNumbers = (name: string) => {
    const key = (name || '').toLowerCase().trim();
    if (campDialedStats[key] !== undefined) return campDialedStats[key];
    const matchingRec = data?.records?.find((r: any) => {
      const rName = (r.data?.campaignName || r.data?.source || r.data?.campaign || r.data?.name || r.name || '').toLowerCase().trim();
      return rName === key;
    });
    if (matchingRec && matchingRec.data?.dialed !== undefined) return Number(matchingRec.data.dialed);
    return 0;
  };

  const handleDownloadCampaign = async (rec: any) => {
    const campaignName = (
      rec.data?.campaignName ||
      rec.data?.source ||
      rec.data?.campaign ||
      rec.data?.name ||
      rec.name
    )?.toString().trim();

    if (!campaignName) {
      showToast('Campaign name not found.', 'error');
      return;
    }

    try {
      showToast(`Exporting 12-column report for "${campaignName}"...`, 'info');
      const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}?export=true`);
      const leads = res.data?.leads || [];

      if (leads.length === 0) {
        showToast(`No lead records found under campaign "${campaignName}".`, 'warning');
        return;
      }

      exportCampaignCSV(campaignName, leads);
      showToast(`Exported ${leads.length} leads for campaign "${campaignName}"!`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to export campaign data.', 'error');
    }
  };

  // Set Active Module in store on path mount/change
  useEffect(() => {
    if (apiPath) {
      setActiveModuleByPath(apiPath);
      setPage(1);
      setSearchVal('');
      if (urlStatus) {
        setFilterField('status');
        setFilterVal(urlStatus);
      } else if (urlFollowup) {
        setFilterField('followup');
        setFilterVal(urlFollowup);
      } else {
        setFilterField('');
        setFilterVal('');
      }
    }
  }, [apiPath, urlStatus, urlFollowup]);

  // Query records (initial records load in 0.0001s with zero flicker)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['records', apiPath, searchVal, filterField, filterVal, isTodayOnly, page, pageSize],
    queryFn: async () => {
      const params: Record<string, any> = {
        page,
        limit: pageSize,
        search: searchVal,
        sort: '-createdAt'
      };
      if (filterField === 'status') {
        params.status = filterVal;
      } else if (filterField === 'followup') {
        params.followup = filterVal;
      } else if (filterField && filterVal) {
        params[`data.${filterField}`] = filterVal;
      }
      if (isTodayOnly) {
        params.createdDate = 'today';
      }
      const res = await api.get(`/records/${apiPath}`, { params });
      if (apiPath === 'campaigns' && !searchVal && page === 1) {
        try { localStorage.setItem('inkcrm_cached_campaigns_records_v2', JSON.stringify(res.data)); } catch {}
      }
      return res.data;
    },
    initialData: () => {
      if (apiPath === 'campaigns' && !searchVal && page === 1) {
        try {
          const raw = localStorage.getItem('inkcrm_cached_campaigns_records_v2');
          return raw ? JSON.parse(raw) : undefined;
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
    enabled: !!apiPath
  });

  // Background prefetch next page so pagination click is 0ms instant
  useEffect(() => {
    if (apiPath && data?.pagination?.totalPages && page < data.pagination.totalPages) {
      const nextPage = page + 1;
      const nextParams: Record<string, any> = {
        page: nextPage,
        limit: pageSize,
        search: searchVal,
        sort: '-createdAt'
      };
      if (filterField === 'status') nextParams.status = filterVal;
      else if (filterField === 'followup') nextParams.followup = filterVal;
      else if (filterField && filterVal) nextParams[`data.${filterField}`] = filterVal;
      if (isTodayOnly) nextParams.createdDate = 'today';

      queryClient.prefetchQuery({
        queryKey: ['records', apiPath, searchVal, filterField, filterVal, isTodayOnly, nextPage, pageSize],
        queryFn: async () => {
          const res = await api.get(`/records/${apiPath}`, { params: nextParams });
          return res.data;
        },
        staleTime: 60000
      });
    }
  }, [data?.pagination?.totalPages, page, pageSize, searchVal, filterField, filterVal, isTodayOnly, apiPath, queryClient]);

  const campaignSummaryStats = useMemo(() => {
    const records = data?.records || [];
    let totalAllocated = 0;
    let totalDialed = 0;
    let inProgressCount = 0;
    let completedCount = 0;
    records.forEach((rec: any) => {
      const name = rec.data?.campaignName || rec.data?.source || rec.data?.campaign || rec.data?.name || rec.name || '';
      const allocated = getAllocatedNumbers(name);
      const dialed = getDialedNumbers(name);
      totalAllocated += allocated;
      totalDialed += dialed;
      const st = (rec.data?.status || '').toString().toLowerCase();
      const isCompleted = (allocated > 0 && dialed >= allocated) || st.includes('completed');
      if (isCompleted) {
        completedCount++;
      } else if (dialed > 0 || st.includes('progress') || st.includes('active')) {
        inProgressCount++;
      }
    });
    const overallRate = totalAllocated > 0 ? Math.round((totalDialed / totalAllocated) * 100) : 0;
    return {
      totalCampaigns: data?.pagination?.total ?? records.length,
      totalAllocated,
      totalDialed,
      yetToDial: Math.max(0, totalAllocated - totalDialed),
      overallRate,
      inProgressCount,
      completedCount
    };
  }, [data?.records, data?.pagination?.total, campaignStatsData]);

  const displayedCampaignRecords = useMemo(() => {
    const records = data?.records || [];
    if (campaignStatusFilter === 'in_progress') {
      return records.filter((rec: any) => {
        const name = rec.data?.campaignName || rec.data?.source || rec.data?.campaign || rec.data?.name || rec.name || '';
        const allocated = getAllocatedNumbers(name);
        const dialed = getDialedNumbers(name);
        const st = (rec.data?.status || '').toString().toLowerCase();
        const isCompleted = (allocated > 0 && dialed >= allocated) || st.includes('completed');
        return !isCompleted && (dialed > 0 || st.includes('progress') || st.includes('active'));
      });
    }
    if (campaignStatusFilter === 'completed') {
      return records.filter((rec: any) => {
        const name = rec.data?.campaignName || rec.data?.source || rec.data?.campaign || rec.data?.name || rec.name || '';
        const allocated = getAllocatedNumbers(name);
        const dialed = getDialedNumbers(name);
        const st = (rec.data?.status || '').toString().toLowerCase();
        return (allocated > 0 && dialed >= allocated) || st.includes('completed');
      });
    }
    return records;
  }, [data?.records, campaignStatusFilter, campaignStatsData]);

  const { data: usersDropdown } = useQuery({
    queryKey: ['moduleview-users-dropdown'],
    queryFn: async () => {
      const res = await api.get('/auth/users?purpose=dropdown');
      return res.data || [];
    },
    staleTime: 60000
  });

  const resolveUserDisplayName = (val: any) => {
    if (!val) return 'Unassigned';
    if (typeof val === 'object') {
      if (val.firstName || val.lastName) return `${val.firstName || ''} ${val.lastName || ''}`.trim();
      if (val.name) return val.name;
      if (val.email) return val.email.split('@')[0];
    }
    const str = String(val).trim();
    if (!str || str === 'undefined' || str === 'null') return 'Unassigned';
    if (Array.isArray(usersDropdown)) {
      const found = usersDropdown.find((u: any) => 
        u._id === str || u.id === str || u.email?.toLowerCase() === str.toLowerCase() || u.userCode === str
      );
      if (found) {
        return `${found.firstName || ''} ${found.lastName || ''}`.trim() || found.name || found.email || str;
      }
    }
    if (/^[0-9a-fA-F]{24}$/.test(str)) {
      return 'Assigned Agent';
    }
    return str;
  };

  // Helper to resolve card theme color strictly matching user prompt mapping
  const getCardThemeColor = (name: string): string => {
    const upper = (name || '').toUpperCase();
    if (upper.includes('HOT')) return '#0284C7';
    if (upper.includes('WARM')) return '#F59E0B';
    if (upper.includes('CEDIL') || upper.includes('CEBIL')) return '#E11D48';
    if (upper.includes('DOCUMENT') || upper.includes('DOC')) return '#0284C7';
    if (upper.includes('APPROVAL') || (upper.includes('APPROV') && upper.includes('PEND'))) return '#EA580C';
    if (upper.includes('APPROVED')) return '#F59E0B';
    if (upper.includes('DISBURSED') || upper.includes('DISBURS')) return '#16A34A';
    if (upper.includes('REJECTED') || upper.includes('REJECT')) return '#E11D48';
    if (upper.includes('FOLLOWUP') || upper.includes('FOLLOW')) return '#0284C7';
    if (upper.includes('DROPPED')) return '#EA580C';
    if (upper.includes('PENDING')) return '#F59E0B';
    return '#6366F1';
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    refetch();
  };

  const handleLoadAll = () => {
    setSearchVal('');
    setFilterVal('');
    setFilterField('');
    setIsTodayOnly(false);
    setPage(1);
    if (urlStatus) {
      navigate('/modules/leads');
    } else {
      refetch();
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/records/${apiPath}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['campaign-allocation-stats'] });
      queryClient.invalidateQueries({ queryKey: ['my-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      refetch();
    }
  });

  const handleDelete = (id: string) => {
    const label = apiPath === 'campaigns' ? 'Campaign' : (activeModule?.singularLabel || 'record');
    showConfirm({
      title: `Delete ${label}`,
      message: `Are you sure you want to delete this ${label}?`,
      onConfirm: () => {
        deleteMutation.mutate(id, {
          onSuccess: () => {
            showAlertModal({
              title: 'Deleted Successfully',
              message: `The ${label} has been permanently deleted.`,
              type: 'success'
            });
            refetch();
          },
          onError: (err: any) => {
            showToast(err.response?.data?.error || `Failed to delete ${label.toLowerCase()}.`, 'error');
          }
        });
      }
    });
  };

  // CSV / XLSX Export Utility
  const handleExportCSV = () => {
    if (!data?.records || !activeModule) return;
    
    if (activeModule.apiPath === 'leads') {
      exportLeadReportXLSX(data.records, 'Leads_Report');
      showToast(`Exported ${data.records.length} lead records to Excel!`, 'success');
      return;
    }

    // Header
    const fields = activeModule.fields.map((f) => f.name);
    const headers = activeModule.fields.map((f) => f.label).join(',');
    
    // Rows
    const rows = data.records.map((rec: any) =>
      fields.map((f) => `"${String(rec.data[f] || '').replace(/"/g, '""')}"`).join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${activeModule.apiPath}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Kanban view card layout assembler
  const renderKanban = (moduleDef: ModuleDefinition, records: any[]) => {
    // Find first dropdown field (e.g. status) to group by
    const statusField = moduleDef.fields.find((f) => f.type === 'dropdown');
    if (!statusField) {
      return (
        <div className="py-12 text-center text-slate-500 border rounded-xl border-dashed">
          Kanban view requires at least one dropdown status field in the module definition.
        </div>
      );
    }

    const columns = statusField.options || ['New', 'In Progress', 'Completed'];

    return (
      <div className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth touch-pan-x overscroll-x-contain hide-scrollbar">
        {columns.map((col) => {
          const colRecords = records.filter(
            (r) => String(r.data[statusField.name] || '').toLowerCase() === col.toLowerCase()
          );

          return (
            <div key={col} className="bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50 rounded-xl p-4 flex flex-col min-w-[280px] sm:min-w-[320px] w-[280px] sm:w-[320px] max-w-[320px] flex-shrink-0 snap-center max-h-[600px]">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <span className="font-semibold text-sm text-slate-700 dark:text-slate-300">{col}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                  {colRecords.length}
                </span>
              </div>
              <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                {colRecords.map((rec) => (
                  <div
                    key={rec._id}
                    onClick={() => navigate(`/modules/${moduleDef.apiPath}/${rec._id}`)}
                    className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary dark:hover:border-primary/50 rounded-lg shadow-sm cursor-pointer transition-all hover:scale-[1.01]"
                  >
                    <p className="font-semibold text-sm text-slate-800 dark:text-white truncate">
                      {rec.data.firstName || rec.data.lastName
                        ? `${rec.data.firstName || ''} ${rec.data.lastName || ''}`.trim()
                        : rec.data.fullName || rec.data.companyName || rec.data.dealName || rec.data.title || rec._id}
                    </p>
                    <div className="mt-2 space-y-1">
                      {moduleDef.fields.slice(0, 3).map((f) => (
                        <p key={f.name} className="text-[11px] text-slate-400 truncate">
                          <span className="font-medium text-slate-500">{f.label}:</span> {String(rec.data[f.name] || '')}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
                {colRecords.length === 0 && (
                  <div className="py-6 text-center text-xs text-slate-400 border border-dashed rounded-lg border-slate-300 dark:border-slate-700">Drop cards here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Calendar cell layout builder
  const renderCalendar = (moduleDef: ModuleDefinition, records: any[]) => {
    const dateField = moduleDef.fields.find((f) => f.type === 'date');
    if (!dateField) {
      return (
        <div className="py-12 text-center text-slate-500 border rounded-xl border-dashed">
          Calendar view requires at least one date field in the module definition.
        </div>
      );
    }

    // Dynamic month assembly (e.g. June 2026)
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const startDayIndex = new Date(today.getFullYear(), today.getMonth(), 1).getDay(); // sun=0

    const calendarGrid = [];
    // empty blocks
    for (let i = 0; i < startDayIndex; i++) {
      calendarGrid.push(null);
    }
    // day blocks
    for (let i = 1; i <= daysInMonth; i++) {
      calendarGrid.push(i);
    }

    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-semibold text-lg text-slate-800 dark:text-white">
            {today.toLocaleString('default', { month: 'long' })} {today.getFullYear()}
          </h3>
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <Icons.Calendar className="w-4 h-4 text-primary" /> Mapping: <span className="font-semibold text-slate-500">{dateField.label}</span>
          </span>
        </div>
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[650px] pr-1">
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
            </div>

            <div className="grid grid-cols-7 gap-2">
              {calendarGrid.map((day, idx) => {
                if (!day) return <div key={`empty-${idx}`} className="h-24 bg-slate-50 dark:bg-slate-900/30 rounded-lg"></div>;

                // Match records falling on this day
                const dayRecords = records.filter((r) => {
                  if (!r.data[dateField.name]) return false;
                  const recDate = new Date(r.data[dateField.name]);
                  return recDate.getDate() === day && recDate.getMonth() === today.getMonth();
                });

                return (
                  <div key={day} className="h-28 border border-slate-100 dark:border-slate-700 rounded-lg p-2 flex flex-col text-left hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-all">
                    <span className="text-xs font-bold text-slate-500">{day}</span>
                    <div className="mt-1 space-y-1 flex-1 overflow-y-auto scrollbar-none">
                      {dayRecords.map((r) => (
                        <Link
                          key={r._id}
                          to={`/modules/${moduleDef.apiPath}/${r._id}`}
                          className="block text-[9px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded truncate"
                        >
                          {r.data.fullName || r.data.companyName || r.data.dealName || r.data.title || r._id.substring(18)}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Timeline view builder
  const renderTimeline = (records: any[]) => {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
        <h3 className="font-semibold text-lg text-slate-800 dark:text-white mb-6">Module Audit Trail</h3>
        <div className="relative pl-6 border-l border-slate-200 dark:border-slate-700 space-y-6">
          {records.map((rec) => (
            <div key={rec._id} className="relative">
              {/* Dot marker */}
              <div className="absolute -left-[30px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-800 bg-primary shadow-sm"></div>
              
              <div className="text-xs text-left">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{formatDate(rec.createdAt)} {new Date(rec.createdAt).toLocaleTimeString()}</p>
                <p className="text-slate-700 dark:text-slate-300 mt-1">
                  Record Created: <Link to={`/modules/${apiPath}/${rec._id}`} className="font-semibold text-primary hover:underline">
                    {rec.data.fullName || rec.data.companyName || rec.data.dealName || rec.data.title || rec._id}
                  </Link>
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {Object.keys(rec.data).slice(0, 3).map((k) => (
                    <span key={k} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] text-slate-500">
                      {k}: {String(rec.data[k])}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!activeModule) return null;

  if (apiPath === 'campaignassignments') {
    return (
      <div className="space-y-6">
        {renderCampaignAssignments()}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {apiPath === 'campaigns' ? (
        <div className="space-y-6">
          {/* Header Title Bar with Modern Gradient Avatar */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-1">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 flex-shrink-0">
                <Icons.Megaphone className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    Campaigns
                  </h1>
                  <span className="text-xs font-black px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60 shadow-3xs font-mono">
                    {data?.pagination?.total ?? (data?.records?.length || 0)} Total Drives
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                  Create and manage marketing campaign records, track allocated leads, and monitor dial progress.
                </p>
              </div>
            </div>
          </div>

          {/* 6 Vibrant Gradient Metric Cards (including In Progress & Completed) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* Card 1: Total Campaigns */}
            <div 
              onClick={() => setCampaignStatusFilter('all')}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group cursor-pointer ${
                campaignStatusFilter === 'all' 
                  ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-indigo-500/10' 
                  : 'border-indigo-100 dark:border-slate-800 hover:border-indigo-300'
              }`}
              title="Click to view all campaigns"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Total Campaigns
                </span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
                  <Icons.Megaphone className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {campaignSummaryStats.totalCampaigns}
                </span>
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                  Active Drives
                </span>
              </div>
            </div>

            {/* Card 2: In Progress */}
            <div 
              onClick={() => setCampaignStatusFilter(campaignStatusFilter === 'in_progress' ? 'all' : 'in_progress')}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group cursor-pointer ${
                campaignStatusFilter === 'in_progress' 
                  ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-blue-500/10' 
                  : 'border-blue-100 dark:border-slate-800 hover:border-blue-300'
              }`}
              title="Click to filter In Progress campaigns"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  In Progress
                </span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xs">
                  <Icons.PhoneCall className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {campaignSummaryStats.inProgressCount}
                </span>
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                  Active Calling
                </span>
              </div>
            </div>

            {/* Card 3: Completed */}
            <div 
              onClick={() => setCampaignStatusFilter(campaignStatusFilter === 'completed' ? 'all' : 'completed')}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group cursor-pointer ${
                campaignStatusFilter === 'completed' 
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-emerald-500/10' 
                  : 'border-emerald-100 dark:border-slate-800 hover:border-emerald-300'
              }`}
              title="Click to filter Completed campaigns"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Completed
                </span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
                  <Icons.CheckCircle2 className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {campaignSummaryStats.completedCount}
                </span>
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md">
                  100% Dialed
                </span>
              </div>
            </div>

            {/* Card 4: Allocated Leads */}
            <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Allocated Leads
                </span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-xs">
                  <Icons.Users className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {campaignSummaryStats.totalAllocated.toLocaleString()}
                </span>
                <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded-md">
                  Pipeline Leads
                </span>
              </div>
            </div>

            {/* Card 5: Total Dialed */}
            <div className="bg-white dark:bg-slate-900 border border-teal-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 to-emerald-500" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Total Dialed
                </span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-600 flex items-center justify-center text-white shadow-xs">
                  <Icons.PhoneCall className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {campaignSummaryStats.totalDialed.toLocaleString()}
                </span>
                <span className="text-[11px] font-bold text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 px-2 py-0.5 rounded-md">
                  Contacted
                </span>
              </div>
            </div>

            {/* Card 6: Dialing Rate */}
            <div className="bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Dialing Rate
                </span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
                  <Icons.Zap className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {campaignSummaryStats.overallRate}%
                </span>
                <div className="w-16 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200/60 dark:border-slate-700/60">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all" 
                    style={{ width: `${Math.max(campaignSummaryStats.overallRate, 4)}%` }} 
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Inline Campaign Creation Form Studio Card */}
          <form 
            onSubmit={handleSaveCampaign} 
            className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden text-left"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
            
            <div className="flex items-center justify-between mb-4 pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Icons.Sparkles className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  {editCampaignId ? 'Edit Campaign Details' : 'Quick Create Marketing Campaign'}
                </span>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1 max-w-xl">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Campaign Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Icons.Tag className="w-4 h-4 text-indigo-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={campaignNameInput}
                    onChange={(e) => setCampaignNameInput(e.target.value)}
                    placeholder="e.g. Q3 Telecalling Drive, HNI Real Estate, Loan Festival..."
                    className="w-full h-11 pl-10 pr-4 text-xs sm:text-sm font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 transition-all shadow-inner-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2.5 self-end md:self-auto mt-2 md:mt-0">
                {editCampaignId && (
                  <button
                    type="button"
                    onClick={() => {
                      setCampaignNameInput('');
                      setEditCampaignId(null);
                    }}
                    className="h-11 px-5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmittingCampaign || !campaignNameInput.trim()}
                  className="h-11 px-6 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] disabled:opacity-50 text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmittingCampaign ? (
                    <Icons.Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <Icons.Plus className="w-4 h-4 stroke-[2.5]" />
                  )}
                  <span>{editCampaignId ? 'Update Campaign' : 'Create Campaign'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : apiPath === 'leads' ? (
        <div className="space-y-5">
          {/* Header Title Bar with Icon & Live Count */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-1">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-3xs flex-shrink-0">
                <Icons.Users className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">
                    {urlStatus ? (urlStatus.toUpperCase().endsWith('LEADS') ? urlStatus.toUpperCase() : `${urlStatus.toUpperCase()} LEADS`) : 'ALL LEADS'}
                  </h1>
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-3xs font-mono">
                    {data?.pagination?.total ?? (data?.records?.length || 0)} Total
                  </span>
                  {isTodayOnly && (
                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shadow-3xs flex items-center gap-1 font-mono">
                      <Icons.Calendar className="w-3 h-3" /> Today Created
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {urlStatus 
                    ? `Filtering leads with status: ${urlStatus}${isTodayOnly ? ' (Created Today)' : ''}` 
                    : isTodayOnly 
                      ? "Showing leads created today, ordered by newest date."
                      : 'Search, manage, and track leads across all campaigns.'}
                </p>
              </div>
            </div>

            {urlStatus && (
              <Link
                to="/modules/leads"
                className="px-3.5 py-2 text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl transition-all flex items-center gap-1.5 shadow-3xs cursor-pointer"
              >
                <Icons.X className="w-3.5 h-3.5" />
                <span>Clear Status Filter</span>
              </Link>
            )}
          </div>

          {/* Premium Control Bar with Generous Padding */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Create Lead Button */}
            <Link
              to="/modules/leads/new"
              className="inline-flex items-center justify-center gap-2 h-10 px-5 bg-[#17223B] hover:bg-[#223050] active:bg-[#0F172A] text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-xs transition-all self-start lg:self-auto cursor-pointer"
            >
              <Icons.Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create Lead</span>
            </Link>

            {/* Search Input & Action Buttons Form */}
            <form 
              onSubmit={handleSearchSubmit}
              className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 w-full"
            >
              <div className="relative flex-1 max-w-md">
                <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchVal}
                  onChange={(e) => setSearchVal(e.target.value)}
                  placeholder="Search by name, lead number, created by, mobile..."
                  className="w-full h-10 pl-10 pr-9 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
                />
                {searchVal && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchVal('');
                      setPage(1);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-1 rounded cursor-pointer"
                    title="Clear search"
                  >
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  type="submit"
                  className="h-10 px-5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Icons.Search className="w-3.5 h-3.5 stroke-[2.2]" />
                  <span>Search</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsTodayOnly(!isTodayOnly);
                    setPage(1);
                  }}
                  className={`h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap border ${
                    isTodayOnly
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-600/25 hover:bg-emerald-700'
                      : 'bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                  title={isTodayOnly ? "Clear today's filter" : "Show only leads created today"}
                >
                  <Icons.Calendar className="w-3.5 h-3.5" />
                  <span>{isTodayOnly ? "Today's Leads (Active)" : "Today's Leads"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadAll}
                  className="h-10 px-4.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  title="Reset filters and load all leads"
                >
                  <Icons.RotateCcw className="w-3.5 h-3.5 stroke-[2]" />
                  <span>Load All</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        <>
          {/* Title & Add new header bar */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 text-primary rounded-xl">
                <DynamicIcon name={activeModule.icon} className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl uppercase font-bold tracking-tight text-slate-800 dark:text-white">
                  {urlStatus ? `${urlStatus} Leads` : activeModule.pluralLabel}
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  {urlStatus ? `Showing leads with status: ${urlStatus}` : 'Manage database records'}
                </p>
              </div>
              {urlStatus && (
                <Link
                  to={`/modules/${activeModule.apiPath}`}
                  className="ml-2 px-3 py-1.5 text-xs font-semibold bg-rose-100 text-rose-600 rounded-lg hover:bg-rose-200 transition-all flex items-center gap-1"
                >
                  <Icons.X className="w-3 h-3" /> Clear Filter
                </Link>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={handleExportCSV}
                className="flex-1 sm:flex-none justify-center px-4 py-2 border border-[#EAE4DA] bg-white hover:bg-[#F8F5F1] rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-[#1F2937] flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
              >
                <Icons.Download className="w-4 h-4" /> Export CSV
              </button>
              <Link
                to={`/modules/${activeModule.apiPath}/new`}
                className="flex-1 sm:flex-none justify-center px-5 py-2 bg-[#17223B] hover:bg-[#24324A] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-[0_2px_6px_rgba(23,34,59,0.12)] hover:shadow-[0_4px_12px_rgba(23,34,59,0.2)]"
              >
                <Icons.Plus className="w-4 h-4" /> Add {activeModule.singularLabel}
              </Link>
            </div>
          </div>

          {/* Filtering Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-end gap-4 border-b border-slate-200 dark:border-slate-700/50 pb-4">

            {/* Inline Search / Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchVal}
                  onChange={(e) => setSearchVal(e.target.value)}
                  placeholder="Search rows..."
                  className="pl-9 pr-4 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-slate-700 dark:text-slate-300"
                />
              </div>

              {/* Quick status dropdown filter */}
              {activeModule.fields.find((f) => f.type === 'dropdown') && (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-slate-400">Filter:</span>
                  <select
                    value={filterVal}
                    onChange={(e) => {
                      const dropField = activeModule.fields.find((f) => f.type === 'dropdown');
                      setFilterField(dropField?.name || '');
                      setFilterVal(e.target.value);
                    }}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none text-slate-700 dark:text-slate-300"
                  >
                    <option value="">All Stages</option>
                    {activeModule.fields
                      .find((f) => f.type === 'dropdown')
                      ?.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Render selected Mode Layout (Instant render with zero shimmer if data or cached data exists) */}
      {isLoading && !data ? (
        <div className="space-y-4 py-8">
          <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded animate-shimmer"></div>
          <div className="h-32 bg-slate-100 dark:bg-slate-800 rounded animate-shimmer"></div>
        </div>
      ) : (
        <>
          {viewMode === 'table' && (
            apiPath === 'campaigns' ? (
              <div className="space-y-6">
                {/* Campaign Status Filter Menu Tabs */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 w-fit">
                    <button
                      type="button"
                      onClick={() => setCampaignStatusFilter('all')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                        campaignStatusFilter === 'all'
                          ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs ring-1 ring-black/5'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icons.Layers className="w-3.5 h-3.5" />
                      <span>All Campaigns</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        campaignStatusFilter === 'all' ? 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {campaignSummaryStats.totalCampaigns}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCampaignStatusFilter('in_progress')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                        campaignStatusFilter === 'in_progress'
                          ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs ring-1 ring-black/5'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icons.PhoneCall className="w-3.5 h-3.5" />
                      <span>In Progress</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        campaignStatusFilter === 'in_progress' ? 'bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {campaignSummaryStats.inProgressCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCampaignStatusFilter('completed')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                        campaignStatusFilter === 'completed'
                          ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs ring-1 ring-black/5'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icons.CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Completed</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        campaignStatusFilter === 'completed' ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {campaignSummaryStats.completedCount}
                      </span>
                    </button>
                  </div>

                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Showing <span className="font-extrabold text-slate-900 dark:text-white">{displayedCampaignRecords.length}</span> of {data?.records?.length || 0} campaigns
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[850px] text-left text-xs text-slate-800 dark:text-slate-200">
                      <thead>
                        <tr className="bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/80">
                          <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">Campaign</th>
                          <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">Created Date</th>
                          <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider text-center">Allocated Leads</th>
                          <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider text-center">Dialed</th>
                          <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">Calling Progress</th>
                          <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {displayedCampaignRecords.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                              <div className="flex flex-col items-center justify-center gap-2">
                                <Icons.Megaphone className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                  No {campaignStatusFilter === 'in_progress' ? 'In Progress' : campaignStatusFilter === 'completed' ? 'Completed' : ''} campaigns found
                                </p>
                                {campaignStatusFilter !== 'all' && (
                                  <button
                                    type="button"
                                    onClick={() => setCampaignStatusFilter('all')}
                                    className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                  >
                                    Show all campaigns
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : (
                          displayedCampaignRecords.map((rec: any) => {
                          const name = rec.data?.campaignName || rec.data?.source || rec.data?.campaign || rec.data?.name || rec.name || 'Unnamed Campaign';
                          const allocated = getAllocatedNumbers(name);
                          const dialed = getDialedNumbers(name);
                          const rawPct = allocated > 0 ? (dialed / allocated) * 100 : 0;
                          const isCompleted = dialed >= allocated && allocated > 0;
                          const isInProgress = dialed > 0 && !isCompleted;
                          const progressText = isCompleted
                            ? '100%'
                            : isInProgress
                              ? (rawPct < 1 ? `${rawPct.toFixed(1)}%` : rawPct >= 99.9 ? '99.9%' : `${Math.floor(rawPct)}%`)
                              : '0%';
                          const createdDateStr = new Date(rec.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + new Date(rec.createdAt).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          });

                          const isDeactive = (rec.data?.status || '').toString().toLowerCase().includes('deactiv') ||
                            (rec.data?.status || '').toString().toLowerCase().includes('inactiv') ||
                            rec.data?.isActive === false || rec.isActive === false;

                          return (
                            <tr key={rec._id} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/60 transition-colors">
                              <td className="px-6 py-4.5 font-bold text-slate-900 dark:text-white">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-xs flex-shrink-0">
                                    <Icons.Megaphone className="w-5 h-5 stroke-[2.2]" />
                                  </div>
                                  <div>
                                    <Link
                                      to={`/my-campaign?campaign=${encodeURIComponent(name)}`}
                                      className="capitalize block text-sm font-extrabold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 tracking-tight transition-colors cursor-pointer"
                                      title="Click to view campaign telecalling details"
                                    >
                                      {name}
                                    </Link>
                                    {isDeactive ? (
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800/60">
                                        Deactive Campaign
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60">
                                        Active Campaign
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4.5 text-slate-500 dark:text-slate-400 font-medium">
                                <span className="inline-flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-200/60 dark:border-slate-700/60 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                  <Icons.Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                  {createdDateStr}
                                </span>
                              </td>
                              <td className="px-6 py-4.5 text-center">
                                <span className="inline-flex items-center justify-center font-bold px-3 py-1 rounded-full bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 font-mono text-xs shadow-3xs">
                                  {allocated.toLocaleString()} Leads
                                </span>
                              </td>
                              <td className="px-6 py-4.5 text-center">
                                <span className="inline-flex items-center justify-center font-bold px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 font-mono text-xs shadow-3xs">
                                  {dialed.toLocaleString()} Dialed
                                </span>
                              </td>
                              <td className="px-6 py-4.5 min-w-[140px]">
                                <div className="space-y-1.5">
                                  <div className="flex justify-between items-center text-xs">
                                    <span className="font-extrabold text-slate-800 dark:text-slate-100 font-mono">{progressText}</span>
                                    <span className={`text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                                      isCompleted ? 'text-emerald-700 bg-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-300' :
                                      isInProgress ? 'text-indigo-700 bg-indigo-100/80 dark:bg-indigo-950/60 dark:text-indigo-300' :
                                      'text-slate-500 bg-slate-100 dark:bg-slate-800'
                                    }`}>
                                      {isCompleted ? 'Completed' : isInProgress ? 'IN PROGRESS' : 'PENDING'}
                                    </span>
                                  </div>
                                  <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200/60 dark:border-slate-700/60 p-0.5">
                                    <div 
                                      className="h-full rounded-full transition-all bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" 
                                      style={{ width: `${Math.max(rawPct, dialed > 0 ? 3 : 0)}%` }} 
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4.5 text-right">
                                <div className="inline-flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => handleDownloadCampaign(rec)}
                                    className="h-8.5 px-3 bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-150 text-indigo-700 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 rounded-xl text-xs font-bold shadow-3xs transition-all inline-flex items-center gap-1.5 cursor-pointer"
                                    title="Download 12-Column CSV"
                                  >
                                    <Icons.Download className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Export</span>
                                  </button>
                                  <button
                                    onClick={() => handleEditClick(rec)}
                                    className="w-8.5 h-8.5 rounded-xl bg-amber-50 hover:bg-amber-100 active:bg-amber-150 text-amber-700 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center transition-all shadow-3xs cursor-pointer"
                                    title="Edit Campaign"
                                  >
                                    <Icons.Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(rec._id)}
                                    className="w-8.5 h-8.5 rounded-xl bg-rose-50 hover:bg-rose-100 active:bg-rose-150 text-rose-600 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800/80 flex items-center justify-center transition-all shadow-3xs cursor-pointer"
                                    title="Delete Campaign"
                                  >
                                    <Icons.Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        }))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : apiPath === 'leads' ? (
              <div className="space-y-6">
                {data?.records.map((rec: any, idx: number) => {
                  const rawCode = rec.data?.['Data Code'] || rec.data?.dataCode || rec.data?.data_code || rec.data?.leadNo || rec.data?.leadNumber || rec.data?.code || (rec._id ? rec._id.slice(-6).toUpperCase() : '');
                  const leadNo = rawCode ? (String(rawCode).trim().toUpperCase().startsWith('LND-') ? String(rawCode).trim().toUpperCase() : `LND-${String(rawCode).trim().toUpperCase()}`) : 'N/A';
                  
                  const extractField = (dataObj: any, targets: string[], contains: string[] = []): string => {
                    if (!dataObj || typeof dataObj !== 'object') return '';
                    for (const t of targets) {
                      if (dataObj[t] !== undefined && dataObj[t] !== null) {
                        const v = String(dataObj[t]).trim();
                        if (v && v !== 'N/A' && v !== 'Unnamed') return v;
                      }
                    }
                    const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const normTargets = targets.map(norm);
                    const keys = Object.keys(dataObj);
                    for (const k of keys) {
                      if (normTargets.includes(norm(k))) {
                        const v = String(dataObj[k] || '').trim();
                        if (v && v !== 'N/A' && v !== 'Unnamed') return v;
                      }
                    }
                    if (contains.length > 0) {
                      const normContains = contains.map(norm);
                      for (const k of keys) {
                        if (normContains.some(c => norm(k).includes(c))) {
                          const v = String(dataObj[k] || '').trim();
                          if (v && v !== 'N/A' && v !== 'Unnamed') return v;
                        }
                      }
                    }
                    return '';
                  };

                  const fullName = `${rec.data?.firstName || ''} ${rec.data?.lastName || ''}`.trim();
                  const leadName = (fullName && fullName !== 'Unnamed' ? fullName : '') ||
                    extractField(
                      rec.data,
                      ['customer', 'customerName', 'customer_name', 'fullName', 'client', 'clientName', 'leadName', 'name', 'costomer'],
                      ['customer', 'client']
                    ) || 'N/A';

                  const leadLocation = extractField(
                    rec.data,
                    ['location', 'city', 'district', 'state', 'presentAddress', 'address', 'place', 'area', 'branch'],
                    ['location', 'city', 'district', 'address']
                  ) || 'N/A';

                  const rawPhone = extractField(
                    rec.data,
                    ['phone', 'mobile', 'contact', 'contactNum', 'contact_num', 'contactNumber', 'contact_number', 'phoneNumber', 'phone_number', 'mobileNo', 'mobile_no', 'cell', 'telephone', 'phNo', 'mobNo', 'telNo', 'name_contact_num', 'nameContactNum'],
                    ['phone', 'mobile', 'contact', 'cell']
                  );
                  const leadPhone = rawPhone || 'N/A';

                  const leadCompany = extractField(
                    rec.data,
                    ['company', 'firmName', 'firm_name', 'firm', 'businessName', 'business', 'agencyName', 'agency', 'shopName', 'shop', 'tradeName', 'organization'],
                    ['firm', 'company', 'agency', 'business']
                  ) || 'N/A';

                  const leadProduct = extractField(
                    rec.data,
                    ['loanType', 'loan_type', 'leadCategory', 'lead_category', 'category', 'product', 'serviceType'],
                    ['category', 'loantype']
                  ) || 'N/A';

                  const amountVal = rec.data?.budget ?? rec.data?.loanAmount ?? rec.data?.amount;
                  const currencySymbol = '₹';
                  const formattedAmount = amountVal != null && amountVal !== '' ? `${currencySymbol}${Number(amountVal).toLocaleString('en-IN')}` : 'N/A';
                  const createdByName = rec.createdBy?.firstName 
                    ? `${rec.createdBy.firstName} ${rec.createdBy.lastName || ''}`.trim()
                    : (rec.createdBy?.name || rec.createdBy?.email?.split('@')[0] || (typeof rec.createdBy === 'string' && rec.createdBy.length < 25 && !rec.createdBy.match(/^[0-9a-fA-F]{24}$/) ? rec.createdBy : '') || rec.data?.source || rec.data?.createdBy || 'Ink CRM');

                  const assignedToName = rec.data?.assignedToName || resolveUserDisplayName(rec.data?.assignedTo || rec.data?.assignTo || rec.assignedTo);
                  const assignedByName = rec.data?.assignedByName 
                    ? resolveUserDisplayName(rec.data.assignedByName) 
                    : (rec.data?.assignedBy 
                        ? resolveUserDisplayName(rec.data.assignedBy) 
                        : (createdByName && createdByName !== 'System' && createdByName !== 'N/A' ? createdByName : 'System Router'));
                  const psmName = rec.data?.psmName || resolveUserDisplayName(rec.data?.psm || rec.data?.assignedTo || 'Unassigned');

                  const isFollowupCard = String(rec.data?.status || rec.data?.normalizedStatus || '').toUpperCase().includes('FOLLOW');
                  const actualStage = rec.data?.stageStatus || rec.data?.originalStatus || rec.data?.previousStatus || rec.data?.leadStage || (rec.data?.dialStatus && !String(rec.data.dialStatus).toUpperCase().includes('FOLLOW') ? rec.data.dialStatus : '');
                  
                  const displayStatusText = isFollowupCard
                    ? (actualStage ? `${actualStage.toUpperCase()} (FOLLOWUP)` : 'HOT LEADS (FOLLOWUP)')
                    : (rec.data?.status || 'NEW');

                  const statusThemeColor = getCardThemeColor(isFollowupCard && actualStage ? actualStage : (rec.data?.status || 'HOT'));

                  const badgeLabelText = isFollowupCard
                    ? (actualStage ? (actualStage.toUpperCase().endsWith('LEAD') || actualStage.toUpperCase().endsWith('LEADS') ? actualStage.toUpperCase() : `${actualStage.toUpperCase()} LEAD`) : 'HOT LEAD')
                    : (rec.data?.status ? (rec.data.status.toUpperCase().endsWith('LEAD') || rec.data.status.toUpperCase().endsWith('LEADS') ? rec.data.status.toUpperCase() : `${rec.data.status.toUpperCase()} LEAD`) : 'LEAD INFO');

                  return (
                    <div key={rec._id} className="border border-[#EAE4DA] dark:border-slate-800 rounded-2xl p-4 sm:p-6 bg-white dark:bg-slate-900 relative mb-6 last:mb-0 text-left shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                      {/* Status-colored Top Accent Bar */}
                      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ backgroundColor: statusThemeColor }} />
                      
                      {/* True 4-Column CSS Grid - All 20 cells direct children for flawless row-to-row alignment */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 sm:gap-x-8 gap-y-4 sm:gap-y-6 text-sm mt-1">
                        {/* --- Row 1 --- */}
                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Sl No.: </span>
                          <span className="text-[#44403C] dark:text-stone-300">{(page - 1) * (data?.pagination?.limit || 10) + idx + 1}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Lead Name: </span>
                          <span className="text-[#1C1917] dark:text-stone-100 font-semibold">{leadName}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Created On: </span>
                          <span className="text-[#44403C] dark:text-stone-300">{formatDate(rec.createdAt)}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Firm/Company: </span>
                          <span className="text-[#44403C] dark:text-stone-300">{leadCompany}</span>
                        </div>

                        {/* --- Row 2 --- */}
                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Lead No.: </span>
                          <span className="text-[#44403C] dark:text-stone-300 font-mono">{leadNo}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Location: </span>
                          <span className="text-[#44403C] dark:text-stone-300">{leadLocation}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Created By: </span>
                          <span className="text-[#44403C] dark:text-stone-300 font-medium">{createdByName}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Modified On: </span>
                          <span className="text-[#44403C] dark:text-stone-300">{formatDate(rec.updatedAt)}</span>
                        </div>

                        {/* --- Row 3 --- */}
                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Product: </span>
                          <span className="text-[#44403C] dark:text-stone-300 uppercase">{leadProduct}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Mobile No.: </span>
                          <span className="text-[#44403C] dark:text-stone-300 font-mono">{maskPhoneNumber(leadPhone)}</span>
                        </div>

                        <div className="text-[13px] leading-snug flex items-center flex-wrap gap-1">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Followup Date: </span>
                          <span className="inline-flex items-center text-indigo-700 dark:text-indigo-300 font-bold bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/40 px-2 py-0.5 rounded text-[11px] leading-tight">
                            {rec.data?.followUpDate ? formatDate(rec.data.followUpDate) : 'N/A'}
                          </span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Assigned By: </span>
                          <span className="text-[#44403C] dark:text-stone-300 font-medium">{assignedByName}</span>
                        </div>

                        {/* --- Row 4 --- */}
                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Status: </span>
                          <span className="text-[#44403C] dark:text-stone-300 uppercase font-semibold">{displayStatusText}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Amount: </span>
                          <span className="text-emerald-700 dark:text-emerald-400 font-bold">{formattedAmount}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Pending at: </span>
                          <span className="text-[#44403C] dark:text-stone-300 uppercase">{rec.data?.assignToTeam || rec.data?.pendingAt || 'SALES MANAGER'}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Assigned To: </span>
                          <span className="text-indigo-600 dark:text-indigo-400 font-bold">{assignedToName}</span>
                        </div>

                        {/* --- Row 5 --- */}
                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Bank Partner: </span>
                          <span className="text-[#44403C] dark:text-stone-300 uppercase">{rec.data?.businessPartner || rec.data?.bankPartner || 'N/A'}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Case Details: </span>
                          <span className="text-[#44403C] dark:text-stone-300">{rec.data?.caseDetails || 'N/A'}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">PSM: </span>
                          <span className="text-[#44403C] dark:text-stone-300">{psmName}</span>
                        </div>

                        <div className="text-[13px] leading-snug">
                          <span className="font-semibold text-[#1C1917] dark:text-stone-100">Remarks: </span>
                          <span className="text-slate-500 dark:text-slate-400 italic text-xs">{rec.data?.notes ? rec.data.notes.replace(/<[^>]*>/g, '') : (rec.data?.dataCode || 'N/A')}</span>
                        </div>
                      </div>

                      {/* Bottom Action / Button Row */}
                      <div className="mt-6 sm:mt-7 pt-4 sm:pt-5 border-t border-[#EAE4DA] dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span 
                            className="text-[10.5px] font-[800] uppercase tracking-wider px-3 py-1.5 rounded-lg border shadow-3xs flex items-center gap-1.5"
                            style={{
                              backgroundColor: `${statusThemeColor}12`,
                              borderColor: `${statusThemeColor}30`,
                              color: statusThemeColor
                            }}
                          >
                            <Icons.Flame className="w-3.5 h-3.5 stroke-[2.5]" />
                            <span>{badgeLabelText}</span>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (rawPhone) {
                                openWhatsAppChat(rawPhone);
                              } else {
                                showToast('No phone number available for this lead.', 'warning');
                              }
                            }}
                            className="h-8 px-3.5 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-150 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30 dark:hover:bg-emerald-900/40 text-[10.5px] font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center gap-1.5 cursor-pointer shadow-3xs"
                          >
                            <Icons.MessageCircle className="w-3.5 h-3.5" />
                            <span>WA Chat</span>
                          </button>
                          
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (rawPhone) {
                                showToast(`Calling ${leadName}...`, 'info');
                                triggerPhoneCall(rawPhone);
                              } else {
                                showToast('No phone number available for this lead.', 'warning');
                              }
                            }}
                            className="h-8 px-3.5 bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-150 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-900/30 dark:hover:bg-indigo-900/40 text-[10.5px] font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center gap-1.5 cursor-pointer shadow-3xs"
                          >
                            <Icons.Phone className="w-3.5 h-3.5" />
                            <span>Call</span>
                          </button>
                          
                          <button 
                            onClick={() => handleUploadClick(rec._id)}
                            className="h-8 px-3.5 bg-amber-50 hover:bg-amber-100 active:bg-amber-150 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30 dark:hover:bg-amber-900/40 text-[10.5px] font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center gap-1.5 cursor-pointer shadow-3xs"
                          >
                            <Icons.Upload className="w-3.5 h-3.5" />
                            <span>Upload File</span>
                          </button>
                          
                          <Link 
                            to={`/modules/leads/${rec._id}`} 
                            className="h-8 px-3.5 bg-cyan-50 hover:bg-cyan-100 active:bg-cyan-150 text-cyan-700 border border-cyan-200 dark:bg-cyan-950/20 dark:text-cyan-400 dark:border-cyan-900/30 dark:hover:bg-cyan-900/40 text-[10.5px] font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center gap-1.5 shadow-3xs"
                          >
                            <Icons.SquarePen className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </Link>

                          <button 
                            onClick={() => openHistory(rec)}
                            className="h-8 px-3.5 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-700 border border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/60 dark:hover:bg-slate-700/80 text-[10.5px] font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center gap-1.5 cursor-pointer shadow-3xs"
                          >
                            <Icons.History className="w-3.5 h-3.5" />
                            <span>History</span>
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}

                {data?.records.length === 0 && (
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 text-center shadow-xs">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-3xs">
                      <Icons.SearchX className="w-7 h-7 stroke-[2]" />
                    </div>
                    <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wide mb-1">
                      No Leads Found
                    </h3>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
                      {searchVal 
                        ? `No leads matched your search "${searchVal}"${urlStatus ? ` with status ${urlStatus}` : ''}${isTodayOnly ? ' created today' : ''}.`
                        : urlStatus 
                          ? `There are no leads currently under "${urlStatus}" status${isTodayOnly ? ' created today' : ''}.`
                          : isTodayOnly
                            ? 'No leads have been created today yet.'
                            : 'No lead records found in this view.'}
                    </p>
                    <div className="flex items-center justify-center gap-3 flex-wrap">
                      {searchVal && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchVal('');
                            setPage(1);
                          }}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Icons.X className="w-3.5 h-3.5" /> Clear Search
                        </button>
                      )}
                      {isTodayOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsTodayOnly(false);
                            setPage(1);
                          }}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Icons.Calendar className="w-3.5 h-3.5" /> Show All Dates
                        </button>
                      )}
                      {(urlStatus || searchVal || isTodayOnly) && (
                        <button
                          type="button"
                          onClick={handleLoadAll}
                          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Icons.RotateCcw className="w-3.5 h-3.5" /> Load All Leads
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto pb-2 -mx-2 px-2 sm:mx-0 sm:px-0">
                  <table className="w-full min-w-[800px] text-left text-sm text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="px-6 py-4">Name / ID</th>
                        {activeModule.fields.slice(1, 5).map((field) => (
                          <th key={field.name} className="px-6 py-4">
                            {field.label}
                          </th>
                        ))}
                        <th className="px-6 py-4">Created At</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {data?.records.map((rec: any) => {
                        const leadName = rec.data.firstName || rec.data.lastName
                          ? `${rec.data.firstName || ''} ${rec.data.lastName || ''}`.trim()
                          : null;
                        const mainVal =
                          leadName ||
                          rec.data.fullName ||
                          rec.data.companyName ||
                          rec.data.dealName ||
                          rec.data.title ||
                          rec._id;

                        return (
                          <tr key={rec._id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                            <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">
                              <Link to={`/modules/${activeModule.apiPath}/${rec._id}`} className="hover:underline text-primary">
                                {mainVal}
                              </Link>
                            </td>
                            {activeModule.fields.slice(1, 5).map((field) => (
                              <td key={field.name} className="px-6 py-4 truncate max-w-[150px]">
                                {field.type === 'currency' 
                                  ? `₹${Number(rec.data[field.name] || 0).toLocaleString('en-IN')}` 
                                  : field.type === 'date'
                                    ? formatDate(rec.data[field.name])
                                    : String(rec.data[field.name] || '-')}
                              </td>
                            ))}
                            <td className="px-6 py-4 text-xs text-slate-400">
                              {formatDate(rec.createdAt)}
                            </td>
                            <td className="px-6 py-4 text-right space-x-3">
                              <Link
                                to={`/modules/${activeModule.apiPath}/${rec._id}`}
                                className="text-primary hover:text-indigo-400 font-medium text-xs"
                              >
                                Edit
                              </Link>
                              <button
                                onClick={() => handleDelete(rec._id)}
                                className="text-rose-500 hover:text-rose-400 font-medium text-xs"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {data?.records.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-slate-400">
                            No records loaded matching queries.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {/* Pagination bar */}
          <div className="px-6 py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-3 text-xs shadow-xs mt-6">
            <div className="flex items-center gap-3">
              <span className="text-slate-500 dark:text-slate-400 font-medium">
                Showing page <span className="font-bold text-slate-800 dark:text-slate-200">{page}</span> of{' '}
                <span className="font-bold text-slate-800 dark:text-slate-200">{data?.pagination?.totalPages || 1}</span>
                <span className="ml-2 text-slate-400 font-mono">({(data?.pagination?.total ?? (data?.records?.length || 0)).toLocaleString()} Total Records)</span>
              </span>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold">Per Page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-8 px-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-bold text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value={10}>10 leads (Instant .02s)</option>
                  <option value={25}>25 leads</option>
                  <option value={50}>50 leads</option>
                  <option value={100}>100 leads</option>
                  <option value={250}>250 leads</option>
                  <option value={500}>500 leads</option>
                  <option value={1000}>1,000 leads</option>
                  <option value={5000}>5,000 leads</option>
                  <option value={10000}>10,000 leads</option>
                  <option value={100000}>All (100,000 leads)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="h-8.5 px-3.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs disabled:opacity-40 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Icons.ChevronLeft className="w-3.5 h-3.5" />
                  Previous
                </button>
                <button
                  disabled={page >= (data?.pagination?.totalPages || 1)}
                  onClick={() => setPage(page + 1)}
                  className="h-8.5 px-3.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs disabled:opacity-40 transition-all flex items-center gap-1 cursor-pointer"
                >
                  Next
                  <Icons.ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {viewMode === 'kanban' && renderKanban(activeModule, data?.records || [])}

          {viewMode === 'calendar' && renderCalendar(activeModule, data?.records || [])}

          {viewMode === 'timeline' && renderTimeline(data?.records || [])}
        </>
      )}
      {/* Hidden file uploader */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />

      {/* Record History & Timeline Modal */}
      {activeHistoryRecord && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white text-lg uppercase tracking-tight">
                  Lead Audit History
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Lead Name: <span className="text-slate-800 dark:text-white font-bold">{activeHistoryRecord.data?.firstName} {activeHistoryRecord.data?.lastName}</span> • Lead No: <span className="font-mono font-bold text-indigo-600">LND-{activeHistoryRecord._id.slice(-6).toUpperCase()}</span>
                </p>
              </div>
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-500 dark:text-slate-400 transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {loadingHistory ? (
                <div className="flex justify-center items-center py-12">
                  <Icons.Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Documents Section */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Icons.File className="w-3.5 h-3.5 text-amber-500" /> Attached Documents ({historyDocuments.length})
                    </h4>
                    {historyDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {historyDocuments.map((doc: any) => (
                          <div key={doc._id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-805">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Icons.FileText className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{doc.name}</p>
                                <p className="text-[10px] text-slate-400">{(doc.size / 1024).toFixed(1)} KB</p>
                              </div>
                            </div>
                            <a 
                              href={`${FILE_BASE_URL}${doc.filePath}`} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                            >
                              <Icons.Download className="w-3.5 h-3.5" /> Download
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No files attached to this record.</p>
                    )}
                  </div>

                  {/* Comprehensive Audit & Modification History */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-2">
                      <Icons.History className="w-4 h-4 text-indigo-600" /> Full Audit & Modification History ({historyActivities.length})
                    </h4>

                    {historyActivities.length > 0 ? (
                      <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-3 pl-6 space-y-6">
                        {historyActivities.map((act: any) => {
                          const dateObj = new Date(act.createdAt);
                          const dateStr = formatDate(act.createdAt);
                          const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                          const performerName = act.userId ? `${act.userId.firstName || ''} ${act.userId.lastName || ''}`.trim() : (act.performedBy ? `${act.performedBy.firstName || ''} ${act.performedBy.lastName || ''}`.trim() : 'System Router');
                          
                          const d = act.details || {};
                          const fieldName = d.fieldName || '';
                          const isStatusChange = act.type === 'status_change' || fieldName === 'status';
                          const isAssignment = act.type === 'assignment' || fieldName === 'assignedTo';
                          const isCreation = act.type === 'create';

                          return (
                            <div key={act._id} className="relative bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 p-3.5 rounded-2xl space-y-2">
                              {/* Dot Icon */}
                              <span className={`absolute -left-[31px] top-4 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 ${
                                isStatusChange ? 'bg-indigo-600' : isAssignment ? 'bg-emerald-600' : isCreation ? 'bg-blue-600' : 'bg-amber-500'
                              }`} />

                              {/* Header & Event Badge */}
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md border ${
                                  isStatusChange ? 'bg-indigo-50 border-indigo-200 text-indigo-700' :
                                  isAssignment ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                                  isCreation ? 'bg-blue-50 border-blue-200 text-blue-700' :
                                  'bg-amber-50 border-amber-200 text-amber-700'
                                }`}>
                                  {isStatusChange ? 'STATUS UPDATED' : isAssignment ? 'LEAD TRANSFERRED / ASSIGNED' : isCreation ? 'LEAD CREATED' : `EDITED (${fieldName.toUpperCase()})`}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">
                                  {dateStr} • {timeStr}
                                </span>
                              </div>

                              {/* Activity Details: Old vs New Values */}
                              <div className="text-xs space-y-1">
                                {isStatusChange && (
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Status Changed: <span className="line-through text-rose-500 font-bold">{d.oldValue || 'N/A'}</span> ➔ <span className="text-emerald-600 font-bold uppercase">{d.newValue || 'Updated'}</span>
                                  </div>
                                )}

                                {isAssignment && (
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Lead Transferred To: <span className="line-through text-slate-400">{d.oldValue || 'Unassigned'}</span> ➔ <span className="text-indigo-600 font-bold">{d.newValue || 'Agent'}</span>
                                  </div>
                                )}

                                {!isStatusChange && !isAssignment && !isCreation && (
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    {fieldName ? `Field '${fieldName}': ` : ''}
                                    <span className="line-through text-slate-400">{String(d.oldValue || 'N/A')}</span> ➔ <span className="text-slate-900 dark:text-white font-bold">{String(d.newValue || 'N/A')}</span>
                                  </div>
                                )}

                                {isCreation && (
                                  <div className="font-semibold text-slate-700 dark:text-slate-300">
                                    Lead initially registered in system with status: <span className="font-bold text-indigo-600 uppercase">{activeHistoryRecord.data?.status || 'New'}</span>
                                  </div>
                                )}

                                {d.commentText && (
                                  <p className="text-[11px] text-slate-500 italic mt-1 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                    "{d.commentText}"
                                  </p>
                                )}
                              </div>

                              {/* Performed By footer */}
                              <div className="text-[10px] text-slate-400 font-semibold pt-1 border-t border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between">
                                <span>Action by: <span className="text-slate-700 dark:text-slate-300 font-bold">{performerName}</span></span>
                                <span>Record ID: LND-{activeHistoryRecord._id.slice(-6).toUpperCase()}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic text-center py-6">No modification history logged for this record yet.</p>
                    )}
                  </div>
                </>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl uppercase transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
