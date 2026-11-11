import React from 'react';
import { Motorcycle, UserSubscription, CustomMotorcycleType, TransmissionType, EngineCooling } from '../types';
import { X, Sparkles, ArrowLeft, PlusCircle, AlertCircle, Wrench } from 'lucide-react';
import { sounds } from '../utils/audio';
import { PHILIPPINE_MOTORCYCLE_PRESETS, PhilippineModelPreset } from '../data/philippinePresets';

export const CUSTOM_MOTORCYCLE_TYPES: CustomMotorcycleType[] = [
  'Scooter',
  'Underbone',
  'Manual',
  'Sport Bike',
  'Standard',
  'Adventure',
  'Other',
];

interface GarageModalProps {
  isOpen: boolean;
  onClose: () => void;
  bike: Motorcycle | null;
  subscription: UserSubscription;
  hasProAccess?: boolean;
  existingCount: number;
  initialCustomMode?: boolean;
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

function normalizeBikeTypeToOption(rawType?: string): string {
  if (!rawType) return 'Scooter';
  if (rawType === 'Scooter / AT') return 'Scooter';
  if (rawType === 'Backbone / Commuter') return 'Manual';
  return rawType;
}

function mapMotorcycleTypeToTransmission(type: string): TransmissionType {
  const lower = type.toLowerCase();
  if (lower.includes('scooter')) return 'Automatic Scooter';
  if (lower.includes('underbone')) return 'Semi-Auto Underbone';
  return 'Manual';
}

export const GarageModal: React.FC<GarageModalProps> = ({
  isOpen,
  onClose,
  bike,
  subscription,
  hasProAccess,
  existingCount,
  initialCustomMode = false,
  onSave,
  onDelete,
  onOpenPaywall,
}) => {
  const isEditing = !!bike;
  const isPro =
    hasProAccess ??
    (subscription.tier === 'pro' &&
      subscription.status === 'active' &&
      !subscription.isExpired);

  // Mode: false = Preset Motorcycle Selection, true = Custom Motorcycle Registration
  const [isCustomMode, setIsCustomMode] = React.useState<boolean>(initialCustomMode);

  // Form State
  const [brand, setBrand] = React.useState('Yamaha');
  const [model, setModel] = React.useState('NMAX 155');
  const [year, setYear] = React.useState<number | ''>(2026);
  const [odometer, setOdometer] = React.useState<number | ''>(3000);
  const [unit, setUnit] = React.useState<'km' | 'mi'>('km');
  const [displacementCc, setDisplacementCc] = React.useState<number | ''>(155);
  const [licensePlate, setLicensePlate] = React.useState('');
  const [motorcycleType, setMotorcycleType] = React.useState<string>('Scooter');
  const [nickname, setNickname] = React.useState('trocket');
  const [badgeColor, setBadgeColor] = React.useState('#00C5FF');
  const [customHexInput, setCustomHexInput] = React.useState('00C5FF');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    setShowDeleteConfirm(false);
    setValidationErrors({});
    if (bike) {
      const matchedPreset = PHILIPPINE_MOTORCYCLE_PRESETS.find(
        (p) =>
          p.brand.toLowerCase() === (bike.brand || '').toLowerCase() &&
          p.model.toLowerCase() === (bike.model || '').toLowerCase()
      );
      setIsCustomMode(Boolean(bike.isCustom) || !matchedPreset);
      setBrand(bike.brand || '');
      setModel(bike.model || '');
      setYear(bike.year ?? 2026);
      setOdometer(bike.odometer ?? 0);
      setDisplacementCc(bike.specs?.displacementCc ?? 155);
      setLicensePlate(bike.licensePlate || '');
      setMotorcycleType(normalizeBikeTypeToOption(bike.motorcycleType));
      setNickname(bike.nickname || '');
      setUnit(bike.unit || 'km');
      const color = bike.customColorBadge || '#00C5FF';
      setBadgeColor(color);
      setCustomHexInput(color.replace('#', ''));
    } else if (initialCustomMode) {
      setIsCustomMode(true);
      setBrand('');
      setModel('');
      setYear(2026);
      setOdometer('');
      setDisplacementCc('');
      setLicensePlate('');
      setMotorcycleType('Scooter');
      setNickname('');
      setBadgeColor('#00C5FF');
      setCustomHexInput('00C5FF');
    } else {
      setIsCustomMode(false);
      setBrand('Yamaha');
      setModel('NMAX 155');
      setYear(2026);
      setOdometer(3000);
      setDisplacementCc(155);
      setLicensePlate('');
      setMotorcycleType('Scooter');
      setNickname('trocket');
      setBadgeColor('#00C5FF');
      setCustomHexInput('00C5FF');
    }
  }, [bike, isOpen, initialCustomMode]);

  if (!isOpen) return null;

  // Free Tier Limit: Max 1 bike (applies equally to preset and custom registration)
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

  const handleSwitchToCustomMode = () => {
    sounds.playClick();
    setValidationErrors({});
    setIsCustomMode(true);
    if (!isEditing) {
      setBrand('');
      setModel('');
      setDisplacementCc('');
      setYear(2026);
      setMotorcycleType('Scooter');
      setOdometer('');
      setNickname('');
    }
  };

  const handleBackToPresetList = () => {
    sounds.playClick();
    setValidationErrors({});
    setIsCustomMode(false);
    if (!isEditing) {
      setBrand('Yamaha');
      setModel('NMAX 155');
      setDisplacementCc(155);
      setYear(2026);
      setMotorcycleType('Scooter');
      setOdometer(3000);
      setNickname('trocket');
    }
  };

  const handleBrandSelect = (selectedBrand: string) => {
    sounds.playClick();
    setValidationErrors({});
    setBrand(selectedBrand);
    const preset = PHILIPPINE_MOTORCYCLE_PRESETS.find(
      (p: PhilippineModelPreset) => p.brand.toLowerCase() === selectedBrand.toLowerCase()
    );
    if (preset) {
      setModel(preset.model);
      setDisplacementCc(preset.displacementCc);
      setMotorcycleType(
        preset.transmission === 'Automatic Scooter'
          ? 'Scooter'
          : preset.transmission === 'Semi-Auto Underbone'
          ? 'Underbone'
          : 'Manual'
      );
    }
  };

  const handleModelSelect = (preset: PhilippineModelPreset) => {
    sounds.playClick();
    setValidationErrors({});
    setModel(preset.model);
    setDisplacementCc(preset.displacementCc);
    setMotorcycleType(
      preset.transmission === 'Automatic Scooter'
        ? 'Scooter'
        : preset.transmission === 'Semi-Auto Underbone'
        ? 'Underbone'
        : 'Manual'
    );
  };

  const handleHexChange = (val: string) => {
    const clean = val.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
    setCustomHexInput(clean);
    if (clean.length === 6) {
      setBadgeColor(`#${clean}`);
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedBrand = brand.trim();
    const trimmedModel = model.trim();
    const parsedCc = displacementCc === '' ? NaN : Number(displacementCc);
    const parsedYear = year === '' ? NaN : Number(year);
    const parsedOdo = odometer === '' ? NaN : Number(odometer);

    if (!trimmedBrand) {
      errors.brand = 'Motorcycle Brand is required.';
    }
    if (!trimmedModel) {
      errors.model = 'Motorcycle Model is required.';
    }
    if (Number.isNaN(parsedCc) || parsedCc <= 0 || parsedCc > 5000) {
      errors.displacementCc = 'Engine Displacement / CC is required (enter a valid CC greater than 0).';
    }
    if (Number.isNaN(parsedYear) || parsedYear < 1950 || parsedYear > 2100) {
      errors.year = 'Year Model is required (enter a valid year between 1950 and 2100).';
    }
    if (!motorcycleType || !motorcycleType.trim()) {
      errors.motorcycleType = 'Motorcycle Type is required.';
    }
    if (Number.isNaN(parsedOdo) || parsedOdo < 0 || parsedOdo > 2000000) {
      errors.odometer = 'Current Odometer Reading is required (0 km or higher).';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditing && !isPro && existingCount >= 1) {
      onClose();
      onOpenPaywall?.();
      return;
    }

    if (!validateForm()) {
      return;
    }

    sounds.playSuccess();

    const trimmedBrand = brand.trim();
    const trimmedModel = model.trim();
    const numericYear = Number(year);
    const numericOdo = Number(odometer);
    const numericCc = Number(displacementCc);

    const selectedPreset = !isCustomMode
      ? PHILIPPINE_MOTORCYCLE_PRESETS.find(
          (p: PhilippineModelPreset) =>
            p.brand.toLowerCase() === trimmedBrand.toLowerCase() &&
            p.model.toLowerCase() === trimmedModel.toLowerCase()
        )
      : undefined;

    const transmission: TransmissionType =
      selectedPreset?.transmission || mapMotorcycleTypeToTransmission(motorcycleType);
    const cooling: EngineCooling =
      selectedPreset?.cooling ||
      bike?.specs?.cooling ||
      (numericCc >= 150 ? 'Liquid-Cooled' : 'Air-Cooled');
    const isScooter = transmission === 'Automatic Scooter';

    const updatedBike: Motorcycle = {
      id: bike?.id || `bike-${Date.now()}`,
      brand: trimmedBrand,
      model: trimmedModel,
      year: numericYear,
      odometer: numericOdo,
      licensePlate: licensePlate.trim().toUpperCase(),
      color: bike?.color || 'Matte Black',
      nickname: nickname.trim() || trimmedModel,
      customColorBadge: badgeColor,
      motorcycleType,
      isCustom: isCustomMode || !selectedPreset,
      unit,
      specs: {
        transmission,
        cooling,
        displacementCc: numericCc,
        tirePressureFrontPsi: selectedPreset?.tirePressureFrontPsi || bike?.specs?.tirePressureFrontPsi || 29,
        tirePressureRearPsi: selectedPreset?.tirePressureRearPsi || bike?.specs?.tirePressureRearPsi || 33,
        oilViscosity:
          selectedPreset?.oilViscosity ||
          bike?.specs?.oilViscosity ||
          (isScooter ? '10W-40 JASO MB' : '10W-40 JASO MA2'),
        oilCapacityLiters:
          selectedPreset?.oilCapacityLiters ||
          bike?.specs?.oilCapacityLiters ||
          (numericCc >= 400 ? 2.4 : numericCc >= 200 ? 1.4 : 0.9),
        gearOilCapacityMl: isScooter
          ? selectedPreset?.gearOilCapacityMl || bike?.specs?.gearOilCapacityMl || 150
          : undefined,
        recommendedServiceIntervalKm:
          selectedPreset?.recommendedServiceIntervalKm ||
          bike?.specs?.recommendedServiceIntervalKm ||
          3000,
      },
    };

    onSave(updatedBike, !isEditing ? selectedPreset : undefined);
    onClose();
  };

  // Filter model presets for current brand
  const brandPresets = PHILIPPINE_MOTORCYCLE_PRESETS.filter(
    (p: PhilippineModelPreset) => p.brand.toLowerCase() === brand.toLowerCase()
  );

  const errorList = Object.values(validationErrors);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-[#FFFDF9] rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-4 px-5 flex items-center justify-between border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="MotoCare Official Logo"
              className="w-10 h-10 rounded-2xl object-contain shadow-sm shrink-0 border border-slate-100 bg-[#0B0F19]"
            />
            <div>
              <h2 className="text-base font-extrabold text-slate-900 leading-tight">
                {isEditing
                  ? 'Edit Motorcycle'
                  : isCustomMode
                  ? 'Add Custom Motorcycle'
                  : 'Register Motorcycle'}
              </h2>
              <p className="text-[11px] text-slate-500">
                {isCustomMode
                  ? 'Manual Motorcycle Registration'
                  : 'Philippine Motorcycle Maintenance'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close motorcycle modal"
            aria-label="Close motorcycle modal"
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="p-5 overflow-y-auto space-y-4 text-xs"
        >
          {/* Mode Banner: Either "Wala sa listahan ang motor mo? Idagdag ito manually." OR "Back to Preset List" */}
          {!isCustomMode ? (
            <div
              data-testid="manual-motorcycle-callout"
              className="p-3.5 rounded-2xl bg-orange-50/90 border border-orange-200 space-y-2"
            >
              <div className="flex items-center gap-2 text-slate-800 font-extrabold text-xs">
                <Wrench className="w-4 h-4 text-[#FF6B00] shrink-0" />
                <span>Wala sa listahan ang motor mo? Idagdag ito manually.</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-snug">
                Can&apos;t find your brand or model in the presets below? Register any scooter, underbone, manual, sport, or big bike manually.
              </p>
              <button
                type="button"
                data-testid="switch-to-custom-motorcycle-btn"
                onClick={handleSwitchToCustomMode}
                className="w-full py-2.5 px-3.5 rounded-xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ Add My Motorcycle Manually</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-100 border border-slate-200">
              <div className="text-[11px] font-bold text-slate-700">
                Custom Motorcycle Entry
              </div>
              <button
                type="button"
                data-testid="back-to-preset-list-btn"
                onClick={handleBackToPresetList}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-[#FF6B00] border border-slate-200 font-extrabold text-xs flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Preset List</span>
              </button>
            </div>
          )}

          {/* Validation Summary Alert */}
          {errorList.length > 0 && (
            <div
              role="alert"
              data-testid="custom-bike-validation-error"
              className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 space-y-1 animate-in fade-in"
            >
              <div className="flex items-center gap-1.5 font-extrabold text-xs text-red-900">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>Please complete all required fields:</span>
              </div>
              <ul className="list-disc list-inside text-[11px] space-y-0.5 pl-1">
                {errorList.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 1. Motorcycle Brand Field */}
          <div className="space-y-1.5">
            <label htmlFor="motorcycle-brand-input" className="font-bold text-slate-700 block">
              {isCustomMode ? 'Motorcycle Brand *' : 'Brand *'}
            </label>
            <input
              id="motorcycle-brand-input"
              data-testid="custom-bike-brand-input"
              type="text"
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                if (validationErrors.brand) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.brand;
                    return next;
                  });
                }
              }}
              placeholder={
                isCustomMode
                  ? 'e.g. KYMCO, Bristol, Rusi, MotorStar, Vespa, BMW'
                  : 'e.g. Yamaha'
              }
              required
              className={`w-full bg-white border rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00] ${
                validationErrors.brand ? 'border-red-400 bg-red-50/30' : 'border-slate-200'
              }`}
            />
            {validationErrors.brand && (
              <p className="text-[11px] font-bold text-red-600">{validationErrors.brand}</p>
            )}

            {/* Quick Brand Pills (shown in Preset Mode) */}
            {!isCustomMode && (
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
            )}
          </div>

          {/* 2. Motorcycle Model Field */}
          <div className="space-y-1.5">
            <label htmlFor="motorcycle-model-input" className="font-bold text-slate-700 block">
              {isCustomMode ? 'Motorcycle Model *' : 'Model *'}
            </label>
            <input
              id="motorcycle-model-input"
              data-testid="custom-bike-model-input"
              type="text"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                if (validationErrors.model) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.model;
                    return next;
                  });
                }
              }}
              placeholder={
                isCustomMode
                  ? 'e.g. Like 150i, Cafe 400, Classic 250, G 310 GS'
                  : 'e.g. NMAX 155'
              }
              required
              className={`w-full bg-white border rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00] ${
                validationErrors.model ? 'border-red-400 bg-red-50/30' : 'border-slate-200'
              }`}
            />
            {validationErrors.model && (
              <p className="text-[11px] font-bold text-red-600">{validationErrors.model}</p>
            )}

            {/* Quick Model Pills (shown in Preset Mode) */}
            {!isCustomMode && brandPresets.length > 0 && (
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
            )}
          </div>

          {/* 3. Engine Displacement / CC (Required) */}
          <div className="space-y-1.5">
            <label htmlFor="motorcycle-cc-input" className="font-bold text-slate-700 block">
              Engine Displacement / CC *
            </label>
            <div className="relative">
              <input
                id="motorcycle-cc-input"
                data-testid="custom-bike-cc-input"
                type="number"
                min="40"
                max="5000"
                value={displacementCc}
                onChange={(e) => {
                  setDisplacementCc(e.target.value === '' ? '' : Number(e.target.value));
                  if (validationErrors.displacementCc) {
                    setValidationErrors((prev) => {
                      const next = { ...prev };
                      delete next.displacementCc;
                      return next;
                    });
                  }
                }}
                placeholder="e.g. 150"
                required
                className={`w-full bg-white border rounded-2xl px-4 pr-12 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00] ${
                  validationErrors.displacementCc ? 'border-red-400 bg-red-50/30' : 'border-slate-200'
                }`}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                cc
              </span>
            </div>
            {validationErrors.displacementCc && (
              <p className="text-[11px] font-bold text-red-600">{validationErrors.displacementCc}</p>
            )}
          </div>

          {/* 4. Year Model & 6. Current Odometer Reading Row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="motorcycle-year-input" className="font-bold text-slate-700 block">
                Year Model *
              </label>
              <input
                id="motorcycle-year-input"
                data-testid="custom-bike-year-input"
                type="number"
                min="1950"
                max="2100"
                value={year}
                onChange={(e) => {
                  setYear(e.target.value === '' ? '' : Number(e.target.value));
                  if (validationErrors.year) {
                    setValidationErrors((prev) => {
                      const next = { ...prev };
                      delete next.year;
                      return next;
                    });
                  }
                }}
                placeholder="e.g. 2024"
                required
                className={`w-full bg-white border rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00] ${
                  validationErrors.year ? 'border-red-400 bg-red-50/30' : 'border-slate-200'
                }`}
              />
              {validationErrors.year && (
                <p className="text-[11px] font-bold text-red-600">{validationErrors.year}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="motorcycle-odometer-input" className="font-bold text-slate-700 block">
                Current Odometer *
              </label>
              <div className="relative">
                <input
                  id="motorcycle-odometer-input"
                  data-testid="custom-bike-odometer-input"
                  type="number"
                  min="0"
                  value={odometer}
                  onChange={(e) => {
                    setOdometer(e.target.value === '' ? '' : Number(e.target.value));
                    if (validationErrors.odometer) {
                      setValidationErrors((prev) => {
                        const next = { ...prev };
                        delete next.odometer;
                        return next;
                      });
                    }
                  }}
                  required
                  placeholder="e.g. 5200"
                  className={`w-full bg-white border rounded-2xl px-4 pr-10 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00] ${
                    validationErrors.odometer ? 'border-red-400 bg-red-50/30' : 'border-slate-200'
                  }`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-amber-600">
                  {unit}
                </span>
              </div>
              {validationErrors.odometer && (
                <p className="text-[11px] font-bold text-red-600">{validationErrors.odometer}</p>
              )}
            </div>
          </div>

          {/* Unit Selector */}
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

          {/* 5. Motorcycle Type (Required: Scooter, Underbone, Manual, Sport Bike, Standard, Adventure, Other) */}
          <div className="space-y-1.5">
            <label htmlFor="motorcycle-type-select" className="font-bold text-slate-700 block">
              Motorcycle Type *
            </label>
            <select
              id="motorcycle-type-select"
              data-testid="custom-bike-type-select"
              value={motorcycleType}
              onChange={(e) => {
                setMotorcycleType(e.target.value);
                if (validationErrors.motorcycleType) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.motorcycleType;
                    return next;
                  });
                }
              }}
              className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            >
              {CUSTOM_MOTORCYCLE_TYPES.map((typeOption) => (
                <option key={typeOption} value={typeOption}>
                  {typeOption}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {CUSTOM_MOTORCYCLE_TYPES.map((typeOption) => (
                <button
                  key={typeOption}
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setMotorcycleType(typeOption);
                    if (validationErrors.motorcycleType) {
                      setValidationErrors((prev) => {
                        const next = { ...prev };
                        delete next.motorcycleType;
                        return next;
                      });
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                    motorcycleType === typeOption
                      ? 'bg-[#FF6B00] text-white shadow-sm'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  {typeOption}
                </button>
              ))}
            </div>
            {validationErrors.motorcycleType && (
              <p className="text-[11px] font-bold text-red-600">{validationErrors.motorcycleType}</p>
            )}
          </div>

          {/* 7. Motorcycle Nickname (Optional) */}
          <div className="space-y-1.5">
            <label htmlFor="motorcycle-nickname-input" className="font-bold text-slate-700 block">
              Motorcycle Nickname (Optional)
            </label>
            <input
              id="motorcycle-nickname-input"
              data-testid="custom-bike-nickname-input"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Red Rocket, Daily Ride, Beast"
              className="w-full bg-white border-2 border-[#FF6B00] rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none shadow-sm"
            />
          </div>

          {/* Plate / MV File Number (Optional) */}
          <div className="space-y-1.5">
            <label htmlFor="motorcycle-plate-input" className="font-bold text-slate-700 block">
              Plate / MV File Number (Optional)
            </label>
            <input
              id="motorcycle-plate-input"
              type="text"
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value)}
              placeholder="e.g. 123ABC or 1234-567890"
              className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            />
          </div>

          {/* Badge Color Swatches & Custom HEX Code */}
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
                  aria-label={`Select badge color ${color}`}
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
              data-testid="submit-motorcycle-registration-btn"
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

