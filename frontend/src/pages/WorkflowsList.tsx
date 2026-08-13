import React, { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { useModuleStore } from '../store/moduleStore';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';

export default function WorkflowsList() {
  const { modules } = useModuleStore();
  const { showToast, showAlertModal } = useToastStore();

  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);

  // Workflow Editor states
  const [name, setName] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [triggerEvent, setTriggerEvent] = useState<'create' | 'update' | 'delete'>('create');
  const [triggerField, setTriggerField] = useState('');
  const [conditions, setConditions] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      const res = await api.get('/workflows');
      setWorkflows(res.data || []);
    } catch (e) {
      // fallback mock
      setWorkflows([
        {
          _id: 'wf_demo_1',
          name: 'Qualified Lead Follow-up Action',
          trigger: { event: 'update', fieldTrigger: 'status' },
          conditions: [{ field: 'status', operator: 'equals', value: 'Qualified' }],
          actions: [{ type: 'create_task', params: { title: 'Call Lead Immediate' } }],
          isEnabled: true
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (id: string, currentState: boolean) => {
    try {
      await api.put(`/workflows/${id}`, { isEnabled: !currentState });
      setWorkflows(workflows.map((w) => (w._id === id ? { ...w, isEnabled: !currentState } : w)));
      showToast('Workflow status updated successfully.', 'success');
    } catch (err) {
      showToast('Failed to toggle workflow status.', 'error');
    }
  };

  const handleAddCondition = () => {
    setConditions([...conditions, { field: '', operator: 'equals', value: '' }]);
  };

  const handleAddAction = (type: string) => {
    setActions([...actions, { type, params: { title: '', message: '', url: '' } }]);
  };

  const handleSaveWorkflow = async () => {
    if (!name || !moduleId) {
      showToast('Name and module selection are required.', 'warning');
      return;
    }
    try {
      const payload = {
        name,
        moduleId,
        trigger: { event: triggerEvent, fieldTrigger: triggerField || undefined },
        conditions,
        actions,
        isEnabled: true
      };

      const res = await api.post('/workflows', payload);
      setWorkflows([...workflows, res.data]);
      setShowEditor(false);
      resetEditor();
      showAlertModal({
        title: 'Saved Successfully',
        message: 'The new workflow automation has been saved successfully.',
        type: 'success'
      });
    } catch (err) {
      showToast('Failed to save workflow.', 'error');
    }
  };

  const resetEditor = () => {
    setName('');
    setModuleId('');
    setTriggerEvent('create');
    setTriggerField('');
    setConditions([]);
    setActions([]);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 rounded animate-shimmer"></div>
        <div className="h-40 rounded animate-shimmer"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-left pb-16 font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 rounded-2xl shadow-xs relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 flex-shrink-0">
            <Icons.Workflow className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider font-mono px-2.5 py-0.5 rounded-full border bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60">
                Business Logic
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Automation
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 uppercase">
              Workflow Automations
            </h1>
          </div>
        </div>

        <button
          onClick={() => {
            resetEditor();
            setShowEditor(true);
          }}
          className="btn-primary-premium flex items-center justify-center gap-1.5 self-start sm:self-auto"
        >
          <Icons.Plus className="w-4 h-4" /> Create Workflow
        </button>
      </div>

      {/* Workflows list grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {workflows.map((wf) => (
          <div
            key={wf._id}
            className="card-premium text-left"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">{wf.name}</h3>
                <span className="text-[9px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block mt-1.5 font-mono">
                  Triggered on {wf.trigger.event}
                </span>
              </div>
              <button
                onClick={() => handleToggle(wf._id, wf.isEnabled)}
                className={`w-10 h-6 rounded-full p-0.5 transition-colors focus:outline-none cursor-pointer ${
                  wf.isEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    wf.isEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Conditions summary description */}
            <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <Icons.CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wider">Conditions:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {wf.conditions.length > 0
                    ? wf.conditions.map((c: any) => `${c.field} ${c.operator} '${c.value}'`).join(' AND ')
                    : 'Execute unconditionally'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Icons.PlayCircle className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wider">Actions:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {wf.actions.map((a: any) => a.type.replace('_', ' ')).join(', ')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Workflow Visual Builder Overlay Canvas Modal */}
      {showEditor && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Modal header */}
            <div className="px-6 py-4.5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h3 className="font-black text-slate-900 dark:text-white text-base uppercase tracking-wider">Visual Workflow Builder</h3>
              <button onClick={() => setShowEditor(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer">
                <Icons.X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Canvas body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Settings side menu panel */}
              <div className="md:col-span-4 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200/90 dark:border-slate-700 rounded-2xl p-5 space-y-4 shadow-sm text-left">
                <h4 className="font-black text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Configure Nodes</h4>
                
                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Workflow Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-10 px-3.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                    placeholder="E.g. Lead Assigned alert"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Target Module</label>
                  <select
                    value={moduleId}
                    onChange={(e) => setModuleId(e.target.value)}
                    className="w-full h-10 px-3.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="">Select module...</option>
                    {modules.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.pluralLabel}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Event</label>
                    <select
                      value={triggerEvent}
                      onChange={(e) => setTriggerEvent(e.target.value as any)}
                      className="w-full h-10 px-3 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="create">On Create</option>
                      <option value="update">On Update</option>
                      <option value="delete">On Delete</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1.5">Trigger Field</label>
                    <input
                      type="text"
                      value={triggerField}
                      onChange={(e) => setTriggerField(e.target.value)}
                      placeholder="Optional"
                      className="w-full h-10 px-3.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Visual Flow chart node panel */}
              <div className="md:col-span-8 space-y-4 flex flex-col justify-start">
                
                {/* Node 1: Trigger */}
                <div className="p-5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200/90 dark:border-slate-700 rounded-2xl relative shadow-sm text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <Icons.Zap className="w-5 h-5 text-amber-500" />
                    <span className="font-black text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">1. TRIGGER NODE</span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold leading-relaxed">
                    Runs when a record in <span className="font-bold text-indigo-600 dark:text-indigo-400">{modules.find((m) => m._id === moduleId)?.singularLabel || 'Selected Module'}</span> is <span className="font-bold text-indigo-600 dark:text-indigo-400">{triggerEvent}d</span>.
                  </p>
                </div>

                {/* Flow connector line */}
                <div className="flex justify-center"><div className="w-[2px] h-4 bg-slate-300 dark:bg-slate-700"></div></div>

                {/* Node 2: Conditions */}
                <div className="p-5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200/90 dark:border-slate-700 rounded-2xl relative shadow-sm text-left space-y-3">
                  <div className="flex justify-between items-center pb-1">
                    <div className="flex items-center gap-2">
                      <Icons.Filter className="w-5 h-5 text-emerald-500" />
                      <span className="font-black text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">2. CONDITIONS (IF MATCH)</span>
                    </div>
                    <button
                      onClick={handleAddCondition}
                      className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Icons.Plus className="w-3.5 h-3.5" /> Add Rule
                    </button>
                  </div>

                  {conditions.map((cond, idx) => (
                    <div key={idx} className="flex gap-2 flex-wrap items-center">
                      <input
                        type="text"
                        value={cond.field}
                        onChange={(e) => {
                          const updated = [...conditions];
                          updated[idx].field = e.target.value;
                          setConditions(updated);
                        }}
                        placeholder="FieldName (e.g. status)"
                        className="h-9 px-3.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 flex-1 min-w-[120px]"
                      />
                      <select
                        value={cond.operator}
                        onChange={(e) => {
                          const updated = [...conditions];
                          updated[idx].operator = e.target.value;
                          setConditions(updated);
                        }}
                        className="h-9 px-3 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="equals">equals</option>
                        <option value="not_equals">not equals</option>
                        <option value="contains">contains</option>
                      </select>
                      <input
                        type="text"
                        value={cond.value}
                        onChange={(e) => {
                          const updated = [...conditions];
                          updated[idx].value = e.target.value;
                          setConditions(updated);
                        }}
                        placeholder="value (e.g. Qualified)"
                        className="h-9 px-3.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 flex-1 min-w-[120px]"
                      />
                    </div>
                  ))}

                  {conditions.length === 0 && (
                    <p className="text-xs text-slate-400 font-semibold italic">Unconditional. Triggers actions immediately.</p>
                  )}
                </div>

                {/* Flow connector line */}
                <div className="flex justify-center"><div className="w-[2px] h-4 bg-slate-300 dark:bg-slate-700"></div></div>

                {/* Node 3: Actions */}
                <div className="p-5 bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200/90 dark:border-slate-700 rounded-2xl relative shadow-sm text-left space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Icons.PlayCircle className="w-5 h-5 text-indigo-500" />
                      <span className="font-black text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">3. ACTIONS (THEN RUN)</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddAction('create_task')}
                        className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-600 dark:text-indigo-300 text-[10px] font-bold uppercase tracking-wider border border-indigo-200/50 dark:border-indigo-800 rounded-lg transition-colors cursor-pointer"
                      >
                        + CRM Task
                      </button>
                      <button
                        onClick={() => handleAddAction('notification')}
                        className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-600 dark:text-indigo-300 text-[10px] font-bold uppercase tracking-wider border border-indigo-200/50 dark:border-indigo-800 rounded-lg transition-colors cursor-pointer"
                      >
                        + In-App Alert
                      </button>
                    </div>
                  </div>

                  {actions.map((act, idx) => (
                    <div key={idx} className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
                      <p className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">{act.type.replace('_', ' ')}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={act.params.title}
                          onChange={(e) => {
                            const updated = [...actions];
                            updated[idx].params.title = e.target.value;
                            setActions(updated);
                          }}
                          placeholder="Action title"
                          className="h-9 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                        />
                        <input
                          type="text"
                          value={act.params.message}
                          onChange={(e) => {
                            const updated = [...actions];
                            updated[idx].params.message = e.target.value;
                            setActions(updated);
                          }}
                          placeholder="Action detail payload text"
                          className="h-9 px-3.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  ))}

                  {actions.length === 0 && (
                    <p className="text-xs text-slate-400 font-semibold italic">Configure actions to execute.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
              <button
                onClick={() => setShowEditor(false)}
                className="btn-secondary-premium h-10 px-5 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveWorkflow}
                className="btn-primary-premium h-10 px-5 text-xs font-bold"
              >
                Publish Automation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
