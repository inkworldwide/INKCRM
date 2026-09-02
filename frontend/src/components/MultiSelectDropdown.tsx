import React, { useState, useRef, useEffect } from 'react';
import * as Icons from 'lucide-react';

interface MultiSelectDropdownProps {
  label?: string;
  options: string[];
  selectedValues: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
}

export default function MultiSelectDropdown({
  label,
  options,
  selectedValues,
  onChange,
  placeholder = '-All-',
  searchPlaceholder = 'Search telecallers/users...'
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto focus search input on open
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase().trim();
    return options.filter(opt => opt.toLowerCase().includes(q));
  }, [options, searchQuery]);

  const isAllFilteredSelected = filteredOptions.length > 0 && filteredOptions.every(opt => selectedValues.includes(opt));
  const isAllSelected = options.length > 0 && selectedValues.length === options.length;

  const handleToggleOption = (val: string) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter(v => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  const handleToggleSelectAll = () => {
    if (isAllFilteredSelected) {
      // Remove all filtered options from selected
      const filteredSet = new Set(filteredOptions);
      onChange(selectedValues.filter(v => !filteredSet.has(v)));
    } else {
      // Add all filtered options to selected
      const combined = new Set([...selectedValues, ...filteredOptions]);
      onChange(Array.from(combined));
    }
  };

  // Determine display label for trigger button
  const getDisplayText = () => {
    if (selectedValues.length === 0) {
      return placeholder;
    }
    if (isAllSelected) {
      return `All Selected (${options.length})`;
    }
    if (selectedValues.length === 1) {
      return selectedValues[0];
    }
    if (selectedValues.length <= 2) {
      return selectedValues.join(', ');
    }
    return `${selectedValues.length} Selected`;
  };

  return (
    <div className="relative w-full text-left" ref={containerRef}>
      {label && (
        <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-2">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input-premium w-full h-11 px-4 text-xs font-semibold bg-[#FDFBF7] dark:bg-slate-900 border border-[#EAE4DA] dark:border-slate-700 rounded-xl flex items-center justify-between text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="truncate pr-2 font-bold text-slate-900 dark:text-slate-100">{getDisplayText()}</span>
        <Icons.ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Popup Menu with Search Box */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 max-h-72 overflow-hidden flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-2 text-xs animate-in fade-in zoom-in-95 duration-100">
          {/* Search Box Header */}
          <div className="relative mb-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <Icons.Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-9 pl-8 pr-7 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Options Container (Scrollable) */}
          <div className="overflow-y-auto max-h-52 space-y-1 pr-1">
            {/* Select All Option */}
            {filteredOptions.length > 0 && (
              <label
                onClick={handleToggleSelectAll}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer font-bold text-[#0F172A] dark:text-white border-b border-slate-100 dark:border-slate-800 mb-1"
              >
                <input
                  type="checkbox"
                  checked={isAllFilteredSelected}
                  onChange={() => {}}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                />
                <span>Select All {searchQuery ? `Matching (${filteredOptions.length})` : `(${options.length})`}</span>
              </label>
            )}

            {/* Individual Options */}
            {filteredOptions.map((opt) => {
              const isChecked = selectedValues.includes(opt);
              return (
                <label
                  key={opt}
                  onClick={() => handleToggleOption(opt)}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors ${
                    isChecked ? 'bg-indigo-50/60 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                  />
                  <span className="truncate">{opt}</span>
                </label>
              );
            })}

            {/* Empty Search Result State */}
            {filteredOptions.length === 0 && (
              <div className="py-6 text-center text-slate-400 text-xs font-medium">
                No matching telecallers or users found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
