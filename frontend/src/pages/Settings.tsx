import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useThemeStore, ThemeSettings } from '../store/themeStore';
import { useModuleStore, FieldDefinition } from '../store/moduleStore';
import api, { FILE_BASE_URL } from '../services/api';
import * as Icons from 'lucide-react';
import FaceEnrollment from '../components/FaceEnrollment';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { useQueryClient } from '@tanstack/react-query';

const PRESET_COLORS = [
  { name: 'Indigo', rgb: '79 70 229', hex: '#4F46E5' },
  { name: 'Emerald', rgb: '16 185 129', hex: '#10B981' },
  { name: 'Teal', rgb: '13 148 136', hex: '#0D9488' },
  { name: 'Rose', rgb: '244 63 94', hex: '#F43F5E' },
  { name: 'Amber', rgb: '245 158 11', hex: '#F59E0B' },
  { name: 'Sky', rgb: '14 165 233', hex: '#0EA5E9' }
];

const FONTS = ['Inter', 'Outfit', 'Roboto'];

export default function Settings() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { showConfirm, showToast, showAlertModal } = useToastStore();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const currentTab = queryParams.get('tab') || 'company';

  const { branding, fetchBranding, applyTheme } = useThemeStore();
  const { modules } = useModuleStore();

  const [companyName, setCompanyName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [selectedColor, setSelectedColor] = useState('79 70 229');
  const [sidebarBg, setSidebarBg] = useState('#0f172a');
  const [fontFamily, setFontFamily] = useState('Inter');
  const [mode, setMode] = useState<'light' | 'dark' | 'system'>('light');

  // Company Setting sub-tab active state
  const [companySubTab, setCompanySubTab] = useState<'details' | 'address' | 'admin'>('details');

  // Extended Company details state
  const [companyCode, setCompanyCode] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [companyDocUrl, setCompanyDocUrl] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [fax, setFax] = useState('');
  const [website, setWebsite] = useState('');
  const [currency, setCurrency] = useState('INR');

  // Address state
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [companyState, setCompanyState] = useState('');
  const [country, setCountry] = useState('India');
  const [postalCode, setPostalCode] = useState('');

  // Admin Details state
  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [financialYear, setFinancialYear] = useState('');
  const [roleType, setRoleType] = useState('');

  // RBAC permissions state
  const [roles, setRoles] = useState<any[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [rolePermissions, setRolePermissions] = useState<any[]>([]);
  const [roleFormName, setRoleFormName] = useState('');
  const [roleFormActive, setRoleFormActive] = useState(true);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [rolePage, setRolePage] = useState(1);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Status settings state
  const [statuses, setStatuses] = useState<any[]>([]);
  const [statusForm, setStatusForm] = useState<any>({
    id: '', name: '', color: '#4F46E5', icon: 'Circle', pipelinePosition: 0,
    dashboardVisibility: true, isFinal: false, isSuccess: false, order: 0
  });
  const [statusEditing, setStatusEditing] = useState(false);

  // User management state
  const [users, setUsers] = useState<any[]>([]);
  const [userForm, setUserForm] = useState({
    id: '', email: '', password: '', firstName: '', lastName: '', roleId: ''
  });
  const [userEditing, setUserEditing] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);

  // Dynamic Module settings state
  const [moduleRecords, setModuleRecords] = useState<any[]>([]);
  const [moduleForm, setModuleForm] = useState<any>({});
  const [moduleEditingId, setModuleEditingId] = useState('');
  const [moduleModalOpen, setModuleModalOpen] = useState(false);
  const [moduleSearchQuery, setModuleSearchQuery] = useState('');

  // Custom Banking Partner state — hardcoded Indian bank list
  const INDIAN_BANKS = [
    'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
    'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'IndusInd Bank', 'IDFC FIRST Bank',
    'Union Bank of India', 'Bank of India', 'Central Bank of India', 'Indian Bank',
    'Yes Bank', 'Federal Bank', 'South Indian Bank', 'Karur Vysya Bank', 'Tata Capital',
    'L&T Finance', 'Bajaj Finserv', 'Shriram Finance', 'Fullerton India', 'Cholamandalam Finance'
  ];
  const [bankMastersList, setBankMastersList] = useState<string[]>([]);
  const [bpForm, setBpForm] = useState({ bank: '', loanType: '', psm: '' });
  const [selectedBanks, setSelectedBanks] = useState<string[]>([]);
  const [editingBpId, setEditingBpId] = useState<string | null>(null);
  const [bpEditModalOpen, setBpEditModalOpen] = useState(false);
  const [bpEditForm, setBpEditForm] = useState({ bank: '', loanType: '', psm: '' });
  const [selectedEditBanks, setSelectedEditBanks] = useState<string[]>([]);
  const [bpFilterBank, setBpFilterBank] = useState('');
  const [bpFilterPsm, setBpFilterPsm] = useState('');
  const [bpFilterLoanType, setBpFilterLoanType] = useState('');
  const [showAllBp, setShowAllBp] = useState(false);
  const [bpConflictModal, setBpConflictModal] = useState<{
    isOpen: boolean;
    psmName: string;
    bankName: string;
    loanType: string;
  } | null>(null);
  const [bpPsmDropdownOpen, setBpPsmDropdownOpen] = useState(false);
  const [bpPsmSearchQuery, setBpPsmSearchQuery] = useState('');
  const [bpEditPsmDropdownOpen, setBpEditPsmDropdownOpen] = useState(false);
  const [bpEditPsmSearchQuery, setBpEditPsmSearchQuery] = useState('');
  const [bpBanksDropdownOpen, setBpBanksDropdownOpen] = useState(false);
  const [bpBankSearchQuery, setBpBankSearchQuery] = useState('');
  const [bpEditBanksDropdownOpen, setBpEditBanksDropdownOpen] = useState(false);
  const [bpEditBankSearchQuery, setBpEditBankSearchQuery] = useState('');
  const [bpProductsList, setBpProductsList] = useState<string[]>([]);
  const [bpSuccessModal, setBpSuccessModal] = useState<{ isOpen: boolean; title: string; message: string } | null>(null);

  const checkBpConflict = (banks: string[], loanType: string, excludeId?: string) => {
    for (const bank of banks) {
      const targetBank = bank.trim().toLowerCase();
      const targetLoan = loanType.trim().toLowerCase();
      
      const conflict = moduleRecords.find((rec: any) => {
        if (excludeId && rec._id === excludeId) return false;
        
        const bpLoanType = rec.data?.loanType || rec.loanType || '';
        const bpBanks = (rec.data?.bank || rec.bank || '')
          .split(',')
          .map((s: string) => s.trim().toLowerCase());
          
        return bpLoanType.trim().toLowerCase() === targetLoan && bpBanks.includes(targetBank);
      });
      
      if (conflict) {
        return {
          bank,
          psmName: conflict.data?.psm || conflict.psm,
          loanType
        };
      }
    }
    return null;
  };

  const handleBankCheckboxChange = (bankName: string, checked: boolean) => {
    if (checked) {
      if (bpForm.loanType) {
        const conflict = checkBpConflict([bankName], bpForm.loanType);
        if (conflict) {
          setBpConflictModal({
            isOpen: true,
            psmName: conflict.psmName,
            bankName: bankName,
            loanType: bpForm.loanType
          });
          return; // Do not check the box
        }
      }
      setSelectedBanks([...selectedBanks, bankName]);
    } else {
      setSelectedBanks(selectedBanks.filter((b) => b !== bankName));
    }
  };

  const handleEditBankCheckboxChange = (bankName: string, checked: boolean) => {
    if (checked) {
      if (bpEditForm.loanType) {
        const conflict = checkBpConflict([bankName], bpEditForm.loanType, editingBpId || undefined);
        if (conflict) {
          setBpConflictModal({
            isOpen: true,
            psmName: conflict.psmName,
            bankName: bankName,
            loanType: bpEditForm.loanType
          });
          return; // Do not check the box
        }
      }
      setSelectedEditBanks([...selectedEditBanks, bankName]);
    } else {
      setSelectedEditBanks(selectedEditBanks.filter((b) => b !== bankName));
    }
  };

  const handleBpLoanTypeChange = (newLoanType: string) => {
    if (newLoanType && selectedBanks.length > 0) {
      const conflict = checkBpConflict(selectedBanks, newLoanType);
      if (conflict) {
        setBpConflictModal({
          isOpen: true,
          psmName: conflict.psmName,
          bankName: conflict.bank,
          loanType: newLoanType
        });
        // Uncheck the conflicting bank
        setSelectedBanks(selectedBanks.filter(b => b !== conflict.bank));
      }
    }
    setBpForm({ ...bpForm, loanType: newLoanType });
  };

  const handleBpEditLoanTypeChange = (newLoanType: string) => {
    if (newLoanType && selectedEditBanks.length > 0) {
      const conflict = checkBpConflict(selectedEditBanks, newLoanType, editingBpId || undefined);
      if (conflict) {
        setBpConflictModal({
          isOpen: true,
          psmName: conflict.psmName,
          bankName: conflict.bank,
          loanType: newLoanType
        });
        // Uncheck the conflicting bank
        setSelectedEditBanks(selectedEditBanks.filter(b => b !== conflict.bank));
      }
    }
    setBpEditForm({ ...bpEditForm, loanType: newLoanType });
  };
  const SETTINGS_TABS = [
    { id: 'company', label: 'Company Setting', icon: Icons.Building2, color: 'indigo', accentGradient: 'from-indigo-500 via-purple-500 to-pink-500', activeBadge: 'text-indigo-700 dark:text-indigo-300 bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800/60' },
    { id: 'role', label: 'Role', icon: Icons.Shield, color: 'purple', accentGradient: 'from-purple-500 to-pink-500', activeBadge: 'text-purple-700 dark:text-purple-300 bg-purple-50/80 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800/60' },
    { id: 'department', label: 'Department', icon: Icons.Network, color: 'teal', accentGradient: 'from-teal-500 to-emerald-500', activeBadge: 'text-teal-700 dark:text-teal-300 bg-teal-50/80 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800/60' },
    { id: 'product', label: 'Product', icon: Icons.Package, color: 'amber', accentGradient: 'from-amber-500 to-orange-500', activeBadge: 'text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/60' },
    { id: 'bankmaster', label: 'Bank Master', icon: Icons.Landmark, color: 'emerald', accentGradient: 'from-emerald-500 to-teal-500', activeBadge: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60' },
    { id: 'bankingpartner', label: 'Banking Partner', icon: Icons.Briefcase, color: 'sky', accentGradient: 'from-sky-500 to-indigo-500', activeBadge: 'text-sky-700 dark:text-sky-300 bg-sky-50/80 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800/60' },
    { id: 'status', label: 'Status', icon: Icons.Tag, color: 'rose', accentGradient: 'from-rose-500 to-pink-500', activeBadge: 'text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/60' },
  ];

  const currentUserRole = roles.find(r => r._id === user?.roleId);
  const isSuperAdmin = currentUserRole?.name === 'Super Admin';
  const visibleTabs = SETTINGS_TABS;
  const accessDenied = false;

  const tabToApiPath: Record<string, string> = {
    department: 'departments',
    product: 'products',
    bankmaster: 'bankmasters',
    bankingpartner: 'bankingpartners'
  };

  useEffect(() => {
    setBpForm({ bank: '', loanType: '', psm: '' });
    setSelectedBanks([]);
    setBpFilterBank('');
    setBpFilterPsm('');
    setBpFilterLoanType('');
    setShowAllBp(false);
    setModuleSearchQuery('');
    loadSettingsData();
  }, [branding, currentTab]);

  const loadSettingsData = async () => {
    let activeBranding = branding;
    if (!activeBranding) {
      const cachedSub = localStorage.getItem('tenantSubdomain') || 'sales';
      activeBranding = await fetchBranding(cachedSub);
    }
    
    if (activeBranding) {
      setCompanyName(activeBranding.name);
      setLogoUrl(activeBranding.logoUrl || '');
      setSelectedColor(activeBranding.themeSettings.primaryColor);
      setSidebarBg(activeBranding.themeSettings.sidebarBg);
      setFontFamily(activeBranding.themeSettings.fontFamily);
      setMode(activeBranding.themeSettings.mode);

      // Populate extended fields
      setCompanyCode(activeBranding.companyCode || '');
      setRegistrationId(activeBranding.registrationId || '');
      setStartDate(activeBranding.startDate || '');
      setEndDate(activeBranding.endDate || '');
      setCompanyDocUrl(activeBranding.companyDocUrl || '');
      setPhoneNumber(activeBranding.phoneNumber || '');
      setMobile(activeBranding.mobile || '');
      setEmail(activeBranding.email || '');
      setFax(activeBranding.fax || '');
      setWebsite(activeBranding.website || '');
      setCurrency(activeBranding.currency || 'INR');

      setAddress(activeBranding.address || '');
      setCity(activeBranding.city || '');
      setCompanyState(activeBranding.state || '');
      setCountry(activeBranding.country || 'India');
      setPostalCode(activeBranding.postalCode || '');

      if (activeBranding.adminDetails) {
        setAdminFirstName(activeBranding.adminDetails.firstName || '');
        setAdminLastName(activeBranding.adminDetails.lastName || '');
        setAdminUsername(activeBranding.adminDetails.username || '');
        setAdminPassword(activeBranding.adminDetails.password || '');
        setAdminConfirmPassword(activeBranding.adminDetails.password || '');
        setFinancialYear(activeBranding.adminDetails.financialYear || '');
        setRoleType(activeBranding.adminDetails.roleType || '');
      }
    }

    try {
      // Load Roles from backend
      const resRoles = await api.get('/auth/roles');
      const fetchedRoles = resRoles.data || [];
      setRoles(fetchedRoles);
      
      if (fetchedRoles.length > 0 && !selectedRoleId) {
        setSelectedRoleId(fetchedRoles[0]._id);
        setRolePermissions(fetchedRoles[0].permissions?.modules || []);
      }

      // Load specific tab data
      if (currentTab === 'status') {
        const resStatus = await api.get('/statuses');
        setStatuses(resStatus.data || []);
      } else if (currentTab === 'users') {
        const resUsers = await api.get('/auth/users');
        setUsers(resUsers.data || []);
      } else if (tabToApiPath[currentTab]) {
        const apiPath = tabToApiPath[currentTab];
        const resModRecords = await api.get(`/records/${apiPath}?limit=1000`);
        setModuleRecords(resModRecords.data?.records || []);

        if (currentTab === 'bankingpartner') {
          // Fetch users for PSM dropdown (always, independent of bank masters)
          try {
            const resUsers = await api.get('/auth/users');
            setUsers(resUsers.data || []);
          } catch { console.warn('Could not load users for PSM'); }
          // Fetch bank masters list
          try {
            const resBM = await api.get('/records/bankmasters?limit=1000');
            const apiNames: string[] = (resBM.data?.records || []).map((r: any) => r.data?.bankName).filter(Boolean);
            setBankMastersList(apiNames);
          } catch {
            setBankMastersList([]);
          }
          // Fetch products for loan types
          try {
            const resProducts = await api.get('/records/products?limit=1000');
            const productNames: string[] = (resProducts.data?.records || []).map((r: any) => r.data?.name).filter(Boolean);
            setBpProductsList(productNames.map((n: string) => n.toUpperCase()));
          } catch {
            setBpProductsList(['HOME LOAN', 'LOAN AGAINST PROPERTY LOAN', 'BUSINESS LOAN', 'PERSONAL LOAN']);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load settings dependency data', e);
    } finally {
      setLoading(false);
    }
  };

  // Branding Customizer updates applied locally in real time
  const handleColorChange = (rgbTriplet: string) => {
    setSelectedColor(rgbTriplet);
    applyTheme({
      primaryColor: rgbTriplet,
      sidebarBg,
      headerBg: '#ffffff',
      fontFamily,
      mode
    });
  };

  const handleFontChange = (font: string) => {
    setFontFamily(font);
    applyTheme({
      primaryColor: selectedColor,
      sidebarBg,
      headerBg: '#ffffff',
      fontFamily: font,
      mode
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    try {
      const res = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const uploadedPath = `${FILE_BASE_URL}${res.data.filePath}`;
      setLogoUrl(uploadedPath);
    } catch (err) {
      showToast('Failed to upload logo.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleModeChange = (selectedMode: 'light' | 'dark' | 'system') => {
    setMode(selectedMode);
    applyTheme({
      primaryColor: selectedColor,
      sidebarBg,
      headerBg: '#ffffff',
      fontFamily,
      mode: selectedMode
    });
  };

  const handleSaveBranding = async () => {
    setSaving(true);
    try {
      const themeSettings: ThemeSettings = {
        primaryColor: selectedColor,
        sidebarBg,
        headerBg: '#ffffff',
        fontFamily,
        mode
      };

      await api.put('/tenants/branding', {
        name: companyName,
        logoUrl,
        themeSettings,

        companyCode,
        registrationId,
        startDate,
        endDate,
        companyDocUrl,
        phoneNumber,
        mobile,
        email,
        fax,
        website,
        currency,

        address,
        city,
        state: companyState,
        country,
        postalCode,

        adminDetails: {
          firstName: adminFirstName,
          lastName: adminLastName,
          username: adminUsername,
          password: adminPassword,
          financialYear,
          roleType
        }
      });

      await fetchBranding();
      showAlertModal({
        title: 'Saved Successfully',
        message: 'Company settings and branding configuration have been saved successfully.',
        type: 'success'
      });
    } catch (err) {
      showToast('Failed to save company settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePermissionChange = (moduleName: string, action: string, val: any) => {
    const updated = rolePermissions.map((p) => {
      if (p.moduleName.toLowerCase() === moduleName.toLowerCase()) {
        return { ...p, [action]: val };
      }
      return p;
    });
    setRolePermissions(updated);
  };

  const handleSaveRole = async () => {
    if (!roleFormName.trim()) {
      showToast('Role name cannot be empty.', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (editingRoleId) {
        // Update existing
        await api.put(`/auth/roles/${editingRoleId}`, { name: roleFormName, isActive: roleFormActive });
        showAlertModal({
          title: 'Saved Successfully',
          message: 'The Role configuration has been updated successfully.',
          type: 'success'
        });
      } else {
        // Create new
        await api.post('/auth/roles', { name: roleFormName, isActive: roleFormActive });
        showAlertModal({
          title: 'Created Successfully',
          message: 'The new Role has been created successfully.',
          type: 'success'
        });
      }
      setRoleFormName('');
      setRoleFormActive(true);
      setEditingRoleId(null);
      
      // Reload roles list
      const res = await api.get('/auth/roles');
      setRoles(res.data || []);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save role.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = (id: string) => {
    showConfirm({
      title: 'Delete Role',
      message: 'Are you sure you want to delete this role? This will permanently remove its permissions settings.',
      onConfirm: async () => {
        try {
          await api.delete(`/auth/roles/${id}`);
          showAlertModal({
            title: 'Deleted Successfully',
            message: 'The Role configuration has been permanently deleted.',
            type: 'success'
          });
          // Reload roles list
          const res = await api.get('/auth/roles');
          setRoles(res.data || []);
        } catch (err: any) {
          showToast(err.response?.data?.error || 'Failed to delete role.', 'error');
        }
      }
    });
  };

  const handleCancelRoleEdit = () => {
    setRoleFormName('');
    setRoleFormActive(true);
    setEditingRoleId(null);
  };

  // Status Handlers
  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (statusEditing) {
        await api.put(`/statuses/${statusForm.id}`, statusForm);
        showAlertModal({
          title: 'Saved Successfully',
          message: 'The status stage has been updated successfully.',
          type: 'success'
        });
      } else {
        await api.post('/statuses', statusForm);
        showAlertModal({
          title: 'Created Successfully',
          message: 'The new status stage has been created successfully.',
          type: 'success'
        });
      }
      setStatusForm({
        id: '', name: '', color: '#4F46E5', icon: 'Circle', pipelinePosition: 0,
        dashboardVisibility: true, isFinal: false, isSuccess: false, order: 0
      });
      setStatusEditing(false);
      loadSettingsData();
      queryClient.invalidateQueries({ queryKey: ['statuses-list'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-leads'] });
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save status.', 'error');
    }
  };

  const handleEditStatus = (status: any) => {
    setStatusForm({
      id: status._id,
      name: status.name,
      color: status.color,
      icon: status.icon,
      pipelinePosition: status.pipelinePosition || 0,
      dashboardVisibility: status.dashboardVisibility,
      isFinal: status.isFinal,
      isSuccess: status.isSuccess,
      order: status.order
    });
    setStatusEditing(true);
  };

  const handleDeleteStatus = (id: string) => {
    showConfirm({
      title: 'Delete Status',
      message: 'Are you sure you want to delete this status? Leads using this status will lose their mapping.',
      onConfirm: async () => {
        try {
          await api.delete(`/statuses/${id}`);
          showAlertModal({
            title: 'Deleted Successfully',
            message: 'The Lead Status stage has been permanently deleted.',
            type: 'success'
          });
          loadSettingsData();
          queryClient.invalidateQueries({ queryKey: ['statuses-list'] });
          queryClient.invalidateQueries({ queryKey: ['sidebar-statuses'] });
          queryClient.invalidateQueries({ queryKey: ['sidebar-leads'] });
        } catch (err) {
          showToast('Failed to delete status.', 'error');
        }
      }
    });
  };

  // User Handlers
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (userEditing) {
        await api.put(`/auth/users/${userForm.id}`, userForm);
        showAlertModal({
          title: 'Saved Successfully',
          message: 'The user account has been updated successfully.',
          type: 'success'
        });
      } else {
        await api.post('/auth/users', userForm);
        showAlertModal({
          title: 'Created Successfully',
          message: 'The new user account has been created successfully.',
          type: 'success'
        });
      }
      setUserModalOpen(false);
      setUserEditing(false);
      setUserForm({ id: '', email: '', password: '', firstName: '', lastName: '', roleId: '' });
      loadSettingsData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save user.', 'error');
    }
  };

  const handleEditUser = (user: any) => {
    setUserForm({
      id: user._id,
      email: user.email,
      password: '',
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId?._id || ''
    });
    setUserEditing(true);
    setUserModalOpen(true);
  };

  const handleDeleteUser = (id: string) => {
    showConfirm({
      title: 'Remove User',
      message: 'Are you sure you want to remove this user? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await api.delete(`/auth/users/${id}`);
          showToast('User removed successfully.', 'success');
          loadSettingsData();
        } catch (err) {
          showToast('Failed to delete user.', 'error');
        }
      }
    });
  };

  const handleToggleUserSetting = async (userId: string, field: 'skipFace' | 'skipLocation' | 'isActive', currentValue: boolean) => {
    try {
      await api.put(`/auth/users/${userId}`, { [field]: !currentValue });
      loadSettingsData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update user setting.', 'error');
    }
  };

  const handleUserRoleChange = async (userId: string, newRoleId: string) => {
    try {
      await api.put(`/auth/users/${userId}`, { roleId: newRoleId });
      showToast('Role updated successfully.', 'success');
      loadSettingsData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update user role.', 'error');
    }
  };

  // Dynamic Module Record Handlers
  const activeModuleDef = modules.find(m => m.apiPath === tabToApiPath[currentTab]);

  const handleSaveModuleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeModuleDef) return;
    const apiPath = activeModuleDef.apiPath;
    try {
      if (moduleEditingId) {
        await api.put(`/records/${apiPath}/${moduleEditingId}`, moduleForm);
        showAlertModal({
          title: 'Saved Successfully',
          message: `The ${activeModuleDef.singularLabel} record has been updated successfully.`,
          type: 'success'
        });
      } else {
        await api.post(`/records/${apiPath}`, moduleForm);
        showAlertModal({
          title: 'Created Successfully',
          message: `The new ${activeModuleDef.singularLabel} record has been created successfully.`,
          type: 'success'
        });
      }
      setModuleModalOpen(false);
      setModuleForm({});
      setModuleEditingId('');
      loadSettingsData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save record.', 'error');
    }
  };

  const handleEditModuleRecord = (rec: any) => {
    setModuleForm(rec.data || {});
    setModuleEditingId(rec._id);
    setModuleModalOpen(true);
  };

  const handleDeleteModuleRecord = (id: string) => {
    if (!activeModuleDef) return;
    showConfirm({
      title: 'Delete Record',
      message: `Are you sure you want to delete this ${activeModuleDef.singularLabel} record?`,
      onConfirm: async () => {
        try {
          await api.delete(`/records/${activeModuleDef.apiPath}/${id}`);
          showAlertModal({
            title: 'Deleted Successfully',
            message: `The ${activeModuleDef.singularLabel} record has been permanently deleted.`,
            type: 'success'
          });
          loadSettingsData();
        } catch (err) {
          showToast('Failed to delete record.', 'error');
        }
      }
    });
  };

  // Banking Partner Handlers

  const handleSaveBankingPartner = async (e: React.FormEvent) => {
    e.preventDefault();
    const banksStr = selectedBanks.join(', ');
    if (!banksStr || !bpForm.loanType || !bpForm.psm) {
      showToast('Please select all required fields (including at least one bank).', 'warning');
      return;
    }

    const conflict = checkBpConflict(selectedBanks, bpForm.loanType);
    if (conflict) {
      setBpConflictModal({
        isOpen: true,
        psmName: conflict.psmName,
        bankName: conflict.bank,
        loanType: conflict.loanType
      });
      return;
    }

    try {
      await api.post('/records/bankingpartners', {
        bank: banksStr,
        loanType: bpForm.loanType,
        psm: bpForm.psm
      });
      setBpSuccessModal({
        isOpen: true,
        title: 'Successfully Created',
        message: 'The Banking Partner record has been successfully created and linked.'
      });
      setBpForm({ bank: '', loanType: '', psm: '' });
      setSelectedBanks([]);
      setBpPsmSearchQuery('');
      loadSettingsData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save banking partner.', 'error');
    }
  };

  const handleEditBankingPartner = (bp: any) => {
    setEditingBpId(bp._id);
    setBpEditForm({
      bank: bp.bank || '',
      loanType: bp.loanType || '',
      psm: bp.psm || ''
    });
    const banks = (bp.bank || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    setSelectedEditBanks(banks);
    setBpEditModalOpen(true);
    setBpEditPsmSearchQuery('');
  };

  const handleSaveEditedBankingPartner = async (e: React.FormEvent) => {
    e.preventDefault();
    const banksStr = selectedEditBanks.join(', ');
    if (!banksStr || !bpEditForm.loanType || !bpEditForm.psm) {
      showToast('Please select all required fields (including at least one bank).', 'warning');
      return;
    }

    const conflict = checkBpConflict(selectedEditBanks, bpEditForm.loanType, editingBpId || undefined);
    if (conflict) {
      setBpConflictModal({
        isOpen: true,
        psmName: conflict.psmName,
        bankName: conflict.bank,
        loanType: conflict.loanType
      });
      return;
    }

    try {
      await api.put(`/records/bankingpartners/${editingBpId}`, {
        bank: banksStr,
        loanType: bpEditForm.loanType,
        psm: bpEditForm.psm
      });
      setBpSuccessModal({
        isOpen: true,
        title: 'Successfully Saved',
        message: 'The Banking Partner record has been successfully updated and saved.'
      });
      setBpEditForm({ bank: '', loanType: '', psm: '' });
      setSelectedEditBanks([]);
      setBpEditPsmSearchQuery('');
      setEditingBpId(null);
      setBpEditModalOpen(false);
      loadSettingsData();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save banking partner.', 'error');
    }
  };

  const handleCancelEditBankingPartner = () => {
    setBpEditForm({ bank: '', loanType: '', psm: '' });
    setSelectedEditBanks([]);
    setEditingBpId(null);
    setBpEditModalOpen(false);
  };

  const handleDeleteBankingPartner = (id: string) => {
    showConfirm({
      title: 'Delete Banking Partner',
      message: 'Are you sure you want to delete this banking partner?',
      onConfirm: async () => {
        try {
          await api.delete(`/records/bankingpartners/${id}`);
          showAlertModal({
            title: 'Deleted Successfully',
            message: 'The Banking Partner configuration has been permanently deleted.',
            type: 'success'
          });
          loadSettingsData();
        } catch (err) {
          showToast('Failed to delete banking partner.', 'error');
        }
      }
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded animate-shimmer"></div>
        <div className="h-40 rounded-lg animate-shimmer"></div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto text-left">
        <div className="pb-2">
          <h1 className="text-2xl uppercase font-[800] tracking-tight text-slate-800">
            Settings
          </h1>
        </div>

        <div className="bg-white border border-[#E8ECF4] rounded-[20px] p-8 shadow-sm text-center max-w-xl mx-auto space-y-4">
          <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto text-rose-500">
            <Icons.ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Access Denied</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            Only the system's main <strong>Super Admin</strong> is permitted to access the Users, Roles, and Security settings.
          </p>
          <button
            onClick={() => navigate('/settings?tab=company')}
            className="btn-primary-premium inline-flex items-center gap-2"
          >
            <Icons.ArrowLeft className="w-4 h-4" />
            Back to Company Settings
          </button>
        </div>
      </div>
    );
  }

  const activeTabMeta = visibleTabs.find(t => t.id === currentTab) || visibleTabs[0];

  return (
    <div className="space-y-6 max-w-6xl mx-auto text-left px-4 md:px-8 py-4">
      {/* Header Banner with Subtle Accent */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${activeTabMeta.accentGradient}`} />
        
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl bg-gradient-to-tr ${activeTabMeta.accentGradient} flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 flex-shrink-0`}>
            {React.createElement(activeTabMeta.icon, { className: "w-6 h-6 stroke-[2.2]" })}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-black uppercase tracking-wider font-mono px-2.5 py-0.5 rounded-full border ${activeTabMeta.activeBadge}`}>
                System Settings
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Workspace Configuration
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              {activeTabMeta.label}
            </h1>
          </div>
        </div>
      </div>

      {/* Settings Tabs Navigation with Subtle Colored Active Pills */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-2 rounded-2xl shadow-xs">
        <div className="flex overflow-x-auto gap-1.5 hide-scrollbar py-0.5 px-0.5">
          {visibleTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => navigate(`/settings?tab=${tab.id}`)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                  isActive 
                    ? `${tab.activeBadge} shadow-3xs font-extrabold` 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? '' : 'text-slate-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        
        {/* Company Settings */}
        <div className={`lg:col-span-12 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-0 overflow-hidden shadow-xs relative ${currentTab === 'company' ? 'block' : 'hidden'}`}>
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
          {/* Sub-tabs Header */}
          <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => setCompanySubTab('details')}
              className={`px-6 py-3.5 font-bold text-xs uppercase tracking-wider transition-all relative cursor-pointer ${
                companySubTab === 'details'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border-r border-slate-100 dark:border-slate-800 font-extrabold shadow-3xs'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800 hover:text-slate-800 border-r border-slate-100 dark:border-slate-800'
              }`}
            >
              Company Details
              {companySubTab === 'details' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setCompanySubTab('address')}
              className={`px-6 py-3.5 font-bold text-xs uppercase tracking-wider transition-all relative cursor-pointer ${
                companySubTab === 'address'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border-r border-slate-100 dark:border-slate-800 font-extrabold shadow-3xs'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800 hover:text-slate-800 border-r border-slate-100 dark:border-slate-800'
              }`}
            >
              Address
              {companySubTab === 'address' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setCompanySubTab('admin')}
              className={`px-6 py-3.5 font-bold text-xs uppercase tracking-wider transition-all relative cursor-pointer ${
                companySubTab === 'admin'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border-r border-slate-100 dark:border-slate-800 font-extrabold shadow-3xs'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800 hover:text-slate-800 border-r border-slate-100 dark:border-slate-800'
              }`}
            >
              Admin Details
              {companySubTab === 'admin' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />
              )}
            </button>
          </div>

          {/* Sub-tab Body */}
          <div className="p-6 space-y-6">
            
            {/* 1. Company Details Panel */}
            {companySubTab === 'details' && (
              <div className="flex flex-col lg:flex-row gap-8 items-start">
                {/* Logo Upload Box */}
                <div className="flex flex-col items-center gap-3 bg-slate-50/50 p-5 border border-slate-150 rounded-2xl w-full lg:w-48 text-center shrink-0">
                  <div className="w-24 h-24 rounded-2xl border border-[#E8ECF4] bg-white flex items-center justify-center p-2 shadow-sm overflow-hidden select-none">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                    ) : (
                      <Icons.Building2 className="w-12 h-12 text-slate-350" />
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Logo Thumbnail</span>
                  <label className="px-3 py-1.5 rounded-xl border border-[#E8ECF4] bg-white hover:bg-slate-50 transition-colors text-xs font-bold text-slate-650 cursor-pointer shadow-sm">
                    {uploading ? 'Uploading...' : 'Choose file'}
                    <input type="file" onChange={handleLogoUpload} className="hidden" disabled={uploading} />
                  </label>
                </div>

                {/* Form Fields Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 flex-grow w-full">
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Company Code *</label>
                    <input type="text" value={companyCode} onChange={e => setCompanyCode(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="e.g. COMP01" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Company Name *</label>
                    <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="e.g. New Frontline Bazaar" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Company Registration Id *</label>
                    <input type="text" value={registrationId} onChange={e => setRegistrationId(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="e.g. 78658764873" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Company Start Date *</label>
                    <input type="text" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="2/20/2018 12:00:00 AM" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Company End Date *</label>
                    <input type="text" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="3/23/2018 12:00:00 AM" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Upload Company Doc</label>
                    <input type="file" onChange={async (e) => {
                      if (!e.target.files || e.target.files.length === 0) return;
                      const file = e.target.files[0];
                      const formData = new FormData();
                      formData.append('file', file);
                      try {
                        const res = await api.post('/documents/upload', formData, {
                          headers: { 'Content-Type': 'multipart/form-data' }
                        });
                        setCompanyDocUrl(`${FILE_BASE_URL}${res.data.filePath}`);
                        showToast('Company document uploaded successfully.', 'success');
                      } catch {
                        showToast('Failed to upload document.', 'error');
                      }
                    }} className="w-full text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer border border-[#E8ECF4] px-3 py-1 bg-white rounded-xl" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Phone Number *</label>
                    <input type="text" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="65327642" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Mobile *</label>
                    <input type="text" value={mobile} onChange={e => setMobile(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="56326563649" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Email *</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="info@frontlinebazaar.com" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Upload Logo</label>
                    <input type="file" onChange={handleLogoUpload} className="w-full text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer border border-[#E8ECF4] px-3 py-1 bg-white rounded-xl" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Fax</label>
                    <input type="text" value={fax} onChange={e => setFax(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="657676" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Website</label>
                    <input type="text" value={website} onChange={e => setWebsite(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="https://frontlinebazaar.com/" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Default Currency</label>
                    <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer">
                      <option value="INR">₹ INR (Indian Rupee)</option>
                      <option value="USD">$ USD (US Dollar)</option>
                      <option value="EUR">€ EUR (Euro)</option>
                      <option value="GBP">£ GBP (British Pound)</option>
                      <option value="AED">د.إ AED (UAE Dirham)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Address Panel */}
            {companySubTab === 'address' && (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Address</label>
                  <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="Gangavati Karnataka" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">City</label>
                    <input type="text" value={city} onChange={e => setCity(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="Ganagavati" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">State</label>
                    <input type="text" value={companyState} onChange={e => setCompanyState(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="Karnataka" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Country</label>
                    <select value={country} onChange={e => setCountry(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer">
                      <option value="">Select Country</option>
                      <option value="India">India</option>
                      <option value="United States">United States</option>
                      <option value="United Kingdom">United Kingdom</option>
                      <option value="Canada">Canada</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Postal Code</label>
                    <input type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="583231" />
                  </div>
                </div>
              </div>
            )}

            {/* 3. Admin Details Panel */}
            {companySubTab === 'admin' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">First Name</label>
                    <input type="text" value={adminFirstName} onChange={e => setAdminFirstName(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="First Name" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Last Name</label>
                    <input type="text" value={adminLastName} onChange={e => setAdminLastName(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="Last Name" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">User Name</label>
                    <input type="text" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="User Name" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Password</label>
                    <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="******" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Confirm Password</label>
                    <input type="password" value={adminConfirmPassword} onChange={e => setAdminConfirmPassword(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500" placeholder="Confirm Password" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Financial Year</label>
                    <select value={financialYear} onChange={e => setFinancialYear(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer">
                      <option value="">Select Financial Year</option>
                      <option value="2025-2026">2025-2026</option>
                      <option value="2026-2027">2026-2027</option>
                      <option value="2027-2028">2027-2028</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Role Type *</label>
                    <select value={roleType} onChange={e => setRoleType(e.target.value)} className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer">
                      <option value="">Select Role Type</option>
                      <option value="Super Admin">Super Admin</option>
                      <option value="Admin">Admin</option>
                      <option value="User">User</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Cancel & Update Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => loadSettingsData()}
                className="btn-secondary-premium h-10 px-5 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBranding}
                disabled={saving}
                className="btn-primary-premium flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update'
                )}
              </button>
            </div>

          </div>
        </div>

        {/* Roles Management */}
        <div className={`lg:col-span-12 space-y-6 ${currentTab === 'role' ? 'block' : 'hidden'}`}>
          {/* Form Card (Add/Edit) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-pink-500" />
            <h2 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight mb-4">
              {editingRoleId ? 'Edit Role' : 'Create New Role'}
            </h2>
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="flex flex-col md:flex-row gap-4 flex-grow max-w-2xl">
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Role Type Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Sales Manager, Telecaller"
                    value={roleFormName}
                    onChange={(e) => setRoleFormName(e.target.value)}
                    className="w-full h-10 px-3.5 text-xs font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-purple-500 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="w-full md:w-36">
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Status</label>
                  <select
                    value={roleFormActive ? 'active' : 'inactive'}
                    onChange={(e) => setRoleFormActive(e.target.value === 'active')}
                    className="w-full h-10 px-3.5 text-xs font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-purple-500 text-slate-900 dark:text-white cursor-pointer"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2.5">
                {editingRoleId && (
                  <button
                    type="button"
                    onClick={handleCancelRoleEdit}
                    className="h-10 px-4 bg-white hover:bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveRole}
                  className="h-10 px-5 bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-purple-500/20 transition-all cursor-pointer"
                >
                  {editingRoleId ? 'Update Role' : 'Save Role'}
                </button>
              </div>
            </div>
          </div>

          {/* Table Card (List) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-pink-500" />
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">Active System Roles</h3>
              <span className="px-2.5 py-0.5 text-[10px] font-black uppercase bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 rounded-full border border-purple-200/80 dark:border-purple-800 font-mono">
                {roles.length} Total Roles
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-100 h-12">
                    <th className="py-2.5 px-4">Role Type</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-center w-36">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(() => {
                    const itemsPerPage = 5;
                    const totalPages = Math.ceil(roles.length / itemsPerPage) || 1;
                    const activePage = Math.min(rolePage, totalPages);
                    const startIndex = (activePage - 1) * itemsPerPage;
                    const paginatedRoles = roles.slice(startIndex, startIndex + itemsPerPage);

                    if (paginatedRoles.length === 0) {
                      return (
                        <tr>
                          <td colSpan={3} className="py-8 text-center text-slate-400 font-medium">
                            No roles defined.
                          </td>
                        </tr>
                      );
                    }

                    return paginatedRoles.map((role) => (
                      <tr key={role._id} className="hover:bg-slate-50/30 transition-colors h-14">
                        <td className="px-4 py-2 font-semibold text-slate-700">{role.name}</td>
                        <td className="px-4 py-2">
                          <span className={role.isActive !== false ? 'status-active-premium' : 'status-inactive-premium'}>
                            <span className={`w-1.5 h-1.5 rounded-full ${role.isActive !== false ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                            {role.isActive !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center flex justify-center gap-3">
                          <button
                            onClick={() => {
                              setEditingRoleId(role._id);
                              setRoleFormName(role.name);
                              setRoleFormActive(role.isActive !== false);
                            }}
                            className="btn-edit-premium"
                            title="Edit Role"
                          >
                            <Icons.SquarePen className="w-4 h-4" />
                          </button>
                          {!role.isSystem && (
                            <button
                              onClick={() => handleDeleteRole(role._id)}
                              className="btn-delete-premium"
                              title="Delete Role"
                            >
                              <Icons.Trash className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {roles.length > 5 && (
              <div className="py-4 border-t border-slate-100 flex justify-center">
                <div className="flex gap-1">
                  {Array.from({ length: Math.ceil(roles.length / 5) }).map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setRolePage(idx + 1)}
                      className={`px-3 py-1.5 border rounded-lg text-xs font-semibold transition-all ${
                        rolePage === idx + 1
                          ? 'bg-[#0275d8] border-[#0275d8] text-white shadow-sm shadow-[#0275d8]/20'
                          : 'bg-white border-[#E8ECF4] text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>



        {/* Status Settings tab */}
        <div className={`lg:col-span-12 grid grid-cols-1 md:grid-cols-12 gap-5 ${currentTab === 'status' ? 'block' : 'hidden'}`}>
          {/* Form Card */}
          <div className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-pink-500" />
            <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight mb-4">
              {statusEditing ? 'Edit Pipeline Status' : 'Add Pipeline Status'}
            </h3>
            <form onSubmit={handleSaveStatus} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Status Name</label>
                <input required type="text" value={statusForm.name} onChange={e => setStatusForm({ ...statusForm, name: e.target.value })} className="w-full h-10 px-3.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-rose-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Color</label>
                  <input type="color" value={statusForm.color} onChange={e => setStatusForm({ ...statusForm, color: e.target.value })} className="w-full h-10 p-1 border border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Icon</label>
                  <select value={statusForm.icon} onChange={e => setStatusForm({ ...statusForm, icon: e.target.value })} className="w-full h-10 px-3 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-rose-500 cursor-pointer">
                    {['Circle', 'Flame', 'Sun', 'Tag', 'CheckCircle', 'Clock', 'XOctagon', 'PhoneCall', 'ArrowDownCircle', 'Hourglass', 'FileWarning', 'FileText', 'Banknote'].map(ic => (
                      <option key={ic} value={ic}>{ic}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Pipeline Pos</label>
                  <input type="number" value={statusForm.pipelinePosition} onChange={e => setStatusForm({ ...statusForm, pipelinePosition: Number(e.target.value) })} className="w-full h-10 px-3.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-rose-500" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Serial Number</label>
                  <input type="number" value={statusForm.order} onChange={e => setStatusForm({ ...statusForm, order: Number(e.target.value) })} className="w-full h-10 px-3.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-rose-500" />
                </div>
              </div>
              <div className="space-y-2 py-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={statusForm.dashboardVisibility} onChange={e => setStatusForm({ ...statusForm, dashboardVisibility: e.target.checked })} className="rounded border-slate-300 text-rose-600 focus:ring-0 w-4 h-4 cursor-pointer" />
                  Show on Dashboard Cards
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={statusForm.isFinal} onChange={e => setStatusForm({ ...statusForm, isFinal: e.target.checked })} className="rounded border-slate-300 text-rose-600 focus:ring-0 w-4 h-4 cursor-pointer" />
                  Is Closed / Final Stage
                </label>
                {statusForm.isFinal && (
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={statusForm.isSuccess} onChange={e => setStatusForm({ ...statusForm, isSuccess: e.target.checked })} className="rounded border-slate-300 text-rose-600 focus:ring-0 w-4 h-4 cursor-pointer" />
                    Is Success (Won / Approved)
                  </label>
                )}
              </div>
              <div className="flex gap-2.5">
                <button type="submit" className="flex-1 h-10 bg-gradient-to-r from-rose-600 via-pink-600 to-red-600 hover:from-rose-700 hover:to-pink-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-rose-500/20 transition-all cursor-pointer">
                  {statusEditing ? 'Update Status' : 'Save Status'}
                </button>
                {statusEditing && (
                  <button type="button" onClick={() => {
                    setStatusEditing(false);
                    setStatusForm({ id: '', name: '', color: '#4F46E5', icon: 'Circle', pipelinePosition: 0, dashboardVisibility: true, isFinal: false, isSuccess: false, order: 0 });
                  }} className="h-10 px-4 bg-white hover:bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all cursor-pointer">Cancel</button>
                )}
              </div>
            </form>
          </div>

          {/* Table Card */}
          <div className="md:col-span-8 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-pink-500" />
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">Configured Pipeline Statuses</h3>
              <span className="px-2.5 py-0.5 text-[10px] font-black uppercase bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 rounded-full border border-rose-200/80 dark:border-rose-800 font-mono">
                {statuses.length} Statuses
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="table-header-premium">
                    <th className="py-2.5 px-4 text-center w-24">Serial No.</th>
                    <th className="py-2.5 px-4">Name</th>
                    <th className="py-2.5 px-4">Pipeline Pos</th>
                    <th className="py-2.5 px-4">Dashboard</th>
                    <th className="py-2.5 px-4">Closed Status</th>
                    <th className="py-2.5 px-4 text-center w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150">
                  {statuses
                    .slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map(st => {
                      const Icon = (Icons as any)[st.icon] || Icons.Circle;
                      return (
                        <tr key={st._id} className="hover:bg-slate-50/50 transition-colors h-11">
                          <td className="px-4 py-2 text-center font-bold text-indigo-650">{st.order ?? 0}</td>
                          <td className="px-4 py-2 font-semibold text-slate-700 flex items-center gap-2">
                            <span style={{ backgroundColor: st.color }} className="w-3 h-3 rounded-full inline-block border border-black/10"></span>
                            <Icon className="w-4 h-4 text-slate-500" />
                            {st.name}
                          </td>
                          <td className="px-4 py-2 text-slate-700 font-semibold">{st.pipelinePosition || 'None'}</td>
                          <td className="px-4 py-2 text-slate-700 font-semibold">{st.dashboardVisibility ? 'Visible' : 'Hidden'}</td>
                          <td className="px-4 py-2 text-slate-700 font-semibold">{st.isFinal ? (st.isSuccess ? 'Won' : 'Lost') : 'Open'}</td>
                        <td className="px-4 py-2 text-center flex justify-center gap-3">
                          <button onClick={() => handleEditStatus(st)} className="btn-edit-premium" title="Edit Status"><Icons.SquarePen className="w-4 h-4" /></button>
                          <button onClick={() => handleDeleteStatus(st._id)} className="btn-delete-premium" title="Delete Status"><Icons.Trash className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>


        {/* Generic Dynamic Custom Module tab (Department, Product, Bank Master, etc.) */}
        {tabToApiPath[currentTab] && activeModuleDef && currentTab !== 'bankingpartner' && (
          <div className="lg:col-span-12 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${activeTabMeta.accentGradient}`} />
            {(() => {
              const filteredModuleRecords = moduleRecords.filter(rec => {
                if (!moduleSearchQuery.trim()) return true;
                const q = moduleSearchQuery.toLowerCase().trim();
                return activeModuleDef.fields.some(f => {
                  const val = String(rec.data?.[f.name] ?? '').toLowerCase();
                  return val.includes(q);
                });
              });

              return (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                      <h2 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                        {activeModuleDef.pluralLabel} Settings
                      </h2>
                      <span className={`px-2.5 py-0.5 text-[10px] font-black uppercase rounded-full border font-mono ${activeTabMeta.activeBadge}`}>
                        {filteredModuleRecords.length} {filteredModuleRecords.length === 1 ? 'Record' : 'Records'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      {/* Search Bar */}
                      <div className="relative flex-1 sm:w-72">
                        <Icons.Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          value={moduleSearchQuery}
                          onChange={(e) => setModuleSearchQuery(e.target.value)}
                          placeholder={`Search ${activeModuleDef.pluralLabel.toLowerCase()}...`}
                          className="w-full h-9 pl-9 pr-8 text-xs bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-900 dark:text-white font-semibold placeholder:text-slate-400 transition-all"
                        />
                        {moduleSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setModuleSearchQuery('')}
                            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            <Icons.X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <button onClick={() => {
                        setModuleForm({});
                        setModuleEditingId('');
                        setModuleModalOpen(true);
                      }} className={`h-9 px-4 bg-gradient-to-r ${activeTabMeta.accentGradient} text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/20 hover:opacity-95 active:scale-[0.98] transition-all flex items-center gap-2 flex-shrink-0 cursor-pointer`}>
                        <Icons.Plus className="w-4 h-4" /> Add Record
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="table-header-premium">
                          {activeModuleDef.fields.map(f => (
                            <th key={f.name} className="py-2.5 px-4">{f.label}</th>
                          ))}
                          <th className="py-2.5 px-4 text-center w-36">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150">
                        {filteredModuleRecords.length === 0 ? (
                          <tr>
                            <td colSpan={activeModuleDef.fields.length + 1} className="py-12 text-center text-slate-400 font-medium text-xs">
                              {moduleSearchQuery 
                                ? `No ${activeModuleDef.pluralLabel.toLowerCase()} matching "${moduleSearchQuery}"` 
                                : `No ${activeModuleDef.pluralLabel.toLowerCase()} records found.`}
                            </td>
                          </tr>
                        ) : (
                          filteredModuleRecords.map(rec => (
                            <tr key={rec._id} className="hover:bg-slate-50/50 transition-colors h-11">
                              {activeModuleDef.fields.map(f => (
                                <td key={f.name} className="px-4 py-2 text-slate-900 font-semibold">
                                  {f.type === 'currency' ? '$' : ''}
                                  {String(rec.data?.[f.name] ?? '')}
                                </td>
                              ))}
                              <td className="px-4 py-2 text-center flex justify-center gap-3">
                                <button onClick={() => handleEditModuleRecord(rec)} className="btn-edit-premium" title="Edit Record"><Icons.SquarePen className="w-4 h-4" /></button>
                                <button onClick={() => handleDeleteModuleRecord(rec._id)} className="btn-delete-premium" title="Delete Record"><Icons.Trash className="w-4 h-4" /></button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}

            {/* Dynamic Module Add/Edit Modal */}
            {moduleModalOpen && (
              <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
                <div className="bg-white rounded-2xl p-6 w-full max-w-md border border-slate-200 shadow-xl space-y-4">
                  <h3 className="text-lg font-bold text-slate-800">
                    {moduleEditingId ? 'Edit Record' : `Add New ${activeModuleDef.singularLabel}`}
                  </h3>
                  <form onSubmit={handleSaveModuleRecord} className="space-y-4">
                    {activeModuleDef.fields.map(f => (
                      <div key={f.name}>
                        <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">{f.label}</label>
                        {f.type === 'dropdown' ? (
                          <select required={f.required} value={moduleForm[f.name] || ''} onChange={e => setModuleForm({ ...moduleForm, [f.name]: e.target.value })} className="w-full h-11 px-4 text-sm font-semibold bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500">
                            <option value="">Select Option...</option>
                            {f.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : f.type === 'number' || f.type === 'currency' ? (
                          <input required={f.required} type="number" step="any" value={moduleForm[f.name] || ''} onChange={e => setModuleForm({ ...moduleForm, [f.name]: Number(e.target.value) })} className="w-full h-11 px-4 text-sm font-semibold bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500" />
                        ) : f.type === 'date' ? (
                          <input required={f.required} type="date" value={moduleForm[f.name] || ''} onChange={e => setModuleForm({ ...moduleForm, [f.name]: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                        ) : (
                          <input required={f.required} type="text" value={moduleForm[f.name] || ''} onChange={e => setModuleForm({ ...moduleForm, [f.name]: e.target.value })} className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                        )}
                      </div>
                    ))}
                    <div className="flex justify-end gap-3 pt-2">
                      <button type="button" onClick={() => setModuleModalOpen(false)} className="btn-secondary-premium">Cancel</button>
                      <button type="submit" className="btn-primary-premium">Save</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Custom Banking Partner Tab View */}
        {currentTab === 'bankingpartner' && (
          <div className="lg:col-span-12 space-y-6">
            
            {/* Top Form Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-indigo-500" />
              <form onSubmit={handleSaveBankingPartner} className="space-y-6">
                
                {/* 1. Loan Type & PSM (Top) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
                      Loan Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={bpForm.loanType}
                      onChange={(e) => handleBpLoanTypeChange(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-sky-500 transition-all cursor-pointer"
                    >
                      <option value="">-Select One-</option>
                      {bpProductsList.map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="relative">
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">
                      PSM <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setBpPsmDropdownOpen(!bpPsmDropdownOpen)}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-850 font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-650 transition-all shadow-sm flex items-center justify-between text-left"
                    >
                      <span className={bpForm.psm ? "text-slate-850 font-bold" : "text-slate-400 font-medium"}>
                        {bpForm.psm || '-Select PSM-'}
                      </span>
                      <Icons.ChevronDown className="w-4 h-4 text-slate-500" />
                    </button>

                    {bpPsmDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setBpPsmDropdownOpen(false)} />
                        <div className="absolute top-full left-0 w-full mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 z-50 space-y-2 max-h-60 overflow-y-auto">
                          <input
                            type="text"
                            value={bpPsmSearchQuery}
                            onChange={(e) => setBpPsmSearchQuery(e.target.value)}
                            placeholder="Search PSM..."
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            autoFocus
                          />
                          <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1">
                            {users.length === 0 ? (
                              <p className="text-xs text-slate-400 p-2 text-center">No users found</p>
                            ) : (() => {
                              const filtered = users.filter((u) => {
                                const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
                                return fullName.includes(bpPsmSearchQuery.toLowerCase());
                              });
                              if (filtered.length === 0) {
                                return <p className="text-xs text-slate-400 p-2 text-center">No matches found</p>;
                              }
                              return filtered.map((u) => {
                                const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
                                const isSelected = bpForm.psm === fullName;
                                return (
                                  <button
                                    key={u._id}
                                    type="button"
                                    onClick={() => {
                                      setBpForm({ ...bpForm, psm: fullName });
                                      setBpPsmDropdownOpen(false);
                                      setBpPsmSearchQuery('');
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                                      isSelected
                                        ? 'bg-indigo-500/10 text-indigo-700'
                                        : 'hover:bg-slate-50 text-slate-700'
                                    }`}
                                  >
                                    {fullName} {u.roleId?.name ? `(${u.roleId.name})` : ''}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* 2. Searchable Multi-Select Banks Dropdown */}
                <div className="space-y-2 relative">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Banks <span className="text-red-500">*</span> (Select one or more)
                    </label>
                    <span className="text-[11px] font-bold text-indigo-600">
                      {selectedBanks.length} Selected
                    </span>
                  </div>

                  {/* Trigger Button showing Selected Tags & Search Prompt */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setBpBanksDropdownOpen(!bpBanksDropdownOpen)}
                      className="w-full min-h-[46px] px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-600/5 focus:border-indigo-650 transition-all shadow-sm flex items-center justify-between text-left gap-2 flex-wrap cursor-pointer"
                    >
                      {selectedBanks.length === 0 ? (
                        <span className="text-slate-400 font-medium text-xs">
                          Search & Select Banks (Out of {bankMastersList.length} Banks)...
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap max-h-24 overflow-y-auto">
                          {selectedBanks.map((bank) => (
                            <span
                              key={bank}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleBankCheckboxChange(bank, false);
                              }}
                            >
                              {bank}
                              <Icons.X className="w-3 h-3 hover:text-indigo-900 cursor-pointer" />
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                        <Icons.Search className="w-4 h-4 text-slate-400" />
                        <Icons.ChevronDown className="w-4 h-4 text-slate-500" />
                      </div>
                    </button>

                    {/* Dropdown Popover with Live Search Bar */}
                    {bpBanksDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setBpBanksDropdownOpen(false)} />
                        <div className="absolute top-full left-0 w-full mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 z-50 space-y-2.5 max-h-80 flex flex-col">
                          
                          {/* Search Input Bar */}
                          <div className="relative">
                            <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={bpBankSearchQuery}
                              onChange={(e) => setBpBankSearchQuery(e.target.value)}
                              placeholder={`Search out of ${bankMastersList.length} banks...`}
                              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              autoFocus
                            />
                            {bpBankSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setBpBankSearchQuery('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                              >
                                <Icons.X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {/* Quick Action Bar (Select All / Clear All) */}
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2 px-1 text-[11px] font-bold">
                            <span className="text-slate-400">
                              {bankMastersList.filter(b => b.toLowerCase().includes(bpBankSearchQuery.toLowerCase())).length} Banks Found
                            </span>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  const filtered = bankMastersList.filter(b => b.toLowerCase().includes(bpBankSearchQuery.toLowerCase()));
                                  const combined = Array.from(new Set([...selectedBanks, ...filtered]));
                                  setSelectedBanks(combined);
                                }}
                                className="text-indigo-600 hover:text-indigo-800"
                              >
                                Select All Filtered
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedBanks([])}
                                className="text-rose-500 hover:text-rose-700"
                              >
                                Clear All
                              </button>
                            </div>
                          </div>

                          {/* Scrollable Bank List */}
                          <div className="space-y-1 overflow-y-auto pr-1 flex-1 max-h-52">
                            {(() => {
                              const filteredBanks = bankMastersList.filter(b => 
                                b.toLowerCase().includes(bpBankSearchQuery.toLowerCase())
                              );

                              if (filteredBanks.length === 0) {
                                return (
                                  <div className="py-6 text-center text-slate-400 text-xs font-medium">
                                    No banks matching "{bpBankSearchQuery}"
                                  </div>
                                );
                              }

                              return filteredBanks.map((bankName) => {
                                const isChecked = selectedBanks.includes(bankName);
                                return (
                                  <button
                                    key={bankName}
                                    type="button"
                                    onClick={() => handleBankCheckboxChange(bankName, !isChecked)}
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-left transition-all ${
                                      isChecked
                                        ? 'bg-indigo-50 text-indigo-800 font-bold border border-indigo-200'
                                        : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                                        isChecked
                                          ? 'bg-indigo-600 border-indigo-600 text-white'
                                          : 'border-slate-300 bg-white'
                                      }`}>
                                        {isChecked && <Icons.Check className="w-3 h-3 stroke-[3]" />}
                                      </div>
                                      <span>{bankName}</span>
                                    </div>
                                    {isChecked && (
                                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">
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
                </div>

                {/* 3. Action Button (Bottom) */}
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    className="btn-primary-premium px-8 py-3 rounded-xl shadow-lg shadow-indigo-600/10 active:scale-95 transition-all text-xs uppercase tracking-wider font-bold"
                  >
                    Save Partner
                  </button>
                </div>

              </form>
            </div>

            {/* Banking Partner Edit Modal */}
            {bpEditModalOpen && (
              <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
                <div className="bg-white rounded-2xl p-6 w-full max-w-2xl border border-slate-200 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
                  <h3 className="text-lg font-bold text-slate-800">
                    Edit Banking Partner
                  </h3>
                  <form onSubmit={handleSaveEditedBankingPartner} className="space-y-6">
                    {/* 1. Loan Type & PSM (Top) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">
                          Loan Type <span className="text-red-500">*</span>
                        </label>
                        <select
                          required
                          value={bpEditForm.loanType}
                          onChange={(e) => handleBpEditLoanTypeChange(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-850 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-600"
                        >
                          <option value="">-Select One-</option>
                          {bpProductsList.map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="relative">
                          <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">
                            PSM <span className="text-red-500">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setBpEditPsmDropdownOpen(!bpEditPsmDropdownOpen)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-850 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-600 flex items-center justify-between text-left"
                          >
                            <span className={bpEditForm.psm ? "text-slate-850 font-bold" : "text-slate-400 font-medium"}>
                              {bpEditForm.psm || '-Select PSM-'}
                            </span>
                            <Icons.ChevronDown className="w-4 h-4 text-slate-500" />
                          </button>

                          {bpEditPsmDropdownOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setBpEditPsmDropdownOpen(false)} />
                              <div className="absolute top-full left-0 w-full mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 z-50 space-y-2 max-h-60 overflow-y-auto">
                                <input
                                  type="text"
                                  value={bpEditPsmSearchQuery}
                                  onChange={(e) => setBpEditPsmSearchQuery(e.target.value)}
                                  placeholder="Search PSM..."
                                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  autoFocus
                                />
                                <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1">
                                  {users.length === 0 ? (
                                    <p className="text-xs text-slate-400 p-2 text-center">No users found</p>
                                  ) : (() => {
                                    const filtered = users.filter((u) => {
                                      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
                                      return fullName.includes(bpEditPsmSearchQuery.toLowerCase());
                                    });
                                    if (filtered.length === 0) {
                                      return <p className="text-xs text-slate-400 p-2 text-center">No matches found</p>;
                                    }
                                    return filtered.map((u) => {
                                      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
                                      const isSelected = bpEditForm.psm === fullName;
                                      return (
                                        <button
                                          key={u._id}
                                          type="button"
                                          onClick={() => {
                                            setBpEditForm({ ...bpEditForm, psm: fullName });
                                            setBpEditPsmDropdownOpen(false);
                                            setBpEditPsmSearchQuery('');
                                          }}
                                          className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                                            isSelected
                                              ? 'bg-indigo-500/10 text-indigo-700'
                                              : 'hover:bg-slate-50 text-slate-700'
                                          }`}
                                        >
                                          {fullName} {u.roleId?.name ? `(${u.roleId.name})` : ''}
                                        </button>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 2. Searchable Multi-Select Banks Dropdown for Edit Modal */}
                    <div className="space-y-2 relative">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">
                          Banks <span className="text-red-500">*</span> (Select one or more)
                        </label>
                        <span className="text-[11px] font-bold text-indigo-600">
                          {selectedEditBanks.length} Selected
                        </span>
                      </div>

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setBpEditBanksDropdownOpen(!bpEditBanksDropdownOpen)}
                          className="w-full min-h-[44px] px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all flex items-center justify-between text-left gap-2 flex-wrap cursor-pointer"
                        >
                          {selectedEditBanks.length === 0 ? (
                            <span className="text-slate-400 font-medium text-xs">
                              Search & Select Banks (Out of {bankMastersList.length} Banks)...
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap max-h-20 overflow-y-auto">
                              {selectedEditBanks.map((bank) => (
                                <span
                                  key={bank}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditBankCheckboxChange(bank, false);
                                  }}
                                >
                                  {bank}
                                  <Icons.X className="w-3 h-3 hover:text-indigo-900 cursor-pointer" />
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                            <Icons.Search className="w-4 h-4 text-slate-400" />
                            <Icons.ChevronDown className="w-4 h-4 text-slate-500" />
                          </div>
                        </button>

                        {bpEditBanksDropdownOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setBpEditBanksDropdownOpen(false)} />
                            <div className="absolute top-full left-0 w-full mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 z-50 space-y-2.5 max-h-72 flex flex-col">
                              
                              {/* Search Bar */}
                              <div className="relative">
                                <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                  type="text"
                                  value={bpEditBankSearchQuery}
                                  onChange={(e) => setBpEditBankSearchQuery(e.target.value)}
                                  placeholder={`Search out of ${bankMastersList.length} banks...`}
                                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  autoFocus
                                />
                                {bpEditBankSearchQuery && (
                                  <button
                                    type="button"
                                    onClick={() => setBpEditBankSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                  >
                                    <Icons.X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>

                              {/* Quick Actions */}
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2 px-1 text-[11px] font-bold">
                                <span className="text-slate-400">
                                  {bankMastersList.filter(b => b.toLowerCase().includes(bpEditBankSearchQuery.toLowerCase())).length} Banks Found
                                </span>
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const filtered = bankMastersList.filter(b => b.toLowerCase().includes(bpEditBankSearchQuery.toLowerCase()));
                                      const combined = Array.from(new Set([...selectedEditBanks, ...filtered]));
                                      setSelectedEditBanks(combined);
                                    }}
                                    className="text-indigo-600 hover:text-indigo-800"
                                  >
                                    Select All Filtered
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedEditBanks([])}
                                    className="text-rose-500 hover:text-rose-700"
                                  >
                                    Clear All
                                  </button>
                                </div>
                              </div>

                              {/* Scrollable Bank List */}
                              <div className="space-y-1 overflow-y-auto pr-1 flex-1 max-h-48">
                                {(() => {
                                  const filteredBanks = bankMastersList.filter(b => 
                                    b.toLowerCase().includes(bpEditBankSearchQuery.toLowerCase())
                                  );

                                  if (filteredBanks.length === 0) {
                                    return (
                                      <div className="py-6 text-center text-slate-400 text-xs font-medium">
                                        No banks matching "{bpEditBankSearchQuery}"
                                      </div>
                                    );
                                  }

                                  return filteredBanks.map((bankName) => {
                                    const isChecked = selectedEditBanks.includes(bankName);
                                    return (
                                      <button
                                        key={bankName}
                                        type="button"
                                        onClick={() => handleEditBankCheckboxChange(bankName, !isChecked)}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-left transition-all ${
                                          isChecked
                                            ? 'bg-indigo-50 text-indigo-800 font-bold border border-indigo-200'
                                            : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2.5">
                                          <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                                            isChecked
                                              ? 'bg-indigo-600 border-indigo-600 text-white'
                                              : 'border-slate-300 bg-white'
                                          }`}>
                                            {isChecked && <Icons.Check className="w-3 h-3 stroke-[3]" />}
                                          </div>
                                          <span>{bankName}</span>
                                        </div>
                                        {isChecked && (
                                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">
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
                    </div>

                    {/* 3. Action Buttons (Bottom) */}
                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={handleCancelEditBankingPartner}
                        className="btn-secondary-premium"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-primary-premium"
                      >
                        Save Changes
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Middle Search & Filter Card */}
            <div className="card-premium">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                  <Icons.Search className="w-4 h-4 text-indigo-500" />
                  Filter Banking Partners
                </h3>
                {(bpFilterBank || bpFilterPsm || bpFilterLoanType) && (
                  <button
                    type="button"
                    onClick={() => {
                      setBpFilterBank('');
                      setBpFilterPsm('');
                      setBpFilterLoanType('');
                      setShowAllBp(false);
                    }}
                    className="text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors flex items-center gap-1.5 active:scale-95 transition-all"
                  >
                    <Icons.RotateCcw className="w-3.5 h-3.5" />
                    Reset Filters
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* 1. Filter by Bank */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Filter by Bank</label>
                  <select
                    value={bpFilterBank}
                    onChange={(e) => {
                      setBpFilterBank(e.target.value);
                      setShowAllBp(false);
                    }}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-850 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                  >
                    <option value="">-Select-</option>
                    {bankMastersList.map((bankName) => (
                      <option key={bankName} value={bankName}>
                        {bankName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Filter by PSM */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Filter by PSM</label>
                  <select
                    value={bpFilterPsm}
                    onChange={(e) => {
                      setBpFilterPsm(e.target.value);
                      setShowAllBp(false);
                    }}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-850 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                  >
                    <option value="">-Select-</option>
                    {users.map((u) => {
                      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
                      return (
                        <option key={u._id} value={fullName}>
                          {fullName}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* 3. Filter by Loan Type */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Filter by Loan Type</label>
                  <select
                    value={bpFilterLoanType}
                    onChange={(e) => {
                      setBpFilterLoanType(e.target.value);
                      setShowAllBp(false);
                    }}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-850 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer"
                  >
                    <option value="">-Select-</option>
                    {bpProductsList.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end pt-4 border-t border-slate-100 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    // Reset dropdown inputs
                    setBpFilterBank('');
                    setBpFilterPsm('');
                    setBpFilterLoanType('');
                    
                    // Toggle showAllBp
                    setShowAllBp(!showAllBp);
                  }}
                  className={`px-6 py-2.5 font-bold text-xs rounded-xl transition-all uppercase tracking-wider ${
                    showAllBp
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-md shadow-indigo-600/15'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 active:scale-95'
                  }`}
                >
                  {showAllBp ? 'Hide All' : 'Show All'}
                </button>
              </div>
            </div>

            {/* Bottom Table Card */}
            <div className="bg-white border-t-[3px] border-t-indigo-600 border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="table-header-premium">
                      <th className="py-2.5 px-4">Bank Name</th>
                      <th className="py-2.5 px-4">Loan Type</th>
                      <th className="py-2.5 px-4">PSM</th>
                      <th className="py-2.5 px-4 text-center w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150">
                    {(() => {
                      const hasActiveFilters = bpFilterBank || bpFilterPsm || bpFilterLoanType;

                      const filtered = moduleRecords.filter((rec) => {
                        if (!hasActiveFilters && !showAllBp) return false;

                        // 1. Bank filter
                        if (bpFilterBank) {
                          const recBanks = rec.data?.bank ? rec.data.bank.split(',').map((s: string) => s.trim().toLowerCase()) : [];
                          if (!recBanks.includes(bpFilterBank.toLowerCase())) {
                            return false;
                          }
                        }
                        // 2. PSM filter
                        if (bpFilterPsm) {
                          const recPsm = (rec.data?.psm || '').trim().toLowerCase();
                          if (recPsm !== bpFilterPsm.trim().toLowerCase()) {
                            return false;
                          }
                        }
                        // 3. Loan Type filter
                        if (bpFilterLoanType) {
                          const recLoanType = (rec.data?.loanType || '').trim().toLowerCase();
                          if (recLoanType !== bpFilterLoanType.trim().toLowerCase()) {
                            return false;
                          }
                        }
                        return true;
                      });

                      if (!hasActiveFilters && !showAllBp) {
                        return (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-400 font-semibold text-xs">
                              Please select filters to search, or click Show All to view all partners.
                            </td>
                          </tr>
                        );
                      }

                      if (filtered.length === 0) {
                        return (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-400 font-semibold text-xs">
                              No banking partners match the selected filter criteria.
                            </td>
                          </tr>
                        );
                      }

                      return filtered.map((rec) => (
                        <tr key={rec._id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2 font-semibold text-slate-850">
                            <div className="flex flex-col gap-1.5 py-1.5">
                              {(rec.data?.bank || '')
                                .split(',')
                                .map((b: string) => b.trim())
                                .filter(Boolean)
                                .filter((bankName: string) => {
                                  if (!bpFilterBank) return true;
                                  return bankName.toLowerCase() === bpFilterBank.toLowerCase();
                                })
                                .map((bankName: string) => (
                                  <div key={bankName} className="flex items-center gap-2 text-[11px] text-slate-850 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-1.5 w-max font-bold shadow-sm shadow-slate-100/50">
                                    <Icons.Landmark className="w-3.5 h-3.5 text-indigo-650" />
                                    {bankName}
                                  </div>
                                ))}
                            </div>
                          </td>
                          <td className="px-4 py-2 font-semibold text-slate-700">
                            {rec.data?.loanType}
                          </td>
                          <td className="px-4 py-2 text-slate-900 font-semibold">
                            {rec.data?.psm}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleEditBankingPartner({
                                  _id: rec._id,
                                  bank: rec.data?.bank,
                                  loanType: rec.data?.loanType,
                                  psm: rec.data?.psm
                                })}
                                className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 hover:text-indigo-600 transition-colors"
                                title="Edit Banking Partner"
                              >
                                <Icons.Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteBankingPartner(rec._id)}
                                className="btn-delete-premium"
                                title="Delete Banking Partner"
                              >
                                <Icons.Trash className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </div>

      {/* Premium Conflict Modal for Banking Partner Settings */}
      {bpConflictModal && bpConflictModal.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            onClick={() => setBpConflictModal(null)}
            className="absolute inset-0 bg-[#0f1115]/50 backdrop-blur-sm animate-fade-in"
          />
          <div className="relative w-full max-w-md bg-white border border-slate-200/80 rounded-3xl shadow-2xl p-6 text-center z-10 transform transition-all duration-300 scale-100 animate-scale-up">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4 text-amber-600">
              <Icons.AlertTriangle className="w-6 h-6 animate-pulse" />
            </div>
            <h3 className="text-base font-black text-slate-800 uppercase tracking-wider mb-2">
              PSM Already Assigned
            </h3>
            <p className="text-xs font-bold text-slate-500 leading-relaxed mb-6">
              This Bank (<span className="text-slate-800 font-extrabold">{bpConflictModal.bankName}</span>) and Loan Type (<span className="text-slate-800 font-extrabold">{bpConflictModal.loanType}</span>) are already assigned to PSM '<span className="text-indigo-600 font-extrabold">{bpConflictModal.psmName}</span>'. Please select another Bank if you want a different assignment.
            </p>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setBpConflictModal(null)}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition-all text-xs font-bold text-white shadow-md shadow-indigo-600/20"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Premium Success Modal for Banking Partner Settings */}
      {bpSuccessModal && bpSuccessModal.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            onClick={() => setBpSuccessModal(null)}
            className="absolute inset-0 bg-[#0f1115]/50 backdrop-blur-sm animate-fade-in"
          />
          <div className="relative w-full max-w-md bg-white border border-slate-200/80 rounded-3xl shadow-2xl p-6 text-center z-10 transform transition-all duration-300 scale-100 animate-scale-up">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4 text-emerald-600">
              <Icons.BadgeCheck className="w-6 h-6 animate-pulse" />
            </div>
            <h3 className="text-base font-black text-slate-800 uppercase tracking-wider mb-2">
              {bpSuccessModal.title}
            </h3>
            <p className="text-xs font-bold text-slate-500 leading-relaxed mb-6">
              {bpSuccessModal.message}
            </p>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setBpSuccessModal(null)}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition-all text-xs font-bold text-white shadow-md shadow-indigo-600/20"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
