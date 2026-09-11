import { create } from 'zustand';
import api from '../services/api';

export interface FieldDefinition {
  name: string;
  label: string;
  type:
    | 'text'
    | 'number'
    | 'currency'
    | 'email'
    | 'phone'
    | 'date'
    | 'dropdown'
    | 'multiselect'
    | 'checkbox'
    | 'switch'
    | 'rating'
    | 'file'
    | 'image'
    | 'formula'
    | 'rich-text'
    | 'signature'
    | 'url';
  required: boolean;
  unique: boolean;
  regexValidation?: string;
  defaultValue?: string;
  formulaExpression?: string;
  options?: string[];
  conditionalVisibility?: {
    dependsOnField: string;
    conditionValue: string;
  };
}

export interface RelationshipDefinition {
  targetModule: string;
  type: 'one-to-many' | 'many-to-one' | 'many-to-many';
  fieldName: string;
}

export interface ModuleDefinition {
  _id: string;
  name: string;
  singularLabel: string;
  pluralLabel: string;
  apiPath: string;
  icon: string;
  isSystem: boolean;
  fields: FieldDefinition[];
  relationships: RelationshipDefinition[];
}

interface ModuleState {
  modules: ModuleDefinition[];
  loadingModules: boolean;
  activeModule: ModuleDefinition | null;
  fetchModules: () => Promise<ModuleDefinition[]>;
  setActiveModuleByPath: (path: string) => void;
  addModule: (module: ModuleDefinition) => void;
}

const getInitialModules = (): ModuleDefinition[] => {
  try {
    const raw = localStorage.getItem('inkcrm_cached_modules_v2');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const useModuleStore = create<ModuleState>((set, get) => ({
  modules: getInitialModules(),
  loadingModules: false,
  activeModule: null,

  fetchModules: async () => {
    // Only show loading spinner if we don't already have cached modules
    if (get().modules.length === 0) {
      set({ loadingModules: true });
    }
    try {
      const res = await api.get('/modules');
      const data = Array.isArray(res.data) ? res.data : [];
      try {
        localStorage.setItem('inkcrm_cached_modules_v2', JSON.stringify(data));
      } catch {}
      set({ modules: data, loadingModules: false });
      return data;
    } catch (err) {
      console.error('Failed to load modules:', err);
      set({ loadingModules: false });
      return get().modules;
    }
  },

  setActiveModuleByPath: (path) => {
    const active = get().modules.find(
      (m) => m.apiPath.toLowerCase() === path.toLowerCase()
    );
    // If not found in dynamic modules, provide built-in system fallbacks for core routes
    if (!active && path.toLowerCase() === 'campaigns') {
      const fallbackCampaigns: ModuleDefinition = {
        _id: 'campaigns_fallback',
        name: 'Campaigns',
        singularLabel: 'Campaign',
        pluralLabel: 'Campaigns',
        apiPath: 'campaigns',
        icon: 'Target',
        isSystem: true,
        fields: [
          { name: 'campaignName', label: 'Campaign Name', type: 'text', required: true, unique: false },
          { name: 'status', label: 'Status', type: 'dropdown', required: false, unique: false, options: ['Planned', 'In Progress', 'Completed'] }
        ],
        relationships: []
      };
      set({ activeModule: fallbackCampaigns });
      return;
    }
    if (!active && path.toLowerCase() === 'campaignassignments') {
      const fallbackAssign: ModuleDefinition = {
        _id: 'campaignassignments_fallback',
        name: 'Campaign Assignments',
        singularLabel: 'Campaign Assignment',
        pluralLabel: 'Campaign Assignments',
        apiPath: 'campaignassignments',
        icon: 'UserCheck',
        isSystem: true,
        fields: [],
        relationships: []
      };
      set({ activeModule: fallbackAssign });
      return;
    }
    set({ activeModule: active || null });
  },

  addModule: (module) => {
    set({ modules: [...get().modules, module] });
  }
}));
