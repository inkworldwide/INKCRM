import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useModuleStore } from '../store/moduleStore';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { useToastStore } from '../store/toastStore';
import loginLogo from '../assets/login-logo.png';
import iconLogo from '../assets/icon.png';
import * as Icons from 'lucide-react';
import {
  SidebarItem,
  SidebarAccordion,
  SidebarSubAccordion,
  SidebarGroup,
  SidebarProfile,
  cn
} from './layout/SidebarComponents';

// Dynamic Icon resolver (Required by Dashboard and ModuleView)
export const DynamicIcon = ({ name, className = 'w-5 h-5' }: { name: string; className?: string }) => {
  const IconComponent = (Icons as any)[name] || Icons.FileText;
  return <IconComponent className={className} />;
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 1024);
  const { modules, fetchModules } = useModuleStore();
  const { user, logout, canAccessMenu } = useAuthStore();
  const { branding, fetchBranding } = useThemeStore();
  const { toasts, showToast, hideToast, confirm, hideConfirm, alertModal, hideAlertModal } = useToastStore();

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark' || (localStorage.getItem('theme') === null && branding?.themeSettings?.mode === 'dark');
  });
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const handleGlobalSearch = async (val: string) => {
    setSearchQuery(val);
    if (!val.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await api.get('/search', { params: { q: val } });
      setSearchResults(res.data || []);
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setIsSearching(false);
    }
  };

  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!branding) {
      const cachedSub = localStorage.getItem('tenantSubdomain') || 'sales';
      fetchBranding(cachedSub);
    }
  }, [branding, fetchBranding]);

  const { data: leadsData } = useQuery({
    queryKey: ['sidebar-leads'],
    queryFn: async () => {
      const res = await api.get('/records/leads', { params: { limit: 100 } });
      return res.data;
    },
    refetchInterval: (query) => (query.state.error ? false : 5000)
  });

  const { data: dbStatuses } = useQuery({
    queryKey: ['statuses-list'],
    queryFn: async () => {
      const res = await api.get('/statuses');
      return res.data || [];
    },
    refetchInterval: (query) => (query.state.error ? false : 5000)
  });

  const { data: metricsData } = useQuery({
    queryKey: ['dashboard-metrics-sidebar'],
    queryFn: async () => {
      const res = await api.get('/dashboard/metrics');
      return res.data;
    },
    refetchInterval: (query) => (query.state.error ? false : 5000)
  });

  const queryClient = useQueryClient();

  const { data: notificationsData, refetch: refetchNotifications } = useQuery({
    queryKey: ['user-notifications'],
    queryFn: async () => {
      const res = await api.get('/notifications', { params: { limit: 20 } });
      return res.data;
    },
    refetchInterval: (query) => (query.state.error ? false : 5000),
    enabled: !!user
  });

  const { data: unreadData, refetch: refetchUnread } = useQuery({
    queryKey: ['unread-notifications-count'],
    queryFn: async () => {
      const res = await api.get('/notifications/unread-count');
      return res.data;
    },
    refetchInterval: (query) => (query.state.error ? false : 5000),
    enabled: !!user
  });

  const handleMarkAsRead = async (id: string, link?: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      await queryClient.invalidateQueries({ queryKey: ['user-notifications'] });
      await queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
      if (link) {
        setShowNotifications(false);
        navigate(link);
      }
    } catch (e) {
      console.error('Failed to mark notification read', e);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      await queryClient.invalidateQueries({ queryKey: ['user-notifications'] });
      await queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
    } catch (e) {
      console.error('Failed to mark all read', e);
    }
  };

  const handleClearAllNotifications = async () => {
    try {
      await api.delete('/notifications/clear-all');
      await queryClient.invalidateQueries({ queryKey: ['user-notifications'] });
      await queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
    } catch (e) {
      console.error('Failed to clear notifications', e);
    }
  };

  const handleSendTestNotification = async () => {
    try {
      await api.post('/notifications/test', {
        title: 'New Lead Assignment & Alert',
        message: 'Welcome to Ink CRM Notification Center! Real-time alerts and assignment reminders are active.',
        type: 'info',
        link: '/modules/leads'
      });
      await queryClient.invalidateQueries({ queryKey: ['user-notifications'] });
      await queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
      showToast('Test notification created successfully!', 'success');
    } catch (e) {
      console.error('Failed to send test notification', e);
      showToast('Failed to trigger test notification.', 'error');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  useEffect(() => {
    fetchModules();
    
    // Global keyboard shortcut for search
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F8F5F1] dark:bg-[#0B0F19] text-[#1F2937] dark:text-white selection:bg-navy-800/20 selection:text-navy-800 flex flex-col">
      
      {/* Clean Subtle Background Layer */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 bg-[#F8F5F1] dark:bg-[#0B0F19]" />

      <div className="relative z-10 flex h-full w-full p-0 sm:p-2 lg:p-4 gap-0 sm:gap-2 lg:gap-4 overflow-hidden">
        
        {/* Mobile Backdrop */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-[#0B0F19]/70 backdrop-blur-md z-40 lg:hidden"
            />
          )}
        </AnimatePresence>

        {/* Visible Outer Bordered Sidebar Container */}
        <aside 
          className={cn(
            "fixed inset-y-0 left-0 z-50 lg:relative lg:inset-auto",
            "flex-shrink-0 bg-[#FAFAF9] dark:bg-slate-900 border-r lg:border border-black/[0.12] dark:border-slate-800 shadow-2xl lg:shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex flex-col h-full transition-all duration-200 ease-in-out overflow-hidden rounded-none lg:rounded-xl",
            isCollapsed ? "w-[68px]" : "w-[280px] sm:w-[250px]",
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}
        >
          
          {/* Clean Enterprise Logo Area */}
          <div className="min-h-[68px] py-2 px-3.5 border-b border-black/[0.08] dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-xl flex items-center gap-3 min-w-0 select-none flex-shrink-0">
            <div className="w-10 h-10 min-w-[40px] max-w-[40px] min-h-[40px] max-h-[40px] rounded-xl bg-white dark:bg-slate-800 p-1 flex items-center justify-center shadow-xs flex-shrink-0 border border-black/[0.08] dark:border-slate-700 overflow-hidden">
              <img 
                src={branding?.logoUrl || loginLogo} 
                alt="Logo" 
                className="w-full h-full object-contain" 
              />
            </div>
            {!isCollapsed && (
              <span className="text-[14px] font-extrabold text-[#B45309] dark:text-amber-400 tracking-tight break-words line-clamp-2 leading-tight font-sans flex-1 min-w-0">
                {branding?.name || 'inkworldwide'}
              </span>
            )}
          </div>

          {/* Navigation Items Area */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
            
            {/* Group 1: Quick Actions */}
            <SidebarGroup title="QUICK ACTIONS" isCollapsed={isCollapsed}>
              {canAccessMenu('leads') && (
                <SidebarItem 
                  to="/modules/leads/new" 
                  label="CREATE LEAD" 
                  icon={Icons.UserPlus} 
                  colorClass="text-[#0D9488]"
                  isCollapsed={isCollapsed}
                />
              )}
              <SidebarItem 
                to="/my-campaign" 
                label="MY CAMPAIGN" 
                icon={Icons.Megaphone} 
                colorClass="text-[#EA580C]"
                isCollapsed={isCollapsed}
              />
            </SidebarGroup>

            {/* Group 2: Main Menu */}
            {(canAccessMenu('dashboard') ||
              canAccessMenu('leads') ||
              canAccessMenu('campaigns') ||
              canAccessMenu('campaignassignments') ||
              canAccessMenu('lead_reports') ||
              canAccessMenu('telecaller_reports') ||
              canAccessMenu('telecaller_monthly') ||
              canAccessMenu('funnel_daily') ||
              canAccessMenu('funnel_monthly') ||
              canAccessMenu('funnel_annual') ||
              modules.some(m => canAccessMenu(m.apiPath))) && (
              <SidebarGroup title="MAIN MENU" isCollapsed={isCollapsed}>
                {canAccessMenu('dashboard') && (
                  <SidebarItem 
                    to="/" 
                    label="DASHBOARD" 
                    icon={Icons.LayoutDashboard} 
                    colorClass="text-slate-600 dark:text-slate-400"
                    isCollapsed={isCollapsed}
                  />
                )}

                {/* Dynamic Modules */}
                {modules.filter(m => {
                  const hiddenSettingsModules = ['departments', 'products', 'bankmasters', 'bankingpartners', 'companies', 'deals'];
                  if (hiddenSettingsModules.includes(m.apiPath.toLowerCase())) return false;
                  if (!canAccessMenu(m.apiPath.toLowerCase())) return false;
                  if (['leads', 'campaigns'].includes(m.apiPath.toLowerCase())) return true;
                  if (!branding || !branding.enabledModules || branding.enabledModules.length === 0) return true;
                  return branding.enabledModules.includes(m.apiPath.toLowerCase());
                }).map(m => {
                  let icon = Icons.FileText;
                  let colorClass = "text-[#7C3AED]";
                  
                  const path = m.apiPath.toLowerCase();
                  if (path === 'leads') {
                    icon = Icons.Layers;
                    colorClass = "text-[#7C3AED]";
                  } else if (path === 'deals') {
                    icon = Icons.DollarSign;
                    colorClass = "text-[#059669]";
                  } else if (path === 'companies') {
                    icon = Icons.Building2;
                    colorClass = "text-[#0D9488]";
                  } else if (path === 'campaigns') {
                    icon = Icons.Target;
                    colorClass = "text-[#EA580C]";
                  } else if (path === 'campaignassignments') {
                    icon = Icons.UserCheck;
                    colorClass = "text-[#EA580C]";
                  } else if (path === 'students') {
                    icon = Icons.GraduationCap;
                    colorClass = "text-[#DB2777]";
                  } else if (path === 'courses') {
                    icon = Icons.BookOpen;
                    colorClass = "text-[#0D9488]";
                  } else if (path === 'patients') {
                    icon = Icons.HeartPulse;
                    colorClass = "text-[#DC2626]";
                  } else if (path === 'appointments') {
                    icon = Icons.Calendar;
                    colorClass = "text-[#2563EB]";
                  } else if (m.icon) {
                    icon = (Icons as any)[m.icon] || Icons.FileText;
                  }

                  if (path === 'leads') {
                    if (!canAccessMenu('leads')) return null;
                    return (
                      <SidebarAccordion 
                        key={m._id} 
                        label="LEADS PROCESS" 
                        icon={icon} 
                        colorClass="text-[#7C3AED]"
                        defaultOpen={false}
                        isCollapsed={isCollapsed}
                      >
                        <SidebarItem 
                          to="/modules/leads" 
                          label="ALL LEADS" 
                          icon={Icons.Layers} 
                          colorClass="text-[#7C3AED]"
                          indent 
                          badge={leadsData?.pagination?.totalRecords || leadsData?.records?.length || 0} 
                          isCollapsed={isCollapsed}
                        />
                        {(() => {
                          const getStatusIcon = (statusName: string, iconName?: string) => {
                            if (iconName && (Icons as any)[iconName]) {
                              return (Icons as any)[iconName];
                            }
                            const lower = statusName.toLowerCase();
                            if (lower.includes('new') || lower.includes('fresh')) return Icons.Sparkles;
                            if (lower.includes('hot')) return Icons.Flame;
                            if (lower.includes('warm')) return Icons.Sun;
                            if (lower.includes('cedil')) return Icons.FileWarning;
                            if (lower.includes('document') || lower.includes('doc')) return Icons.FileText;
                            if (lower.includes('approval') || lower.includes('approve')) return Icons.Clock;
                            if (lower.includes('approved')) return Icons.CheckCircle;
                            if (lower.includes('disburs') || lower.includes('paid')) return Icons.Banknote;
                            if (lower.includes('reject') || lower.includes('decline')) return Icons.XOctagon;
                            if (lower.includes('follow') || lower.includes('call')) return Icons.PhoneCall;
                            if (lower.includes('drop') || lower.includes('lost')) return Icons.ArrowDownCircle;
                            if (lower.includes('pending') || lower.includes('wait')) return Icons.Hourglass;
                            if (lower.includes('kyc') || lower.includes('verify')) return Icons.ShieldCheck;
                            if (lower.includes('underwrit')) return Icons.FileCheck;
                            return Icons.Tag;
                          };

                          const getStatusColor = (statusName: string) => {
                            const lower = statusName.toLowerCase();
                            if (lower.includes('hot') || lower.includes('reject')) return 'text-[#DC2626]';
                            if (lower.includes('warm') || lower.includes('pending') && !lower.includes('cedil') && !lower.includes('doc')) return 'text-[#D97706]';
                            if (lower.includes('approved') || lower.includes('disburs') || lower.includes('success')) return 'text-[#059669]';
                            if (lower.includes('cedil')) return 'text-[#0D9488]';
                            if (lower.includes('document') || lower.includes('doc')) return 'text-[#0284C7]';
                            if (lower.includes('approval')) return 'text-[#EA580C]';
                            if (lower.includes('follow') || lower.includes('call')) return 'text-[#2563EB]';
                            if (lower.includes('drop')) return 'text-[#64748B]';
                            return 'text-[#7C3AED]';
                          };

                          const activeStatuses = (Array.isArray(dbStatuses) && dbStatuses.length > 0)
                            ? dbStatuses
                            : [
                                { name: 'HOT LEADS', icon: 'Flame', color: '#0284C7' },
                                { name: 'WARM LEADS', icon: 'Sun', color: '#F59E0B' },
                                { name: 'CEBIL PENDING', icon: 'FileWarning', color: '#E11D48' },
                                { name: 'DOCUMENT PENDING', icon: 'FileText', color: '#0284C7' },
                                { name: 'APPROVAL PENDING', icon: 'Clock', color: '#EA580C' },
                                { name: 'APPROVED BUT NOT DISBUSE', icon: 'CheckCircle', color: '#F59E0B' },
                                { name: 'DISBUSED', icon: 'Banknote', color: '#16A34A' },
                                { name: 'REJECTED', icon: 'XOctagon', color: '#E11D48' },
                                { name: 'FOLLOWUP', icon: 'PhoneCall', color: '#0284C7' },
                                { name: 'DROPPED', icon: 'ArrowDownCircle', color: '#EA580C' },
                                { name: 'PENDING', icon: 'Hourglass', color: '#F59E0B' },
                              ];

                          const getStatusCountFromMetrics = (name: string) => {
                            if (!metricsData?.statusCounts) {
                              const records = leadsData?.records || [];
                              return records.filter((r: any) => {
                                const s1 = (r.data?.status || '').toString().trim().toUpperCase();
                                const s2 = name.trim().toUpperCase();
                                return s1 === s2 || s1 === s2.replace(/ LEADS$/, '') || s2 === s1.replace(/ LEADS$/, '');
                              }).length;
                            }
                            const raw = (name || '').trim();
                            const upper = raw.toUpperCase();
                            if (metricsData.statusCounts[raw] !== undefined) return metricsData.statusCounts[raw];
                            if (metricsData.statusCounts[upper] !== undefined) return metricsData.statusCounts[upper];
                            const noLeadsKey = upper.replace(/ LEADS$/, '');
                            if (metricsData.statusCounts[noLeadsKey] !== undefined) return metricsData.statusCounts[noLeadsKey];
                            for (const [k, v] of Object.entries(metricsData.statusCounts)) {
                              const kUpper = k.trim().toUpperCase();
                              if (kUpper === upper || kUpper === noLeadsKey || kUpper.replace(/ LEADS$/, '') === noLeadsKey) {
                                return Number(v);
                              }
                            }
                            return 0;
                          };

                          return activeStatuses.map((st: any) => {
                            const statusName = st.name || '';
                            const count = getStatusCountFromMetrics(statusName);
                            return (
                              <SidebarItem
                                key={st._id || statusName}
                                to={`/modules/leads?status=${encodeURIComponent(statusName)}`}
                                label={statusName.toUpperCase()}
                                icon={getStatusIcon(statusName, st.icon)}
                                colorClass={getStatusColor(statusName)}
                                indent
                                badge={count}
                                isCollapsed={isCollapsed}
                              />
                            );
                          });
                        })()}
                      </SidebarAccordion>
                    );
                  }

                  return (
                    <SidebarItem 
                      key={m._id} 
                      to={`/modules/${m.apiPath}`} 
                      label={m.pluralLabel.toUpperCase()} 
                      icon={icon} 
                      colorClass={colorClass}
                      isCollapsed={isCollapsed}
                    />
                  );
                })}

                {/* Campaigns accordion */}
                {(canAccessMenu('campaigns') || canAccessMenu('campaignassignments')) && (
                  <SidebarAccordion label="CAMPAIGNS" icon={Icons.Megaphone} colorClass="text-[#EA580C]" isCollapsed={isCollapsed}>
                    {canAccessMenu('campaigns') && (
                      <SidebarItem to="/modules/campaigns" label="CAMPAIGN LIST" icon={Icons.Target} colorClass="text-[#EA580C]" indent isCollapsed={isCollapsed} />
                    )}
                    {canAccessMenu('campaignassignments') && (
                      <SidebarItem to="/modules/campaignassignments" label="ASSIGN CAMPAIGN" icon={Icons.UserCheck} colorClass="text-[#EA580C]" indent isCollapsed={isCollapsed} />
                    )}
                  </SidebarAccordion>
                )}

                {/* Reports accordion */}
                {(canAccessMenu('lead_reports') || canAccessMenu('telecaller_reports') || canAccessMenu('telecaller_monthly')) && (
                  <SidebarAccordion label="REPORTS & ANALYTICS" icon={Icons.BarChart3} colorClass="text-[#059669]" isCollapsed={isCollapsed}>
                    {canAccessMenu('lead_reports') && (
                      <SidebarItem to="/reports/lead-reports" label="LEAD REPORTS" icon={Icons.ListFilter} colorClass="text-[#059669]" indent isCollapsed={isCollapsed} />
                    )}
                    {canAccessMenu('telecaller_reports') && (
                      <SidebarItem to="/reports/telecaller-reports" label="TELECALLER'S REPORTS" icon={Icons.PhoneCall} colorClass="text-[#059669]" indent isCollapsed={isCollapsed} />
                    )}
                    {canAccessMenu('telecaller_monthly') && (
                      <SidebarItem to="/reports/telecaller-monthly" label="TELECALLER'S MONTHLY" icon={Icons.Calendar} colorClass="text-[#059669]" indent isCollapsed={isCollapsed} />
                    )}
                  </SidebarAccordion>
                )}

                {/* Separate Funnel Accordion */}
                {(canAccessMenu('funnel_daily') || canAccessMenu('funnel_monthly') || canAccessMenu('funnel_annual')) && (
                  <SidebarAccordion label="FUNNEL" icon={Icons.Filter} colorClass="text-[#2563EB]" isCollapsed={isCollapsed}>
                    {canAccessMenu('funnel_daily') && (
                      <SidebarItem to="/reports/funnel-daily" label="DAILY FUNNEL" icon={Icons.CalendarRange} colorClass="text-[#2563EB]" indent isCollapsed={isCollapsed} />
                    )}
                    {canAccessMenu('funnel_monthly') && (
                      <SidebarItem to="/reports/funnel-monthly" label="MONTHLY FUNNEL" icon={Icons.CalendarDays} colorClass="text-[#2563EB]" indent isCollapsed={isCollapsed} />
                    )}
                    {canAccessMenu('funnel_annual') && (
                      <SidebarItem to="/reports/funnel-annual" label="ANNUAL FUNNEL" icon={Icons.TrendingUp} colorClass="text-[#2563EB]" indent isCollapsed={isCollapsed} />
                    )}
                  </SidebarAccordion>
                )}
              </SidebarGroup>
            )}

            {/* Group 3: Administration */}
            {(canAccessMenu('settings') || canAccessMenu('access_privilege') || canAccessMenu('lead_transfer') || canAccessMenu('users_management')) && (
              <SidebarGroup title="ADMINISTRATION" isCollapsed={isCollapsed}>
                {canAccessMenu('settings') && (
                  <SidebarItem to="/settings" label="SETTINGS" icon={Icons.Settings} colorClass="text-[#CA8A04]" isCollapsed={isCollapsed} />
                )}

                {(canAccessMenu('access_privilege') || canAccessMenu('lead_transfer')) && (
                  <SidebarAccordion label="SECURITY" icon={Icons.ShieldCheck} colorClass="text-[#DC2626]" defaultOpen={true} isCollapsed={isCollapsed}>
                    {canAccessMenu('access_privilege') && (
                      <SidebarItem to="/access-privilege" label="ACCESS PRIVILEGE" icon={Icons.ShieldCheck} colorClass="text-[#DC2626]" indent isCollapsed={isCollapsed} />
                    )}
                    {canAccessMenu('lead_transfer') && (
                      <SidebarItem to="/lead-transfer" label="LEAD TRANSFER" icon={Icons.Send} colorClass="text-[#DC2626]" indent isCollapsed={isCollapsed} />
                    )}
                  </SidebarAccordion>
                )}

                {canAccessMenu('users_management') && (
                  <SidebarItem to="/users-management" label="USERS MANAGEMENT" icon={Icons.Users} colorClass="text-[#DB2777]" isCollapsed={isCollapsed} />
                )}
              </SidebarGroup>
            )}
          </div>

          {/* Single Row Profile Footer */}
          <SidebarProfile isCollapsed={isCollapsed} />
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 min-h-0 rounded-none sm:rounded-xl bg-white dark:bg-slate-900 shadow-[0_1px_3px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col relative border-0 sm:border border-black/[0.08] dark:border-slate-800">
          
          {/* Dashboard Header */}
          <header className="h-14 sm:h-[68px] flex-shrink-0 bg-white dark:bg-slate-900 border-b border-black/[0.08] dark:border-slate-800 flex items-center justify-between px-3 sm:px-6 md:px-8 z-20 transition-colors duration-150">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button 
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 text-slate-700 dark:text-slate-300 hover:bg-[#FAFAF9] dark:hover:bg-slate-800 rounded-xl transition-colors -ml-1 flex-shrink-0 cursor-pointer"
                title="Open Menu"
              >
                <Icons.Menu className="w-5 h-5 dark:text-slate-300" />
              </button>
              <div className="flex flex-col text-left min-w-0">
                <h2 className="text-sm sm:text-base md:text-[19px] font-[850] text-[#111111] dark:text-white tracking-tight leading-tight truncate">
                  {(() => {
                    const path = location.pathname;
                    if (path === '/reports/lead-reports') return 'Lead Reports';
                    if (path === '/reports/telecaller-reports') return "Telecaller's Reports";
                    if (path === '/reports/telecaller-monthly') return "Telecaller's Monthly Report";
                    if (path === '/reports/campaign-report') return 'My Campaign Report';
                    if (path === '/reports/funnel-daily') return 'Daily Lead Funnel';
                    if (path === '/reports/funnel-monthly') return 'Monthly Lead Funnel';
                    if (path === '/reports/funnel-annual') return 'Annual Lead Funnel';
                    if (path === '/reports') return 'Reports & Analytics';
                    if (path === '/users-management') return 'Users Management';
                    if (path === '/settings') return 'Settings';
                    if (path === '/access-privilege') return 'Access Privilege';
                    if (path === '/lead-transfer') return 'Lead Transfer';
                    if (path === '/my-campaign') return 'My Campaign';
                    if (path === '/workflows') return 'Workflows & Automation';
                    if (path === '/status') return 'Status Pipeline Stages';
                    if (path === '/modules/leads/new') return 'Create Lead';
                    if (path.startsWith('/modules/leads')) return 'Leads Process';
                    if (path.startsWith('/modules/deals')) return 'Deals';
                    if (path.startsWith('/modules/campaigns')) return 'Campaigns';
                    if (path.startsWith('/modules/campaignassignments')) return 'Assign Campaign';
                    if (path.startsWith('/modules/')) {
                      const parts = path.split('/');
                      const modApi = parts[2];
                      const found = modules.find(m => m.apiPath.toLowerCase() === modApi?.toLowerCase());
                      if (parts.length > 3 && parts[3] === 'new') {
                        return `Create ${found?.name || 'Record'}`;
                      }
                      if (parts.length > 3) {
                        return `Edit ${found?.name || 'Record'}`;
                      }
                      if (found) return found.pluralLabel || found.name;
                      return 'Module';
                    }
                    return 'Dashboard Overview';
                  })()}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 relative ml-auto flex-shrink-0">
              {/* Backdrops to close popovers when clicking outside */}
              {(showNotifications || showUserDropdown) && (
                <div 
                  className="fixed inset-0 z-30" 
                  onClick={() => {
                    setShowNotifications(false);
                    setShowUserDropdown(false);
                  }}
                />
              )}

              {/* Theme & Notification Buttons */}
              <div className="flex items-center gap-1.5 sm:gap-2 z-40">
                {/* Theme Toggle */}
                <button 
                  onClick={() => setDarkMode(!darkMode)}
                  className="w-8.5 h-8.5 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center bg-white dark:bg-slate-800 border border-black/[0.08] dark:border-slate-700 shadow-2xs hover:bg-black/[0.03] dark:hover:bg-slate-700 transition-all cursor-pointer group"
                  title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                >
                  {darkMode ? (
                    <Icons.Sun className="w-4 h-4 text-amber-500 animate-pulse" />
                  ) : (
                    <Icons.Moon className="w-4 h-4 text-[#7C3AED]/70 transition-transform duration-150 group-hover:scale-105" />
                  )}
                </button>

                {/* Notifications Bell */}
                <button 
                  onClick={() => {
                    setShowNotifications(!showNotifications);
                    setShowUserDropdown(false);
                  }}
                  className="w-8.5 h-8.5 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center bg-white dark:bg-slate-800 border border-black/[0.08] dark:border-slate-700 shadow-2xs hover:bg-black/[0.03] dark:hover:bg-slate-700 transition-all relative cursor-pointer group"
                  title="View Alerts & Notifications"
                >
                  <Icons.Bell className="w-4 h-4 text-[#CA8A04] transition-transform duration-150 group-hover:scale-105" />
                  {(unreadData?.unreadCount || 0) > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 bg-[#EF4444] text-white text-[9px] font-extrabold rounded-full flex items-center justify-center animate-pulse border-2 border-white dark:border-slate-800 font-mono">
                      {unreadData.unreadCount > 9 ? '9+' : unreadData.unreadCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Notifications Popover */}
              <AnimatePresence>
                {showNotifications && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 top-12 w-[calc(100vw-24px)] sm:w-88 max-w-sm bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-2xl p-4 z-50 text-left"
                  >
                    <div className="flex justify-between items-center pb-2.5 border-b border-slate-100 dark:border-slate-800 mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                          <Icons.Bell className="w-3.5 h-3.5 text-[#CA8A04]" /> Notifications
                        </h4>
                        {(unreadData?.unreadCount || 0) > 0 && (
                          <span className="text-[10px] bg-rose-50 dark:bg-rose-950 text-[#EF4444] dark:text-rose-400 px-2 py-0.5 rounded-full font-bold font-mono">
                            {unreadData.unreadCount} New
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <button
                          onClick={handleSendTestNotification}
                          className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-0.5"
                          title="Trigger a live test notification"
                        >
                          <Icons.Sparkles className="w-3 h-3" /> Test
                        </button>
                        {(unreadData?.unreadCount || 0) > 0 && (
                          <button
                            onClick={handleMarkAllAsRead}
                            className="text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 font-bold hover:underline cursor-pointer"
                          >
                            Mark read
                          </button>
                        )}
                        {notificationsData && notificationsData.length > 0 && (
                          <button
                            onClick={handleClearAllNotifications}
                            className="text-slate-400 hover:text-rose-500 font-medium cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {notificationsData && notificationsData.length > 0 ? (
                        notificationsData.map((item: any) => (
                          <div 
                            key={item._id} 
                            onClick={() => handleMarkAsRead(item._id, item.link)}
                            className={`flex gap-3 items-start p-2.5 rounded-xl border transition-all cursor-pointer text-left ${
                              !item.isRead
                                ? 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900/50 hover:bg-indigo-100/60 dark:hover:bg-indigo-900/60'
                                : 'bg-white dark:bg-slate-900 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            <div className={`p-1.5 rounded-xl mt-0.5 flex-shrink-0 ${
                              item.title?.includes('Assigned') || item.title?.includes('Transferred') || item.title?.includes('Allocated')
                                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                                : item.type === 'success'
                                  ? 'bg-emerald-500/10 text-emerald-600'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                            }`}>
                              {item.title?.includes('Assigned') || item.title?.includes('Transferred') || item.title?.includes('Allocated') ? (
                                <Icons.UserCheck className="w-3.5 h-3.5" />
                              ) : (
                                <Icons.Sparkles className="w-3.5 h-3.5" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <p className={`text-xs font-bold truncate ${
                                  !item.isRead ? 'text-indigo-950 dark:text-white' : 'text-slate-700 dark:text-slate-300'
                                }`}>
                                  {item.title}
                                </p>
                                <span className="text-[10px] text-slate-400 flex-shrink-0 font-medium">
                                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug line-clamp-2">
                                {item.message}
                              </p>
                            </div>

                            {!item.isRead && (
                              <span className="w-2 h-2 rounded-full bg-indigo-600 flex-shrink-0 mt-1.5"></span>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 px-4 text-slate-400 text-xs space-y-3">
                          <Icons.BellOff className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto" />
                          <p className="text-slate-500 dark:text-slate-400 font-medium">No notifications yet.</p>
                          <button
                            onClick={handleSendTestNotification}
                            className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 dark:text-indigo-400 rounded-xl text-xs font-bold transition-all border border-indigo-200/60 dark:border-indigo-800/60 inline-flex items-center gap-1.5 cursor-pointer shadow-3xs"
                          >
                            <Icons.Sparkles className="w-3.5 h-3.5" />
                            <span>Send Test Alert</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="h-6 w-px bg-black/[0.08] dark:bg-slate-800 z-40"></div>

              {/* User Dropdown Button */}
              <div 
                onClick={() => {
                  setShowUserDropdown(!showUserDropdown);
                  setShowNotifications(false);
                }}
                className="flex items-center gap-2.5 cursor-pointer hover:bg-[#FAFAF9] dark:hover:bg-slate-800 p-1.5 rounded-full pr-3 transition-colors border border-transparent hover:border-black/[0.08] dark:hover:border-slate-700 z-40"
              >
                <div className="w-8 h-8 rounded-full bg-[#4338CA] border border-indigo-700/30 flex items-center justify-center text-white font-bold text-xs shadow-2xs ring-1 ring-black/[0.06]">
                  {user ? `${user.firstName?.charAt(0) || ''}${user.lastName?.charAt(0) || ''}`.toUpperCase() || 'IC' : 'IC'}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-bold text-[#111111] dark:text-slate-200 leading-none">{user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Admin User' : 'Admin User'}</p>
                  <p className="text-[10px] text-[#78716C] dark:text-stone-400 font-medium mt-0.5">{user?.email || 'ink@crm.com'}</p>
                </div>
                <Icons.ChevronDown className="w-3.5 h-3.5 text-[#78716C] ml-1" />
              </div>

              {/* User Dropdown Menu */}
              <AnimatePresence>
                {showUserDropdown && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 top-14 w-52 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-slate-950/80 py-2.5 z-40"
                  >
                    <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 mb-2 text-left">
                      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Signed in as</p>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate mt-0.5">{user?.email || 'ink@crm.com'}</p>
                    </div>

                    <button
                      onClick={() => {
                        setShowUserDropdown(false);
                        navigate('/settings');
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2.5"
                    >
                      <Icons.Settings className="w-4 h-4 text-indigo-500" />
                      Account Settings
                    </button>

                    <button
                      onClick={() => {
                        setShowUserDropdown(false);
                        handleLogout();
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors flex items-center gap-2.5 border-t border-slate-100 dark:border-slate-800 mt-2 pt-2.5"
                    >
                      <Icons.LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </header>

          {/* Scrollable Main Content Area */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col bg-[#fdfbf7] dark:bg-[#0B0F19] custom-scrollbar">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="flex-1 flex flex-col p-3 sm:p-5 md:p-6 text-slate-800 dark:text-slate-100 min-h-full"
              >
                <div className="flex-1">
                  {children}
                </div>

                <footer className="mt-8 pt-4 pb-2 border-t border-slate-200/60 dark:border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-semibold text-slate-400 flex-shrink-0">
                  <div>
                    <span>© {new Date().getFullYear()} {branding?.name || 'INK CRM'}. All Rights Reserved.</span>
                  </div>
                  <div className="flex gap-4">
                    <a href="#" className="hover:text-indigo-600 transition-colors">Privacy Policy</a>
                    <span className="text-slate-200 dark:text-slate-700">|</span>
                    <a href="#" className="hover:text-indigo-600 transition-colors">Terms of Service</a>
                  </div>
                </footer>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Premium Toast Notifications Overlay */}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-3 max-w-md w-[calc(100vw-40px)] pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => {
            let bgColor = 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100';
            let icon = <Icons.Info className="w-5 h-5 text-blue-500" />;
            if (toast.type === 'success') {
              bgColor = 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300';
              icon = <Icons.CheckCircle2 className="w-5 h-5 text-emerald-505" />;
            } else if (toast.type === 'error') {
              bgColor = 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-300';
              icon = <Icons.AlertCircle className="w-5 h-5 text-rose-500" />;
            } else if (toast.type === 'warning') {
              bgColor = 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300';
              icon = <Icons.AlertTriangle className="w-5 h-5 text-amber-505" />;
            }

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, x: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85, x: 50, transition: { duration: 0.2 } }}
                className={cn(
                  "p-4 rounded-2xl border shadow-lg flex items-start gap-3 pointer-events-auto backdrop-blur-md",
                  bgColor
                )}
              >
                <div className="flex-shrink-0 mt-0.5">{icon}</div>
                <div className="flex-grow text-xs font-bold leading-relaxed">{toast.message}</div>
                <button
                  onClick={() => hideToast(toast.id)}
                  className="flex-shrink-0 text-slate-400 hover:text-slate-650 dark:hover:text-slate-200 transition-colors"
                >
                  <Icons.X className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Premium Confirm Dialog Modal */}
      <AnimatePresence>
        {confirm && (() => {
          const isDelete = confirm.type === 'danger' || confirm.title.toLowerCase().includes('delete') || confirm.message.toLowerCase().includes('delete');
          const isWarning = confirm.type === 'warning' || confirm.title.toLowerCase().includes('warning');

          let iconBg = 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400';
          let icon = <Icons.HelpCircle className="w-6 h-6" />;
          let confirmBtnClass = 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/25';

          if (isDelete) {
            iconBg = 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400';
            icon = <Icons.Trash2 className="w-6 h-6" />;
            confirmBtnClass = 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/25';
          } else if (isWarning) {
            iconBg = 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400';
            icon = <Icons.AlertTriangle className="w-6 h-6" />;
            confirmBtnClass = 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/25';
          }

          return (
            <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (confirm.onCancel) confirm.onCancel();
                  hideConfirm();
                }}
                className="absolute inset-0 bg-[#0f1115]/60 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 15 }}
                transition={{ type: "spring", stiffness: 350, damping: 28 }}
                className="relative w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-2xl p-6 text-center z-10"
              >
                <div className={`w-13 h-13 rounded-2xl flex items-center justify-center mx-auto mb-4 ${iconBg}`}>
                  {icon}
                </div>
                <h3 className="text-sm font-[850] text-slate-850 dark:text-slate-100 uppercase tracking-wider mb-2">
                  {confirm.title}
                </h3>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
                  {confirm.message}
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => {
                      if (confirm.onCancel) confirm.onCancel();
                      hideConfirm();
                    }}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors text-xs font-bold text-slate-650 dark:text-slate-300 shadow-xs"
                  >
                    {confirm.cancelText || 'Cancel'}
                  </button>
                  <button
                    onClick={() => {
                      confirm.onConfirm();
                      hideConfirm();
                    }}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all ${confirmBtnClass}`}
                  >
                    {confirm.confirmText || (isDelete ? 'Delete' : 'Confirm')}
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* Premium Alert/Success Dialog Modal */}
      <AnimatePresence>
        {alertModal && (() => {
          let alertIcon = <Icons.CheckCircle2 className="w-6 h-6" />;
          let iconBg = 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400';
          let btnClass = 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/25';

          if (alertModal.type === 'error') {
            alertIcon = <Icons.AlertOctagon className="w-6 h-6" />;
            iconBg = 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400';
            btnClass = 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/25';
          } else if (alertModal.type === 'warning') {
            alertIcon = <Icons.AlertTriangle className="w-6 h-6" />;
            iconBg = 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400';
            btnClass = 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/25';
          } else if (alertModal.type === 'info') {
            alertIcon = <Icons.Info className="w-6 h-6" />;
            iconBg = 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400';
            btnClass = 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/25';
          }
          
          return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (alertModal.onClose) alertModal.onClose();
                  hideAlertModal();
                }}
                className="absolute inset-0 bg-[#0f1115]/60 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 15 }}
                transition={{ type: "spring", stiffness: 350, damping: 28 }}
                className="relative w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-2xl p-6 text-center z-10"
              >
                <div className={`w-13 h-13 rounded-2xl flex items-center justify-center mx-auto mb-4 ${iconBg}`}>
                  {alertIcon}
                </div>
                <h3 className="text-sm font-[850] text-slate-850 dark:text-slate-100 uppercase tracking-wider mb-2">
                  {alertModal.title}
                </h3>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
                  {alertModal.message}
                </p>
                <div className="flex justify-center">
                  <button
                    onClick={() => {
                      if (alertModal.onClose) alertModal.onClose();
                      hideAlertModal();
                    }}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all ${btnClass}`}
                  >
                    {alertModal.buttonText || 'Got it'}
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
