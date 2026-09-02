import React, { useState, useEffect } from 'react';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import MultiSelectDropdown from '../components/MultiSelectDropdown';

export default function ImportDeleteLeads() {
  const { showToast, showAlertModal, showConfirm } = useToastStore();
  const [activeTab, setActiveTab] = useState<'import' | 'delete' | 'duplicates'>('import');

  // Common State
  const [telecallers, setTelecallers] = useState<any[]>([]);
  const [leadStatuses, setLeadStatuses] = useState<string[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgressStatus, setImportProgressStatus] = useState('');
  const [importProgressPercent, setImportProgressPercent] = useState(0);

  // Delete State (By User + Particular Date + Actual Lead Process Status)
  const [deleteAgent, setDeleteAgent] = useState('');
  const [deleteDate, setDeleteDate] = useState('');
  const [deleteStatus, setDeleteStatus] = useState('');
  const [matchingLeadsCount, setMatchingLeadsCount] = useState<number | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Duplicate Leads State (Matching Lead No, Lead Name, Created Date, Phone, Assigned To, Assigned By)
  const [dupStatus, setDupStatus] = useState('');
  const [dupAgent, setDupAgent] = useState('');
  const [dupDate, setDupDate] = useState('');
  const [dupMonth, setDupMonth] = useState('');
  const [dupYear, setDupYear] = useState('2026');
  const [scanMode, setScanMode] = useState<'all_match' | 'phone_only'>('all_match');
  const [duplicateScanResult, setDuplicateScanResult] = useState<{
    duplicateGroups: number;
    extraDuplicatesCount: number;
    idsToDelete: string[];
  } | null>(null);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);
  const [isPurgingDuplicates, setIsPurgingDuplicates] = useState(false);

  const monthsList = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const yearsList = ['2026', '2025', '2024', '2023'];

  // Default Lead Process Statuses fallback
  const defaultLeadStatuses = [
    'NEW',
    'HOT LEADS',
    'WARM LEADS',
    'COOL LEADS',
    'FOLLOWUP',
    'PENDING',
    'DOCUMENT PENDING',
    'APPROVAL PENDING',
    'APPROVED BUT NOT DISBUSE',
    'DISBURSED',
    'REJECTED',
    'DROPPED',
    'NOT INTERESTED',
    'NO ANSWER',
    'WRONG NUM',
    'UNTOUCHED'
  ];

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoadingInitial(true);
    try {
      const [usersRes, statusRes] = await Promise.all([
        api.get('/auth/users?purpose=dropdown').catch(() => ({ data: [] })),
        api.get('/statuses').catch(() => ({ data: [] }))
      ]);

      const fetchedUsers = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.users || [];
      setTelecallers(fetchedUsers);

      const fetchedStatuses = Array.isArray(statusRes.data) ? statusRes.data.map((s: any) => s.name).filter(Boolean) : [];
      if (fetchedStatuses.length > 0) {
        setLeadStatuses(fetchedStatuses);
      } else {
        setLeadStatuses(defaultLeadStatuses);
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to load initial data.', 'error');
    } finally {
      setLoadingInitial(false);
    }
  };

  // ── DOWNLOAD SAMPLE CSV TEMPLATE ──────────────────────────────────────────
  const handleDownloadSampleCSV = () => {
    const csvContent = 'Customer Name,Mobile No,Firm Name,Location,Lead Category,Amount,Status,Remarks\n' +
      'Rajesh Kumar,9876543210,M S Traders,Bangalore,Personal Loan,500000,HOT LEADS,Interested in quick disbursement\n' +
      'Anita Sharma,9123456789,Sun Enterprises,Mumbai,Home Loan,2500000,WARM LEADS,Followup requested on weekend\n';
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Sample_Leads_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Downloaded sample leads import CSV template!', 'info');
  };

  // ── 1. IMPORT LEADS HANDLER ────────────────────────────────────────────────
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) {
      showToast('Please select a CSV or Excel file to import.', 'warning');
      return;
    }

    setIsImporting(true);
    setImportProgressPercent(10);
    setImportProgressStatus('Reading file and preparing leads for import...');

    try {
      const isExcel = importFile.name.endsWith('.xlsx') || importFile.name.endsWith('.xls');
      const reader = new FileReader();

      reader.onload = async (evt) => {
        try {
          let parsedLeads: any[] = [];

          if (isExcel) {
            const XLSX = await import('xlsx');
            const dataBuffer = new Uint8Array(evt.target?.result as ArrayBuffer);
            const workbook = XLSX.read(dataBuffer, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            parsedLeads = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          } else {
            const csvText = evt.target?.result as string;
            const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length <= 1) {
              showToast('Uploaded file contains no lead rows.', 'warning');
              setIsImporting(false);
              return;
            }
            const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
            parsedLeads = lines.slice(1).map(line => {
              const row: any = {};
              const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
              headers.forEach((h, idx) => {
                row[h] = vals[idx] || '';
              });
              return row;
            });
          }

          if (parsedLeads.length === 0) {
            showToast('No valid lead rows found in file.', 'warning');
            setIsImporting(false);
            return;
          }

          const targetCampaignTag = 'Direct Lead Import';
          const validSelectedAgents = telecallers.filter(u => selectedAgents.includes(u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.name || u.email));
          const agentNames = validSelectedAgents.map(a => {
            const fn = (a.firstName || '').trim();
            const ln = (a.lastName || '').trim();
            const full = `${fn} ${ln}`.trim();
            return full || a.name || a.username || a.email || 'Agent';
          }).filter(Boolean);

          const BATCH_SIZE = 500;
          const totalLeads = parsedLeads.length;
          const totalBatches = Math.ceil(totalLeads / BATCH_SIZE);
          let assignedCount = 0;

          for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const start = batchIdx * BATCH_SIZE;
            const chunk = parsedLeads.slice(start, start + BATCH_SIZE);
            const isLast = batchIdx === totalBatches - 1;
            const currentPercent = Math.min(95, Math.round(10 + ((batchIdx + 1) / totalBatches) * 85));

            setImportProgressPercent(currentPercent);
            setImportProgressStatus(`Importing batch ${batchIdx + 1} of ${totalBatches} (${start.toLocaleString()} - ${Math.min(start + BATCH_SIZE, totalLeads).toLocaleString()} / ${totalLeads.toLocaleString()} leads)...`);

            const res = await api.post('/records/campaigns/bulk-assign', {
              campaignName: targetCampaignTag,
              agentNames: agentNames.length > 0 ? agentNames : undefined,
              leads: chunk,
              agentOffset: start,
              isLastBatch: isLast
            }, { timeout: 120000 });

            assignedCount += (res.data?.count || chunk.length);
          }

          setImportProgressPercent(100);
          setImportProgressStatus('Import Complete!');

          showAlertModal({
            title: 'LEADS IMPORTED SUCCESSFULLY',
            message: `Successfully imported ${assignedCount.toLocaleString()} leads into the Leads Process!`,
            buttonText: 'OK',
            type: 'success'
          });

          setImportFile(null);
          setSelectedAgents([]);
        } catch (err: any) {
          console.error(err);
          showToast(err.response?.data?.error || err.message || 'Failed to import leads.', 'error');
        } finally {
          setIsImporting(false);
          setImportProgressPercent(0);
          setImportProgressStatus('');
        }
      };

      if (isExcel) {
        reader.readAsArrayBuffer(importFile);
      } else {
        reader.readAsText(importFile);
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to read file.', 'error');
      setIsImporting(false);
    }
  };

  // ── 2. PREVIEW DELETION MATCH COUNT ───────────────────────────────────────
  const handlePreviewDeleteCount = async () => {
    if (!deleteAgent && !deleteDate && !deleteStatus) {
      showToast('Please select at least one filter criterion (Telecaller, Date, or Status).', 'warning');
      return;
    }

    setIsCounting(true);
    try {
      const res = await api.post('/records/leads/bulk-delete-count', {
        assignedTo: deleteAgent || undefined,
        createdDate: deleteDate || undefined,
        status: deleteStatus || undefined
      });
      setMatchingLeadsCount(res.data?.count ?? 0);
    } catch (err) {
      showToast('Failed to calculate matching lead count.', 'error');
    } finally {
      setIsCounting(false);
    }
  };

  // ── 3. EXECUTE BULK DELETE LEADS ──────────────────────────────────────────
  const handleExecuteBulkDelete = () => {
    if (!deleteAgent && !deleteDate && !deleteStatus) {
      showToast('Please select at least one filter criterion to delete leads.', 'warning');
      return;
    }

    const userLabel = deleteAgent ? `for user '${deleteAgent}'` : 'across all users';
    const dateLabel = deleteDate ? `on date '${deleteDate}'` : 'for all dates';
    const statusLabel = deleteStatus ? `with status '${deleteStatus}'` : '';

    showConfirm({
      title: 'CONFIRM DELETE LEADS',
      message: `Are you sure you want to permanently delete leads ${userLabel} ${dateLabel} ${statusLabel}? This action cannot be undone.`,
      type: 'danger',
      confirmText: 'YES, DELETE LEADS',
      cancelText: 'CANCEL',
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          const res = await api.post('/records/leads/bulk-delete', {
            assignedTo: deleteAgent || undefined,
            createdDate: deleteDate || undefined,
            status: deleteStatus || undefined
          });

          showAlertModal({
            title: 'LEADS DELETED SUCCESSFULLY',
            message: res.data?.message || `Successfully purged matching leads from the database.`,
            buttonText: 'OK',
            type: 'success'
          });

          setDeleteAgent('');
          setDeleteDate('');
          setDeleteStatus('');
          setMatchingLeadsCount(null);
        } catch (err: any) {
          console.error(err);
          showToast(err.response?.data?.error || 'Failed to delete leads.', 'error');
        } finally {
          setIsDeleting(false);
        }
      }
    });
  };

  // ── 4. SCAN DUPLICATE LEADS ────────────────────────────────────────────────
  const handleScanDuplicates = async () => {
    setIsScanningDuplicates(true);
    try {
      const res = await api.post('/records/leads/duplicates-count', {
        status: dupStatus || undefined,
        user: dupAgent || undefined,
        date: dupDate || undefined,
        month: dupMonth || undefined,
        year: dupYear || undefined,
        scanMode
      });

      setDuplicateScanResult({
        duplicateGroups: res.data?.duplicateGroups ?? 0,
        extraDuplicatesCount: res.data?.extraDuplicatesCount ?? 0,
        idsToDelete: res.data?.idsToDelete ?? []
      });
    } catch (err) {
      console.error(err);
      showToast('Failed to scan for duplicate leads.', 'error');
    } finally {
      setIsScanningDuplicates(false);
    }
  };

  // ── 5. EXECUTE PURGE DUPLICATE LEADS (EXTRA ONLY) ──────────────────────────
  const handleExecutePurgeDuplicates = () => {
    if (!duplicateScanResult || duplicateScanResult.extraDuplicatesCount === 0) {
      showToast('No extra duplicate leads to delete.', 'warning');
      return;
    }

    showConfirm({
      title: 'CONFIRM DELETE DUPLICATE LEADS',
      message: `Are you sure you want to delete ${duplicateScanResult.extraDuplicatesCount.toLocaleString()} EXTRA duplicate leads? The 1 original lead for each contact will be safely preserved in MongoDB.`,
      type: 'danger',
      confirmText: 'PURGE EXTRA DUPLICATES',
      cancelText: 'CANCEL',
      onConfirm: async () => {
        setIsPurgingDuplicates(true);
        try {
          const res = await api.post('/records/leads/delete-duplicates', {
            idsToDelete: duplicateScanResult.idsToDelete
          });

          showAlertModal({
            title: 'DUPLICATE LEADS PURGED',
            message: res.data?.message || `Successfully purged ${duplicateScanResult.extraDuplicatesCount} extra duplicate leads! 1 original lead was kept for each contact number.`,
            buttonText: 'OK',
            type: 'success'
          });

          setDuplicateScanResult(null);
        } catch (err: any) {
          console.error(err);
          showToast(err.response?.data?.error || 'Failed to purge duplicate leads.', 'error');
        } finally {
          setIsPurgingDuplicates(false);
        }
      }
    });
  };

  const activeLeadStatuses = leadStatuses.length > 0 ? leadStatuses : defaultLeadStatuses;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto text-left px-4 md:px-8 py-6">
      {/* ── TOP HEADER BANNER & BALANCED TAB CONTROLLER (SINGLE LINE TITLE) ── */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 border-b border-slate-200/90 dark:border-slate-800 pb-6">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-rose-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 flex-shrink-0">
            <Icons.ShieldCheck className="w-7 h-7 stroke-[2.2]" />
          </div>
          <div className="text-left flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight whitespace-nowrap">
                Import & Lead Management
              </h1>
              <span className="text-[10px] font-black px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60 shadow-3xs font-mono uppercase tracking-wider whitespace-nowrap">
                Security & Data Studio
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 mt-1 font-medium max-w-2xl">
              Bulk import lead contact sheets, delete user/date leads, or purge extra duplicate records safely.
            </p>
          </div>
        </div>

        {/* Ultra-Clean 3-Segment Tab Bar */}
        <div className="w-full xl:w-auto p-1.5 bg-slate-100 dark:bg-slate-800/90 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-inner flex items-center justify-start sm:justify-center gap-2 overflow-x-auto no-scrollbar">
          {/* Tab 1: Import Leads */}
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'import'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-2 ring-indigo-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
            }`}
          >
            <Icons.FileSpreadsheet className="w-4 h-4" />
            <span>01. Import Leads</span>
          </button>

          {/* Tab 2: Delete Leads */}
          <button
            type="button"
            onClick={() => setActiveTab('delete')}
            className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'delete'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 ring-2 ring-rose-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
            }`}
          >
            <Icons.Trash2 className="w-4 h-4" />
            <span>02. Delete Leads</span>
          </button>

          {/* Tab 3: Delete Duplicate Leads */}
          <button
            type="button"
            onClick={() => setActiveTab('duplicates')}
            className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'duplicates'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 ring-2 ring-amber-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
            }`}
          >
            <Icons.CopyX className="w-4 h-4" />
            <span>03. Delete Duplicate Leads</span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: BULK IMPORT LEADS STUDIO (CLEAN 2-STEP IMPORT FORM) ────── */}
      {activeTab === 'import' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs relative overflow-hidden text-left">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-3xs">
                <Icons.UploadCloud className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                  Lead Import Studio
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Upload CSV or Excel contact sheets to import lead records directly into the Leads Process.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadSampleCSV}
              className="h-10 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 text-xs font-extrabold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-3xs"
            >
              <Icons.Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Download Sample CSV Template</span>
            </button>
          </div>

          <form onSubmit={handleImportSubmit} className="space-y-6 max-w-4xl">
            {/* Step 1: Assign Telecallers / Employees */}
            <div className="bg-slate-50/70 dark:bg-slate-800/50 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center">1</span>
                <label className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Assign Telecaller / User (Optional)
                </label>
              </div>
              <MultiSelectDropdown
                options={telecallers.map((u: any) => u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.name || u.email)}
                selectedValues={selectedAgents}
                onChange={setSelectedAgents}
                placeholder="Select telecallers to distribute imported leads..."
                searchPlaceholder="Search telecallers by name..."
              />
              <p className="text-[11px] text-slate-400 mt-2 font-medium">
                Leads will be evenly distributed among selected telecallers during bulk import.
              </p>
            </div>

            {/* Step 2: Choose File Uploader */}
            <div className="bg-slate-50/70 dark:bg-slate-800/50 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center">2</span>
                <label className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Select CSV or Excel Contact File <span className="text-rose-500">*</span>
                </label>
              </div>

              <div className="border-2 border-dashed border-indigo-200 dark:border-indigo-900/60 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-2xl p-8 text-center bg-white dark:bg-slate-900 transition-all cursor-pointer shadow-3xs group">
                <input
                  type="file"
                  accept=".csv, .xlsx, .xls"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="hidden"
                  id="lead-file-upload"
                />
                <label htmlFor="lead-file-upload" className="cursor-pointer block">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                    <Icons.FileSpreadsheet className="w-7 h-7" />
                  </div>
                  {importFile ? (
                    <div className="space-y-1">
                      <span className="text-sm font-black text-slate-900 dark:text-white block">{importFile.name}</span>
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 inline-block font-mono">
                        {(importFile.size / 1024).toFixed(1)} KB — Ready for Import
                      </span>
                      <p className="text-xs text-slate-400 mt-2">Click to replace file</p>
                    </div>
                  ) : (
                    <div>
                      <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
                        Click to browse or drop contact sheet
                      </span>
                      <p className="text-[11.5px] text-slate-400 mt-1 max-w-md mx-auto">
                        Supports standard CSV and Excel contact sheets containing Customer Name, Phone, Location, Firm Name, Loan Category, etc.
                      </p>
                      <div className="flex items-center justify-center gap-2 mt-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase font-mono">.CSV</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase font-mono">.XLSX</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase font-mono">.XLS</span>
                      </div>
                    </div>
                  )}
                </label>
              </div>
            </div>

            {/* Progress Bar */}
            {isImporting && (
              <div className="space-y-2.5 bg-indigo-50 dark:bg-indigo-950/60 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-800 shadow-3xs">
                <div className="flex justify-between text-xs font-extrabold text-indigo-900 dark:text-indigo-200">
                  <span>{importProgressStatus}</span>
                  <span>{importProgressPercent}%</span>
                </div>
                <div className="w-full h-3 bg-indigo-200/80 dark:bg-indigo-900 rounded-full overflow-hidden p-0.5">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300 rounded-full shadow-xs"
                    style={{ width: `${importProgressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isImporting || !importFile}
              className="h-12 px-9 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
            >
              {isImporting ? <Icons.Loader className="w-4.5 h-4.5 animate-spin" /> : <Icons.Upload className="w-4.5 h-4.5" />}
              <span>Import Leads into Leads Process</span>
            </button>
          </form>
        </div>
      )}

      {/* ── TAB 2: BULK DELETE LEADS STUDIO (3 CLEAN FILTERS ONLY) ──────────── */}
      {activeTab === 'delete' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs relative overflow-hidden text-left">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-rose-500 via-red-500 to-amber-500" />

          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center shadow-3xs">
              <Icons.Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                Delete Leads Studio (User & Specific Date Target)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Filter and permanently delete leads assigned to a specific telecaller, on a specific date, or by lead status.
              </p>
            </div>
          </div>

          <div className="space-y-6 max-w-4xl">
            {/* Clean 3-Column Filter Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Telecaller / User Selection */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Select User / Telecaller
                </label>
                <select
                  value={deleteAgent}
                  onChange={(e) => {
                    setDeleteAgent(e.target.value);
                    setMatchingLeadsCount(null);
                  }}
                  className="w-full h-11 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15"
                >
                  <option value="">All Users / Telecallers</option>
                  {telecallers.map((u: any) => {
                    const name = u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.name || u.email;
                    return <option key={u._id || u.id} value={name}>{name}</option>;
                  })}
                </select>
              </div>

              {/* Specific Date Picker */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Select Particular Date
                </label>
                <input
                  type="date"
                  value={deleteDate}
                  onChange={(e) => {
                    setDeleteDate(e.target.value);
                    setMatchingLeadsCount(null);
                  }}
                  className="w-full h-11 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15"
                />
              </div>

              {/* Lead Process Status Filter */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Lead Status (Optional)
                </label>
                <select
                  value={deleteStatus}
                  onChange={(e) => {
                    setDeleteStatus(e.target.value);
                    setMatchingLeadsCount(null);
                  }}
                  className="w-full h-11 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15"
                >
                  <option value="">All Statuses</option>
                  {activeLeadStatuses.map((st, i) => (
                    <option key={i} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Preview Matching Count Box */}
            <div className="p-5 bg-rose-50/50 dark:bg-rose-950/30 rounded-2xl border border-rose-200/70 dark:border-rose-900/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Icons.Search className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  <span className="text-xs font-black uppercase tracking-wider text-rose-900 dark:text-rose-200">
                    Lead Scan Preview
                  </span>
                </div>
                <span className="text-xs text-rose-800/90 dark:text-rose-300 font-medium block mt-1">
                  {matchingLeadsCount !== null 
                    ? `${matchingLeadsCount.toLocaleString()} lead(s) match ${deleteAgent ? `user '${deleteAgent}'` : 'selected filters'} ${deleteDate ? `on date '${deleteDate}'` : ''} ${deleteStatus ? `with status '${deleteStatus}'` : ''}.` 
                    : 'Click "Preview Lead Count" to calculate matching leads before deletion.'}
                </span>
              </div>
              <button
                type="button"
                onClick={handlePreviewDeleteCount}
                disabled={isCounting || (!deleteAgent && !deleteDate && !deleteStatus)}
                className="h-10 px-5 bg-white dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-slate-700 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-slate-700 text-xs font-black uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 flex-shrink-0"
              >
                {isCounting ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Search className="w-4 h-4" />}
                <span>Preview Lead Count</span>
              </button>
            </div>

            {/* Danger Warning Alert */}
            <div className="p-4 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-800 dark:text-rose-300 text-xs flex items-start gap-3">
              <Icons.AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-extrabold uppercase tracking-wider block">Caution: Permanent Action</span>
                Deleting leads will permanently erase matching lead records, dial remarks, and case details from MongoDB. Make sure to double-check your filter criteria.
              </div>
            </div>

            {/* Execute Delete Button */}
            <button
              type="button"
              onClick={handleExecuteBulkDelete}
              disabled={isDeleting || (!deleteAgent && !deleteDate && !deleteStatus)}
              className="h-12 px-9 bg-rose-600 hover:bg-rose-700 active:scale-[0.98] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-rose-600/30 transition-all flex items-center gap-2.5 cursor-pointer"
            >
              {isDeleting ? <Icons.Loader className="w-4.5 h-4.5 animate-spin" /> : <Icons.Trash2 className="w-4.5 h-4.5" />}
              <span>Delete Matching Leads Now</span>
            </button>
          </div>
        </div>
      )}

      {/* ── TAB 3: PURGE DUPLICATE LEADS STUDIO (6-ATTRIBUTE MATCHING RULE) ──── */}
      {activeTab === 'duplicates' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xs relative overflow-hidden text-left">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500" />

          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-3xs">
              <Icons.CopyX className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                Purge Extra Duplicate Leads Studio
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Scans and detects duplicate lead records by matching <b>Lead No</b>, <b>Lead Name</b>, <b>Phone Number</b>, <b>Created Date</b>, <b>Assigned To</b>, and <b>Assigned By</b>.
              </p>
            </div>
          </div>

          <div className="space-y-6 max-w-4xl">
            {/* Scan Mode Selection Bar */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-2.5">
                Duplicate Scanning Matching Criteria
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <label
                  onClick={() => {
                    setScanMode('all_match');
                    setDuplicateScanResult(null);
                  }}
                  className={`flex-1 p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center gap-2.5 ${
                    scanMode === 'all_match'
                      ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-500 text-amber-900 dark:text-amber-200 ring-2 ring-amber-500/20'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="scanMode"
                    checked={scanMode === 'all_match'}
                    onChange={() => {}}
                    className="accent-amber-600"
                  />
                  <div>
                    <span className="block font-black uppercase text-[11px] text-amber-700 dark:text-amber-300">
                      Full 6-Attribute Matching (Recommended)
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                      Matches Lead No + Lead Name + Phone + Date + Assigned To + Assigned By
                    </span>
                  </div>
                </label>

                <label
                  onClick={() => {
                    setScanMode('phone_only');
                    setDuplicateScanResult(null);
                  }}
                  className={`flex-1 p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center gap-2.5 ${
                    scanMode === 'phone_only'
                      ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-500 text-amber-900 dark:text-amber-200 ring-2 ring-amber-500/20'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="scanMode"
                    checked={scanMode === 'phone_only'}
                    onChange={() => {}}
                    className="accent-amber-600"
                  />
                  <div>
                    <span className="block font-black uppercase text-[11px] text-amber-700 dark:text-amber-300">
                      Phone Number Only Matching
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                      Matches duplicate contact numbers across all leads
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Filter Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Lead Status */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Lead Status
                </label>
                <select
                  value={dupStatus}
                  onChange={(e) => {
                    setDupStatus(e.target.value);
                    setDuplicateScanResult(null);
                  }}
                  className="w-full h-11 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                >
                  <option value="">All Statuses</option>
                  {activeLeadStatuses.map((st, i) => (
                    <option key={i} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              {/* Telecaller / User */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  User / Telecaller
                </label>
                <select
                  value={dupAgent}
                  onChange={(e) => {
                    setDupAgent(e.target.value);
                    setDuplicateScanResult(null);
                  }}
                  className="w-full h-11 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                >
                  <option value="">All Telecallers</option>
                  {telecallers.map((u: any) => {
                    const name = u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.name || u.email;
                    return <option key={u._id || u.id} value={name}>{name}</option>;
                  })}
                </select>
              </div>

              {/* Specific Date */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Specific Date
                </label>
                <input
                  type="date"
                  value={dupDate}
                  onChange={(e) => {
                    setDupDate(e.target.value);
                    setDuplicateScanResult(null);
                  }}
                  className="w-full h-11 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                />
              </div>

              {/* Month Filter */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Month
                </label>
                <select
                  value={dupMonth}
                  onChange={(e) => {
                    setDupMonth(e.target.value);
                    setDuplicateScanResult(null);
                  }}
                  className="w-full h-11 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                >
                  <option value="">All Months</option>
                  {monthsList.map((m, i) => (
                    <option key={i} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Year Filter */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                  Year
                </label>
                <select
                  value={dupYear}
                  onChange={(e) => {
                    setDupYear(e.target.value);
                    setDuplicateScanResult(null);
                  }}
                  className="w-full h-11 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                >
                  <option value="">All Years</option>
                  {yearsList.map((y, i) => (
                    <option key={i} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Visual Scan Results Cards */}
            {duplicateScanResult ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-amber-50 dark:bg-amber-950/50 rounded-2xl border border-amber-200 dark:border-amber-800">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-400 block">
                    Matching Duplicate Groups
                  </span>
                  <span className="text-2xl font-black text-amber-900 dark:text-amber-100 mt-1 block">
                    {duplicateScanResult.duplicateGroups.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 block">
                    {scanMode === 'all_match' ? 'Lead No, Name, Phone, Date, Assigned To/By match' : 'Contact numbers with multiple entries'}
                  </span>
                </div>

                <div className="p-4 bg-rose-50 dark:bg-rose-950/50 rounded-2xl border border-rose-200 dark:border-rose-800">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-400 block">
                    Extra Duplicates to Purge
                  </span>
                  <span className="text-2xl font-black text-rose-900 dark:text-rose-100 mt-1 block">
                    {duplicateScanResult.extraDuplicatesCount.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 block">
                    2nd, 3rd, 4th duplicate copies to delete
                  </span>
                </div>

                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 rounded-2xl border border-emerald-200 dark:border-emerald-800">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                    Original Leads Preserved
                  </span>
                  <span className="text-2xl font-black text-emerald-900 dark:text-emerald-100 mt-1 block">
                    {duplicateScanResult.duplicateGroups.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                    1st original lead kept safe per group
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-5 bg-amber-50/50 dark:bg-amber-950/30 rounded-2xl border border-amber-200/70 dark:border-amber-900/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Icons.Search className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-200">
                      Duplicate Lead Scanner
                    </span>
                  </div>
                  <span className="text-xs text-amber-800/90 dark:text-amber-300 font-medium block mt-1">
                    Click "Scan Extra Duplicates" to detect leads matching <b>Lead No</b>, <b>Lead Name</b>, <b>Phone</b>, <b>Created Date</b>, <b>Assigned To</b>, and <b>Assigned By</b>.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleScanDuplicates}
                  disabled={isScanningDuplicates}
                  className="h-10 px-5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-md shadow-amber-600/30 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 flex-shrink-0"
                >
                  {isScanningDuplicates ? <Icons.Loader className="w-4 h-4 animate-spin" /> : <Icons.Search className="w-4 h-4" />}
                  <span>Scan Extra Duplicates</span>
                </button>
              </div>
            )}

            {/* Safety Guarantee Banner */}
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-300 text-xs flex items-start gap-3">
              <Icons.ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-extrabold uppercase tracking-wider block">Duplicate Deletion Safety Rule</span>
                A lead is recognized as a duplicate when <b>Lead No</b>, <b>Lead Name</b>, <b>Phone Number</b>, <b>Created Date</b>, <b>Assigned To</b>, and <b>Assigned By</b> match across records. Only <b>extra duplicate lead copies</b> (2nd, 3rd, etc.) will be deleted. The <b>1st original lead</b> record is ALWAYS safely preserved in your database.
              </div>
            </div>

            {/* Execute Purge Duplicates Button */}
            <button
              type="button"
              onClick={handleExecutePurgeDuplicates}
              disabled={isPurgingDuplicates || !duplicateScanResult || duplicateScanResult.extraDuplicatesCount === 0}
              className="h-12 px-9 bg-amber-600 hover:bg-amber-700 active:scale-[0.98] disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-amber-600/30 transition-all flex items-center gap-2.5 cursor-pointer"
            >
              {isPurgingDuplicates ? <Icons.Loader className="w-4.5 h-4.5 animate-spin" /> : <Icons.Trash2 className="w-4.5 h-4.5" />}
              <span>Purge Extra Duplicate Leads Only</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
