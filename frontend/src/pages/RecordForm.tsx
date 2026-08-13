import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import * as Icons from 'lucide-react';
import { useModuleStore, FieldDefinition } from '../store/moduleStore';
import api, { FILE_BASE_URL } from '../services/api';
import { useToastStore } from '../store/toastStore';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';

// Normalization helper for bank names
const normalizeBankForSubmit = (bankName: string): string => {
  if (!bankName) return '';
  const name = bankName.trim().toLowerCase();
  if (name === 'sbi' || name === 'state bank of india') return 'state bank of india';
  return name;
};

// Normalization helper for loan types
const normalizeLoanForSubmit = (loanType: string): string => {
  if (!loanType) return '';
  let type = loanType.trim().toLowerCase();
  if (type === 'lap' || type.includes('loan against property')) return 'loan against property';
  if (type.includes('salaried personal') || type === 'personal loan') return 'personal loan';
  if (type.endsWith(' loan') && !['personal loan', 'home loan', 'business loan'].includes(type)) {
    type = type.replace(/\s+loan$/, '').trim();
  }
  return type;
};

export default function RecordForm() {
  const { apiPath, id } = useParams<{ apiPath: string; id?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { activeModule, setActiveModuleByPath } = useModuleStore();
  const { showConfirm, showToast, showAlertModal } = useToastStore();
  const { user } = useAuthStore();
  const { branding } = useThemeStore();
  const isLeads = true; // Use light layout for all creation/edit forms

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formSchema, setFormSchema] = useState<any>(z.object({}));

  // Timeline / Comment / Attachments states for existing records
  const [timeline, setTimeline] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [dynamicStatuses, setDynamicStatuses] = useState<string[]>([]);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocName, setEditingDocName] = useState<string>('');
  const [bankPartnerMappings, setBankPartnerMappings] = useState<any[]>([]);
  const [psmAutoFilled, setPsmAutoFilled] = useState(false);
  const [psmWarningMessage, setPsmWarningMessage] = useState<string>('');
  const [conflictModal, setConflictModal] = useState<{
    isOpen: boolean;
    psmName: string;
    bankName: string;
    loanType: string;
  } | null>(null);
  const [bpDropdownOpen, setBpDropdownOpen] = useState(false);
  const [bpSearchQuery, setBpSearchQuery] = useState('');
  const [allBanks, setAllBanks] = useState<string[]>([]);
  const [allLoanTypes, setAllLoanTypes] = useState<string[]>([]);
  const [allTeams, setAllTeams] = useState<string[]>([]);
  const [allUsers, setAllUsers] = useState<string[]>([]);
  const [rawUsersList, setRawUsersList] = useState<any[]>([]);

  const isInitialLoadRef = React.useRef(true);

  useEffect(() => {
    const fetchDynamicStatuses = async () => {
      try {
        const res = await api.get('/statuses');
        setDynamicStatuses(res.data.map((s: any) => s.name));
      } catch (err) {
        console.error('Failed to fetch dynamic statuses', err);
      }
    };
    fetchDynamicStatuses();

    // Fetch dependencies for Leads module
    if (apiPath === 'leads') {
      const fetchLeadsDependencies = async () => {
        try {
          const [resBP, resBM, resProducts, resDepts, resUsers] = await Promise.all([
            api.get('/records/bankingpartners'),
            api.get('/records/bankmasters'),
            api.get('/records/products'),
            api.get('/records/departments'),
            api.get('/auth/users?purpose=dropdown')
          ]);
          
          setBankPartnerMappings(resBP.data?.records || resBP.data || []);
          
          // 1. Process bank options list (Bank Master Settings)
          const customBanks = (resBM.data?.records || []).map((r: any) => r.data?.bankName).filter(Boolean);
          const mergedBanks = customBanks.map((b: string) => b.toUpperCase());
          // Keep both 'SBI' and 'STATE BANK OF INDIA' for backwards-compatibility matching
          if (mergedBanks.includes('STATE BANK OF INDIA') && !mergedBanks.includes('SBI')) {
            mergedBanks.unshift('SBI');
          }
          setAllBanks(mergedBanks);

          // 2. Process loan types (Products Settings)
          const dbLoanTypes = (resProducts.data?.records || [])
            .map((r: any) => r.data?.name)
            .filter(Boolean)
            .map((b: string) => b.toUpperCase());
          if (dbLoanTypes.length > 0) {
            setAllLoanTypes(dbLoanTypes);
          } else {
            setAllLoanTypes(['SALARIED PERSONAL LOAN', 'BUSINESS LOAN', 'HOME LOAN', 'LAP']);
          }

          // 3. Process teams (Departments Settings)
          const dbTeams = (resDepts.data?.records || [])
            .map((r: any) => r.data?.name)
            .filter(Boolean);
          if (dbTeams.length > 0) {
            setAllTeams(dbTeams);
          } else {
            setAllTeams(['Team A', 'Team B']);
          }

          // 4. Process agents (Users settings)
          const dbUsers = (resUsers.data || [])
            .map((u: any) => [u.firstName, u.lastName].filter(Boolean).join(' '))
            .filter(Boolean);
          setAllUsers(dbUsers);
          setRawUsersList(resUsers.data || []);

        } catch (err) {
          console.error('Failed to load leads dependency data', err);
          // Fallbacks
          setAllBanks([]);
          setAllLoanTypes(['SALARIED PERSONAL LOAN', 'BUSINESS LOAN', 'HOME LOAN', 'LAP']);
          setAllTeams(['Team A', 'Team B']);
          setAllUsers([]);
          setRawUsersList([]);
        }
      };
      fetchLeadsDependencies();
    }
  }, [apiPath]);

  // Set isInitialLoadRef to false when loading goes from true to false
  useEffect(() => {
    let timer: any;
    if (!loading) {
      timer = setTimeout(() => {
        isInitialLoadRef.current = false;
      }, 300); // 300ms delay to make sure form values are fully loaded/reset
    } else {
      isInitialLoadRef.current = true;
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [loading]);

  // Set active module
  useEffect(() => {
    if (apiPath) {
      setActiveModuleByPath(apiPath);
    }
  }, [apiPath]);

  // Build schema and load existing record data
  useEffect(() => {
    if (!activeModule) return;

    // 1. Build dynamic Zod validation schema
    const schemaFields: Record<string, any> = {};

    activeModule.fields.forEach((field) => {
      // Don't validate formula fields in input schemas (they are backend calculated)
      if (field.type === 'formula') {
        schemaFields[field.name] = z.any().optional();
        return;
      }

      let zField: any;

      if (field.type === 'number' || field.type === 'currency') {
        zField = z.preprocess(
          (val) => (val === '' || val === undefined || val === null ? undefined : Number(val)),
          field.required 
            ? z.number({ required_error: `${field.label} is required.` }) 
            : z.number().optional()
        );
      } else if (field.required) {
        if (field.type === 'email') {
          zField = z.string().email('Invalid email address.');
        } else {
          zField = z.string().min(1, `${field.label} is required.`);
        }
      } else {
        zField = z.string().optional().or(z.literal(''));
      }

      schemaFields[field.name] = zField;
    });

    setFormSchema(z.object(schemaFields));

    // 2. Load record if in edit mode
    if (id) {
      loadRecordData();
    } else {
      // Initialize default values
      const defaults: Record<string, any> = {};
      activeModule.fields.forEach((f) => {
        if (f.defaultValue) defaults[f.name] = f.defaultValue;
      });
      defaults['country'] = 'INDIA';
      if (apiPath === 'leads') {
        const loggedInName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email.split('@')[0] : '';
        if (loggedInName) {
          defaults['source'] = loggedInName;
        }
      }
      
      // Merge values passed from campaign calling card
      const passedData = location.state || {};
      const finalDefaults = {
        ...defaults,
        ...passedData
      };
      
      reset(finalDefaults);
      setLoading(false);
    }
  }, [activeModule, id, apiPath, user, location]);

  const loadRecordData = async () => {
    try {
      const [recordRes, docRes, activityRes] = await Promise.all([
        api.get(`/records/${apiPath}/${id}`),
        api.get('/documents', { params: { recordId: id } }),
        api.get('/dashboard/metrics') // loads activities
      ]);

      const rawData = recordRes.data.data instanceof Map 
        ? Object.fromEntries(recordRes.data.data) 
        : (recordRes.data.data || {});
      
      const recordValues = { ...rawData };

      // Auto-populate firstName / lastName if lead has fullName, customerName, name, or leadName
      if (!recordValues.firstName && recordValues.fullName) {
        const parts = String(recordValues.fullName).trim().split(' ');
        recordValues.firstName = parts[0] || '';
        recordValues.lastName = parts.slice(1).join(' ') || '';
      } else if (!recordValues.firstName && recordValues.customerName) {
        const parts = String(recordValues.customerName).trim().split(' ');
        recordValues.firstName = parts[0] || '';
        recordValues.lastName = parts.slice(1).join(' ') || '';
      } else if (!recordValues.firstName && recordValues.name) {
        const parts = String(recordValues.name).trim().split(' ');
        recordValues.firstName = parts[0] || '';
        recordValues.lastName = parts.slice(1).join(' ') || '';
      } else if (!recordValues.firstName && recordValues.leadName) {
        const parts = String(recordValues.leadName).trim().split(' ');
        recordValues.firstName = parts[0] || '';
        recordValues.lastName = parts.slice(1).join(' ') || '';
      }

      // Ensure location is loaded from city / state / presentAddress if not set
      if (!recordValues.location) {
        recordValues.location = [recordValues.city, recordValues.state].filter(Boolean).join(', ') || recordValues.city || recordValues.presentAddress || '';
      }

      // Default currency
      if (!recordValues.currency) {
        recordValues.currency = 'INR';
      }
      
      reset(recordValues);
      setDocuments(docRes.data || []);
      
      // Filter activities for this record
      const fullTimeline = activityRes.data.recentActivities || [];
      setTimeline(fullTimeline.filter((t: any) => t.recordId === id));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors }
  } = useForm({
    resolver: zodResolver(formSchema)
  });

  // Watch fields for conditional visibility evaluation
  const watchedValues = watch() || {};

  const filteredUsers = React.useMemo(() => {
    let list = rawUsersList.filter((u: any) => u.isActive !== false);
    const selectedTeam = watchedValues?.assignToTeam;
    if (selectedTeam) {
      const filtered = list.filter((u: any) => String(u.department || '').trim().toLowerCase() === selectedTeam.trim().toLowerCase());
      if (filtered.length > 0) {
        list = filtered;
      }
    }
    return list.map((u: any) => [u.firstName, u.lastName].filter(Boolean).join(' ')).filter(Boolean);
  }, [rawUsersList, watchedValues?.assignToTeam]);

  const recordName = apiPath === 'leads'
    ? `${watchedValues?.firstName || ''} ${watchedValues?.lastName || ''}`.trim()
    : watchedValues?.fullName || watchedValues?.companyName || watchedValues?.dealName || watchedValues?.title || '';

  // Auto-fill PSM when loanType + businessPartner are both selected
  useEffect(() => {
    if (loading || apiPath !== 'leads' || bankPartnerMappings.length === 0) return;
    const selectedLoanType = watchedValues?.loanType;
    const selectedBank = watchedValues?.businessPartner;
    
    if (!selectedLoanType || !selectedBank) {
      if (psmAutoFilled) {
        setValue('psm', '');
        setPsmAutoFilled(false);
      }
      setPsmWarningMessage('');
      return;
    }
    
    const targetLoan = normalizeLoanForSubmit(selectedLoanType);

    // Split selected banks (supports comma-separated string)
    const selectedBanksList = selectedBank.split(',').map((s: string) => s.trim()).filter(Boolean);

    let matchedPsm: string | null = null;
    let matchedBank: string | null = null;

    console.log('[Bank Partner Debug] Selected Banks List:', selectedBanksList, 'Loan Type:', targetLoan);

    const resolvedPsms: string[] = [];
    const unmappedBanks: string[] = [];

    // Find mapping for each selected bank
    for (const bank of selectedBanksList) {
      const targetBank = normalizeBankForSubmit(bank);
      const match = bankPartnerMappings.find((bp: any) => {
        const bpLoanType = bp.data?.loanType || bp.loanType;
        const bpBanks = (bp.data?.bank || bp.bank || '')
          .split(',')
          .map((s: string) => normalizeBankForSubmit(s));
        
        const bpNormLoan = normalizeLoanForSubmit(bpLoanType || '');
        
        return bpNormLoan === targetLoan && bpBanks.includes(targetBank);
      });

      if (match) {
        const psmVal = match.data?.psm || match.psm;
        if (psmVal) {
          resolvedPsms.push(psmVal);
        } else {
          unmappedBanks.push(bank);
        }
      } else {
        unmappedBanks.push(bank);
      }
    }

    if (resolvedPsms.length > 0) {
      setValue('psm', resolvedPsms.join(', '));
      setPsmAutoFilled(true);
      if (unmappedBanks.length > 0) {
        setPsmWarningMessage(`No PSM has been assigned for: ${unmappedBanks.join(', ')} for this Loan Type. Please configure it in Settings → Bank Partner.`);
      } else {
        setPsmWarningMessage('');
      }
    } else {
      setValue('psm', '');
      setPsmAutoFilled(false);
      setPsmWarningMessage('No PSM has been assigned for any of the selected Banks and Loan Type. Please configure it in Settings → Bank Partner.');
    }
  }, [watchedValues.loanType, watchedValues.businessPartner, bankPartnerMappings, loading]);

  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.log('RecordForm Validation Errors:', errors);
    }
  }, [errors]);

  const onSubmitForm = async (formData: any) => {
    setSaving(true);
    try {
      const data = { ...formData };

      // Auto-sync fullName, location, and currency
      if (data.firstName || data.lastName) {
        data.fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
      }
      if (!data.location && (data.city || data.presentAddress || data.state)) {
        data.location = [data.city, data.state].filter(Boolean).join(', ') || data.city || data.presentAddress || '';
      }
      if (!data.currency) {
        data.currency = 'INR';
      }

      let createdCount = 1;
      if (id) {
        await api.put(`/records/${apiPath}/${id}`, data);
      } else {
        if (apiPath === 'leads' && data.businessPartner) {
          const partners = data.businessPartner.split(',').map((s: string) => s.trim()).filter(Boolean);
          if (partners.length > 1) {
            createdCount = partners.length;
            const promises = partners.map(async (partner: string) => {
              let matchedPsm = '';
              const targetLoan = normalizeLoanForSubmit(data.loanType || '');
              const targetBank = normalizeBankForSubmit(partner);
              
              const match = bankPartnerMappings.find((bp: any) => {
                const bpLoanType = bp.data?.loanType || bp.loanType;
                const bpBanks = (bp.data?.bank || bp.bank || '')
                  .split(',')
                  .map((s: string) => normalizeBankForSubmit(s));
                const bpNormLoan = normalizeLoanForSubmit(bpLoanType || '');
                return bpNormLoan === targetLoan && bpBanks.includes(targetBank);
              });
              
              if (match) {
                matchedPsm = match.data?.psm || match.psm || '';
              }
              
              const singleLeadData = {
                ...data,
                businessPartner: partner,
                psm: matchedPsm
              };
              
              return api.post(`/records/${apiPath}`, singleLeadData);
            });
            await Promise.all(promises);
          } else {
            await api.post(`/records/${apiPath}`, data);
          }
        } else {
          await api.post(`/records/${apiPath}`, data);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['records', apiPath] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      showAlertModal({
        title: id ? 'Saved Successfully' : 'Created Successfully',
        message: id 
          ? 'The record has been updated successfully.' 
          : createdCount > 1
            ? `${createdCount} leads have been created successfully (one for each business partner).`
            : 'The record has been created successfully.',
        type: 'success',
        onClose: () => {
          navigate(`/modules/${apiPath}`);
        }
      });
    } catch (err: any) {
      const serverData = err.response?.data;
      let msg = serverData?.error || 'Failed to submit form.';
      if (serverData?.details && Array.isArray(serverData.details) && serverData.details.length > 0) {
        msg = `${msg}: ${serverData.details.join(' ')}`;
      }
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Upload Document
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    const formData = new FormData();
    formData.append('file', file);
    if (id) formData.append('recordId', id);

    setUploadingDoc(true);
    try {
      const res = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setDocuments([res.data, ...documents]);
    } catch (err) {
      showToast('Failed to upload document.', 'error');
    } finally {
      setUploadingDoc(false);
    }
  };

  // Delete Document
  const handleDeleteDoc = (docId: string) => {
    showConfirm({
      title: 'Delete File',
      message: 'Are you sure you want to delete this file attachment?',
      onConfirm: async () => {
        try {
          await api.delete(`/documents/${docId}`);
          setDocuments(documents.filter((d) => d._id !== docId));
          showAlertModal({
            title: 'Deleted Successfully',
            message: 'The attached file has been permanently deleted.',
            type: 'success'
          });
        } catch (err) {
          showToast('Failed to delete file.', 'error');
        }
      }
    });
  };

  // Rename Document Submit
  const handleRenameDocSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDocId || !editingDocName.trim()) return;
    try {
      const res = await api.put(`/documents/${editingDocId}`, { name: editingDocName });
      setDocuments(documents.map((d) => (d._id === editingDocId ? res.data : d)));
      showToast('Document renamed successfully.', 'success');
      setEditingDocId(null);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to rename document.', 'error');
    }
  };

  const renderField = (field: FieldDefinition) => {
    // Evaluate Conditional Visibility
    if (field.conditionalVisibility) {
      const depValue = watchedValues?.[field.conditionalVisibility.dependsOnField];
      if (String(depValue || '').toLowerCase() !== field.conditionalVisibility.conditionValue.toLowerCase()) {
        return null;
      }
    }

    const inputBase = 'w-full h-11 px-4 text-xs font-semibold bg-white border border-[#EAE4DA] rounded-xl focus:outline-none focus:ring-4 focus:ring-[#17223B]/10 focus:border-[#17223B] transition-all text-[#111827] placeholder-slate-400';

    const labelClass = 'text-[11px] font-bold text-[#1F2937] uppercase tracking-wider block mb-1.5';

    if (field.name === 'source' && apiPath === 'leads') {
      return (
        <div key={field.name} className="space-y-1.5 text-left">
          <label className={labelClass}>
            {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
          <input
            type="text"
            readOnly
            placeholder={field.label}
            {...register(field.name)}
            className={`${inputBase} bg-slate-100/80 text-[#111827] font-semibold cursor-not-allowed border-[#EAE4DA]`}
          />
        </div>
      );
    }

    if (field.name === 'psm' && apiPath === 'leads') {
      const psmVal = watchedValues[field.name] || '';
      const lineCount = Math.max(1, psmVal.split(',').length);
      const calculatedRows = Math.min(6, lineCount);

      return (
        <div key={field.name} className="space-y-1.5 text-left">
          <label className={labelClass}>
            {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
          <textarea
            readOnly
            rows={calculatedRows}
            placeholder={field.label}
            {...register(field.name)}
            className="w-full px-4 py-2.5 text-xs font-semibold bg-slate-100/80 border border-[#EAE4DA] rounded-xl text-[#111827] focus:outline-none cursor-not-allowed resize-none transition-all duration-200"
          />
          {psmWarningMessage && (
            <p className="text-[11px] text-amber-600 font-bold mt-1 leading-normal">{psmWarningMessage}</p>
          )}
          {errors[field.name] && (
            <p className="text-[11px] text-rose-550 font-bold mt-1">{(errors[field.name]?.message as string)}</p>
          )}
        </div>
      );
    }

    if (field.name === 'businessPartner' && apiPath === 'leads') {
      const selectedVal = watchedValues[field.name] || '';
      const selectedList = selectedVal ? selectedVal.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      let opts = allBanks.length > 0 ? allBanks : field.options || [];

      const toggleBank = (bank: string) => {
        let newList: string[];
        if (selectedList.includes(bank)) {
          newList = selectedList.filter((x: string) => x !== bank);
        } else {
          newList = [...selectedList, bank];
        }
        setValue(field.name, newList.join(', '), { shouldValidate: true });
      };

      return (
        <div key={field.name} className="space-y-1.5 text-left relative">
          <label className={labelClass}>
            {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setBpDropdownOpen(!bpDropdownOpen)}
              className={`${inputBase} flex items-center justify-between text-left`}
            >
              <span className={selectedList.length === 0 ? "text-slate-400 font-medium" : "text-slate-900 font-medium truncate pr-4"}>
                {selectedList.length === 0 ? '-Select Business Partners-' : selectedList.join(', ')}
              </span>
              <Icons.ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
            </button>

            {/* Hidden input for react-hook-form integration */}
            <input type="hidden" {...register(field.name)} value={selectedVal} />

            {bpDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setBpDropdownOpen(false)} />
                <div className="absolute top-full left-0 w-full mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 z-50 space-y-2 max-h-72 flex flex-col">
                  {/* Search Bar */}
                  <div className="relative">
                    <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={bpSearchQuery}
                      onChange={(e) => setBpSearchQuery(e.target.value)}
                      placeholder={`Search out of ${opts.length} banks...`}
                      className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      autoFocus
                    />
                    {bpSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setBpSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <Icons.X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Quick Action Bar */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 px-1 text-[11px] font-bold">
                    <span className="text-slate-400">
                      {opts.filter(b => b.toLowerCase().includes(bpSearchQuery.toLowerCase())).length} Banks Found
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const filtered = opts.filter(b => b.toLowerCase().includes(bpSearchQuery.toLowerCase()));
                          const combined = Array.from(new Set([...selectedList, ...filtered]));
                          setValue(field.name, combined.join(', '), { shouldValidate: true });
                        }}
                        className="text-emerald-600 hover:text-emerald-800"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => setValue(field.name, '', { shouldValidate: true })}
                        className="text-rose-500 hover:text-rose-700"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  {/* Scrollable list */}
                  <div className="space-y-1 overflow-y-auto pr-1 flex-1 max-h-48">
                    {(() => {
                      const filteredOpts = opts.filter(b => b.toLowerCase().includes(bpSearchQuery.toLowerCase()));
                      if (filteredOpts.length === 0) {
                        return (
                          <div className="py-4 text-center text-slate-400 text-xs font-medium">
                            No banks matching "{bpSearchQuery}"
                          </div>
                        );
                      }
                      return filteredOpts.map((opt) => {
                        const isChecked = selectedList.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => toggleBank(opt)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-xl text-left transition-all ${
                              isChecked
                                ? 'bg-emerald-500/10 text-emerald-800 font-bold'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                                isChecked
                                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                                  : 'border-slate-300 bg-white'
                              }`}>
                                {isChecked && <Icons.Check className="w-3 h-3 stroke-[3]" />}
                              </div>
                              <span>{opt}</span>
                            </div>
                            {isChecked && (
                              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
                                Selected
                              </span>
                            )}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
          {errors[field.name] && (
            <p className="text-[11px] text-rose-550 font-bold mt-1">{(errors[field.name]?.message as string)}</p>
          )}
        </div>
      );
    }

    if (field.name === 'assignedTo' && apiPath === 'leads') {
      return (
        <div key={field.name} className="space-y-1.5 text-left">
          <label className={labelClass}>
            {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
          <select {...register(field.name)} className={inputBase}>
            <option value="" className="bg-white text-slate-500 font-semibold">-Select Agent-</option>
            {filteredUsers.map((userOpt) => (
              <option key={userOpt} value={userOpt} className="bg-white text-[#111827] font-bold">
                {userOpt}
              </option>
            ))}
          </select>
          {errors[field.name] && (
            <p className="text-[11px] text-rose-550 font-bold mt-1">{(errors[field.name]?.message as string)}</p>
          )}
        </div>
      );
    }

    switch (field.type) {
      case 'dropdown': {
        let opts = field.options || [];
        
        if (field.name === 'status' && dynamicStatuses.length > 0) {
          opts = dynamicStatuses;
        } else if (field.name === 'loanType' && apiPath === 'leads' && allLoanTypes.length > 0) {
          opts = allLoanTypes;
        } else if (field.name === 'assignToTeam' && apiPath === 'leads' && allTeams.length > 0) {
          opts = allTeams;
        }

        if (field.name === 'source') {
          const loggedInName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email.split('@')[0] : '';
          if (loggedInName && !opts.includes(loggedInName)) {
            opts = [loggedInName, ...opts];
          }
          const passedSource = location.state?.source;
          if (passedSource && !opts.includes(passedSource)) {
            opts = [passedSource, ...opts];
          }
        }
        return (
          <div key={field.name} className="space-y-1.5 text-left">
            <label className={labelClass}>
              {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
            </label>
            <select {...register(field.name)} className={inputBase}>
              {field.name !== 'country' && (
                <option value="" className="bg-white text-slate-500 font-semibold">-Select One-</option>
              )}
              {opts?.map((opt) => (
                <option key={opt} value={opt} className="bg-white text-[#111827] font-bold">
                  {opt}
                </option>
              ))}
            </select>
            {errors[field.name] && (
              <p className="text-[11px] text-rose-550 font-bold mt-1">{(errors[field.name]?.message as string)}</p>
            )}
          </div>
        );
      }

      case 'checkbox':
        return (
          <div key={field.name} className="flex items-center gap-2.5 text-left pt-6">
            <input
              type="checkbox"
              {...register(field.name)}
              className={isLeads 
                ? "rounded border-slate-300 bg-white text-emerald-600 focus:ring-0 focus:ring-offset-0 w-5 h-5 cursor-pointer"
                : "rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0 focus:ring-offset-0 w-5 h-5 cursor-pointer"}
            />
            <label className={isLeads 
              ? "text-xs md:text-[13px] font-bold text-slate-700 select-none cursor-pointer"
              : "text-xs md:text-[13px] font-bold text-slate-200 select-none cursor-pointer"}>
              {field.label}
            </label>
          </div>
        );

      case 'rich-text':
        return (
          <div key={field.name} className="space-y-1.5 text-left col-span-1 md:col-span-2 lg:col-span-4">
            <label className={labelClass}>{field.label}</label>
            <textarea
              rows={3}
              {...register(field.name)}
              placeholder={field.label}
              className={inputBase}
            />
          </div>
        );

      case 'formula':
        return (
          <div key={field.name} className="space-y-1.5 text-left">
            <label className={isLeads 
              ? "block text-xs md:text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-2"
              : "block text-xs md:text-[13px] font-bold text-slate-400 uppercase tracking-wider mb-2"}>{field.label} (Auto)</label>
            <input
              type="text"
              readOnly
              value={watchedValues?.[field.name] || 'Auto-Calculated'}
              className={isLeads
                ? "w-full px-4 py-3 text-sm bg-slate-100 border border-slate-200 rounded-xl text-slate-600 focus:outline-none cursor-not-allowed"
                : "w-full px-4 py-3 text-sm md:text-[15px] bg-slate-950/40 border border-slate-800 rounded-xl text-slate-450 focus:outline-none cursor-not-allowed"}
            />
          </div>
        );

      case 'date': {
        const storedVal = watchedValues?.[field.name] || '';
        const displayVal = (() => {
          if (!storedVal) return '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(storedVal)) {
            const [y, m, d] = storedVal.split('-');
            return `${d}/${m}/${y}`;
          }
          return storedVal;
        })();

        const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value;
          // Only allow digits and slashes
          let v = raw.replace(/[^\d/]/g, '');

          // Auto-insert slashes after dd and mm
          const digits = v.replace(/\//g, '');
          if (digits.length >= 4) {
            v = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
          } else if (digits.length >= 2) {
            v = digits.slice(0, 2) + '/' + digits.slice(2);
          }
          if (v.length > 10) v = v.slice(0, 10);

          // Store as yyyy-mm-dd when fully typed
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
            const [dd, mm, yyyy] = v.split('/');
            setValue(field.name, `${yyyy}-${mm}-${dd}`);
          } else {
            // Store the raw typed text temporarily so it stays visible
            setValue(field.name, v ? `__raw__${v}` : '');
          }
        };

        // For display: convert stored value or show raw typing
        const inputDisplay = (() => {
          if (storedVal.startsWith('__raw__')) return storedVal.replace('__raw__', '');
          return displayVal;
        })();
        const datePickerId = `date-picker-${field.name}`;

        return (
          <div key={field.name} className="space-y-1.5 text-left">
            <label className={labelClass}>
              {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
            </label>
            <div className="relative">
              <input
                type="text"
                value={inputDisplay}
                onChange={handleDateChange}
                placeholder="dd/mm/yyyy"
                maxLength={10}
                className={`${inputBase} pr-10`}
                autoComplete="new-password"
              />
              {/* Hidden native date picker */}
              <input
                id={datePickerId}
                type="date"
                className="sr-only"
                value={/^\d{4}-\d{2}-\d{2}$/.test(storedVal) ? storedVal : ''}
                onChange={(e) => {
                  if (e.target.value) setValue(field.name, e.target.value);
                }}
                tabIndex={-1}
              />
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById(datePickerId) as HTMLInputElement | null;
                  if (el) { try { el.showPicker(); } catch { el.click(); } }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 transition-colors"
              >
                <Icons.Calendar className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            {errors[field.name] && (
              <p className="text-[11px] text-rose-550 font-bold mt-1">{(errors[field.name]?.message as string)}</p>
            )}
          </div>
        );
      }

      case 'currency': {
        const symbol = branding?.currency === 'USD' ? '$' : branding?.currency === 'EUR' ? '€' : branding?.currency === 'GBP' ? '£' : branding?.currency === 'AED' ? 'AED' : '₹';

        return (
          <div key={field.name} className="space-y-1.5 text-left">
            <label className={labelClass}>
              {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
            </label>
            <div className="relative flex items-center">
              <input
                type="number"
                step="any"
                {...register(field.name)}
                placeholder={`Enter ${field.label.toLowerCase()} amount`}
                className={`${inputBase} pr-10 font-medium`}
                autoComplete="new-password"
              />
              <span className="absolute right-3.5 text-sm font-black text-slate-400 select-none pointer-events-none">
                {symbol}
              </span>
            </div>
            {errors[field.name] && (
              <p className="text-[11px] text-rose-550 font-bold mt-1">{(errors[field.name]?.message as string)}</p>
            )}
          </div>
        );
      }

      default: {
        if (field.name === 'budget' || field.name === 'salary') {
          const symbol = branding?.currency === 'USD' ? '$' : branding?.currency === 'EUR' ? '€' : branding?.currency === 'GBP' ? '£' : branding?.currency === 'AED' ? 'AED' : '₹';

          return (
            <div key={field.name} className="space-y-1.5 text-left">
              <label className={labelClass}>
                {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="any"
                  {...register(field.name)}
                  placeholder={`Enter ${field.label.toLowerCase()} amount`}
                  className={`${inputBase} pr-10 font-medium`}
                  autoComplete="new-password"
                />
                <span className="absolute right-3.5 text-sm font-black text-slate-400 select-none pointer-events-none">
                  {symbol}
                </span>
              </div>
              {errors[field.name] && (
                <p className="text-[11px] text-rose-550 font-bold mt-1">{(errors[field.name]?.message as string)}</p>
              )}
            </div>
          );
        }

        return (
          <div key={field.name} className="space-y-1.5 text-left">
            <label className={labelClass}>
              {field.label}{field.required && <span className="text-rose-500 ml-0.5">*</span>}
            </label>
            <input
              type={field.type === 'number' ? 'number' : 'text'}
              {...register(field.name)}
              placeholder={field.label}
              className={inputBase}
              autoComplete="new-password"
            />
            {errors[field.name] && (
              <p className="text-[11px] text-rose-550 font-bold mt-1">{(errors[field.name]?.message as string)}</p>
            )}
          </div>
        );
      }
    }
  };

  // Group fields into Loan Details / Personal Details sections
  const groupFields = (fields: FieldDefinition[]) => {
    const loanDetailNames = [
      'source', 'loanType', 'budget', 'dataCode', 'businessPartner', 'psm', 'status', 'caseDetails', 'assignToTeam', 'assignedTo', 'followUpDate', 'notes'
    ];
    const personalNames = [
      'firstName', 'lastName', 'company', 'salary', 'phone', 'email', 'presentAddress', 'city', 'pinCode', 'state', 'country'
    ];

    const sections: { title: string; fields: FieldDefinition[] }[] = [];

    if (apiPath === 'leads') {
      const loanFields = fields.filter(f => loanDetailNames.includes(f.name));
      const persFields = fields.filter(f => personalNames.includes(f.name));
      const remaining = fields.filter(f => !loanDetailNames.includes(f.name) && !personalNames.includes(f.name) && f.name !== 'leadScore');

      // Map labels specifically for Leads module
      loanFields.forEach(f => {
        if (f.name === 'status') f.label = 'Current Status';
        if (f.name === 'budget') f.label = 'Loan Amount';
        if (f.name === 'assignedTo') f.label = 'Assign To Agent';
        if (f.name === 'leadScore') f.label = 'Data Code';
        if (f.name === 'notes') f.label = 'Remarks';
      });

      persFields.forEach(f => {
        if (f.name === 'company') f.label = 'Company Name';
        if (f.name === 'phone') f.label = 'Mobile';
        if (f.name === 'email') f.label = 'E-Mail';
      });

      // Maintain order to match the request layout:
      // Loan Details
      const orderedLoan = [
        loanFields.find(f => f.name === 'source'),
        loanFields.find(f => f.name === 'budget'),
        loanFields.find(f => f.name === 'loanType'),
        loanFields.find(f => f.name === 'businessPartner'),
        loanFields.find(f => f.name === 'psm'),
        loanFields.find(f => f.name === 'status'),
        loanFields.find(f => f.name === 'assignToTeam'),
        loanFields.find(f => f.name === 'assignedTo'),
        loanFields.find(f => f.name === 'followUpDate'),
        loanFields.find(f => f.name === 'dataCode'),
        loanFields.find(f => f.name === 'caseDetails'),
        loanFields.find(f => f.name === 'notes')
      ].filter(Boolean) as FieldDefinition[];

      // Personal Details
      const orderedPers = [
        persFields.find(f => f.name === 'firstName'),
        persFields.find(f => f.name === 'lastName'),
        persFields.find(f => f.name === 'company'),
        persFields.find(f => f.name === 'salary'),
        persFields.find(f => f.name === 'phone'),
        persFields.find(f => f.name === 'email'),
        persFields.find(f => f.name === 'presentAddress'),
        persFields.find(f => f.name === 'city'),
        persFields.find(f => f.name === 'pinCode'),
        persFields.find(f => f.name === 'state'),
        persFields.find(f => f.name === 'country')
      ].filter(Boolean) as FieldDefinition[];

      sections.push({ title: 'Loan Details', fields: orderedLoan });
      sections.push({ title: 'Personal Details', fields: orderedPers });

      if (remaining.length > 0) {
        sections.push({ title: 'Additional Details', fields: remaining });
      }
    } else {
      sections.push({ title: `${activeModule?.singularLabel || 'Record'} Details`, fields: fields });
    }

    return sections;
  };

  if (!activeModule || loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded animate-shimmer"></div>
        <div className="h-64 rounded-lg animate-shimmer"></div>
      </div>
    );
  }

  const sections = groupFields(activeModule.fields);

  return (
    <div className="space-y-6 max-w-5xl mx-auto text-left">
      
      {/* breadcrumbs */}
      <div className="flex items-center gap-2 text-[11px] font-bold text-[#374151] dark:text-slate-400 uppercase tracking-wider">
        <Link to={`/modules/${activeModule.apiPath}`} className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
          {activeModule.pluralLabel}
        </Link>
        <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[#111827] dark:text-white font-bold">
          {id ? `Edit: ${recordName}` : `New ${activeModule.singularLabel}`}
        </span>
      </div>

      {/* Main card box */}
      <div className="card-premium p-0 overflow-hidden relative">
        
        {/* Header */}
        <div className="px-4 sm:px-6 md:px-8 py-4 sm:py-5 border-b border-[#EAE4DA] dark:border-slate-800 bg-[#F8F5F1]/60 dark:bg-slate-850 flex justify-between items-center">
          <h2 className="text-xs sm:text-sm font-bold text-[#111827] dark:text-white uppercase tracking-wider">
            {id ? `Edit ${activeModule.singularLabel}: ${recordName}` : `Create ${activeModule.singularLabel}`}
          </h2>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmitForm)} autoComplete="off">
          
          {sections.map((section) => (
            <div key={section.title} className="p-4 sm:p-6 md:p-8 border-b border-[#EAE4DA] dark:border-slate-800 last:border-b-0 space-y-5 sm:space-y-6">
              <div className="flex items-center gap-2.5 pb-1.5 mb-2">
                <div className="w-1.5 h-3.5 bg-[#17223B] dark:bg-indigo-500 rounded-full" />
                <h3 className="text-xs font-bold text-[#111827] dark:text-white uppercase tracking-wider">
                  {section.title}
                </h3>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-4 sm:gap-y-5">
                {section.fields.map((field) => renderField(field))}
              </div>
            </div>
          ))}

          {/* Centered actions footer */}
          <div className="p-4 sm:p-6 bg-[#F8F5F1]/60 dark:bg-slate-850 border-t border-[#EAE4DA] dark:border-slate-800 flex items-center justify-center gap-3 sm:gap-4">
            <Link
              to={`/modules/${activeModule.apiPath}`}
              className="btn-secondary-premium h-10 px-5 text-xs font-bold"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary-premium h-10 px-6 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              {saving && <Icons.Loader className="w-3.5 h-3.5 animate-spin" />}
              Save
            </button>
          </div>

        </form>

      </div>

      {/* Attachments & Audit below card (only in Edit mode) */}
      {id && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Attachments panel */}
          <div className="card-premium p-4 sm:p-6">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-[10px] font-[800] text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                <Icons.Paperclip className="w-4 h-4 text-indigo-500" /> Attachments
              </h4>
              <label className="text-[10px] font-[800] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex items-center gap-1">
                {uploadingDoc ? (
                  <Icons.Loader className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Icons.Plus className="w-3 h-3" /> Upload File
                  </>
                )}
                <input type="file" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>

            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc._id} className="p-3 bg-slate-50/80 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700 flex items-center justify-between group">
                  <div className="flex items-center gap-2.5 truncate">
                    <Icons.FileText className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                    <div className="truncate text-left">
                      <a
                        href={`${FILE_BASE_URL}${doc.filePath}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-slate-800 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        {doc.name}
                      </a>
                      <span className="text-[10px] text-slate-400 block">
                        {(doc.size / 1024).toFixed(1)} KB • {new Date(doc.uploadedAt || doc.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setEditingDocId(doc._id);
                        setEditingDocName(doc.name);
                      }}
                      className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors cursor-pointer"
                      title="Rename file"
                    >
                      <Icons.Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteDoc(doc._id)}
                      className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                      title="Delete file"
                    >
                      <Icons.Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {documents.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-400 border border-dashed rounded-xl border-slate-200 dark:border-slate-700 font-medium">
                  No files attached.
                </div>
              )}
            </div>
          </div>

          {/* Activity History panel */}
          <div className="card-premium p-4 sm:p-6">
            <h4 className="text-[10px] font-[800] text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-2">
              <Icons.History className="w-4 h-4 text-indigo-500" /> Activity History
            </h4>

            <div className="relative pl-4 border-l border-slate-100 dark:border-slate-800 space-y-4 max-h-[300px] overflow-y-auto">
              {timeline.map((item) => (
                <div key={item._id} className="relative text-left text-xs">
                  <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-4 ring-white dark:ring-slate-900"></div>
                  <p className="font-semibold text-slate-700 dark:text-slate-200">
                    {item.userId?.firstName} {item.userId?.lastName}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{item.type} change</p>
                  {item.details?.fieldName && (
                    <p className="text-slate-600 dark:text-slate-300 mt-1">
                      Changed <span className="font-medium text-slate-700 dark:text-white">{item.details.fieldName}</span> from{' '}
                      <span className="font-semibold text-rose-500">{String(item.details.oldValue || 'None')}</span> to{' '}
                      <span className="font-semibold text-emerald-500">{String(item.details.newValue)}</span>.
                    </p>
                  )}
                </div>
              ))}
              {timeline.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-400 font-medium">
                  No activity history yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Premium Rename Document Modal */}
      {editingDocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="relative w-full max-w-sm bg-white border border-[#E8ECF4] rounded-[20px] shadow-xl p-6 space-y-4 text-left">
            <h3 className="text-xs font-[800] text-slate-400 uppercase tracking-wider">Rename File Attachment</h3>
            <form onSubmit={handleRenameDocSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-1.5">New File Name</label>
                <input
                  type="text"
                  required
                  value={editingDocName}
                  onChange={(e) => setEditingDocName(e.target.value)}
                  className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                />
              </div>
              <div className="flex gap-2.5 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingDocId(null)}
                  className="btn-secondary-premium h-9 px-4 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-premium h-9 px-4 text-xs font-bold"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
