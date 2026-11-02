import React from 'react';
import { MaintenanceReminder, Motorcycle, ServiceCategory } from '../types';
import { Bell, X, Sparkles } from 'lucide-react';
import { sounds } from '../utils/audio';

interface AddReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: Motorcycle;
  editingReminder?: MaintenanceReminder | null;
  onSave: (reminder: MaintenanceReminder) => void;
  onDelete?: (id: string) => void;
}

const PRESETS: Array<{
  title: string;
  category: ServiceCategory;
  categoryTag: string;
  intervalKm: number;
  priority: 'high' | 'medium' | 'low';
  notes: string;
  manualSpecNote: string;
  estimatedCostPhp: number;
}> = [
  {
    title: 'Engine Oil Change (Yamalube AT Blue Core)',
    category: 'Engine Oil',
    categoryTag: 'ENGINE',
    intervalKm: 3000,
    priority: 'high',
    notes: 'Yamalube 4T 10W-40 AT JASO MB (900ml).',
    manualSpecNote: '[YMPH Manual - NMAX/Aerox 155] Yamalube 4T 10W-40 AT JASO MB every 3,000 km (2,000-2,500 km in severe Metro Manila traffic).',
    estimatedCostPhp: 380,
  },
  {
    title: 'Final Transmission Gear Oil',
    category: 'Gear Oil',
    categoryTag: 'FLUIDS',
    intervalKm: 6000,
    priority: 'high',
    notes: '150ml Yamalube Scooter Gear Oil.',
    manualSpecNote: '[YMPH Manual - NMAX/Aerox 155] Replace gear oil every 2 engine oil changes (6,000 km) with Yamalube Gear Oil (150ml).',
    estimatedCostPhp: 120,
  },
  {
    title: 'CVT Cleaning & Flyball/Slider Inspection',
    category: 'CVT & Belt',
    categoryTag: 'CVT & DRIVE',
    intervalKm: 6000,
    priority: 'medium',
    notes: 'Degrease clutch bell, inspect roller weights and slider shoes.',
    manualSpecNote: '[YMPH Manual - NMAX/Aerox 155] Degrease clutch bell, inspect roller weights (flyball) and slider shoes every 6,000 km.',
    estimatedCostPhp: 350,
  },
  {
    title: 'CVT V-Belt Replacement',
    category: 'CVT & Belt',
    categoryTag: 'CVT & DRIVE',
    intervalKm: 25000,
    priority: 'medium',
    notes: 'Official replacement at 25,000 km.',
    manualSpecNote: '[YMPH Manual - NMAX/Aerox 155] Official replacement at 25,000 km; inspect for cracks or wear every 8,000 km.',
    estimatedCostPhp: 650,
  },
  {
    title: 'Viscous Paper Air Cleaner Element',
    category: 'Air Filter',
    categoryTag: 'ENGINE',
    intervalKm: 12000,
    priority: 'medium',
    notes: 'Viscous paper type.',
    manualSpecNote: '[YMPH Manual - NMAX/Aerox 155] Viscous paper type: Replace at 12,000 km. STRICTLY DO NOT blow with compressed air!',
    estimatedCostPhp: 450,
  },
  {
    title: 'Spark Plug Check / Replacement',
    category: 'Spark Plug',
    categoryTag: 'ELECTRICAL',
    intervalKm: 8000,
    priority: 'medium',
    notes: 'Check electrode gap (0.8-0.9 mm).',
    manualSpecNote: '[YMPH Manual - NMAX/Aerox 155] Check electrode gap (0.8-0.9 mm) and replace if eroded.',
    estimatedCostPhp: 250,
  },
];

export const AddReminderModal: React.FC<AddReminderModalProps> = ({
  isOpen,
  onClose,
  bike,
  editingReminder,
  onSave,
  onDelete,
}) => {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [category, setCategory] = React.useState<ServiceCategory>('Engine Oil');
  const [categoryTag, setCategoryTag] = React.useState('ENGINE');
  const [intervalKm, setIntervalKm] = React.useState<number | ''>(3000);
  const [lastCompletedOdo, setLastCompletedOdo] = React.useState<number | ''>(bike.odometer);
  const [lastCompletedDate, setLastCompletedDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [priority, setPriority] = React.useState<'high' | 'medium' | 'low'>('high');
  const [notes, setNotes] = React.useState('');
  const [manualSpecNote, setManualSpecNote] = React.useState('');
  const [estimatedCostPhp, setEstimatedCostPhp] = React.useState<number | ''>(380);

  React.useEffect(() => {
    if (editingReminder) {
      setTitle(editingReminder.title);
      setCategory(editingReminder.category);
      setCategoryTag(editingReminder.categoryTag || 'ENGINE');
      setIntervalKm(editingReminder.intervalKm);
      setLastCompletedOdo(editingReminder.lastCompletedOdo);
      setLastCompletedDate(editingReminder.lastCompletedDate || new Date().toISOString().split('T')[0]);
      setPriority(editingReminder.priority);
      setNotes(editingReminder.notes || '');
      setManualSpecNote(editingReminder.manualSpecNote || '');
      setEstimatedCostPhp(editingReminder.estimatedCostPhp);
    } else {
      setTitle('');
      setCategory('Engine Oil');
      setCategoryTag('ENGINE');
      setIntervalKm(3000);
      setLastCompletedOdo(bike.odometer);
      setLastCompletedDate(new Date().toISOString().split('T')[0]);
      setPriority('high');
      setNotes('');
      setManualSpecNote('');
      setEstimatedCostPhp(380);
    }
  }, [editingReminder, isOpen, bike.odometer]);

  if (!isOpen) return null;

  const handleApplyPreset = (preset: typeof PRESETS[0]) => {
    sounds.playClick();
    setTitle(preset.title);
    setCategory(preset.category);
    setCategoryTag(preset.categoryTag);
    setIntervalKm(preset.intervalKm);
    setPriority(preset.priority);
    setNotes(preset.notes);
    setManualSpecNote(preset.manualSpecNote);
    setEstimatedCostPhp(preset.estimatedCostPhp);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const km = typeof intervalKm === 'number' ? intervalKm : 3000;
    const lastOdo = typeof lastCompletedOdo === 'number' ? lastCompletedOdo : bike.odometer;

    const reminder: MaintenanceReminder = {
      id: editingReminder ? editingReminder.id : `rem-ph-${Date.now()}`,
      bikeId: bike.id,
      title: title.trim(),
      category,
      categoryTag,
      intervalKm: km,
      lastCompletedDate,
      lastCompletedOdo: lastOdo,
      nextDueOdo: lastOdo + km,
      priority,
      notes: notes.trim(),
      manualSpecNote: manualSpecNote.trim(),
      estimatedCostPhp: typeof estimatedCostPhp === 'number' ? estimatedCostPhp : 350,
    };

    sounds.playSuccess();
    onSave(reminder);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white border border-slate-100 rounded-3xl w-full max-w-lg my-6 overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#F95A00]" />
            <h3 className="text-base font-extrabold text-slate-900">
              {editingReminder ? 'Edit PMS Task' : 'Add Maintenance Task'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Presets */}
        {!editingReminder && (
          <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 shrink-0">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1 mb-1.5">
              <Sparkles className="w-3 h-3 text-[#F95A00]" /> Philippine Manual Presets:
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
              {PRESETS.map((p, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={() => handleApplyPreset(p)}
                  className="px-2.5 py-1 rounded-xl bg-white hover:bg-orange-50 border border-slate-200 text-slate-700 whitespace-nowrap text-[11px] font-semibold transition-colors shadow-2xs"
                >
                  {p.title.split(' ')[0]} {p.title.split(' ')[1] || ''}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Task Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Engine Oil Change (Yamalube AT Blue Core)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#F95A00]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => {
                  const cat = e.target.value as ServiceCategory;
                  setCategory(cat);
                  setCategoryTag(
                    cat === 'Engine Oil' || cat === 'Air Filter' || cat === 'Valve Clearance'
                      ? 'ENGINE'
                      : cat === 'Gear Oil' || cat === 'Coolant'
                      ? 'FLUIDS'
                      : cat === 'CVT & Belt'
                      ? 'CVT & DRIVE'
                      : cat === 'Spark Plug'
                      ? 'ELECTRICAL'
                      : 'BRAKES'
                  );
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
              >
                <option value="Engine Oil">Engine Oil</option>
                <option value="Gear Oil">Gear Oil</option>
                <option value="CVT & Belt">CVT & Belt</option>
                <option value="Drive Chain">Drive Chain</option>
                <option value="Brakes">Brakes</option>
                <option value="Spark Plug">Spark Plug</option>
                <option value="Coolant">Coolant</option>
                <option value="Air Filter">Air Filter</option>
                <option value="Valve Clearance">Valve Clearance</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Repeat Every (KM) *
              </label>
              <input
                type="number"
                min="100"
                step="100"
                required
                value={intervalKm}
                onChange={(e) => setIntervalKm(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-[#F95A00]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Last Performed Odometer (km)
              </label>
              <input
                type="number"
                min="0"
                value={lastCompletedOdo}
                onChange={(e) => setLastCompletedOdo(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-[#F95A00]"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Estimated Cost (₱ PHP)
              </label>
              <input
                type="number"
                min="0"
                step="10"
                value={estimatedCostPhp}
                onChange={(e) => setEstimatedCostPhp(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-[#F95A00]"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              🇵🇭 Philippine Manual Spec Note
            </label>
            <textarea
              rows={2}
              placeholder="e.g. [YMPH Manual - NMAX 155] Yamalube 4T 10W-40 AT JASO MB every 3,000 km..."
              value={manualSpecNote}
              onChange={(e) => setManualSpecNote(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            <div>
              {editingReminder && onDelete && (
                confirmDelete ? (
                  <div className="flex items-center gap-1.5 animate-in fade-in">
                    <button
                      type="button"
                      onClick={() => {
                        sounds.playClick();
                        onDelete(editingReminder.id);
                        onClose();
                      }}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors"
                    >
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      setConfirmDelete(true);
                    }}
                    className="text-xs font-bold text-red-500 hover:text-red-700 hover:underline transition-colors"
                  >
                    Delete Task
                  </button>
                )
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 text-xs font-bold text-white bg-[#F95A00] hover:bg-[#EA580C] rounded-2xl transition-all shadow-md shadow-[#F95A00]/25"
              >
                {editingReminder ? 'Update Task' : 'Save Task'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
