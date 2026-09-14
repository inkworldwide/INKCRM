import React, { useEffect, useState, useRef } from 'react';
import * as Icons from 'lucide-react';
import api, { FILE_BASE_URL } from '../services/api';
import { useThemeStore } from '../store/themeStore';
import { Link, useNavigate } from 'react-router-dom';
import { DynamicIcon } from '../components/Layout';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '../utils/dateFormatter';
import { useToastStore } from '../store/toastStore';
import { maskPhoneNumber, triggerPhoneCall, openWhatsAppChat } from '../utils/phoneUtils';
import SalesFunnel3D from '../components/SalesFunnel3D';

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToastStore();
  const { branding } = useThemeStore();
  const [animate, setAnimate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<any>(null);
  const searchSeqRef = useRef<number>(0);
  const [activeTab] = useState<'overview' | 'pipeline' | 'followups'>('overview');
  const [followupTab, setFollowupTab] = useState<'today' | 'upcoming'>('today');

  // File upload, Search input ref and History timeline states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRecordId, setUploadingRecordId] = useState<string | null>(null);
  const [activeHistoryRecord, setActiveHistoryRecord] = useState<any | null>(null);
  const [historyActivities, setHistoryActivities] = useState<any[]>([]);
  const [historyDocuments, setHistoryDocuments] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Fast LocalStorage Cache Helpers for 0ms Instant Loading
  const getLocalCache = <T,>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  const setLocalCache = (key: string, data: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Ignore storage errors in private/quota modes
    }
  };

  const DEFAULT_METRICS = {
    statusCounts: {
      'HOT LEADS': 0,
      'WARM LEADS': 0,
      'CEBIL PENDING': 0,
      'DOCUMENT PENDING': 0,
      'APPROVAL PENDING': 0,
      'APPROVED BUT NOT DISBUSE': 0,
      'DISBUSED': 0,
      'REJECTED': 0,
      'FOLLOWUP': 0,
      'DROPPED': 0,
      'PENDING': 0
    },
    pipelineData: {
      'Prospecting': 0,
      'Qualification': 0,
      'Proposal': 0,
      'Negotiation': 0,
      'Closed Won': 0,
      'Closed Lost': 0
    },
    dealStatus: { open: 0, won: 0, lost: 0, pending: 0 },
    todayFollowupsCount: 0,
    todayFollowupsList: [],
    upcomingFollowupsList: [],
    upcomingFollowupsCount: 0,
    totalLeads: 0,
    recentActivities: [],
    campaignMetrics: {
      totalCampaigns: 0,
      completedCampaigns: 0,
      inProgressCampaigns: 0,
      yetToStartCampaigns: 0,
      totalLeadsAllocated: 0,
      totalLeadsDialed: 0,
      totalLeadsRemaining: 0,
      dialedPercentage: 0,
      activeCampaignNames: 'Direct Campaigns'
    }
  };

  // Fetch dynamic configured statuses from database (Settings -> Status Settings) with 0ms cache
  const { data: configuredStatuses = [] } = useQuery({
    queryKey: ['dashboard-configured-statuses'],
    queryFn: async () => {
      const res = await api.get('/statuses').catch(() => ({ data: [] }));
      const arr = Array.isArray(res.data) ? res.data : [];
      if (arr.length > 0) setLocalCache('inkcrm_dashboard_statuses_cache_v2', arr);
      return arr;
    },
    initialData: () => getLocalCache('inkcrm_dashboard_statuses_cache_v2', []),
    staleTime: 60000
  });

  // Fetch campaigns for Campaign Status section with 0ms cache
  const { data: campaignRecords = [] } = useQuery({
    queryKey: ['dashboard-campaigns-list'],
    queryFn: async () => {
      const res = await api.get('/records/campaigns?limit=50').catch(() => ({ data: { records: [] } }));
      const list = res.data?.records || res.data || [];
      setLocalCache('inkcrm_dashboard_campaigns_cache_v2', list);
      return list;
    },
    initialData: () => getLocalCache('inkcrm_dashboard_campaigns_cache_v2', []),
    staleTime: 60000
  });

  // Cmd+K / Ctrl+K Keyboard Shortcut Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Fetch live dashboard metrics from database with instant local hydration & 30s background polling
  const { data: metricsData = DEFAULT_METRICS } = useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => {
      const res = await api.get('/dashboard/metrics');
      if (res.data) setLocalCache('inkcrm_dashboard_metrics_cache_v2', res.data);
      return res.data;
    },
    initialData: () => getLocalCache('inkcrm_dashboard_metrics_cache_v2', DEFAULT_METRICS),
    staleTime: 60000,
    refetchInterval: (query) => (query.state.error ? false : 30000)
  });

  // Prefetch leads for a given status or followup to enable 0.001s instant transitions
  const prefetchStatusLeads = (statusName: string, isFollowup = false) => {
    const params: Record<string, any> = {
      page: 1,
      limit: 10,
      search: '',
      sort: '-createdAt'
    };
    let filterField = 'status';
    let filterVal = statusName;

    if (isFollowup) {
      filterField = 'followup';
      filterVal = 'today';
      params.followup = 'today';
    } else {
      params.status = statusName;
    }

    queryClient.prefetchQuery({
      queryKey: ['records', 'leads', '', filterField, filterVal, false, 1, 10],
      queryFn: async () => {
        const res = await api.get('/records/leads', { params });
        return res.data;
      },
      staleTime: 60000
    });
  };

  // Pre-warm top statuses in background after dashboard mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      const topStatuses = configuredStatuses && configuredStatuses.length > 0 
        ? configuredStatuses.slice(0, 10).map((s: any) => s.name)
        : ['Hot', 'Warm', 'CALL BACK', 'GIVEN LOGIN', 'CIBIL PENDING', 'Document Pending', 'Status Pending', 'Approved', 'reject', 'Followup'];

      topStatuses.forEach((st: string) => {
        prefetchStatusLeads(st);
      });
      prefetchStatusLeads("TODAY'S FOLLOWUPS", true);
    }, 400);
    return () => clearTimeout(timer);
  }, [configuredStatuses]);

  const { data: usersDropdown = [] } = useQuery({
    queryKey: ['dashboard-users-dropdown'],
    queryFn: async () => {
      const res = await api.get('/auth/users?purpose=dropdown');
      const list = res.data || [];
      if (Array.isArray(list) && list.length > 0) setLocalCache('inkcrm_dashboard_users_cache', list);
      return list;
    },
    initialData: () => getLocalCache('inkcrm_dashboard_users_cache', []),
    staleTime: 120000
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

  useEffect(() => {
    if (metricsData) {
      if (metricsData.todayFollowupsCount > 0) {
        setFollowupTab('today');
      } else if (metricsData.upcomingFollowupsCount > 0 || metricsData.isUpcoming) {
        setFollowupTab('upcoming');
      }
    }
  }, [metricsData]);

  useEffect(() => {
    const timer = setTimeout(() => setAnimate(true), 150);
    return () => clearTimeout(timer);
  }, [metricsData]);

  const handleGlobalSearch = (val: string, immediate = false) => {
    setSearchQuery(val);
    const clean = val.trim();

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (clean.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const thisSeq = ++searchSeqRef.current;

    const executeSearch = async () => {
      try {
        const res = await api.get(`/search?q=${encodeURIComponent(clean)}`);
        // Ignore stale responses if a newer search was initiated
        if (thisSeq === searchSeqRef.current) {
          const results = res.data;
          setSearchResults(Array.isArray(results) ? results.filter((r: any) => r.records && r.records.length > 0) : []);
          setIsSearching(false);
        }
      } catch (e) {
        if (thisSeq === searchSeqRef.current) {
          console.error('Search error:', e);
          setIsSearching(false);
        }
      }
    };

    if (immediate) {
      executeSearch();
    } else {
      searchDebounceRef.current = setTimeout(executeSearch, 200);
    }
  };

  const normalizeStatusName = (rawSt: string): string => {
    if (!rawSt) return 'PENDING';
    const s = rawSt.trim().toUpperCase();

    // Campaign telephony dial outcomes - strictly separate from loan pipeline stages
    if (s.includes('CALL REJECT') || s.includes('CALL REJECTED')) return 'CALL REJECT';
    if (s.includes('NO ANSWER') || s === 'NO ANSWER') return 'NO ANSWER';
    if (s.includes('NOT INTRESTED') || s.includes('NOT INTERESTED') || s.includes('NOT INTESTED')) return 'NOT INTERESTED';
    if (s.includes('NOT CONNECT') || s.includes('CALL NOT CONNECT')) return 'CALL NOT CONNECT';
    if (s.includes('WRONG NUM') || s.includes('WRONG NUMBER')) return 'WRONG NUM';
    if (s.includes('NUM NOT EXIT') || s.includes('NOT EXIST') || s.includes('NOT EXISTS')) return 'NUM NOT EXIT';
    if (s.includes('REPEATED NUM') || s.includes('REPEATED NUMBER')) return 'REPEATED NUM';
    if (s.includes('NO BUSINESS')) return 'NO BUSINESS';
    if (s.includes('COOL LEAD') || s === 'COOL LEAD') return 'COOL LEAD';
    if (s.includes('CAL BACK') || s.includes('CALL BACK')) return 'CAL BACK';
    if (s.includes('GIVEN LOGIN')) return 'GIVEN LOGIN';

    // Lead Lifecycle Stages
    if (s === 'HOT' || s === 'HOT LEAD' || s === 'HOT LEADS' || s.includes('HOT LEAD')) return 'HOT LEADS';
    if (s === 'WARM' || s === 'WARM LEAD' || s === 'WARM LEADS' || s.includes('WARM LEAD')) return 'WARM LEADS';
    if (s === 'COLD' || s === 'COLD LEAD' || s === 'COLD LEADS' || s.includes('COLD LEAD')) return 'COLD LEADS';
    if (s.includes('CEBIL') || s.includes('CEDIL') || s.includes('CIVIL') || s.includes('CIBIL')) return 'CEBIL PENDING';
    if (s.includes('DOCUMENT') || s.includes('DOC PENDING')) return 'DOCUMENT PENDING';
    if (s.includes('APPROVAL PENDING') || s === 'APPROVAL PENDING') return 'APPROVAL PENDING';
    if (s.includes('APPROVED BUT NOT') || s === 'APPROVED BUT NOT DISBUSE' || s === 'APPROVED BUT NOT DISBURSED') return 'APPROVED BUT NOT DISBUSE';
    if (s === 'APPROVED') return 'APPROVED BUT NOT DISBUSE';
    if (s.includes('DISBURS') || s.includes('DISBUS')) return 'DISBUSED';

    // Strict loan rejection check: Only genuine credit/lead rejections, never telephony calls
    if (s === 'REJECT' || s === 'REJECTED' || s === 'LEAD REJECTED' || s === 'APPLICATION REJECTED' || s === 'CREDIT REJECTED') {
      return 'REJECTED';
    }

    if (s.includes('FOLLOW')) return 'FOLLOWUP';
    if (s.includes('DROP')) return 'DROPPED';
    if (s === 'PENDING') return 'PENDING';
    if (s.includes('YET TO CALL') || s.includes('YET TO DIAL')) return 'YET TO CALL';

    return s;
  };

  const getStatusCount = (lbl: string) => {
    if (!metricsData?.statusCounts) return 0;
    const raw = (lbl || '').trim();
    if (!raw) return 0;
    const upper = raw.toUpperCase();

    if (upper === "TODAY'S FOLLOWUPS") {
      return metricsData.todayFollowupsCount || 0;
    }

    if (metricsData.statusCounts[raw] !== undefined) {
      return Number(metricsData.statusCounts[raw]);
    }
    if (metricsData.statusCounts[upper] !== undefined) {
      return Number(metricsData.statusCounts[upper]);
    }
    if (metricsData.statusCounts[raw.toLowerCase()] !== undefined) {
      return Number(metricsData.statusCounts[raw.toLowerCase()]);
    }

    const canonical = normalizeStatusName(raw);
    if (metricsData.statusCounts[canonical] !== undefined) {
      return Number(metricsData.statusCounts[canonical]);
    }

    const noLeadsKey = upper.replace(/ LEADS$/, '');
    if (metricsData.statusCounts[noLeadsKey] !== undefined) {
      return Number(metricsData.statusCounts[noLeadsKey]);
    }

    for (const [k, v] of Object.entries(metricsData.statusCounts)) {
      const kUpper = k.trim().toUpperCase();
      const kCanonical = normalizeStatusName(kUpper);
      if (kCanonical === canonical || kUpper === upper || kUpper === noLeadsKey) {
        return Number(v);
      }
    }

    return 0;
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
    if (upper.includes('DROPPED') || upper.includes('DROP')) return '#EA580C';
    if (upper.includes('PENDING')) return '#F59E0B';
    return '#0284C7';
  };

  // Construct dynamic metric cards from configured statuses in Settings, plus Today's Followups
  const getDynamicMetricCards = () => {
    const todaysFollowupsCard = {
      label: "TODAY'S FOLLOWUPS",
      rawName: "TODAY'S FOLLOWUPS",
      category: 'followups',
      icon: Icons.Calendar,
      sub: 'Due Today',
      accentColor: '#0284C7'
    };

    if (configuredStatuses && configuredStatuses.length > 0) {
      const visible = configuredStatuses
        .filter((s: any) => s.dashboardVisibility !== false)
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

      if (visible.length > 0) {
        const dynamicCards = visible.map((st: any) => {
          const IconComp = (Icons as any)[st.icon] || Icons.Circle;
          const upperName = (st.name || '').toUpperCase();

          let category = 'overview';
          if (st.pipelinePosition > 0) category = 'pipeline';
          if (upperName.includes('FOLLOW') || upperName.includes('WARM') || upperName.includes('PENDING') || upperName.includes('REACHABLE')) {
            category = 'followups';
          }

          const themeColor = st.color || getCardThemeColor(st.name);

          return {
            label: st.name.toUpperCase(),
            rawName: st.name,
            category,
            accentColor: themeColor,
            icon: IconComp,
            sub: st.isFinal 
              ? (st.isSuccess ? '✔ Closed Won' : '✕ Closed Final') 
              : (st.pipelinePosition > 0 ? `Stage #${st.pipelinePosition}` : 'Configured Status')
          };
        });

        return [...dynamicCards, todaysFollowupsCard];
      }
    }

    // Default fallback list of 11 status cards + Today's Followups (matching 2nd image layout)
    return [
      { label: 'HOT LEADS', rawName: 'HOT LEADS', category: 'pipeline', icon: Icons.Flame, sub: 'Stage #2', accentColor: '#0284C7' },
      { label: 'WARM LEADS', rawName: 'WARM LEADS', category: 'pipeline', icon: Icons.Sun, sub: 'Stage #3', accentColor: '#F59E0B' },
      { label: 'CEBIL PENDING', rawName: 'CEBIL PENDING', category: 'pipeline', icon: Icons.FileWarning, sub: 'Stage #5', accentColor: '#E11D48' },
      { label: 'DOCUMENT PENDING', rawName: 'DOCUMENT PENDING', category: 'pipeline', icon: Icons.FileText, sub: 'Stage #6', accentColor: '#0284C7' },
      { label: 'APPROVAL PENDING', rawName: 'APPROVAL PENDING', category: 'pipeline', icon: Icons.Clock, sub: 'Stage #7', accentColor: '#EA580C' },
      { label: 'APPROVED BUT NOT DISBUSE', rawName: 'APPROVED BUT NOT DISBUSE', category: 'pipeline', icon: Icons.CheckCircle, sub: 'Stage #8', accentColor: '#F59E0B' },
      { label: 'DISBUSED', rawName: 'DISBUSED', category: 'pipeline', icon: Icons.Banknote, sub: '✔ Closed Won', accentColor: '#16A34A' },
      { label: 'REJECTED', rawName: 'REJECTED', category: 'overview', icon: Icons.XOctagon, sub: '✕ Closed Final', accentColor: '#E11D48' },
      { label: 'FOLLOWUP', rawName: 'FOLLOWUP', category: 'followups', icon: Icons.PhoneCall, sub: 'Stage #11', accentColor: '#0284C7' },
      { label: 'DROPPED', rawName: 'DROPPED', category: 'overview', icon: Icons.ArrowDownCircle, sub: '✕ Closed Final', accentColor: '#EA580C' },
      { label: 'PENDING', rawName: 'PENDING', category: 'followups', icon: Icons.Hourglass, sub: 'Stage #13', accentColor: '#F59E0B' },
      todaysFollowupsCard
    ];
  };

  // Convert pipeline stage data to array with dynamic percentage scaling
  const rawPipeline = [
    { 
      name: 'Lead Ingestion / New', 
      val: metricsData?.pipelineData?.['Prospecting'] || getStatusCount('NEW') * 50000 || 0, 
      count: getStatusCount('NEW') || 0,
      icon: Icons.UserPlus,
      color: '#4F46E5',
      bgTint: 'rgba(79, 70, 229, 0.1)'
    },
    { 
      name: 'Qualification & Hot Leads', 
      val: metricsData?.pipelineData?.['Qualification'] || 0, 
      count: getStatusCount('HOT') + getStatusCount('WARM') || 0,
      icon: Icons.Flame,
      color: '#059669',
      bgTint: 'rgba(5, 150, 105, 0.1)'
    },
    { 
      name: 'Proposal & Documentation', 
      val: metricsData?.pipelineData?.['Proposal'] || 0, 
      count: getStatusCount('DOCUMENT PENDING') + getStatusCount('CEDIL PENDING') || 0,
      icon: Icons.FileText,
      color: '#D97706',
      bgTint: 'rgba(217, 119, 6, 0.1)'
    },
    { 
      name: 'Negotiation & Approval', 
      val: metricsData?.pipelineData?.['Negotiation'] || 0, 
      count: getStatusCount('APPROVAL PENDING') || 0,
      icon: Icons.TrendingUp,
      color: '#EA580C',
      bgTint: 'rgba(234, 88, 12, 0.1)'
    },
    { 
      name: 'Disbursed / Closed Won', 
      val: metricsData?.pipelineData?.['Closed Won'] || 0, 
      count: getStatusCount('APPROVED') + getStatusCount('DISBURSED') || 0,
      icon: Icons.CheckCircle2,
      color: '#7C3AED',
      bgTint: 'rgba(124, 58, 237, 0.1)'
    }
  ];

  const maxPipelineVal = Math.max(...rawPipeline.map(s => s.val), 1);

  const totalPipeline = rawPipeline.reduce((a, b) => a + Number(b.val), 0);
  const activeDeals = metricsData?.dealStatus?.open || 0;
  const avgDealSize = activeDeals > 0 ? Math.round(totalPipeline / activeDeals) : 0;

  const wonCount = metricsData?.dealStatus?.won || 0;
  const lostCount = metricsData?.dealStatus?.lost || 0;
  const totalClosed = wonCount + lostCount;
  const winRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0;

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto text-left px-4 md:px-8 py-6">
      
      {/* 1. TOP ACTION & CONTROLS BAR (Stripe/Linear Elevated Primary Action Row) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-6 py-4.5 border-b border-black/[0.08] dark:border-slate-800">
        
        {/* Command Search Bar - Confident Elevated Input with Focus Glow */}
        <div className="relative flex-1 max-w-xl">
          <div className="relative flex items-center group w-full">
            <Icons.Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 min-w-[16px] max-w-[16px] min-h-[16px] max-h-[16px] text-[#4F46E5] pointer-events-none stroke-[2.2] flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleGlobalSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleGlobalSearch(searchQuery, true);
                }
              }}
              placeholder="Search leads, deals, contacts, campaigns..."
              className="w-full h-11 pl-11 pr-14 text-xs md:text-sm bg-white dark:bg-slate-800/90 border-2 border-stone-200 dark:border-slate-700 hover:border-stone-300 dark:hover:border-slate-600 rounded-xl focus:outline-none focus:border-[#4F46E5] focus:ring-2 focus:ring-[#4F46E5]/15 focus:bg-white transition-all text-[#1C1917] dark:text-white font-medium shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] placeholder:text-[#78716C] dark:placeholder:text-stone-400"
            />
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center pointer-events-none gap-1.5">
              {isSearching && (
                <Icons.Loader2 className="w-4 h-4 text-[#4F46E5] animate-spin" />
              )}
              <kbd className="hidden sm:inline-flex items-center text-[10.5px] font-mono font-bold text-[#57534E] dark:text-stone-300 bg-[#F5F5F4] dark:bg-slate-700/80 border border-black/[0.08] dark:border-slate-600 px-2 py-0.5 rounded-md shadow-2xs">
                ⌘K
              </kbd>
            </div>
          </div>

          {/* Search Results Dropdown */}
          {searchQuery && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-black/[0.08] dark:border-slate-700 shadow-xl rounded-xl overflow-hidden max-h-80 overflow-y-auto z-50 p-2 space-y-2 text-left">
              {isSearching ? (
                <div className="p-4 flex items-center justify-center gap-2 text-xs text-[#6B7280] font-medium">
                  <Icons.Loader2 className="w-4 h-4 animate-spin text-[#4F46E5]" />
                  <span>Searching records...</span>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-4 text-center text-xs text-[#6B7280] font-medium">
                  No lead, contact, or firm matching "{searchQuery}"
                </div>
              ) : (
                searchResults.map(({ module, records }) => (
                  <div key={module._id} className="space-y-1">
                    <div className="px-3 py-1 bg-[#FAFAF9] dark:bg-slate-900 rounded-lg text-[10px] font-bold text-[#6B7280] uppercase tracking-wider flex items-center gap-1.5">
                      <DynamicIcon name={module.icon} className="w-3.5 h-3.5 text-[#111111]" />
                      {module.pluralLabel} ({records.length})
                    </div>
                    {records.map((rec: any) => {
                      const name = `${rec.data?.firstName || ''} ${rec.data?.lastName || ''}`.trim() || 
                                   rec.data?.customerName || 
                                   rec.data?.customer || 
                                   rec.data?.fullName || 
                                   rec.data?.leadName || 
                                   rec.data?.company || 
                                   'Lead Record';
                      const phone = rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contact_num || rec.data?.['contact num'] || rec.data?.contact;
                      const code = rec.data?.leadNo || rec.data?.dataCode || rec.data?.data_code || rec.data?.allocatedNo || (rec._id ? `LND-${String(rec._id).slice(-6).toUpperCase()}` : '');
                      const company = rec.data?.company || rec.data?.firmName || rec.data?.firm_name;

                      return (
                        <Link
                          key={rec._id}
                          to={`/modules/${module.apiPath}/${rec._id}`}
                          onClick={() => setSearchQuery('')}
                          className="flex items-center justify-between p-2.5 hover:bg-[#FAFAF9] dark:hover:bg-slate-700/50 rounded-lg transition-all text-left group border border-transparent hover:border-black/[0.08]"
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-bold text-[#1A1A1A] dark:text-white truncate group-hover:text-black transition-colors">
                                {name}
                              </p>
                              {code && (
                                <span className="text-[9px] font-bold bg-[#FAFAF9] border border-black/[0.08] text-[#111111] px-1.5 py-0.5 rounded uppercase flex-shrink-0">
                                  #{code}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[#6B7280] font-medium truncate">
                              {company && <span>Firm: <strong className="text-[#1A1A1A] dark:text-slate-300">{company}</strong></span>}
                              {phone && <span>Ph: <strong className="text-[#1A1A1A] dark:text-slate-300">{phone}</strong></span>}
                            </div>
                          </div>
                          <Icons.ChevronRight className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#111111] transition-colors flex-shrink-0" />
                        </Link>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right Controls & Quick Actions */}
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap justify-between sm:justify-end ml-auto">
          {/* Add Lead CTA Button - Sleek, Compact & Crisp */}
          <Link 
            to="/modules/leads/new" 
            className="group h-9 px-3.5 bg-gradient-to-b from-[#222222] to-[#0A0A0A] hover:from-[#2E2E2E] hover:to-[#141414] text-white rounded-lg flex items-center justify-center gap-2 shadow-[0_1px_3px_rgba(0,0,0,0.12)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.18)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all duration-150 cursor-pointer border border-white/15 select-none"
          >
            <div className="w-5 h-5 rounded-md bg-white/15 flex items-center justify-center border border-white/20 text-white shadow-2xs group-hover:bg-white/25 transition-colors flex-shrink-0">
              <Icons.UserPlus className="w-3 h-3 stroke-[2.4]" />
            </div>
            <span className="text-xs font-semibold tracking-tight whitespace-nowrap">Add Lead</span>
            <Icons.ArrowRight className="w-3 h-3 text-white/50 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0" />
          </Link>
        </div>
      </div>

      {/* 2. OVERVIEW STATUS KPI CARDS (13 Cards with locked-in white bg + top accent bar + 40% border + floating colored icon) */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-3.5">
          {getDynamicMetricCards().map((metric, idx) => {
            const Icon = metric.icon;
            const count = getStatusCount(metric.rawName || metric.label);
            const filterStatus = metric.rawName || metric.label;
            const isZero = count === 0;
            const themeColor = getCardThemeColor(metric.rawName || metric.label);

            return (
              <Link
                to={
                  metric.rawName === "TODAY'S FOLLOWUPS"
                    ? '/modules/leads?followup=today'
                    : `/modules/leads?status=${encodeURIComponent(metric.rawName || metric.label)}`
                }
                key={idx} 
                onMouseEnter={() => prefetchStatusLeads(metric.rawName || metric.label, metric.rawName === "TODAY'S FOLLOWUPS")}
                onFocus={() => prefetchStatusLeads(metric.rawName || metric.label, metric.rawName === "TODAY'S FOLLOWUPS")}
                className="group flex flex-col justify-between p-3.5 sm:p-4 bg-white dark:bg-slate-900 rounded-xl transition-all duration-200 cursor-pointer relative overflow-hidden text-left shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.05)] hover:-translate-y-0.5"
                style={{
                  borderStyle: 'solid',
                  borderWidth: '1px',
                  borderColor: `${themeColor}66`,
                  borderTopWidth: '3px',
                  borderTopColor: themeColor,
                }}
              >
                {/* Top Label & Floating Colored Icon (No badge background circle) */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider leading-none truncate">
                    {metric.label}
                  </span>
                  <div 
                    className="flex items-center justify-center transition-transform duration-200 group-hover:scale-110 flex-shrink-0"
                    style={{ color: themeColor }}
                  >
                    <Icon className="w-4 h-4 stroke-[2]" />
                  </div>
                </div>

                {/* Stat Number (Always Dark/Black) */}
                <div className="my-2">
                  <h3 className={`text-2xl sm:text-[25px] font-[850] tracking-tight leading-none ${
                    isZero ? 'text-slate-400' : 'text-[#111827] dark:text-white'
                  }`}>
                    {count}
                  </h3>
                </div>

                {/* Subtext Label with Status Dot */}
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span 
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: themeColor }} 
                  />
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
                    {metric.sub}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* 3. MIDDLE ROW: Campaign Status */}
      <div id="campaign-status-section" className="scroll-mt-24">
        
        {/* Campaign Status Grid */}
        <div className="bg-white dark:bg-slate-900 border border-black/[0.08] dark:border-slate-800 rounded-2xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] transition-all duration-300">
          <div className="flex flex-col h-full justify-between">
            <div>
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-600/20 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-[0_2px_10px_rgba(245,158,11,0.1)]">
                    <Icons.Megaphone className="w-5 h-5 stroke-[2]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-[#111111] dark:text-white tracking-tight">Campaign Status</h3>
                      <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40">
                        {metricsData?.campaignMetrics?.totalCampaigns !== undefined ? metricsData.campaignMetrics.totalCampaigns : (campaignRecords?.length || 0)} Campaign Drives
                      </span>
                    </div>
                    <p className="text-[11px] text-[#6B7280] dark:text-slate-400 font-medium mt-0.5">My campaign execution overview</p>
                  </div>
                </div>
                <Link 
                  to="/modules/mycampaign" 
                  className="text-[10px] font-bold text-[#111111] dark:text-white hover:text-amber-600 dark:hover:text-amber-400 bg-stone-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-black/[0.08] dark:border-slate-700 hover:border-amber-300 uppercase tracking-wider flex items-center gap-1 shadow-2xs transition-all"
                >
                  View Campaigns <Icons.ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {/* 4-Column Metric Grid with Top Accent Bar System */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-5">
                {[
                  { 
                    label: 'TOTAL CAMPAIGNS', 
                    value: metricsData?.campaignMetrics?.totalCampaigns !== undefined ? metricsData.campaignMetrics.totalCampaigns : (campaignRecords?.length || 0), 
                    sub: 'All active drives', 
                    icon: Icons.Megaphone,
                    themeColor: '#4F46E5',
                    badgeBg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
                    badgeColor: 'text-indigo-600 dark:text-indigo-400'
                  },
                  { 
                    label: 'COMPLETED CAMPAIGN', 
                    value: metricsData?.campaignMetrics?.completedCampaigns !== undefined ? metricsData.campaignMetrics.completedCampaigns : 0, 
                    sub: '100% Dialed & Closed', 
                    icon: Icons.CheckCircle2,
                    themeColor: '#10B981',
                    badgeBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
                    badgeColor: 'text-emerald-600 dark:text-emerald-400'
                  },
                  { 
                    label: 'INPROGRESS', 
                    value: metricsData?.campaignMetrics?.inProgressCampaigns !== undefined ? metricsData.campaignMetrics.inProgressCampaigns : 0, 
                    sub: 'Active calling', 
                    icon: Icons.PhoneCall,
                    themeColor: '#2563EB',
                    badgeBg: 'bg-blue-500/10 dark:bg-blue-500/20',
                    badgeColor: 'text-blue-600 dark:text-blue-400'
                  },
                  { 
                    label: 'YET TO START', 
                    value: metricsData?.campaignMetrics?.yetToStartCampaigns !== undefined ? metricsData.campaignMetrics.yetToStartCampaigns : 0, 
                    sub: 'Queued drives', 
                    icon: Icons.Clock,
                    themeColor: '#D97706',
                    badgeBg: 'bg-amber-500/10 dark:bg-amber-500/20',
                    badgeColor: 'text-amber-600 dark:text-amber-400'
                  }
                ].map((box, index) => {
                  const BoxIcon = box.icon;
                  return (
                    <div 
                      key={index} 
                      onClick={() => navigate('/modules/mycampaign')}
                      className="p-4 bg-white dark:bg-slate-900 rounded-xl text-left flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-md hover:-translate-y-0.5 group"
                      style={{
                        borderStyle: 'solid',
                        borderWidth: '1px',
                        borderColor: `${box.themeColor}50`,
                        borderTopWidth: '3px',
                        borderTopColor: box.themeColor,
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className={`w-8 h-8 rounded-lg ${box.badgeBg} ${box.badgeColor} flex items-center justify-center shadow-2xs transition-transform group-hover:scale-105`}>
                          <BoxIcon className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-bold text-[#737373] dark:text-slate-400 group-hover:text-[#111111] dark:group-hover:text-white uppercase tracking-wider transition-colors">{box.label}</span>
                      </div>
                      <div>
                        <h4 className="text-2xl font-black text-[#1A1A1A] dark:text-white tracking-tight mt-2.5">
                          {box.value}
                        </h4>
                        <p className="text-[10px] font-medium text-[#8C8C8C] dark:text-slate-400 mt-0.5">{box.sub}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Campaign Execution Progress Banner (Sleek Compact Telemetry Hero Widget) */}
            <div className="p-3.5 sm:p-4 bg-[#0F131C] border border-[#1E2433] rounded-xl shadow-lg relative overflow-hidden text-left mt-2 group">
              {/* Top Accent Gradient Border */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 opacity-90" />
              
              {/* Subtle ambient lighting */}
              <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-indigo-600/15 rounded-full blur-xl pointer-events-none" />

              {/* Header: Title + Live Status Badge */}
              <div className="flex items-center justify-between text-xs mb-2 relative z-10">
                <div className="flex items-center gap-2">
                  <div className="w-6.5 h-6.5 rounded-lg bg-white/[0.08] border border-white/10 flex items-center justify-center text-indigo-300 shadow-inner">
                    <Icons.Activity className="w-3.5 h-3.5 animate-pulse text-indigo-300" />
                  </div>
                  <div>
                    <span className="font-extrabold uppercase tracking-wider text-[10.5px] text-white block leading-none">Overall Campaign Execution</span>
                  </div>
                </div>

                <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-black text-[10px] px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                  <span className="tracking-wide">{metricsData?.campaignMetrics?.dialedPercentage ?? 0}% DIALED</span>
                </div>
              </div>

              {/* Sub-metrics breakdown */}
              <div className="flex items-baseline justify-between text-[11px] mb-1.5 px-0.5 relative z-10">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-black text-white tracking-tight">{(metricsData?.campaignMetrics?.totalLeadsDialed ?? 0).toLocaleString()}</span>
                  <span className="text-[10px] text-slate-400 font-medium">of {(metricsData?.campaignMetrics?.totalLeadsAllocated ?? 0).toLocaleString()} Leads Dialed</span>
                </div>
                <span className="text-[10px] font-bold text-indigo-300 tracking-tight">{(metricsData?.campaignMetrics?.totalLeadsRemaining ?? 0).toLocaleString()} Remaining</span>
              </div>

              {/* High-definition progress track */}
              <div 
                className="w-full h-2.5 bg-[#181D2A] rounded-full overflow-hidden mb-2.5 relative p-[1.5px] border border-white/[0.08]"
                style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.6)' }}
              >
                <div 
                  className="h-full rounded-full transition-all duration-1000 ease-out relative" 
                  style={{ 
                    width: `${Math.max(metricsData?.campaignMetrics?.dialedPercentage ?? 0, (metricsData?.campaignMetrics?.totalLeadsDialed ?? 0) > 0 ? 4 : 0)}%`,
                    background: 'linear-gradient(90deg, #4F46E5 0%, #7C3AED 50%, #10B981 100%)',
                    boxShadow: '0 0 10px rgba(16, 185, 129, 0.4)'
                  }} 
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_4px_#ffffff] float-right mr-0.5 mt-[1px]" />
                </div>
              </div>

              {/* Bottom detail chips */}
              <div className="flex items-center justify-between gap-2 text-[10px] relative z-10">
                <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.07] px-2.5 py-1 rounded-lg">
                  <Icons.PhoneCall className="w-3 h-3 text-indigo-300" />
                  <span className="text-slate-300 font-medium truncate max-w-[200px]">
                    {metricsData?.campaignMetrics?.activeCampaignNames || 'Personal & Home Loan Drives'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-emerald-500/[0.08] border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                  <Icons.Target className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400 font-bold tracking-tight">Target: 100%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* 4. TODAY'S & UPCOMING FOLLOWUP LEADS DETAILS */}
      <div className="bg-[#F8F5F1] dark:bg-slate-900 border border-[#EAE4DA] dark:border-slate-800 rounded-2xl p-4 sm:p-6 md:p-8 overflow-hidden text-left shadow-xs">
        <div className="px-1 pb-5 border-b border-[#EAE4DA] dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-800 border border-[#EAE4DA] dark:border-slate-700 flex items-center justify-center shadow-2xs">
              <Icons.CalendarClock className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">
                Followup Leads Details
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                {followupTab === 'today' ? "Scheduled for action today" : "Upcoming scheduled followups"}
              </p>
            </div>
          </div>

          {/* Tab buttons: Today's vs Upcoming */}
          <div className="flex items-center gap-1.5 sm:gap-2 bg-white dark:bg-slate-800 border border-[#EAE4DA] dark:border-slate-700 p-1.5 rounded-xl shadow-2xs">
            <button
              onClick={() => setFollowupTab('today')}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center gap-1.5 sm:gap-2 cursor-pointer ${
                followupTab === 'today'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <Icons.Calendar className="w-3.5 h-3.5" />
              <span>Today's Followups</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${followupTab === 'today' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {metricsData?.todayFollowupsCount || 0}
              </span>
            </button>

            <button
              onClick={() => setFollowupTab('upcoming')}
              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center gap-1.5 sm:gap-2 cursor-pointer ${
                followupTab === 'upcoming'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <Icons.Clock className="w-3.5 h-3.5" />
              <span>Upcoming Followups</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${followupTab === 'upcoming' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {metricsData?.upcomingFollowupsCount || 0}
              </span>
            </button>
          </div>
        </div>
        
        <div className="space-y-6">
          {(() => {
            const activeList = followupTab === 'today'
              ? (metricsData?.todayFollowupsList || [])
              : (metricsData?.upcomingFollowupsList?.length ? metricsData.upcomingFollowupsList : (metricsData?.todayFollowupsList || []));

            if (!activeList || activeList.length === 0) {
              return (
                <div className="py-12 bg-white dark:bg-slate-800/80 border border-[#EAE4DA] dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center text-center shadow-xs">
                  <div className="w-14 h-14 rounded-full bg-[#F8F5F1] dark:bg-slate-700/60 border border-[#EAE4DA] dark:border-slate-600 flex items-center justify-center mb-3 shadow-inner">
                    <Icons.CheckCircle2 className="w-7 h-7 text-slate-400 dark:text-slate-300" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {followupTab === 'today' ? "No follow-ups scheduled today." : "No upcoming follow-ups scheduled."}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Enjoy your day.</p>
                </div>
              );
            }

            return activeList.map((rec: any, idx: number) => {
              const leadNo = rec._id.slice(-6).toUpperCase();
              const leadName = `${rec.data?.firstName || ''} ${rec.data?.lastName || ''}`.trim() || rec.data?.fullName || rec.data?.customerName || rec.data?.name || rec.data?.leadName || 'N/A';
              const leadLocation = rec.data?.location || [rec.data?.city, rec.data?.state].filter(Boolean).join(', ') || rec.data?.city || rec.data?.presentAddress || rec.data?.address || 'N/A';
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
              const statusThemeColor = getCardThemeColor(rec.data?.status || 'HOT');

              return (
                <div key={rec._id} className="border border-[#EAE4DA] dark:border-slate-800 rounded-2xl p-6 bg-white dark:bg-slate-900 relative mb-6 last:mb-0 text-left shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                  {/* Status-colored Top Accent Bar */}
                  <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ backgroundColor: statusThemeColor }} />
                  
                  {/* True 4-Column CSS Grid - All 20 cells direct children for flawless row-to-row alignment */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 text-sm mt-1">
                    {/* --- Row 1 --- */}
                    <div className="text-[13px] leading-snug">
                      <span className="font-semibold text-[#1C1917] dark:text-stone-100">Sl No.: </span>
                      <span className="text-[#44403C] dark:text-stone-300">{idx + 1}</span>
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
                      <span className="text-[#44403C] dark:text-stone-300">{rec.data?.company || 'N/A'}</span>
                    </div>

                    {/* --- Row 2 --- */}
                    <div className="text-[13px] leading-snug">
                      <span className="font-semibold text-[#1C1917] dark:text-stone-100">Lead No.: </span>
                      <span className="text-[#44403C] dark:text-stone-300 font-mono">LND-{leadNo}</span>
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
                      <span className="text-[#44403C] dark:text-stone-300 uppercase">{rec.data?.loanType || 'N/A'}</span>
                    </div>

                    <div className="text-[13px] leading-snug">
                      <span className="font-semibold text-[#1C1917] dark:text-stone-100">Mobile No.: </span>
                      <span className="text-[#44403C] dark:text-stone-300 font-mono">
                        {maskPhoneNumber(rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contactNum || rec.data?.mobileNo || rec.data?.contact_num)}
                      </span>
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
                      <span className="text-[#44403C] dark:text-stone-300 uppercase font-semibold">{rec.data?.status || 'NEW'}</span>
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
                      <span className="text-[#44403C] dark:text-stone-300 uppercase">{rec.data?.businessPartner || rec.data?.bankPartner || 'IDFC FIRST BANK'}</span>
                    </div>

                    <div className="text-[13px] leading-snug">
                      <span className="font-semibold text-[#1C1917] dark:text-stone-100">Case Details: </span>
                      <span className="text-[#44403C] dark:text-stone-300">{rec.data?.caseDetails || '001 case detailes'}</span>
                    </div>

                    <div className="text-[13px] leading-snug">
                      <span className="font-semibold text-[#1C1917] dark:text-stone-100">PSM: </span>
                      <span className="text-[#44403C] dark:text-stone-300">{psmName}</span>
                    </div>

                    <div className="text-[13px] leading-snug">
                      <span className="font-semibold text-[#1C1917] dark:text-stone-100">Remarks: </span>
                      <span className="text-slate-500 dark:text-slate-400 italic text-xs">{rec.data?.notes ? rec.data.notes.replace(/<[^>]*>/g, '') : (rec.data?.dataCode || '001remarks')}</span>
                    </div>
                  </div>

                  {/* Bottom Action / Button Row */}
                  <div className="mt-7 pt-5 border-t border-[#EAE4DA] dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
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
                        <span>{rec.data?.status ? `${rec.data.status} LEAD` : 'LEAD INFO'}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const rawPhone = rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contactNum || rec.data?.mobileNo || rec.data?.contact_num || '';
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
                          const rawPhone = rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contactNum || rec.data?.mobileNo || rec.data?.contact_num || '';
                          if (rawPhone) {
                            const leadName = `${rec.data?.firstName || ''} ${rec.data?.lastName || ''}`.trim() || rec.data?.fullName || rec.data?.customerName || rec.data?.name || 'Lead';
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
            });
          })()}
        </div>
      </div>

      {/* 5. 3D CONICAL SALES FUNNEL & PIPELINE ADVANCEMENT */}
      <div className="space-y-4">
        <SalesFunnel3D
          stages={rawPipeline.map(s => ({
            name: s.name,
            val: Number(s.val),
            count: Number(s.count),
            pct: Math.round((Number(s.val) / maxPipelineVal) * 100),
            icon: s.icon
          }))}
          maxVal={maxPipelineVal}
        />

        {/* Pipeline Summary Horizontal KPI Bar */}
        <div className="w-full grid grid-cols-2 sm:grid-cols-4 bg-white dark:bg-slate-900 border border-black/[0.06] dark:border-slate-800 rounded-2xl p-4 sm:p-5 items-center gap-4 shadow-sm text-left">
          <div className="flex items-center gap-3 pl-1">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(79, 70, 229, 0.1)', color: '#4F46E5' }}
            >
              <Icons.Briefcase className="w-4.5 h-4.5 stroke-[2.2]" style={{ color: '#4F46E5' }} />
            </div>
            <div className="text-left min-w-0">
              <p className="text-[10px] font-bold text-[#6B7280] dark:text-slate-400 uppercase tracking-wider truncate">Total Pipeline</p>
              <p className="text-base font-black text-[#1A1A1A] dark:text-white tracking-tight mt-0.5 truncate">₹{totalPipeline.toLocaleString('en-IN')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pl-1 sm:border-l border-black/[0.06] dark:border-slate-800">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(5, 150, 105, 0.1)', color: '#059669' }}
            >
              <Icons.Percent className="w-4.5 h-4.5 stroke-[2.2]" style={{ color: '#059669' }} />
            </div>
            <div className="text-left min-w-0">
              <p className="text-[10px] font-bold text-[#6B7280] dark:text-slate-400 uppercase tracking-wider truncate">Win Rate</p>
              <p className="text-base font-black text-[#1A1A1A] dark:text-white tracking-tight mt-0.5 truncate">{winRate}%</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 pl-1 sm:border-l border-black/[0.06] dark:border-slate-800">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#2563EB' }}
            >
              <Icons.Calendar className="w-4.5 h-4.5 stroke-[2.2]" style={{ color: '#2563EB' }} />
            </div>
            <div className="text-left min-w-0">
              <p className="text-[10px] font-bold text-[#6B7280] dark:text-slate-400 uppercase tracking-wider truncate">Avg. Cycle</p>
              <p className="text-base font-black text-[#1A1A1A] dark:text-white tracking-tight mt-0.5 truncate">28 Days</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pl-1 sm:border-l border-black/[0.06] dark:border-slate-800">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(217, 119, 6, 0.1)', color: '#D97706' }}
            >
              <Icons.IndianRupee className="w-4.5 h-4.5 stroke-[2.2]" style={{ color: '#D97706' }} />
            </div>
            <div className="text-left min-w-0">
              <p className="text-[10px] font-bold text-[#6B7280] dark:text-slate-400 uppercase tracking-wider truncate">Avg. Deal</p>
              <p className="text-base font-black text-[#1A1A1A] dark:text-white tracking-tight mt-0.5 truncate">₹{avgDealSize.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file uploader */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />

      {/* Record History & Timeline Modal */}
      {activeHistoryRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 text-left">
          <div className="bg-white dark:bg-slate-900 border border-[#EAE4DA] dark:border-slate-800 rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-[#EAE4DA] dark:border-slate-800 flex justify-between items-center bg-[#FAFAF9] dark:bg-slate-850">
              <div>
                <h3 className="font-bold text-[#111111] dark:text-white text-xs uppercase tracking-wider">
                  Lead Audit History
                </h3>
                <p className="text-[10px] text-[#6B7280] dark:text-slate-400 font-bold mt-0.5 uppercase tracking-wider">
                  {activeHistoryRecord.data?.firstName} {activeHistoryRecord.data?.lastName}
                </p>
              </div>
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="w-7 h-7 rounded-lg flex items-center justify-center bg-white dark:bg-slate-800 hover:bg-[#FAFAF9] dark:hover:bg-slate-700 border border-[#EAE4DA] dark:border-slate-700 text-[#6B7280] dark:text-slate-300 transition-colors cursor-pointer"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loadingHistory ? (
                <div className="flex justify-center items-center py-10">
                  <Icons.Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Documents Section */}
                  <div>
                    <h4 className="text-[10px] font-bold text-[#6B7280] dark:text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                      <Icons.File className="w-3.5 h-3.5 text-[#111111] dark:text-slate-300" /> Attached Documents ({historyDocuments.length})
                    </h4>
                    {historyDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {historyDocuments.map((doc: any) => (
                          <div key={doc._id} className="flex justify-between items-center p-3 bg-[#FAFAF9] dark:bg-slate-800/80 border border-[#EAE4DA] dark:border-slate-700 rounded-xl">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Icons.FileText className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#1A1A1A] dark:text-white truncate">{doc.name}</p>
                                <p className="text-[10px] text-[#6B7280] dark:text-slate-400">{(doc.size / 1024).toFixed(1)} KB</p>
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
                      <p className="text-xs text-[#6B7280] dark:text-slate-400 italic">No files attached to this record.</p>
                    )}
                  </div>

                  {/* Timeline Section */}
                  <div>
                    <h4 className="text-[10px] font-bold text-[#6B7280] dark:text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                      <Icons.Clock className="w-3.5 h-3.5 text-[#111111] dark:text-slate-300" /> System Activities
                    </h4>
                    {historyActivities.length > 0 ? (
                      <div className="relative border-l border-[#EAE4DA] dark:border-slate-800 ml-2 pl-4 space-y-4">
                        {historyActivities.map((act: any) => (
                          <div key={act._id} className="relative">
                            <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-600 ring-4 ring-white dark:ring-slate-900" />
                            <div className="text-xs">
                              <p className="font-semibold text-[#1A1A1A] dark:text-white">{act.action}</p>
                              {act.details && Object.keys(act.details).length > 0 && (
                                <p className="text-[11px] text-[#6B7280] dark:text-slate-400 mt-0.5">
                                  {act.details.status && `Status: ${act.details.status}`}
                                  {act.details.assignedTo && ` Assigned To: ${act.details.assignedTo}`}
                                </p>
                              )}
                              <p className="text-[10px] text-[#8C8C8C] dark:text-slate-400 mt-1">
                                {act.performedBy ? `${act.performedBy.firstName} ${act.performedBy.lastName}` : 'System'} • {new Date(act.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#6B7280] dark:text-slate-400 italic">No activity log found for this record.</p>
                    )}
                  </div>
                </>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 bg-[#FAFAF9] dark:bg-slate-850 border-t border-[#EAE4DA] dark:border-slate-800 flex justify-end">
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="flex items-center justify-center px-4 h-9 text-xs font-bold uppercase tracking-wider bg-[#111111] dark:bg-indigo-600 hover:bg-[#262626] dark:hover:bg-indigo-500 text-white rounded-xl transition-all cursor-pointer"
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
