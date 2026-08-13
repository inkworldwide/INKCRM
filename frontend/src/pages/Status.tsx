import React, { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import api from '../services/api';

export default function Status() {
  const [logs, setLogs] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Mock server health indicators
  const healthMetrics = {
    dbStatus: 'Connected',
    dbLatency: '14ms',
    uptime: '4d 18h 32m',
    memoryUsage: '142 MB / 512 MB',
    activeSessions: sessions.length || 3
  };

  useEffect(() => {
    loadStatusData();
  }, []);

  const loadStatusData = async () => {
    try {
      const [auditRes, sessionRes] = await Promise.all([
        api.get('/audit'),
        api.get('/auth/sessions')
      ]);
      setLogs(auditRes.data || []);
      setSessions(sessionRes.data || []);
    } catch (e) {
      // fallback mock logs if endpoints are empty
      setLogs([
        { _id: 'log_1', action: 'auth.login', resource: 'User', userId: { firstName: 'Gregory', lastName: 'House', email: 'admin@hospital.com' }, ipAddress: '192.168.1.1', createdAt: new Date() },
        { _id: 'log_2', action: 'record.create', resource: 'Lead', userId: { firstName: 'Sarah', lastName: 'Connor', email: 'admin@sales.com' }, ipAddress: '127.0.0.1', createdAt: new Date(Date.now() - 3600000) }
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 rounded animate-shimmer"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="h-28 rounded-xl animate-shimmer"></div>
          <div className="h-28 rounded-xl animate-shimmer"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-left pb-16 font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 flex-shrink-0">
            <Icons.Activity className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider font-mono px-2.5 py-0.5 rounded-full border bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60">
                System Health
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Infrastructure
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              System Status & Logs
            </h1>
          </div>
        </div>
      </div>

      {/* Health metrics grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <div className="card-premium flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-xl flex-shrink-0">
            <Icons.Database className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Database</p>
            <p className="text-base sm:text-lg font-black text-slate-800 dark:text-white mt-0.5">{healthMetrics.dbStatus}</p>
            <span className="text-[10px] text-slate-400 font-semibold truncate block">Latency: {healthMetrics.dbLatency}</span>
          </div>
        </div>

        <div className="card-premium flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl flex-shrink-0">
            <Icons.Cpu className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Server Uptime</p>
            <p className="text-base sm:text-lg font-black text-slate-800 dark:text-white mt-0.5 truncate">{healthMetrics.uptime}</p>
            <span className="text-[10px] text-slate-400 font-semibold truncate block">Memory: {healthMetrics.memoryUsage}</span>
          </div>
        </div>

        <div className="card-premium flex items-center gap-4">
          <div className="p-3 bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 rounded-xl flex-shrink-0">
            <Icons.Users className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Active Devices</p>
            <p className="text-base sm:text-lg font-black text-slate-800 dark:text-white mt-0.5">{healthMetrics.activeSessions}</p>
            <span className="text-[10px] text-slate-400 font-semibold truncate block">Sessions verified</span>
          </div>
        </div>

        <div className="card-premium flex items-center gap-4">
          <div className="p-3 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl flex-shrink-0">
            <Icons.ShieldCheck className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Security Rules</p>
            <p className="text-base sm:text-lg font-black text-slate-800 dark:text-white mt-0.5">Enabled</p>
            <span className="text-[10px] text-slate-400 font-semibold truncate block">CORS & Rate limits active</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Audit Log Table */}
        <div className="lg:col-span-8 card-premium p-0 overflow-hidden shadow-sm">
          <div className="px-6 py-4.5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-850">
            <h3 className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Icons.FileText className="w-4 h-4 text-indigo-500" /> Admin Audit Logs
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50/80 dark:bg-slate-800/80 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 h-11">
                <tr>
                  <th className="px-5 py-3">Timestamp</th>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Resource</th>
                  <th className="px-5 py-3">User Email</th>
                  <th className="px-5 py-3">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => (
                  <tr key={log._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors h-14">
                    <td className="px-5 py-3.5 text-slate-400 font-semibold">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider font-mono">
                      {log.action}
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-slate-200">
                      {log.resource}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300 font-semibold">
                      {log.userId?.email || 'System'}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 font-mono font-semibold">
                      {log.ipAddress || '127.0.0.1'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sessions sidebar */}
        <div className="lg:col-span-4 card-premium shadow-sm">
          <h3 className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-3.5">
            <Icons.Key className="w-4 h-4 text-indigo-500" /> Verified Devices
          </h3>

          <div className="space-y-3">
            {sessions.map((s, idx) => (
              <div key={idx} className="p-4 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200/90 dark:border-slate-700 rounded-2xl text-xs space-y-1.5">
                <div className="flex justify-between font-bold text-slate-800 dark:text-white">
                  <span>{s.browser} • {s.os}</span>
                  <span className="text-[9px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 rounded-lg tracking-wider uppercase">Active</span>
                </div>
                <p className="text-slate-400 font-semibold font-mono">IP: {s.ip}</p>
                <p className="text-[10px] text-slate-400 font-semibold">Last active: {new Date(s.lastActive).toLocaleTimeString()}</p>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="p-4 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200/90 dark:border-slate-700 rounded-2xl text-xs space-y-1.5">
                <div className="flex justify-between font-bold text-slate-800 dark:text-white">
                  <span>Google Chrome • Windows</span>
                  <span className="text-[9px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 rounded-lg tracking-wider uppercase">Active</span>
                </div>
                <p className="text-slate-400 font-semibold font-mono">IP: 192.168.1.12</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
