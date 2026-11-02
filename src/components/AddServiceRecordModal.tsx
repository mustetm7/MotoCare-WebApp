import React from 'react';
import { Motorcycle, ServiceRecord, ServiceCategory, MaintenanceReminder, ServicePart } from '../types';
import { Wrench, X, Plus, Trash2, Link, ShieldCheck } from 'lucide-react';
import { sounds } from '../utils/audio';

interface AddServiceRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: Motorcycle;
  reminders: MaintenanceReminder[];
  initialTitle?: string;
  initialReminderId?: string;
  onSave: (record: ServiceRecord, linkedReminderId?: string) => void;
}

const PHILIPPINE_SHOPS = [
  'Yamaha 3S Shop (RevZone / Flagship)',
  'Honda Desmark / Guanzon 3S Center',
  'Suzuki Moto Center / Big Bikes',
  'Kawasaki K-Zone / Bajaj Service Center',
  'Motoworld / MotoMarket Service Hub',
  'Shell Advance MotoCare Station',
  'Caltex Havoline Bike Point',
  'Petron Car Care Center / Moto Lube',
  'Home Garage (DIY)',
];

const OIL_GRADES = [
  'Yamalube Blue Core 10W-40 JASO MB (900ml)',
  'Yamalube Power Matic 10W-40 (800ml)',
  'Yamalube 4T Full Synthetic 10W-40 JASO MA2',
  'Honda 4T SL 10W-30 Scooter Oil (800ml)',
  'Honda 4T Fully Synthetic 10W-30 (1.0L)',
  'Shell Advance AX7 Scooter 10W-40',
  'Shell Advance Ultra 4T 10W-40 (Full Syn)',
  'Motul Scooter Expert LE 10W-40',
  'Motul 7100 4T 10W-40 Ester',
  'Castrol Power1 Ultimate 10W-40',
  'Pertua Apex 4T Synthetic Performance',
];

export const AddServiceRecordModal: React.FC<AddServiceRecordModalProps> = ({
  isOpen,
  onClose,
  bike,
  reminders,
  initialTitle = '',
  initialReminderId,
  onSave,
}) => {
  const [title, setTitle] = React.useState(initialTitle);
  const [date, setDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [odometer, setOdometer] = React.useState<number>(bike.odometer);
  const [category, setCategory] = React.useState<ServiceCategory>('Engine Oil');
  const [type, setType] = React.useState<'DIY' | 'Casa / Official 3S' | 'Independent Shop'>('Casa / Official 3S');
  const [shopName, setShopName] = React.useState(PHILIPPINE_SHOPS[0]);
  const [oilBrandGrade, setOilBrandGrade] = React.useState(OIL_GRADES[0]);
  const [receiptNumber, setReceiptNumber] = React.useState('');
  const [isCasaVerified, setIsCasaVerified] = React.useState(true);
  const [parts, setParts] = React.useState<ServicePart[]>([
    { name: 'Engine Oil / Service Supplies', costPhp: 380 },
  ]);
  const [laborCostPhp, setLaborCostPhp] = React.useState<number>(150);
  const [notes, setNotes] = React.useState('');
  const [linkedReminderId, setLinkedReminderId] = React.useState<string>(initialReminderId || '');

  React.useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle || '');
      setDate(new Date().toISOString().split('T')[0]);
      setOdometer(bike.odometer);
      setLinkedReminderId(initialReminderId || '');

      if (initialReminderId) {
        const r = reminders.find((rem) => rem.id === initialReminderId);
        if (r) {
          setCategory(r.category);
          if (!initialTitle) setTitle(r.title);
        }
      }
    }
  }, [isOpen, bike.odometer, initialTitle, initialReminderId, reminders]);

  if (!isOpen) return null;

  const partsTotal = parts.reduce((sum, p) => sum + (Number(p.costPhp) || 0), 0);
  const totalCostPhp = partsTotal + (Number(laborCostPhp) || 0);

  const handleAddPart = () => {
    setParts([...parts, { name: '', costPhp: 0 }]);
  };

  const handleRemovePart = (index: number) => {
    setParts(parts.filter((_, i) => i !== index));
  };

  const handlePartChange = (index: number, field: keyof ServicePart, value: string | number) => {
    const updated = [...parts];
    if (field === 'costPhp') {
      updated[index].costPhp = Number(value) || 0;
    } else {
      updated[index].name = String(value);
    }
    setParts(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const record: ServiceRecord = {
      id: `rec-ph-${Date.now()}`,
      bikeId: bike.id,
      date,
      odometer: Number(odometer) || bike.odometer,
      title: title.trim(),
      category,
      type,
      shopName: type === 'DIY' ? 'Home Garage (DIY)' : shopName.trim(),
      oilBrandGrade: category === 'Engine Oil' || category === 'Gear Oil' ? oilBrandGrade : undefined,
      parts: parts.filter((p) => p.name.trim() !== ''),
      laborCostPhp: Number(laborCostPhp) || 0,
      totalCostPhp,
      receiptNumber: receiptNumber.trim() || undefined,
      isCasaVerified: type === 'Casa / Official 3S' ? isCasaVerified : false,
      notes: notes.trim(),
      linkedReminderId: linkedReminderId || undefined,
    };

    sounds.playSuccess();
    onSave(record, linkedReminderId || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white border border-slate-100 rounded-3xl w-full max-w-lg my-6 overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-[#F95A00]" />
            <h3 className="text-base font-extrabold text-slate-900">Log Completed Service</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Service Task / Title *
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
                Date Completed
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-[#F95A00]"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Odometer at Service (km)
              </label>
              <input
                type="number"
                min="0"
                required
                value={odometer}
                onChange={(e) => setOdometer(Number(e.target.value) || 0)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-[#F95A00]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Service Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ServiceCategory)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
              >
                <option value="Engine Oil">Engine Oil Service</option>
                <option value="Gear Oil">Gear Oil (Scooter)</option>
                <option value="CVT & Belt">CVT & Belt Clean</option>
                <option value="Drive Chain">Drive Chain (Manual)</option>
                <option value="Brakes">Brakes & Pads</option>
                <option value="Spark Plug">Spark Plug</option>
                <option value="Coolant">Coolant Flush</option>
                <option value="Air Filter">Air Cleaner Filter</option>
                <option value="Valve Clearance">Valve Clearance</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Service Provider
              </label>
              <select
                value={type}
                onChange={(e) => {
                  const t = e.target.value as typeof type;
                  setType(t);
                  if (t === 'DIY') {
                    setLaborCostPhp(0);
                    setIsCasaVerified(false);
                  } else if (t === 'Casa / Official 3S') {
                    setIsCasaVerified(true);
                  }
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
              >
                <option value="Casa / Official 3S">Official Casa / 3S Center</option>
                <option value="Independent Shop">Independent Workshop</option>
                <option value="DIY">DIY (Home Garage)</option>
              </select>
            </div>
          </div>

          {/* Shop Selector */}
          {type !== 'DIY' && (
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Service Center / Workshop Name
              </label>
              <input
                type="text"
                list="shop-list"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
              />
              <datalist id="shop-list">
                {PHILIPPINE_SHOPS.map((s, idx) => (
                  <option key={idx} value={s} />
                ))}
              </datalist>
            </div>
          )}

          {/* Oil Grade Selector */}
          {(category === 'Engine Oil' || category === 'Gear Oil') && (
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Engine / Gear Oil Brand & Grade Used
              </label>
              <input
                type="text"
                list="oil-list"
                value={oilBrandGrade}
                onChange={(e) => setOilBrandGrade(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
              />
              <datalist id="oil-list">
                {OIL_GRADES.map((o, idx) => (
                  <option key={idx} value={o} />
                ))}
              </datalist>
            </div>
          )}

          {/* Receipt & Casa Stamp */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Official Receipt / Invoice #
              </label>
              <input
                type="text"
                placeholder="e.g. OR-84920"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:border-[#F95A00]"
              />
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={isCasaVerified}
                  onChange={(e) => setIsCasaVerified(e.target.checked)}
                  className="rounded text-[#F95A00] focus:ring-0"
                />
                <span className="flex items-center gap-1 font-bold text-emerald-600">
                  <ShieldCheck className="w-3.5 h-3.5" /> Casa Verified Stamp
                </span>
              </label>
            </div>
          </div>

          {/* Reset Linked Reminder */}
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-700 font-bold mb-1">
              <Link className="w-3.5 h-3.5 text-[#F95A00]" />
              Auto-Reset Scheduled Task
            </div>
            <select
              value={linkedReminderId}
              onChange={(e) => setLinkedReminderId(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
            >
              <option value="">-- None (Standalone Service Entry) --</option>
              {reminders
                .filter((r) => r.bikeId === bike.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    Reset Target: {r.title}
                  </option>
                ))}
            </select>
          </div>

          {/* Itemized Parts */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-bold text-slate-700">
                Parts & Fluids Invoiced (PHP ₱)
              </label>
              <button
                type="button"
                onClick={handleAddPart}
                className="text-[11px] text-[#F95A00] hover:underline flex items-center gap-1 font-bold"
              >
                <Plus className="w-3 h-3" /> Add Item
              </button>
            </div>

            <div className="space-y-1.5">
              {parts.map((part, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Part item description"
                    value={part.name}
                    onChange={(e) => handlePartChange(idx, 'name', e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#F95A00]"
                  />
                  <div className="relative w-28 shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-mono">₱</span>
                    <input
                      type="number"
                      min="0"
                      value={part.costPhp || ''}
                      onChange={(e) => handlePartChange(idx, 'costPhp', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-6 pr-2 py-1.5 text-xs font-mono font-bold text-slate-800 text-right focus:outline-none focus:border-[#F95A00]"
                    />
                  </div>
                  {parts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemovePart(idx)}
                      className="p-1.5 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Labor & Total */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Labor Fee (₱ PHP)
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-mono">₱</span>
                <input
                  type="number"
                  min="0"
                  value={laborCostPhp}
                  onChange={(e) => setLaborCostPhp(Number(e.target.value) || 0)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-6 pr-2 py-1.5 text-xs font-mono font-bold text-slate-800 text-right focus:outline-none focus:border-[#F95A00]"
                />
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-500 mb-1">Total Paid (PHP)</div>
              <div className="text-xl font-extrabold font-mono text-[#F95A00] tabular-nums">
                ₱{totalCostPhp.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
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
              Save to Service Logbook
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
