import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import { useAuthStore } from '../store/authStore';
import * as Icons from 'lucide-react';
import { exportCampaignCSV, exportCampaignXLSX } from '../utils/exportCampaignCSV';
import { TableHorizontalScrollWrapper } from '../components/TableHorizontalScrollWrapper';
import { maskPhoneNumber } from '../utils/phoneUtils';

interface CampaignStats {
  campaignName: string;
  totalAssigned: number;
  dialed: number;
  yetToDial: number;
  createdAt: string;
  dailyTarget: number;
}

interface LeadRecord {
  _id: string;
  data: Record<string, any>;
  createdAt: string;
}

interface LeadState {
  status?: string;
  remarks?: string;
  caseDetails?: string;
}

const CAMPAIGN_STATUSES = [
  'Yet To Call',
  'Hot Lead',
  'Warm Lead',
  'Not Intested',
  'Call Rejected',
  'Not Connected',
  'Cool Lead',
  'No Answer',
  'Wrong Number',
  'Not Exists',
  'Repeated Number',
  'No Business',
  'Not Reachable'
];

// Universal fuzzy case-insensitive field extractor for Excel imports and custom records
export const getLeadFieldValue = (data: Record<string, any> | undefined, targetKeys: string[], containsKeys: string[] = []): string => {
  if (!data || typeof data !== 'object') return '';
  
  // 1. Direct exact or lowercase match
  for (const k of targetKeys) {
    if (data[k] !== undefined && data[k] !== null) {
      const val = String(data[k]).trim();
      if (val !== '' && val !== 'N/A' && val !== 'Unnamed') {
        return val;
      }
    }
  }

  const normKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedTargets = targetKeys.map(normKey);
  const keys = Object.keys(data);

  // 2. Normalized alphanumeric match
  for (const k of keys) {
    const nk = normKey(k);
    if (normalizedTargets.includes(nk)) {
      const val = data[k];
      if (val !== undefined && val !== null) {
        const sVal = String(val).trim();
        if (sVal !== '' && sVal !== 'N/A' && sVal !== 'Unnamed') {
          return sVal;
        }
      }
    }
  }

  // 3. Substring match
  if (containsKeys.length > 0) {
    const normalizedContains = containsKeys.map(normKey);
    for (const k of keys) {
      const nk = normKey(k);
      if (normalizedContains.some(c => nk.includes(c))) {
        const val = data[k];
        if (val !== undefined && val !== null) {
          const sVal = String(val).trim();
          if (sVal !== '' && sVal !== 'N/A' && sVal !== 'Unnamed') {
            return sVal;
          }
        }
      }
    }
  }

  return '';
};

export const getLeadPhone = (data: any): string => {
  return getLeadFieldValue(
    data,
    ['phone', 'mobile', 'contact', 'contactNum', 'contact_num', 'contactNumber', 'contact_number', 'phoneNumber', 'phone_number', 'mobileNo', 'mobile_no', 'contactNo', 'contact_no', 'cell', 'telephone', 'phNo', 'mobNo', 'telNo', 'name_contact_num', 'nameContactNum', 'callNo', 'whatsappNo', 'phone1', 'phone2'],
    ['phone', 'mobile', 'contact', 'cell', 'tele']
  );
};

export const getLeadCustomer = (data: any): string => {
  const fullName = `${data?.firstName || ''} ${data?.lastName || ''}`.trim();
  if (fullName && fullName !== 'Unnamed' && fullName !== '') return fullName;
  const found = getLeadFieldValue(
    data,
    ['customer', 'customerName', 'customer_name', 'custName', 'client', 'clientName', 'firstName', 'name', 'fullName', 'buyer', 'buyerName', 'costomer', 'leadName'],
    ['customer', 'client']
  );
  return found || 'Unnamed';
};

export const getLeadLocation = (data: any): string => {
  return getLeadFieldValue(
    data,
    ['city', 'location', 'district', 'state', 'address', 'place', 'area', 'branch'],
    ['location', 'city', 'district', 'address']
  ) || 'N/A';
};

export const getLeadFirmName = (data: any): string => {
  return getLeadFieldValue(
    data,
    ['company', 'firmName', 'firm_name', 'firm', 'businessName', 'business', 'agencyName', 'agency', 'shopName', 'shop', 'tradeName', 'treaderName', 'traderName', 'organization'],
    ['firm', 'company', 'agency', 'business', 'treader', 'trader']
  ) || 'N/A';
};

export const getLeadCategory = (data: any): string => {
  return getLeadFieldValue(
    data,
    ['leadCategory', 'lead_category', 'loanType', 'loan_type', 'category', 'product', 'service', 'leadType'],
    ['category', 'loantype']
  ) || 'N/A';
};

export const getLeadDataCode = (lead: any): string => {
  const data = lead?.data || lead;
  const code = getLeadFieldValue(
    data,
    ['dataCode', 'data_code', 'Data Code', 'data code', 'DataCode', 'datacode', 'code', 'leadCode', 'lead_code', 'lead code'],
    ['datacode', 'leadcode', 'code']
  ) || data?.dataCode || data?.data_code || data?.['Data Code'] || data?.['data code'] || data?.datacode || data?.DataCode || data?.code;

  if (code && String(code).trim() !== '' && String(code).trim() !== 'N/A' && String(code).trim() !== 'Unnamed') {
    return String(code).trim();
  }
  return lead?._id ? `LND-${lead._id.slice(-6).toUpperCase()}` : 'N/A';
};

export default function MyCampaign() {
  const navigate = useNavigate();
  const { showToast } = useToastStore();
  const { canExportCampaigns } = useAuthStore();
  const allowExport = canExportCampaigns();
  const [campaigns, setCampaigns] = useState<CampaignStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCampaign, setActiveCampaign] = useState<CampaignStats | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [dialFilter, setDialFilter] = useState<'yet_to_dial' | 'dialed' | 'all'>('yet_to_dial');
  
  // Track inputs for each lead ID
  const [leadStates, setLeadStates] = useState<Record<string, LeadState>>({});

  // Fetch campaigns
  const fetchCampaigns = async () => {
    try {
      setLoading(true);
      const res = await api.get('/records/campaigns/my-campaigns');
      setCampaigns(res.data.campaigns || []);
    } catch (err: any) {
      console.error(err);
      showToast('Failed to load campaigns.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Fetch lead details for active campaign
  const fetchLeadDetails = async (campaignName: string) => {
    try {
      setLoadingLeads(true);
      const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}`);
      setLeads(res.data.leads || []);
      
      // Initialize states
      const initialStates: Record<string, LeadState> = {};
      (res.data.leads || []).forEach((lead: LeadRecord) => {
        const rawRemarks = lead.data?.notes || lead.data?.remarks || '';
        const cleanRemarks = String(rawRemarks).replace(/<[^>]*>/g, '').trim();
        initialStates[lead._id] = {
          status: lead.data?.status || lead.data?.dialStatus || 'Yet To Call',
          remarks: cleanRemarks,
          caseDetails: lead.data?.caseDetails || ''
        };
      });
      setLeadStates(initialStates);
    } catch (err: any) {
      console.error(err);
      showToast('Failed to load campaign leads.', 'error');
    } finally {
      setLoadingLeads(false);
    }
  };

  // Fetch status dropdown options
  useEffect(() => {
    fetchCampaigns();
    api.get('/statuses')
      .then(res => setStatuses(res.data.map((s: any) => s.name)))
      .catch(err => console.error('Failed to load statuses', err));
  }, []);

  const handleViewDetails = (campaign: CampaignStats, initialFilter: 'yet_to_dial' | 'dialed' | 'all' = 'yet_to_dial') => {
    setActiveCampaign(campaign);
    setDialFilter(initialFilter);
    fetchLeadDetails(campaign.campaignName);
  };

  const handleBack = () => {
    setActiveCampaign(null);
    setLeads([]);
    fetchCampaigns();
  };

  const handleDownloadCampaign = async (campaignName: string, campaignLeads?: LeadRecord[]) => {
    try {
      showToast('Exporting Campaign Excel Report...', 'info');
      let targetLeads = campaignLeads && campaignLeads.length > 0 ? campaignLeads : undefined;
      
      if (!targetLeads) {
        const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}?export=true`);
        targetLeads = res.data.leads || [];
      }

      if (!targetLeads || targetLeads.length === 0) {
        showToast('No leads available to export.', 'warning');
        return;
      }

      // Merge current live UI edits into data if available
      const enrichedLeads = targetLeads.map(lead => {
        const liveState = leadStates[lead._id];
        if (liveState) {
          return {
            ...lead,
            data: {
              ...lead.data,
              status: liveState.status || lead.data?.status,
              dialStatus: liveState.status || lead.data?.dialStatus,
              notes: liveState.remarks !== undefined ? liveState.remarks : lead.data?.notes,
              remarks: liveState.remarks !== undefined ? liveState.remarks : lead.data?.remarks,
              caseDetails: liveState.caseDetails !== undefined ? liveState.caseDetails : lead.data?.caseDetails
            }
          };
        }
        return lead;
      });

      exportCampaignXLSX(campaignName, enrichedLeads);
      showToast(`Exported ${enrichedLeads.length} leads to Excel!`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to export campaign report.', 'error');
    }
  };

  const handleFieldChange = (leadId: string, field: keyof LeadState, value: string) => {
    setLeadStates(prev => ({
      ...prev,
      [leadId]: {
        ...prev[leadId],
        [field]: value
      }
    }));
  };

  const handleStatusSelect = async (lead: LeadRecord, newStatus: string) => {
    // 1. Update state first
    setLeadStates(prev => ({
      ...prev,
      [lead._id]: {
        ...prev[lead._id],
        status: newStatus
      }
    }));

    // 2. Prepare payload for saving
    const currentRemarks = leadStates[lead._id]?.remarks || '';
    const currentCaseDetails = leadStates[lead._id]?.caseDetails || '';

    try {
      const payload = {
        status: newStatus,
        dialStatus: newStatus,
        dialedAt: new Date(),
        callAttempts: ((lead.data?.callAttempts as number) || 0) + 1,
        notes: currentRemarks,
        caseDetails: currentCaseDetails
      };

      // 3. Save to database immediately
      await api.put(`/records/leads/${lead._id}`, payload);
      showToast('Status updated successfully!', 'success');

      // 4. Refresh stats in background
      const res = await api.get('/records/campaigns/my-campaigns');
      const updatedCampaigns: CampaignStats[] = res.data.campaigns || [];
      setCampaigns(updatedCampaigns);
      if (activeCampaign) {
        const found = updatedCampaigns.find(c => c.campaignName === activeCampaign.campaignName);
        if (found) {
          setActiveCampaign(found);
        }
      }

      // 5. If "Hot Lead" or "Warm Lead" selected, navigate to Create Lead page with pre-populated data
      if (newStatus === 'Hot Lead' || newStatus === 'Warm Lead') {
        const passedStatus = newStatus === 'Hot Lead' ? 'Hot' : 'Warm';
        const phoneVal = getLeadPhone(lead.data);
        
        navigate('/modules/leads/new', {
          state: {
            ...lead.data,
            firstName: getLeadCustomer(lead.data),
            lastName: '',
            phone: phoneVal,
            company: getLeadFirmName(lead.data),
            city: getLeadLocation(lead.data),
            dataCode: getLeadDataCode(lead),
            status: passedStatus,
            notes: currentRemarks,
            caseDetails: currentCaseDetails,
            source: activeCampaign?.campaignName || lead.data?.source || ''
          }
        });
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.response?.data?.error || 'Failed to update status.', 'error');
    }
  };

  const handleWhatsAppChat = (lead: LeadRecord) => {
    const rawPhone = getLeadPhone(lead.data);
    let cleanPhone = String(rawPhone).replace(/\D/g, '').trim();
    if (!cleanPhone) {
      showToast('No phone number available for this lead.', 'warning');
      return;
    }
    if (cleanPhone.length === 10) {
      cleanPhone = `91${cleanPhone}`;
    }
    window.open(`https://wa.me/${cleanPhone}`, '_blank');
  };

  const handleInitiateCall = async (lead: LeadRecord) => {
    const rawPhone = getLeadPhone(lead.data);
    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '').trim();
    if (!cleanPhone) {
      showToast('No phone number available for this lead.', 'warning');
      return;
    }
    const leadName = getLeadCustomer(lead.data) || getLeadFirmName(lead.data) || 'Lead';
    showToast(`Calling ${leadName}...`, 'info');

    // Track dial activity
    try {
      await api.put(`/records/leads/${lead._id}`, {
        dialedAt: new Date(),
        callAttempts: ((lead.data?.callAttempts as number) || 0) + 1
      });
    } catch (e) {}

    window.location.href = `tel:${cleanPhone}`;
  };

  const handleSaveLead = async (leadId: string) => {
    try {
      const state = leadStates[leadId];
      if (!state) {
        showToast('No changes to save.', 'warning');
        return;
      }

      const payload: Record<string, any> = {
        status: state.status,
        dialStatus: state.status,
        notes: state.remarks,
        caseDetails: state.caseDetails
      };

      await api.put(`/records/leads/${leadId}`, payload);
      showToast('Lead details updated successfully!', 'success');

      // Refresh list in background to maintain sync
      const res = await api.get('/records/campaigns/my-campaigns');
      const updatedCampaigns: CampaignStats[] = res.data.campaigns || [];
      setCampaigns(updatedCampaigns);
      
      if (activeCampaign) {
        const found = updatedCampaigns.find(c => c.campaignName === activeCampaign.campaignName);
        if (found) {
          setActiveCampaign(found);
        }
      }
    } catch (err: any) {
      console.error(err);
      showToast('Failed to save lead updates.', 'error');
    }
  };

  if (loading && campaigns.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto text-left p-4 sm:p-6">
      
      {!activeCampaign ? (
        // CAMPAIGNS CARDS VIEW
        (() => {
          const filteredCampaigns = campaigns.filter(c => 
            c.campaignName.toLowerCase().includes(searchQuery.trim().toLowerCase())
          );

          return (
            <div className="space-y-4">
              {/* Streamlined Header Summary Bar with Defined Border */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-5 py-4 rounded-xl shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 flex-shrink-0 shadow-3xs">
                      <Icons.Megaphone className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">
                          My Call Campaigns
                        </h2>
                        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                          ({campaigns.length} {campaigns.length === 1 ? 'Active' : 'Active'})
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Select a campaign to initiate telecalling, record call remarks, and update lead status.
                      </p>
                    </div>
                  </div>

                  {/* Compact Stats Indicators with Border */}
                  {campaigns.length > 0 && (
                    <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-800 pt-2.5 sm:pt-0 sm:pl-5 flex-shrink-0">
                      <div className="text-left">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Campaigns</span>
                        <span className="text-base font-bold text-slate-800 dark:text-slate-100 font-mono leading-tight">{campaigns.length}</span>
                      </div>
                      <div className="w-px h-7 bg-slate-200 dark:bg-slate-700" />
                      <div className="text-left">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Total Leads</span>
                        <span className="text-base font-bold text-emerald-700 dark:text-emerald-400 font-mono leading-tight">
                          {campaigns.reduce((sum, c) => sum + c.totalAssigned, 0)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Search & Filter Toolbar with Crisp Border */}
              {campaigns.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-xl shadow-xs">
                  <div className="relative flex-1 max-w-sm">
                    <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search campaigns by name..."
                      className="w-full h-8.5 pl-9 pr-8 text-xs bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-0.5 rounded cursor-pointer"
                        title="Clear search"
                      >
                        <Icons.X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <span>Showing</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{filteredCampaigns.length}</span>
                    <span>of</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{campaigns.length}</span>
                    <span>campaigns</span>
                  </div>
                </div>
              )}

              {campaigns.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-10 text-center text-slate-500 dark:text-slate-400 shadow-xs">
                  <div className="w-12 h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mx-auto mb-3 text-slate-400 shadow-3xs">
                    <Icons.Megaphone className="w-5 h-5" />
                  </div>
                  <p className="font-bold text-sm text-slate-800 dark:text-slate-200">No campaigns assigned to you yet.</p>
                  <p className="text-xs text-slate-400 mt-0.5">When leads are allocated to your account, they will appear here.</p>
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-slate-500 dark:text-slate-400 shadow-xs">
                  <Icons.Search className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="font-bold text-sm text-slate-800 dark:text-slate-200">No campaigns matching &quot;{searchQuery}&quot;</p>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-3 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Clear Search Filter
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredCampaigns.map((campaign) => {
                    const pct = campaign.totalAssigned > 0 
                      ? Math.round((campaign.dialed / campaign.totalAssigned) * 100)
                      : 0;

                    return (
                      <div 
                        key={campaign.campaignName}
                        className="group relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-lg hover:border-indigo-300 dark:hover:border-indigo-800/80 transition-all duration-200 flex flex-col justify-between overflow-hidden"
                      >
                        {/* Top Accent bar */}
                        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 via-indigo-600 to-indigo-700" />

                        <div className="space-y-4">
                          {/* Header: Title & Total Badge */}
                          <div className="flex items-start justify-between gap-3 pt-1">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-900/50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                  <Icons.PhoneCall className="w-2.5 h-2.5" />
                                  Campaign
                                </span>
                                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                                  {new Date(campaign.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                              </div>
                              <h3 className="text-base font-bold text-slate-900 dark:text-white capitalize truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {campaign.campaignName}
                              </h3>
                            </div>

                            <div className="text-right flex-shrink-0">
                              <div className="inline-flex flex-col items-end bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 px-2.5 py-1 rounded-xl">
                                <span className="text-sm font-black text-slate-800 dark:text-slate-100 leading-tight font-mono">{campaign.totalAssigned}</span>
                                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">Total Leads</span>
                              </div>
                            </div>
                          </div>

                          {/* Metric Cards - Sleek 2-col cards with micro icons and subtle colored indicators */}
                          <div className="grid grid-cols-2 gap-2.5">
                            <div 
                              onClick={() => handleViewDetails(campaign, 'dialed')}
                              className="bg-slate-50/80 hover:bg-emerald-50/80 dark:bg-slate-800/50 dark:hover:bg-emerald-950/40 border border-slate-200/70 hover:border-emerald-300 dark:border-slate-700/60 rounded-xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-3xs group"
                              title="Click to view Dialed leads"
                            >
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">Dialed</span>
                                <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono leading-none mt-1 block">
                                  {campaign.dialed}
                                </span>
                              </div>
                              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/60 dark:border-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:scale-105 transition-transform">
                                <Icons.PhoneCall className="w-3.5 h-3.5" />
                              </div>
                            </div>

                            <div 
                              onClick={() => handleViewDetails(campaign, 'yet_to_dial')}
                              className="bg-slate-50/80 hover:bg-amber-50/80 dark:bg-slate-800/50 dark:hover:bg-amber-950/40 border border-slate-200/70 hover:border-amber-300 dark:border-slate-700/60 rounded-xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-3xs group"
                              title="Click to view Yet To Dial leads"
                            >
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block group-hover:text-amber-700 dark:group-hover:text-amber-300 transition-colors">Yet to Dial</span>
                                <span className="text-lg font-bold text-amber-600 dark:text-amber-400 font-mono leading-none mt-1 block">
                                  {campaign.yetToDial}
                                </span>
                              </div>
                              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200/60 dark:border-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400 group-hover:scale-105 transition-transform">
                                <Icons.Clock className="w-3.5 h-3.5" />
                              </div>
                            </div>
                          </div>

                          {/* Progress Bar in Sub-panel */}
                          <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/50 rounded-xl p-2.5 space-y-1.5">
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">Calling Progress</span>
                              <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">{pct}% completed</span>
                            </div>
                            <div className="w-full h-2 bg-slate-200/80 dark:bg-slate-700/80 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-300"
                                style={{ width: `${Math.max(pct, pct > 0 ? 5 : 0)}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Actions Bar */}
                        <div className="flex items-center gap-2 pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
                          <button 
                            onClick={() => handleViewDetails(campaign, 'yet_to_dial')}
                            className="flex-1 h-9 px-3.5 bg-slate-900 hover:bg-slate-800 active:bg-black text-white text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                          >
                            <Icons.Eye className="w-4 h-4" />
                            <span>View Details</span>
                          </button>
                          {allowExport && (
                            <button 
                              onClick={() => handleDownloadCampaign(campaign.campaignName)}
                              className="h-9 px-3.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-3xs"
                              title="Download Campaign Excel/CSV"
                            >
                              <Icons.Download className="w-3.5 h-3.5 text-slate-500" />
                              <span>Export</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()
      ) : (
        // DETAILS VIEW
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#111827] p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
            <div className="flex items-center gap-3.5">
              <button 
                onClick={handleBack} 
                className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all shadow-xs cursor-pointer"
                title="Back to Campaigns"
              >
                <Icons.ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 dark:text-indigo-400 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    Call Campaign
                  </span>
                  <span className="text-xs font-semibold text-slate-400">
                    Created {new Date(activeCampaign.createdAt).toLocaleDateString('en-GB')}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mt-0.5">
                  {activeCampaign.campaignName}
                </h2>
              </div>
            </div>

            {/* Campaign Controls & Progress */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              {/* View Switcher */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setViewMode('table')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Icons.Table className="w-3.5 h-3.5" />
                  Table View
                </button>
                <button
                  onClick={() => setViewMode('cards')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'cards'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Icons.LayoutGrid className="w-3.5 h-3.5" />
                  Card View
                </button>
              </div>

              {allowExport && (
                <button
                  onClick={() => handleDownloadCampaign(activeCampaign.campaignName, leads)}
                  className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer uppercase tracking-wider active:scale-95"
                >
                  <Icons.FileSpreadsheet className="w-3.5 h-3.5" />
                  Export Excel
                </button>
              )}
              {(() => {
                const pct = activeCampaign.totalAssigned > 0 
                  ? Math.round((activeCampaign.dialed / activeCampaign.totalAssigned) * 100)
                  : 0;
                return (
                  <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2 rounded-xl min-w-[160px]">
                    <div className="flex-1">
                      <div className="flex justify-between text-[11px] font-bold mb-1">
                        <span className="text-slate-500 uppercase tracking-wider">Progress</span>
                        <span className="text-indigo-600 dark:text-indigo-400">{pct}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ACTIVE CAMPAIGN METRICS GRID & LEADS LIST */}
          {(() => {
            const isLeadDialed = (lead: LeadRecord) => {
              const liveSt = leadStates[lead._id]?.status || lead.data?.status || lead.data?.dialStatus || '';
              const st = String(liveSt).trim().toLowerCase();
              const notDialed = ['yet to call', 'not called', 'new', ''];
              const hasDialedStatus = st && !notDialed.includes(st);
              const hasCallAttempts = (Number(lead.data?.callAttempts) > 0) || !!lead.data?.dialedAt;
              return hasDialedStatus || hasCallAttempts;
            };

            const dialedLeadsList = leads.filter(l => isLeadDialed(l));
            const yetToDialLeadsList = leads.filter(l => !isLeadDialed(l));

            const displayedLeads = leads.filter(lead => {
              const dialed = isLeadDialed(lead);
              if (dialFilter === 'yet_to_dial' && dialed) return false;
              if (dialFilter === 'dialed' && !dialed) return false;

              if (searchQuery.trim()) {
                const q = searchQuery.trim().toLowerCase();
                const customer = String(getLeadCustomer(lead.data)).toLowerCase();
                const firmName = String(getLeadFirmName(lead.data)).toLowerCase();
                const dataCode = String(getLeadDataCode(lead)).toLowerCase();
                const phone = String(getLeadPhone(lead.data)).toLowerCase();
                const remarks = String(leadStates[lead._id]?.remarks || lead.data?.notes || '').toLowerCase();
                const caseDetails = String(leadStates[lead._id]?.caseDetails || lead.data?.caseDetails || '').toLowerCase();
                const status = String(leadStates[lead._id]?.status || lead.data?.status || '').toLowerCase();

                return customer.includes(q) || firmName.includes(q) || dataCode.includes(q) || phone.includes(q) || remarks.includes(q) || caseDetails.includes(q) || status.includes(q);
              }

              return true;
            });

            return (
              <div className="space-y-4">
                {/* METRICS GRID - CLICKABLE CARDS FOR FILTERING */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                  <div 
                    onClick={() => setDialFilter('yet_to_dial')}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs flex items-center justify-between ${
                      dialFilter === 'yet_to_dial'
                        ? 'bg-amber-50/90 border-amber-500 ring-2 ring-amber-500/20 dark:bg-amber-950/50'
                        : 'bg-white dark:bg-[#111827] border-slate-200/80 dark:border-slate-800 hover:border-amber-300'
                    }`}
                    title="Click to view Yet To Dial leads"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-xl">
                        <Icons.Clock className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Yet To Dial</p>
                        <p className="text-xl font-black text-amber-600 dark:text-amber-400">{yetToDialLeadsList.length}</p>
                      </div>
                    </div>
                    {dialFilter === 'yet_to_dial' && (
                      <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-black uppercase rounded-md shadow-2xs">Active Filter</span>
                    )}
                  </div>

                  <div 
                    onClick={() => setDialFilter('dialed')}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs flex items-center justify-between ${
                      dialFilter === 'dialed'
                        ? 'bg-emerald-50/90 border-emerald-500 ring-2 ring-emerald-500/20 dark:bg-emerald-950/50'
                        : 'bg-white dark:bg-[#111827] border-slate-200/80 dark:border-slate-800 hover:border-emerald-300'
                    }`}
                    title="Click to view Dialed leads"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
                        <Icons.PhoneCall className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Dialed</p>
                        <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{dialedLeadsList.length}</p>
                      </div>
                    </div>
                    {dialFilter === 'dialed' && (
                      <span className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-black uppercase rounded-md shadow-2xs">Active Filter</span>
                    )}
                  </div>

                  <div 
                    onClick={() => setDialFilter('all')}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs flex items-center justify-between ${
                      dialFilter === 'all'
                        ? 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/20 dark:bg-indigo-950/50'
                        : 'bg-white dark:bg-[#111827] border-slate-200/80 dark:border-slate-800 hover:border-indigo-300'
                    }`}
                    title="Click to view All leads"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
                        <Icons.Layers className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Allocated</p>
                        <p className="text-xl font-black text-slate-900 dark:text-white">{leads.length}</p>
                      </div>
                    </div>
                    {dialFilter === 'all' && (
                      <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-black uppercase rounded-md shadow-2xs">Active Filter</span>
                    )}
                  </div>
                </div>

                {/* SEARCH & DIAL FILTER BAR */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-[#111827] p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
                  <div className="relative flex-1 w-full">
                    <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search leads by customer, firm, data code, mobile..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl w-full sm:w-auto">
                    <button
                      onClick={() => setDialFilter('yet_to_dial')}
                      className={`flex-1 sm:flex-initial py-1.5 px-3.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        dialFilter === 'yet_to_dial'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icons.Clock className="w-3.5 h-3.5" />
                      <span>Yet To Dial</span>
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/20">
                        {yetToDialLeadsList.length}
                      </span>
                    </button>

                    <button
                      onClick={() => setDialFilter('dialed')}
                      className={`flex-1 sm:flex-initial py-1.5 px-3.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        dialFilter === 'dialed'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icons.PhoneCall className="w-3.5 h-3.5" />
                      <span>Dialed</span>
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/20">
                        {dialedLeadsList.length}
                      </span>
                    </button>

                    <button
                      onClick={() => setDialFilter('all')}
                      className={`flex-1 sm:flex-initial py-1.5 px-3.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        dialFilter === 'all'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icons.Layers className="w-3.5 h-3.5" />
                      <span>All Leads</span>
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-white/20">
                        {leads.length}
                      </span>
                    </button>
                  </div>
                </div>

                {loadingLeads ? (
                  <div className="flex items-center justify-center h-[40vh]">
                    <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : displayedLeads.length === 0 ? (
                  <div className="bg-white dark:bg-[#1a1f2c] rounded-3xl border border-slate-100 dark:border-slate-800 p-12 text-center text-slate-500 dark:text-slate-400">
                    <p className="font-bold text-base text-slate-800 dark:text-slate-200 mb-1">No Leads Found</p>
                    <p className="text-xs text-slate-500">
                      {dialFilter === 'yet_to_dial' 
                        ? 'There are no "Yet To Dial" leads in this view.' 
                        : dialFilter === 'dialed'
                        ? 'No leads have been dialed yet in this view.'
                        : 'No matching leads found for your search query.'}
                    </p>
                  </div>
                ) : viewMode === 'table' ? (
                  /* 12-COLUMN CAMPAIGN DATA TABLE VIEW */
                  <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden relative">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500" />
                    
                    <TableHorizontalScrollWrapper maxHeight="70vh">
                      <table className="w-full text-left text-xs border-collapse min-w-[1300px]">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-[#17223B] text-white font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-800 shadow-xs">
                            <th className="py-3.5 px-3 text-center w-14 border-r border-slate-700/50">Sl No.</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">Data Code</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">Location</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">Customer</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">firm_name</th>
                            <th className="py-3.5 px-3 min-w-[150px] border-r border-slate-700/50">contact num</th>
                            <th className="py-3.5 px-3 min-w-[160px] border-r border-slate-700/50">Case Details</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">lead_category</th>
                            <th className="py-3.5 px-3 min-w-[160px] border-r border-slate-700/50">Remarks</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">Agent Assigned To</th>
                            <th className="py-3.5 px-3 min-w-[150px] border-r border-slate-700/50">Dial Status</th>
                            <th className="py-3.5 px-3 min-w-[130px]">Dailed Datetime</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-700 dark:text-slate-200">
                          {displayedLeads.map((lead, idx) => {
                            const dataCode = getLeadDataCode(lead);
                            const location = getLeadLocation(lead.data);
                            const customer = getLeadCustomer(lead.data);
                            const firmName = getLeadFirmName(lead.data);
                            const phoneVal = getLeadPhone(lead.data) || 'N/A';
                            const leadCategory = getLeadCategory(lead.data);
                            const agentAssigned = lead.data?.assignedTo || (lead as any).assignedToName || 'Unassigned';
                            
                            const dialStatus = leadStates[lead._id]?.status || lead.data?.status || 'Not Called';
                            const isDialed = dialStatus && dialStatus !== 'Yet To Call' && dialStatus !== 'Not Called';

                            let dialedDatetime = 'Not Called';
                            if (isDialed || lead.data?.dialedAt || lead.data?.lastCallDate) {
                              const dateVal = lead.data?.dialedAt || lead.data?.lastCallDate || (lead as any).updatedAt || lead.createdAt;
                              if (dateVal) {
                                const d = new Date(dateVal);
                                if (!isNaN(d.getTime())) {
                                  dialedDatetime = d.toLocaleString('en-US', {
                                    month: 'short',
                                    day: '2-digit',
                                    year: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                    hour12: true
                                  }).replace(',', '');
                                }
                              }
                            }

                            return (
                              <tr key={lead._id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                                {/* 1. Slno */}
                                <td className="py-3 px-3 text-center font-bold text-slate-400 border-r border-slate-100 dark:border-slate-800">{idx + 1}</td>
                                
                                {/* 2. Data Code */}
                                <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white border-r border-slate-100 dark:border-slate-800">{dataCode}</td>
                                
                                {/* 3. Location */}
                                <td className="py-3 px-3 border-r border-slate-100 dark:border-slate-800 font-semibold">{location}</td>
                                
                                {/* 4. Customer */}
                                <td className="py-3 px-3 font-extrabold text-slate-900 dark:text-white border-r border-slate-100 dark:border-slate-800">{customer}</td>
                                
                                {/* 5. firm_name */}
                                <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800">{firmName}</td>
                                
                                {/* 6. contact num */}
                                <td className="py-3 px-3 border-r border-slate-100 dark:border-slate-800">
                                  <div className="space-y-1">
                                    <span className="font-bold text-slate-900 dark:text-white block">{maskPhoneNumber(phoneVal)}</span>
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => handleWhatsAppChat(lead)}
                                        className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px] font-bold rounded flex items-center gap-1 transition-all cursor-pointer"
                                        title="WhatsApp Chat"
                                      >
                                        <Icons.MessageSquare className="w-3 h-3 text-emerald-600" />
                                        WA
                                      </button>
                                      <button
                                        onClick={() => handleInitiateCall(lead)}
                                        className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 text-[10px] font-bold rounded flex items-center gap-1 transition-all cursor-pointer"
                                        title="Initiate Call"
                                      >
                                        <Icons.PhoneCall className="w-3 h-3 text-blue-600" />
                                        Call
                                      </button>
                                    </div>
                                  </div>
                                </td>
                                
                                {/* 7. Case Details */}
                                <td className="py-2 px-2 border-r border-slate-100 dark:border-slate-800">
                                  <input
                                    type="text"
                                    placeholder="Case Details"
                                    value={leadStates[lead._id]?.caseDetails ?? (lead.data?.caseDetails || lead.data?.case_details || '')}
                                    onChange={(e) => handleFieldChange(lead._id, 'caseDetails', e.target.value)}
                                    onBlur={() => handleSaveLead(lead._id)}
                                    className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-600"
                                  />
                                </td>
                                
                                {/* 8. lead_category */}
                                <td className="py-3 px-3 border-r border-slate-100 dark:border-slate-800 font-semibold">{leadCategory}</td>
                                
                                {/* 9. Remarks */}
                                <td className="py-2 px-2 border-r border-slate-100 dark:border-slate-800">
                                  <input
                                    type="text"
                                    placeholder="Remarks / Notes"
                                    value={(leadStates[lead._id]?.remarks ?? (lead.data?.notes || lead.data?.remarks || '')).replace(/<[^>]*>/g, '')}
                                    onChange={(e) => handleFieldChange(lead._id, 'remarks', e.target.value)}
                                    onBlur={() => handleSaveLead(lead._id)}
                                    className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-600"
                                  />
                                </td>
                                
                                {/* 10. Agent Assigned To */}
                                <td className="py-3 px-3 border-r border-slate-100 dark:border-slate-800 font-semibold text-slate-800 dark:text-slate-300">{agentAssigned}</td>
                                
                                {/* 11. Dial Status */}
                                <td className="py-2 px-2 border-r border-slate-100 dark:border-slate-800">
                                  <select
                                    value={leadStates[lead._id]?.status || lead.data?.status || 'Yet To Call'}
                                    onChange={(e) => handleStatusSelect(lead, e.target.value)}
                                    className="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-white cursor-pointer"
                                  >
                                    {CAMPAIGN_STATUSES.map(statusOpt => (
                                      <option key={statusOpt} value={statusOpt}>{statusOpt}</option>
                                    ))}
                                  </select>
                                </td>
                                
                                {/* 12. Dailed Datetime */}
                                <td className="py-3 px-3 font-semibold text-slate-600 dark:text-slate-400">{dialedDatetime}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableHorizontalScrollWrapper>
                  </div>
                ) : (
                  /* CARD VIEW MATCHING EXACT DESIGN IN MEDIA USER IMAGE */
                  <div className="space-y-4">
                    {displayedLeads.map((lead, idx) => {
                      const customer = getLeadCustomer(lead.data);
                      const firmName = getLeadFirmName(lead.data);
                      const phoneVal = getLeadPhone(lead.data) || 'N/A';
                      const dataCode = getLeadDataCode(lead);
                      const caseCategory = lead.data?.caseCategory || lead.data?.case_category || 'N/A';
                      const leadCategory = getLeadCategory(lead.data);
                      const agentAssigned = lead.data?.assignedTo || (lead as any).assignedToName || 'Unassigned';
                      const createdOnStr = lead.createdAt 
                        ? new Date(lead.createdAt).toLocaleDateString('en-GB') 
                        : 'N/A';
                      const currentStatus = leadStates[lead._id]?.status || lead.data?.status || 'Yet To Call';

                      return (
                        <div 
                          key={lead._id}
                          className="bg-white dark:bg-[#111827] rounded-xl border-l-[4px] border-l-indigo-600 dark:border-l-indigo-500 border border-slate-200/90 dark:border-slate-800 p-3 sm:p-3.5 shadow-xs hover:shadow-md transition-all duration-200 space-y-2.5 text-left"
                        >
                          {/* TOP METADATA SECTION: 1. SL No & 2. Created Date */}
                          <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 text-[11px] font-black rounded-md">
                                SL No.: {idx + 1}
                              </span>
                            </div>
                            <span className="text-[10.5px] font-extrabold text-slate-600 dark:text-slate-400">
                              Created Date: <strong className="text-slate-900 dark:text-white font-black">{createdOnStr}</strong>
                            </span>
                          </div>

                          {/* MAIN DETAILS SECTION */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-0.5 text-xs">
                            {/* 3. Data Code */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Data Code:
                              </span>
                              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-xs block leading-tight">
                                {dataCode}
                              </span>
                            </div>

                            {/* Location */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Location:
                              </span>
                              <span className="font-extrabold text-slate-900 dark:text-white text-xs block truncate leading-tight">
                                {getLeadLocation(lead.data)}
                              </span>
                            </div>

                            {/* 4. Customer Name */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Customer Name:
                              </span>
                              <span className="font-extrabold text-slate-900 dark:text-white text-xs block truncate leading-tight">
                                {customer}
                              </span>
                            </div>

                            {/* 5. Firm Name */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Firm Name:
                              </span>
                              <span className="font-extrabold text-slate-900 dark:text-white text-xs block truncate leading-tight">
                                {firmName}
                              </span>
                            </div>

                            {/* 6. Status */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Status:
                              </span>
                              <select
                                value={currentStatus}
                                onChange={(e) => handleStatusSelect(lead, e.target.value)}
                                className="w-full h-7 text-xs font-extrabold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-0.5 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-2xs leading-tight"
                              >
                                {CAMPAIGN_STATUSES.map(statusOpt => (
                                  <option key={statusOpt} value={statusOpt}>{statusOpt}</option>
                                ))}
                              </select>
                            </div>

                            {/* 7. Case Details */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Case Details:
                              </span>
                              <input
                                type="text"
                                placeholder="Case Details"
                                value={leadStates[lead._id]?.caseDetails ?? (lead.data?.caseDetails || lead.data?.case_details || '')}
                                onChange={(e) => handleFieldChange(lead._id, 'caseDetails', e.target.value)}
                                onBlur={() => handleSaveLead(lead._id)}
                                className="w-full h-7 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-0.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs font-semibold leading-tight"
                              />
                            </div>

                            {/* 8. Lead Category */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Lead Category:
                              </span>
                              <span className="font-extrabold text-slate-900 dark:text-white text-xs block leading-tight">
                                {leadCategory}
                              </span>
                            </div>

                            {/* 9. Remarks */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Remarks:
                              </span>
                              <input
                                type="text"
                                placeholder="Remarks / Notes"
                                value={(leadStates[lead._id]?.remarks ?? (lead.data?.notes || lead.data?.remarks || '')).replace(/<[^>]*>/g, '')}
                                onChange={(e) => handleFieldChange(lead._id, 'remarks', e.target.value)}
                                onBlur={() => handleSaveLead(lead._id)}
                                className="w-full h-7 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-0.5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs font-semibold leading-tight"
                              />
                            </div>

                            {/* 10. Mobile Number */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Mobile Number:
                              </span>
                              <span className="font-mono font-bold text-slate-900 dark:text-white text-xs block leading-tight">
                                {maskPhoneNumber(phoneVal)}
                              </span>
                            </div>

                            {/* 11. Assigned To */}
                            <div className="bg-slate-50/60 dark:bg-slate-900/60 p-2 px-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 flex flex-col justify-center">
                              <span className="text-[9.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
                                Assigned To:
                              </span>
                              <span className="font-extrabold text-indigo-600 dark:text-indigo-400 text-xs block truncate leading-tight">
                                {agentAssigned}
                              </span>
                            </div>
                          </div>

                          {/* Action Buttons Footer (Group 1: WA CHAT + CALL left, Group 2: SAVE + EDIT right) */}
                          <div className="flex flex-wrap gap-2 justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800/80 pl-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap w-full sm:w-auto">
                              <button
                                onClick={() => handleWhatsAppChat(lead)}
                                className="flex-1 sm:flex-initial h-8 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-3xs"
                              >
                                <Icons.MessageSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                <span>WA CHAT</span>
                              </button>
                              <button
                                onClick={() => handleInitiateCall(lead)}
                                className="flex-1 sm:flex-initial h-8 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-3xs"
                              >
                                <Icons.PhoneCall className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                <span>CALL</span>
                              </button>
                            </div>

                            <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                              <button
                                onClick={() => handleSaveLead(lead._id)}
                                className="flex-1 sm:flex-initial h-8 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 uppercase tracking-wider"
                              >
                                <Icons.Save className="w-3 h-3" />
                                <span>SAVE</span>
                              </button>
                              <button
                                onClick={() => navigate(`/modules/leads/${lead._id}`)}
                                className="flex-1 sm:flex-initial h-8 px-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 text-[11px] font-bold rounded-lg shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 uppercase tracking-wider"
                              >
                                <Icons.Edit className="w-3 h-3 text-slate-600 dark:text-slate-300" />
                                <span>EDIT</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
