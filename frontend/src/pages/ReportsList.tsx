import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { useModuleStore } from '../store/moduleStore';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';

export default function ReportsList() {
  const { modules } = useModuleStore();
  const { showToast, showAlertModal } = useToastStore();

  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDesigner, setShowDesigner] = useState(false);

  // Report designer state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie' | 'donut' | 'table'>('bar');
  const [groupByField, setGroupByField] = useState('');
  const [metricField, setMetricField] = useState('');
  const [aggregation, setAggregation] = useState<'count' | 'sum' | 'avg'>('count');
  
  const [filters, setFilters] = useState<any[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const res = await api.get('/reports');
      setReports(res.data || []);
    } catch (e) {
      // fallback mock templates
      setReports([
        {
          _id: 'rep_demo_1',
          name: 'Lead Source Breakdown Chart',
          description: 'Tracks lead counts grouped by original capture channel',
          chartType: 'donut',
          moduleId: { pluralLabel: 'Leads' }
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddFilter = () => {
    setFilters([...filters, { field: '', operator: 'equals', value: '' }]);
  };

  const handleToggleColumn = (colName: string) => {
    if (selectedColumns.includes(colName)) {
      setSelectedColumns(selectedColumns.filter((c) => c !== colName));
    } else {
      setSelectedColumns([...selectedColumns, colName]);
    }
  };

  const handleSaveReport = async () => {
    if (!name || !moduleId) {
      showToast('Name and module selection are required.', 'warning');
      return;
    }
    try {
      const payload = {
        name,
        description,
        moduleId,
        chartType,
        groupByField,
        metricField: metricField || undefined,
        aggregation,
        filters,
        columns: selectedColumns
      };

      const res = await api.post('/reports', payload);
      setReports([...reports, res.data]);
      setShowDesigner(false);
      resetDesigner();
      loadReports(); // refresh populate module values
      showAlertModal({
        title: 'Saved Successfully',
        message: 'Report configuration has been saved successfully.',
        type: 'success'
      });
    } catch (err) {
      showToast('Failed to save report configuration.', 'error');
    }
  };

  const resetDesigner = () => {
    setName('');
    setDescription('');
    setModuleId('');
    setChartType('bar');
    setGroupByField('');
    setMetricField('');
    setAggregation('count');
    setFilters([]);
    setSelectedColumns([]);
  };

  const selectedModuleFields = modules.find((m) => m._id === moduleId)?.fields || [];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded animate-shimmer"></div>
        <div className="h-32 rounded animate-shimmer"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto text-left px-4 md:px-8 py-4">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 flex-shrink-0">
            <Icons.BarChart3 className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/60 px-2.5 py-0.5 rounded-full uppercase tracking-wider font-mono">
                Analytics Hub
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Visual Report Center
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              Reports & Analysis
            </h1>
          </div>
        </div>

        <button
          onClick={() => {
            resetDesigner();
            setShowDesigner(true);
          }}
          className="h-11 px-5 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Icons.Plus className="w-4 h-4" /> Create Custom Report
        </button>
      </div>

      {/* Standard Analytics & Funnel Reports Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Card 1: Monthly Funnel */}
        <Link to="/reports/funnel-monthly" className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
                <Icons.Filter className="w-5 h-5" />
              </div>
              <span className="px-2.5 py-0.5 text-[10px] font-black uppercase bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 rounded-full border border-indigo-200/80 dark:border-indigo-800 font-mono">
                Monthly Funnel
              </span>
            </div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors uppercase">
              Monthly Campaign Funnel
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1 leading-relaxed">
              Visual ring chart & bar graph for lead status distribution (Hot, Warm, Unreachable, Disbursed) per campaign.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-bold text-indigo-600 dark:text-indigo-400">
            <span>Launch Funnel</span>
            <Icons.ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Card 2: Annual Funnel */}
        <Link to="/reports/funnel-annual" className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-600 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
                <Icons.TrendingUp className="w-5 h-5" />
              </div>
              <span className="px-2.5 py-0.5 text-[10px] font-black uppercase bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded-full border border-emerald-200/80 dark:border-emerald-800 font-mono">
                12-Month Progression
              </span>
            </div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors uppercase">
              Annual Campaign Funnel
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1 leading-relaxed">
              Year-over-year campaign lead volume progression and monthly conversion yield summary.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <span>Launch Annual Report</span>
            <Icons.ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>

        {/* Card 3: Lead Reports */}
        <Link to="/reports/lead-reports" className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:border-amber-400 dark:hover:border-amber-600 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
                <Icons.ListFilter className="w-5 h-5" />
              </div>
              <span className="px-2.5 py-0.5 text-[10px] font-black uppercase bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 rounded-full border border-amber-200/80 dark:border-amber-800 font-mono">
                Lead Analytics
              </span>
            </div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors uppercase">
              Campaign & Lead Reports
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1 leading-relaxed">
              Filter leads by active campaigns, statuses, products, and export full reports to Excel.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-bold text-amber-600 dark:text-amber-400">
            <span>View Lead Matrix</span>
            <Icons.ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </div>
        </Link>
      </div>

      {/* Reports Grid list */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {reports.map((rep) => (
          <div
            key={rep._id}
            className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left flex flex-col justify-between hover:shadow-md transition-all"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
            <div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  {rep.chartType === 'table' ? (
                    <Icons.Table className="w-4.5 h-4.5" />
                  ) : (
                    <Icons.BarChart2 className="w-4.5 h-4.5" />
                  )}
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-tight">{rep.name}</h3>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
                    {rep.moduleId?.pluralLabel || 'General'}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-3 leading-relaxed">{rep.description}</p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs">
              <span className="font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider text-[10px] font-mono bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md">
                {rep.chartType} chart
              </span>
              <Link
                to={`/reports/${rep._id}`}
                className="font-bold text-slate-700 hover:text-indigo-600 dark:text-slate-300 flex items-center gap-1"
              >
                View <Icons.ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ))}

        {reports.length === 0 && (
          <div className="col-span-3 py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 font-medium">
            No saved reports found. Click "Create Custom Report" to launch designer.
          </div>
        )}
      </div>

      {/* Report Designer Modal */}
      {showDesigner && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-50 border border-[#E8ECF4] rounded-[24px] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-5 bg-white border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-[800] text-slate-800 text-base uppercase tracking-wider">Visual Report Designer</h3>
              <button onClick={() => setShowDesigner(false)} className="text-slate-400 hover:text-slate-600">
                <Icons.X className="w-6 h-6" />
              </button>
            </div>

            {/* Canvas Body */}
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-12 gap-6 text-left text-sm">
              {/* Left Settings Panel */}
              <div className="md:col-span-5 bg-white border border-[#E8ECF4] rounded-[20px] p-6 space-y-4 shadow-sm">
                <h4 className="font-[800] text-[10px] text-slate-400 uppercase tracking-wider">Aggregation Config</h4>

                <div>
                  <label className="text-[10px] font-bold text-slate-450 uppercase tracking-wider block mb-1.5">Report Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                    placeholder="E.g., Students by Grade"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Query Module</label>
                  <select
                    value={moduleId}
                    onChange={(e) => {
                      setModuleId(e.target.value);
                      setSelectedColumns([]);
                    }}
                    className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="">Select source module...</option>
                    {modules.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.pluralLabel}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Chart Type</label>
                    <select
                      value={chartType}
                      onChange={(e) => setChartType(e.target.value as any)}
                      className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="bar">Bar Chart</option>
                      <option value="line">Line Chart</option>
                      <option value="pie">Pie Chart</option>
                      <option value="donut">Donut Chart</option>
                      <option value="table">Table only</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Group By</label>
                    <select
                      value={groupByField}
                      onChange={(e) => setGroupByField(e.target.value)}
                      className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="">No grouping...</option>
                      {selectedModuleFields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Formula Metric</label>
                    <select
                      value={aggregation}
                      onChange={(e) => setAggregation(e.target.value as any)}
                      className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="count">Count Rows</option>
                      <option value="sum">Sum Metric</option>
                      <option value="avg">Average Metric</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block mb-1.5">Metric Field</label>
                    <select
                      value={metricField}
                      onChange={(e) => setMetricField(e.target.value)}
                      disabled={aggregation === 'count'}
                      className="w-full h-11 px-4 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                    >
                      <option value="">Select number field...</option>
                      {selectedModuleFields
                        .filter((f) => ['number', 'currency'].includes(f.type))
                        .map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.label}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Right Columns & Filters selection panel */}
              <div className="md:col-span-7 space-y-6">
                
                {/* Filters */}
                <div className="bg-white border border-[#E8ECF4] rounded-[20px] p-6 space-y-4 shadow-sm">
                  <div className="flex justify-between items-center pb-1">
                    <h4 className="font-[800] text-[10px] text-slate-450 uppercase tracking-wider">Matching Filters</h4>
                    <button
                      onClick={handleAddFilter}
                      className="text-[10px] font-[800] uppercase tracking-wider text-indigo-650 hover:underline flex items-center gap-1"
                    >
                      <Icons.Plus className="w-3.5 h-3.5" /> Add Filter
                    </button>
                  </div>

                  {filters.map((f, idx) => (
                    <div key={idx} className="flex gap-2 flex-wrap items-center">
                      <select
                        value={f.field}
                        onChange={(e) => {
                          const updated = [...filters];
                          updated[idx].field = e.target.value;
                          setFilters(updated);
                        }}
                        className="h-9 px-3 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="">Field...</option>
                        {selectedModuleFields.map((field) => (
                          <option key={field.name} value={field.name}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={f.operator}
                        onChange={(e) => {
                          const updated = [...filters];
                          updated[idx].operator = e.target.value;
                          setFilters(updated);
                        }}
                        className="h-9 px-3 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="equals">equals</option>
                        <option value="not_equals">not equals</option>
                        <option value="contains">contains</option>
                      </select>
                      <input
                        type="text"
                        value={f.value}
                        onChange={(e) => {
                          const updated = [...filters];
                          updated[idx].value = e.target.value;
                          setFilters(updated);
                        }}
                        placeholder="match value"
                        className="h-9 px-3.5 text-xs font-semibold bg-white border border-[#E8ECF4] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500"
                      />
                    </div>
                  ))}
                  {filters.length === 0 && <p className="text-xs text-slate-400 font-semibold italic">Query all records.</p>}
                </div>

                {/* Columns Selection */}
                <div className="bg-white border border-[#E8ECF4] rounded-[20px] p-6 space-y-4 shadow-sm">
                  <h4 className="font-[800] text-[10px] text-slate-450 uppercase tracking-wider">Report Columns Table (Select to show)</h4>
                  <div className="flex gap-2 flex-wrap">
                    {selectedModuleFields.map((f) => (
                      <button
                        key={f.name}
                        onClick={() => handleToggleColumn(f.name)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border transition-all ${
                          selectedColumns.includes(f.name)
                            ? 'bg-indigo-50 text-indigo-650 border-indigo-200 shadow-sm'
                            : 'border-slate-200 text-slate-450 bg-white hover:bg-slate-50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setShowDesigner(false)}
                className="btn-secondary-premium h-10 px-5 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReport}
                className="btn-primary-premium h-10 px-5 text-xs font-bold"
              >
                Save Report Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
