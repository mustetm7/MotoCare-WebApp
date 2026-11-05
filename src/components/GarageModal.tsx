import React from 'react';
import { Motorcycle, UserSubscription } from '../types';
import { X, Sparkles } from 'lucide-react';
import { sounds } from '../utils/audio';
import { PHILIPPINE_MOTORCYCLE_PRESETS, PhilippineModelPreset } from '../data/philippinePresets';

interface GarageModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: Motorcycle | null;
  subscription: UserSubscription;
  existingCount: number;
  onSave: (bike: Motorcycle, selectedPreset?: PhilippineModelPreset) => void;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
  onOpenPaywall?: () => void;
}

const COLOR_SWATCHES = [
  '#FF6B00', // Orange
  '#EF4444', // Red-Orange
  '#2563EB', // Blue
  '#10B981', // Green
  '#00C5FF', // Light Cyan (trocket default)
  '#DC2626', // Deep Red
  '#06B6D4', // Aqua
  '#EAB308', // Yellow
  '#78716C', // Charcoal/Brown
];

export const GarageModal: React.FC<GarageModalProps> = ({
  isOpen,
  onClose,
  bike,
  subscription,
  existingCount,
  onSave,
  onDelete,
  canDelete,
  onOpenPaywall,
}) => {
  const isEditing = !!bike;
  const isPro = subscription.tier === 'pro';

  // Form State matching screenshots
  const [brand, setBrand] = React.useState('Yamaha');
  const [model, setModel] = React.useState('NMAX 155');
  const [year, setYear] = React.useState<number>(2026);
  const [odometer, setOdometer] = React.useState<number>(3000);
  const [unit, setUnit] = React.useState<'km' | 'mi'>('km');
  const [displacementCc, setDisplacementCc] = React.useState<number>(155);
  const [licensePlate, setLicensePlate] = React.useState('');
  const [motorcycleType, setMotorcycleType] = React.useState<'Scooter / AT' | 'Underbone' | 'Backbone / Commuter'>('Scooter / AT');
  const [nickname, setNickname] = React.useState('trocket');
  const [badgeColor, setBadgeColor] = React.useState('#00C5FF');
  const [customHexInput, setCustomHexInput] = React.useState('00C5FF');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  React.useEffect(() => {
    setShowDeleteConfirm(false);
    if (bike) {
      setBrand(bike.brand);
      setModel(bike.model);
      setYear(bike.year);
      setOdometer(bike.odometer);
      setDisplacementCc(bike.specs?.displacementCc || 155);
      setLicensePlate(bike.licensePlate || '');
      setMotorcycleType(
        bike.motorcycleType === 'Underbone'
          ? 'Underbone'
          : bike.motorcycleType === 'Backbone / Commuter'
          ? 'Backbone / Commuter'
          : 'Scooter / AT'
      );
      setNickname(bike.nickname || '');
      const color = bike.customColorBadge || '#00C5FF';
      setBadgeColor(color);
      setCustomHexInput(color.replace('#', ''));
    } else {
      setBrand('Yamaha');
      setModel('NMAX 155');
      setYear(2026);
      setOdometer(3000);
      setDisplacementCc(155);
      setLicensePlate('');
      setMotorcycleType('Scooter / AT');
      setNickname('trocket');
      setBadgeColor('#00C5FF');
      setCustomHexInput('00C5FF');
    }
  }, [bike, isOpen]);

  if (!isOpen) return null;

  // Free Tier Limit: Max 1 bike
  if (!isEditing && !isPro && existingCount >= 1) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
        <div className="w-full max-w-md bg-white rounded-3xl p-6 text-center space-y-4 shadow-2xl border border-slate-100">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-[#FF6B00] flex items-center justify-center mx-auto">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-extrabold text-slate-900">
            Multi-Bike Garage is a Pro Feature
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Free accounts include 1 motorcycle in your digital garage. Upgrade to MotoCare Pro for ₱49/mo to track unlimited scooters, underbones, and big bikes.
          </p>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 text-xs font-bold text-slate-600 bg-slate-100 rounded-2xl hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPaywall?.();
              }}
              className="flex-1 py-3 text-xs font-bold text-white bg-[#FF6B00] hover:bg-[#EA580C] rounded-2xl shadow-md shadow-[#FF6B00]/25"
            >
              Upgrade to Pro (₱49/mo)
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleBrandSelect = (selectedBrand: string) => {
    sounds.playClick();
    setBrand(selectedBrand);
    // Find first preset for this brand
    const preset = PHILIPPINE_MOTORCYCLE_PRESETS.find(
      (p: PhilippineModelPreset) => p.brand.toLowerCase() === selectedBrand.toLowerCase()
    );
    if (preset) {
      setModel(preset.model);
      setDisplacementCc(preset.displacementCc);
      setMotorcycleType(
        preset.transmission === 'Automatic Scooter'
          ? 'Scooter / AT'
          : preset.transmission === 'Semi-Auto Underbone'
          ? 'Underbone'
          : 'Backbone / Commuter'
      );
    }
  };

  const handleModelSelect = (preset: PhilippineModelPreset) => {
    sounds.playClick();
    setModel(preset.model);
    setDisplacementCc(preset.displacementCc);
    setMotorcycleType(
      preset.transmission === 'Automatic Scooter'
        ? 'Scooter / AT'
        : preset.transmission === 'Semi-Auto Underbone'
        ? 'Underbone'
        : 'Backbone / Commuter'
    );
  };

  const handleHexChange = (val: string) => {
    const clean = val.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
    setCustomHexInput(clean);
    if (clean.length === 6) {
      setBadgeColor(`#${clean}`);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sounds.playSuccess();

    const selectedPreset = PHILIPPINE_MOTORCYCLE_PRESETS.find(
      (p: PhilippineModelPreset) =>
        p.brand.toLowerCase() === brand.toLowerCase() && p.model.toLowerCase() === model.toLowerCase()
    );

    const updatedBike: Motorcycle = {
      id: bike?.id || `bike-${Date.now()}`,
      brand,
      model,
      year: Number(year) || 2026,
      odometer: Number(odometer) || 0,
      licensePlate: licensePlate.trim().toUpperCase(),
      color: bike?.color || 'Matte Black',
      nickname: nickname.trim() || model,
      customColorBadge: badgeColor,
      motorcycleType,
      unit,
      specs: {
        transmission: motorcycleType === 'Scooter / AT' ? 'Automatic Scooter' : motorcycleType === 'Underbone' ? 'Semi-Auto Underbone' : 'Manual',
        cooling: selectedPreset?.cooling || bike?.specs?.cooling || 'Liquid-Cooled',
        displacementCc: Number(displacementCc) || 155,
        tirePressureFrontPsi: selectedPreset?.tirePressureFrontPsi || bike?.specs?.tirePressureFrontPsi || 29,
        tirePressureRearPsi: selectedPreset?.tirePressureRearPsi || bike?.specs?.tirePressureRearPsi || 33,
        oilViscosity: selectedPreset?.oilViscosity || bike?.specs?.oilViscosity || '10W-40 JASO MB',
        oilCapacityLiters: selectedPreset?.oilCapacityLiters || bike?.specs?.oilCapacityLiters || 0.9,
        gearOilCapacityMl: selectedPreset?.gearOilCapacityMl || bike?.specs?.gearOilCapacityMl || 150,
        recommendedServiceIntervalKm: selectedPreset?.recommendedServiceIntervalKm || 3000,
      },
    };

    onSave(updatedBike, !isEditing ? selectedPreset : undefined);
    onClose();
  };

  // Filter model presets for current brand
  const brandPresets = PHILIPPINE_MOTORCYCLE_PRESETS.filter(
    (p: PhilippineModelPreset) => p.brand.toLowerCase() === brand.toLowerCase()
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-[#FFFDF9] rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header matching screenshot 5 */}
        <div className="p-4 px-5 flex items-center justify-between border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="MotoCare Official Logo"
              className="w-10 h-10 rounded-2xl object-contain shadow-sm shrink-0 border border-slate-100 bg-[#0B0F19]"
            />
            <div>
              <h2 className="text-base font-extrabold text-slate-900 leading-tight">
                {isEditing ? 'Edit Motorcycle' : 'Register Motorcycle'}
              </h2>
              <p className="text-[11px] text-slate-500">Philippine Motorcycle Maintenance</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body matching screenshots 5 & 8 */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Brand Field */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700">Brand *</label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              required
              className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            />
            {/* Quick Brand Pills */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {['Yamaha', 'Honda', 'Suzuki', 'Kawasaki'].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => handleBrandSelect(b)}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                    brand.toLowerCase() === b.toLowerCase()
                      ? 'bg-[#FF6B00] text-white shadow-sm'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          {/* Model Field */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700">Model *</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
              className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            />
            {/* Quick Model Pills matching screenshot */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar pt-1">
              {brandPresets.slice(0, 6).map((preset) => (
                <button
                  key={preset.model}
                  type="button"
                  onClick={() => handleModelSelect(preset)}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs whitespace-nowrap transition-colors ${
                    model.toLowerCase() === preset.model.toLowerCase()
                      ? 'bg-[#0097A7] text-white shadow-sm'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  {preset.model}
                </button>
              ))}
            </div>
          </div>

          {/* Year & Current Odometer Row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700">Year *</label>
              <input
                type="number"
                min="1990"
                max="2030"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                required
                className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-700">Current Odometer *</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  value={odometer}
                  onChange={(e) => setOdometer(Number(e.target.value))}
                  required
                  placeholder="e.g. 5200"
                  className="w-full bg-white border border-slate-200 rounded-2xl px-4 pr-10 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-amber-600">
                  {unit}
                </span>
              </div>
            </div>
          </div>

          {/* Unit Selector matching screenshot */}
          <div className="flex items-center justify-end gap-2 text-xs">
            <span className="text-slate-500">Unit:</span>
            <button
              type="button"
              onClick={() => setUnit('km')}
              className={`px-3 py-1 rounded-xl font-bold ${
                unit === 'km' ? 'bg-[#FF6B00] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Kilometers (km)
            </button>
            <button
              type="button"
              onClick={() => setUnit('mi')}
              className={`px-3 py-1 rounded-xl font-bold ${
                unit === 'mi' ? 'bg-[#FF6B00] text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Miles (mi)
            </button>
          </div>

          {/* Engine Displacement (cc) */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700">Engine Displacement (cc)</label>
            <input
              type="number"
              value={displacementCc}
              onChange={(e) => setDisplacementCc(Number(e.target.value))}
              placeholder="155"
              className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            />
          </div>

          {/* Plate / MV File Number (Optional) */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700">Plate / MV File Number (Optional)</label>
            <input
              type="text"
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value)}
              placeholder="e.g. 123ABC or 1234-567890"
              className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            />
          </div>

          {/* Motorcycle Type Pills */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700">Motorcycle Type</label>
            <div className="flex flex-wrap gap-1.5">
              {(['Scooter / AT', 'Underbone', 'Backbone / Commuter'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMotorcycleType(type)}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                    motorcycleType === type
                      ? 'bg-[#FF6B00] text-white shadow-sm'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Nickname (Optional) matching screenshot 8 with orange border */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-700">Nickname (Optional)</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Red Rocket, Daily Ride, Beast"
              className="w-full bg-white border-2 border-[#FF6B00] rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none shadow-sm"
            />
          </div>

          {/* Badge Color Swatches & Custom HEX Code matching screenshot 8 */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-700">Badge Color</label>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-[#00ACC1] text-[10px] font-bold uppercase">
                <span>👁</span>
                <span>PREVIEW</span>
              </div>
            </div>

            {/* 9 Color circles */}
            <div className="flex items-center justify-between gap-1.5 pt-1">
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setBadgeColor(color);
                    setCustomHexInput(color.replace('#', ''));
                  }}
                  className={`w-7 h-7 rounded-full transition-transform ${
                    badgeColor.toLowerCase() === color.toLowerCase()
                      ? 'ring-2 ring-offset-2 ring-slate-800 scale-110'
                      : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            {/* Custom HEX Code Box */}
            <div className="pt-2 flex items-center justify-between gap-3">
              <div className="flex-1 space-y-1">
                <span className="text-[10px] text-slate-500 font-medium">Custom HEX Code</span>
                <div className="flex items-center bg-white border border-slate-200 rounded-2xl px-3 py-2 text-xs font-mono font-bold text-slate-800">
                  <span className="text-amber-600 mr-1.5 font-sans font-bold">#</span>
                  <input
                    type="text"
                    value={customHexInput}
                    onChange={(e) => handleHexChange(e.target.value)}
                    maxLength={6}
                    placeholder="00C5FF"
                    className="w-full uppercase font-mono tracking-wider focus:outline-none"
                  />
                </div>
              </div>

              {/* Color Preview Square */}
              <div
                className="w-12 h-12 rounded-2xl shadow-inner border border-slate-200 mt-4 shrink-0 transition-colors"
                style={{ backgroundColor: badgeColor }}
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-3">
            <button
              type="submit"
              className="w-full py-3.5 bg-[#FF6B00] hover:bg-[#EA580C] text-white rounded-2xl font-bold text-sm shadow-lg shadow-[#FF6B00]/25 transition-all flex items-center justify-center gap-1.5 active:scale-98"
            >
              <span>+</span>
              <span>{isEditing ? 'Save Changes' : 'Register to Garage'}</span>
            </button>

            {isEditing && (
              <div className="mt-2.5">
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      setShowDeleteConfirm(true);
                    }}
                    className="w-full py-2.5 text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 rounded-2xl transition-colors"
                  >
                    Delete Motorcycle
                  </button>
                ) : (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-center space-y-2.5 animate-in fade-in duration-150">
                    <p className="text-xs font-bold text-red-800">
                      Remove &quot;{bike?.nickname || bike?.model}&quot; from your garage?
                    </p>
                    <p className="text-[11px] text-red-600 leading-normal">
                      This will remove this motorcycle and its maintenance schedule.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          sounds.playClick();
                          setShowDeleteConfirm(false);
                        }}
                        className="flex-1 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          sounds.playClick();
                          if (bike?.id) {
                            onDelete?.(bike.id);
                          }
                          onClose();
                        }}
                        className="flex-1 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-all active:scale-95"
                      >
                        Yes, Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
