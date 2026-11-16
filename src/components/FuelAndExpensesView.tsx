import React from 'react';
import {
  Motorcycle,
  UserSubscription,
  ExpenseEntry,
  ExpenseEntryType,
} from '../types';
import {
  ALLOWED_EXPENSE_TYPES,
  getCurrentManilaDateStr,
  getCurrentManilaMonthKey,
  shiftManilaMonthKey,
  formatManilaMonthLabel,
  formatManilaDateLabel,
  validateGasOdometerForBike,
  calculateBikeFuelStats,
  fetchMonthlyExpensesPage,
  fetchBikeGasEntriesOnce,
  saveExpenseEntryToFirestore,
  deleteExpenseEntryFromFirestore,
} from '../utils/firestoreService';
import {
  Fuel,
  Plus,
  ChevronLeft,
  ChevronRight,
  Lock,
  Sparkles,
  Edit3,
  Trash2,
  X,
  Check,
  AlertCircle,
  Gauge,
  Bike,
  ArrowLeft,
  FileText,
} from 'lucide-react';
import { sounds } from '../utils/audio';
import { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';

interface FuelAndExpensesViewProps {
  userId?: string;
  motorcycles: Motorcycle[];
  activeBike: Motorcycle;
  subscription: UserSubscription;
  hasProAccess: boolean;
  onOpenPaywall: () => void;
  onUpdateBikeOdometer?: (bikeId: string, newOdometerKm: number) => void;
  onBack: () => void;
}

const EXPENSE_TYPE_COLORS: Record<ExpenseEntryType, { bar: string; badge: string }> = {
  Gas: {
    bar: 'bg-[#FF6B00]',
    badge: 'bg-orange-50 text-[#FF6B00] border-orange-200',
  },
  Maintenance: {
    bar: 'bg-[#00ACC1]',
    badge: 'bg-cyan-50 text-[#0097A7] border-cyan-200',
  },
  'Registration (LTO)': {
    bar: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  Insurance: {
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  'Parking-Toll': {
    bar: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  'Iba pa': {
    bar: 'bg-slate-500',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
  },
};

function getLastUsedExpenseBikeId(userId: string | undefined, motorcycles: Motorcycle[], fallbackId: string): string {
  if (typeof window === 'undefined') return fallbackId;
  try {
    const key = `motocare_last_expense_bike_v1_${userId || 'guest'}`;
    const saved = localStorage.getItem(key);
    if (saved && motorcycles.some((b) => b.id === saved)) {
      return saved;
    }
  } catch {
    // ignore
  }
  return fallbackId || motorcycles[0]?.id || '';
}

function saveLastUsedExpenseBikeId(userId: string | undefined, bikeId: string): void {
  if (typeof window === 'undefined' || !bikeId) return;
  try {
    const key = `motocare_last_expense_bike_v1_${userId || 'guest'}`;
    localStorage.setItem(key, bikeId);
  } catch {
    // ignore
  }
}

export const FuelAndExpensesView: React.FC<FuelAndExpensesViewProps> = ({
  userId,
  motorcycles,
  activeBike,
  subscription,
  hasProAccess,
  onOpenPaywall,
  onUpdateBikeOdometer,
  onBack,
}) => {
  const isPro = Boolean(hasProAccess);
  const isExpiredPro =
    !isPro &&
    (subscription.status === 'expired' ||
      subscription.status === 'revoked' ||
      Boolean(subscription.isExpired) ||
      Boolean(subscription.expiryDate));

  // Monthly Report State (Asia/Manila YYYY-MM)
  const [selectedMonthKey, setSelectedMonthKey] = React.useState<string>(() =>
    getCurrentManilaMonthKey()
  );
  const [bikeFilter, setBikeFilter] = React.useState<string>('all');

  // Paginated Monthly Entries (1 month at a time, limit 50)
  const [monthEntries, setMonthEntries] = React.useState<ExpenseEntry[]>([]);
  const [prevMonthEntries, setPrevMonthEntries] = React.useState<ExpenseEntry[]>([]);
  const [hasMoreEntries, setHasMoreEntries] = React.useState(false);
  const [loadingMonth, setLoadingMonth] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const lastDocCursorRef = React.useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  // Per-Bike Gas History for accurate Km/L, Cost/km, and Monotonic Odometer Check
  const [statsBikeId, setStatsBikeId] = React.useState<string>(() =>
    getLastUsedExpenseBikeId(userId, motorcycles, activeBike?.id)
  );
  const [bikeGasEntriesMap, setBikeGasEntriesMap] = React.useState<Record<string, ExpenseEntry[]>>({});

  // One-handed Add / Edit Form State
  const [isFormOpen, setIsFormOpen] = React.useState<boolean>(isPro);
  const [editingEntry, setEditingEntry] = React.useState<ExpenseEntry | null>(null);
  const [entryType, setEntryType] = React.useState<ExpenseEntryType>('Gas');
  const [formBikeId, setFormBikeId] = React.useState<string>(() =>
    getLastUsedExpenseBikeId(userId, motorcycles, activeBike?.id)
  );
  const [dateStr, setDateStr] = React.useState<string>(() => getCurrentManilaDateStr());
  const [amountPhpStr, setAmountPhpStr] = React.useState<string>('');
  const [litersStr, setLitersStr] = React.useState<string>('');
  const [odometerKmStr, setOdometerKmStr] = React.useState<string>('');
  const [isFullTank, setIsFullTank] = React.useState<boolean>(true);
  const [note, setNote] = React.useState<string>('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formSuccessMsg, setFormSuccessMsg] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState<boolean>(false);

  // Delete Confirmation State
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [isDeleting, setIsDeleting] = React.useState<boolean>(false);

  const hasAnyStoredEntries =
    monthEntries.length > 0 ||
    prevMonthEntries.length > 0 ||
    Object.values(bikeGasEntriesMap).some((list) => list && list.length > 0);

  // Load selected month + previous month comparison (only for Pro or Expired Pro users)
  const loadMonthData = React.useCallback(
    async (targetMonthKey: string) => {
      if (!userId || (!isPro && !isExpiredPro)) return;
      setLoadingMonth(true);
      setFetchError(null);
      try {
        const prevMonthKey = shiftManilaMonthKey(targetMonthKey, -1);
        const [currentRes, prevRes] = await Promise.all([
          fetchMonthlyExpensesPage({
            userId,
            monthKey: targetMonthKey,
            pageSize: 50,
            lastDoc: null,
          }),
          fetchMonthlyExpensesPage({
            userId,
            monthKey: prevMonthKey,
            pageSize: 50,
            lastDoc: null,
          }),
        ]);
        lastDocCursorRef.current = currentRes.lastDoc;
        setMonthEntries(currentRes.entries);
        setHasMoreEntries(currentRes.hasMore);
        setPrevMonthEntries(prevRes.entries);
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        setFetchError(msg);
      } finally {
        setLoadingMonth(false);
      }
    },
    [userId, isPro, isExpiredPro]
  );

  React.useEffect(() => {
    void loadMonthData(selectedMonthKey);
  }, [selectedMonthKey, loadMonthData]);

  // Load bounded Gas entries for the selected bike to power Fuel Stats & Odometer validation
  const loadBikeGasStats = React.useCallback(
    async (targetBikeId: string) => {
      if (!userId || !targetBikeId || (!isPro && !isExpiredPro)) return;
      try {
        const gasEntries = await fetchBikeGasEntriesOnce(userId, targetBikeId, 50);
        setBikeGasEntriesMap((prev) => ({
          ...prev,
          [targetBikeId]: gasEntries,
        }));
      } catch {
        // fallback to monthly entries if offline
      }
    },
    [userId, isPro, isExpiredPro]
  );

  React.useEffect(() => {
    if (statsBikeId) {
      void loadBikeGasStats(statsBikeId);
    }
  }, [statsBikeId, loadBikeGasStats]);

  React.useEffect(() => {
    if (formBikeId && formBikeId !== statsBikeId) {
      void loadBikeGasStats(formBikeId);
    }
  }, [formBikeId, statsBikeId, loadBikeGasStats]);

  const handleLoadMoreEntries = async () => {
    if (!userId || !hasMoreEntries || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchMonthlyExpensesPage({
        userId,
        monthKey: selectedMonthKey,
        pageSize: 50,
        lastDoc: lastDocCursorRef.current,
      });
      lastDocCursorRef.current = page.lastDoc;
      setMonthEntries((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const uniqueNext = page.entries.filter((e) => !existingIds.has(e.id));
        return [...prev, ...uniqueNext];
      });
      setHasMoreEntries(page.hasMore);
    } catch (err: any) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const resetForm = (keepBikeId?: string) => {
    setEditingEntry(null);
    setEntryType('Gas');
    setFormBikeId(keepBikeId || getLastUsedExpenseBikeId(userId, motorcycles, activeBike?.id));
    setDateStr(getCurrentManilaDateStr());
    setAmountPhpStr('');
    setLitersStr('');
    setOdometerKmStr('');
    setIsFullTank(true);
    setNote('');
    setFormError(null);
  };

  const handleStartEdit = (entry: ExpenseEntry) => {
    if (!isPro) return;
    sounds.playClick();
    setEditingEntry(entry);
    setEntryType(entry.type);
    setFormBikeId(entry.bikeId);
    setDateStr(entry.date);
    setAmountPhpStr(String(entry.amountPhp));
    setLitersStr(entry.liters != null ? String(entry.liters) : '');
    setOdometerKmStr(entry.odometerKm != null ? String(entry.odometerKm) : '');
    setIsFullTank(entry.isFullTank !== false);
    setNote(entry.note || '');
    setFormError(null);
    setFormSuccessMsg(null);
    setIsFormOpen(true);
  };

  const handleSubmitEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPro) {
      onOpenPaywall();
      return;
    }
    if (!userId) {
      setFormError('Mag-sign in muna para mag-save ng gastos.');
      return;
    }

    setFormError(null);
    setFormSuccessMsg(null);

    const parsedAmount = Number(amountPhpStr);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Ilagay ang halaga sa piso (₱) na mas mataas sa 0.');
      return;
    }

    if (note.trim().length > 100) {
      setFormError('Hanggang 100 characters lang ang note.');
      return;
    }

    let parsedLiters: number | null = null;
    let parsedOdometer: number | null = null;

    if (entryType === 'Gas') {
      parsedLiters = Number(litersStr);
      parsedOdometer = Number(odometerKmStr);

      if (!Number.isFinite(parsedLiters) || parsedLiters <= 0) {
        setFormError('Ilagay kung ilang litro ng gas ang naikarga (mas mataas sa 0).');
        return;
      }

      if (!Number.isFinite(parsedOdometer) || parsedOdometer <= 0) {
        setFormError('Ilagay ang odometer km ng motor.');
        return;
      }

      // Combine known gas entries for this bike to validate monotonic odometer increase
      const knownBikeGasEntries = [
        ...(bikeGasEntriesMap[formBikeId] || []),
        ...monthEntries.filter((x) => x.bikeId === formBikeId && x.type === 'Gas'),
      ];
      const uniqueGasMap = new Map<string, ExpenseEntry>();
      knownBikeGasEntries.forEach((item) => uniqueGasMap.set(item.id, item));

      const odoCheck = validateGasOdometerForBike(
        Array.from(uniqueGasMap.values()),
        formBikeId,
        parsedOdometer,
        editingEntry?.id
      );

      if (!odoCheck.valid) {
        setFormError(
          odoCheck.error ||
            'Kailangang mas mataas ang odometer kaysa sa nakaraang entry para sa motor na ito.'
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      const saved = await saveExpenseEntryToFirestore({
        id: editingEntry?.id,
        userId,
        bikeId: formBikeId,
        type: entryType,
        date: dateStr,
        amountPhp: parsedAmount,
        liters: entryType === 'Gas' ? parsedLiters : null,
        odometerKm: entryType === 'Gas' ? parsedOdometer : null,
        isFullTank: entryType === 'Gas' ? isFullTank : null,
        note: note.trim(),
        createdAt: editingEntry?.createdAt,
      });

      saveLastUsedExpenseBikeId(userId, formBikeId);
      setStatsBikeId(formBikeId);

      // Update local monthly state if it belongs to the active month or previous month
      if (saved.monthKey === selectedMonthKey) {
        setMonthEntries((prev) => {
          const filtered = prev.filter((item) => item.id !== saved.id);
          const next = [saved, ...filtered];
          next.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          return next;
        });
      } else {
        // Switch month view to the saved entry's month so the user sees it immediately
        setSelectedMonthKey(saved.monthKey);
      }

      if (saved.type === 'Gas') {
        setBikeGasEntriesMap((prev) => {
          const list = (prev[formBikeId] || []).filter((item) => item.id !== saved.id);
          const next = [...list, saved].sort(
            (a, b) => (Number(a.odometerKm) || 0) - (Number(b.odometerKm) || 0)
          );
          return { ...prev, [formBikeId]: next };
        });

        const targetBike = motorcycles.find((b) => b.id === formBikeId);
        if (
          targetBike &&
          parsedOdometer &&
          parsedOdometer > targetBike.odometer &&
          onUpdateBikeOdometer
        ) {
          onUpdateBikeOdometer(formBikeId, parsedOdometer);
        }
      }

      sounds.playSuccess();
      setFormSuccessMsg(
        editingEntry ? 'Na-update na ang entry!' : 'Na-save na ang bagong gastos!'
      );
      resetForm(formBikeId);
    } catch (err: any) {
      setFormError(err instanceof Error ? err.message : 'Hindi na-save ang entry. Subukan ulit.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async (entry: ExpenseEntry) => {
    setIsDeleting(true);
    try {
      await deleteExpenseEntryFromFirestore(entry.id);
      setMonthEntries((prev) => prev.filter((item) => item.id !== entry.id));
      if (entry.type === 'Gas') {
        setBikeGasEntriesMap((prev) => ({
          ...prev,
          [entry.bikeId]: (prev[entry.bikeId] || []).filter((item) => item.id !== entry.id),
        }));
      }
      setConfirmDeleteId(null);
      sounds.playClick();
    } catch (err: any) {
      setFetchError(err instanceof Error ? err.message : 'Hindi nabura ang entry.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered entries for the Monthly Expense Report
  const filteredMonthEntries = React.useMemo(() => {
    if (bikeFilter === 'all') return monthEntries;
    return monthEntries.filter((e) => e.bikeId === bikeFilter);
  }, [monthEntries, bikeFilter]);

  const filteredPrevMonthEntries = React.useMemo(() => {
    if (bikeFilter === 'all') return prevMonthEntries;
    return prevMonthEntries.filter((e) => e.bikeId === bikeFilter);
  }, [prevMonthEntries, bikeFilter]);

  const totalSpentThisMonth = React.useMemo(
    () => filteredMonthEntries.reduce((sum, e) => sum + (Number(e.amountPhp) || 0), 0),
    [filteredMonthEntries]
  );

  const totalSpentPrevMonth = React.useMemo(
    () => filteredPrevMonthEntries.reduce((sum, e) => sum + (Number(e.amountPhp) || 0), 0),
    [filteredPrevMonthEntries]
  );

  const monthDiffPhp = totalSpentThisMonth - totalSpentPrevMonth;

  const breakdownByType = React.useMemo(() => {
    const totals: Record<ExpenseEntryType, number> = {
      Gas: 0,
      Maintenance: 0,
      'Registration (LTO)': 0,
      Insurance: 0,
      'Parking-Toll': 0,
      'Iba pa': 0,
    };
    for (const entry of filteredMonthEntries) {
      if (totals[entry.type] !== undefined) {
        totals[entry.type] += Number(entry.amountPhp) || 0;
      }
    }
    return ALLOWED_EXPENSE_TYPES.map((type) => {
      const amount = totals[type] || 0;
      const percent = totalSpentThisMonth > 0 ? (amount / totalSpentThisMonth) * 100 : 0;
      return { type, amount, percent };
    });
  }, [filteredMonthEntries, totalSpentThisMonth]);

  // Per-Bike Fuel Stats calculation
  const currentBikeForStats =
    motorcycles.find((b) => b.id === statsBikeId) || activeBike || motorcycles[0];

  const mergedBikeGasEntries = React.useMemo(() => {
    if (!currentBikeForStats) return [];
    const map = new Map<string, ExpenseEntry>();
    for (const item of bikeGasEntriesMap[currentBikeForStats.id] || []) {
      map.set(item.id, item);
    }
    for (const item of monthEntries) {
      if (item.bikeId === currentBikeForStats.id && item.type === 'Gas') {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }, [bikeGasEntriesMap, monthEntries, currentBikeForStats]);

  const fuelStats = React.useMemo(
    () =>
      currentBikeForStats
        ? calculateBikeFuelStats(mergedBikeGasEntries, currentBikeForStats.id)
        : null,
    [mergedBikeGasEntries, currentBikeForStats]
  );

  const getBikeLabel = (bikeId: string): string => {
    const found = motorcycles.find((b) => b.id === bikeId);
    if (!found) return 'Motor';
    return found.nickname
      ? `${found.nickname} (${found.model})`
      : `${found.brand} ${found.model}`;
  };

  // 4. PRO GATING: Free users (without expired Pro data) see the locked screen
  if (!isPro && !isExpiredPro && !hasAnyStoredEntries) {
    return (
      <div className="space-y-5" data-testid="fuel-expenses-locked-screen">
        <div className="flex items-center justify-between pb-1 border-b border-slate-100">
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              onBack();
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-[#FF6B00] transition-colors py-1.5 px-3 rounded-xl bg-white border border-slate-200 hover:border-[#FF6B00] shadow-2xs cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-[#FF6B00]" />
            <span>Balik sa Schedule</span>
          </button>
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
            Fuel &amp; Gastos (PRO)
          </span>
        </div>

        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-orange-200/80 shadow-md text-center space-y-5 relative overflow-hidden">
          <div className="w-14 h-14 rounded-2xl bg-orange-50 border border-orange-200 flex items-center justify-center mx-auto text-[#FF6B00]">
            <Lock className="w-7 h-7" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-900 text-amber-400 text-[10px] font-black uppercase tracking-wider font-mono">
              <Sparkles className="w-3 h-3" />
              <span>MOTOCARE PRO FEATURE</span>
            </span>
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-snug">
              Gusto mong makita kung saan napupunta ang gas money mo? Pro ito.
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              I-track ang bawat karga ng gas (km/L at gastos kada km), maintenance, LTO registration,
              insurance, at buwanang gastos ng motor mo sa isang tap lang.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 max-w-sm mx-auto text-left">
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/70">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Km per Liter</div>
              <div className="text-sm font-extrabold font-mono text-slate-800 mt-0.5">
                42.5 km/L
              </div>
              <div className="text-[10px] text-slate-500">Full-tank accuracy</div>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/70">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Gastos / KM</div>
              <div className="text-sm font-extrabold font-mono text-[#FF6B00] mt-0.5">
                ₱1.48 / km
              </div>
              <div className="text-[10px] text-slate-500">Tunay na konsumo</div>
            </div>
          </div>

          <div className="pt-1 space-y-2.5">
            <button
              type="button"
              data-testid="mag-pro-na-btn"
              onClick={() => {
                sounds.playClick();
                onOpenPaywall();
              }}
              className="w-full sm:w-auto min-w-[220px] py-3.5 px-6 rounded-2xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-extrabold text-sm shadow-md shadow-[#FF6B00]/25 transition-all active:scale-95 cursor-pointer"
            >
              Mag-Pro na
            </button>
            <p className="text-xs font-bold text-slate-500">
              ₱1.63 kada araw lang. Kanselahin kahit kailan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="fuel-expenses-view">
      {/* Top Navigation */}
      <div className="flex items-center justify-between pb-1 border-b border-slate-100">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            onBack();
          }}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-[#FF6B00] transition-colors py-1.5 px-3 rounded-xl bg-white border border-slate-200 hover:border-[#FF6B00] shadow-2xs cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-[#FF6B00]" />
          <span>Balik sa Schedule</span>
        </button>

        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
          Fuel Log &amp; Gastos
        </span>
      </div>

      {/* Expired Pro Read-Only Banner (Data is preserved, adding & editing blocked until renewal) */}
      {!isPro && (
        <div
          data-testid="expired-pro-readonly-banner"
          className="p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-amber-300 shadow-xs space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 text-[#FF6B00] flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-1 flex-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-amber-800 font-mono">
                READ-ONLY MODE • EXPIRED PRO
              </div>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                Gusto mong makita kung saan napupunta ang gas money mo? Pro ito.
              </h3>
              <p className="text-xs text-slate-700 leading-relaxed">
                Ligtas at naka-save pa rin ang lahat ng dati mong Fuel Log at Monthly Expense data
                (Read-Only). Mag-renew para makapagdagdag o makapag-edit ulit ng entries.
              </p>
              <p className="text-xs font-bold text-amber-900">
                ₱1.63 kada araw lang. Kanselahin kahit kailan.
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="expired-mag-pro-na-btn"
            onClick={() => {
              sounds.playClick();
              onOpenPaywall();
            }}
            className="w-full py-3 px-5 rounded-xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-extrabold text-xs shadow-sm transition-all cursor-pointer"
          >
            Mag-Pro na
          </button>
        </div>
      )}

      {/* Header & Quick Toggle Form Button */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Fuel className="w-5 h-5 text-[#FF6B00]" />
            <span>Fuel Log &amp; Gastos</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            I-monitor ang konsumo sa gas (km/L) at buwanang gastos sa motor
          </p>
        </div>

        {isPro && (
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              if (editingEntry) {
                resetForm(formBikeId);
              }
              setIsFormOpen((v) => !v);
            }}
            className="px-4 py-2.5 rounded-2xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-extrabold text-xs flex items-center gap-1.5 shadow-sm shadow-[#FF6B00]/20 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{isFormOpen ? 'Itago ang Form' : 'Mag-lista ng Gastos'}</span>
          </button>
        )}
      </div>

      {/* 1. ADD / EDIT ENTRY FORM (One-Handed Mobile Friendly, Pro Only) */}
      {isPro && isFormOpen && (
        <form
          onSubmit={handleSubmitEntry}
          data-testid="expense-entry-form"
          className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-900">
              {editingEntry ? 'I-edit ang Gastos Entry' : 'Magdagdag ng Gastos / Karga ng Gas'}
            </h3>
            {editingEntry && (
              <button
                type="button"
                onClick={() => resetForm(formBikeId)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>Kanselahin ang Edit</span>
              </button>
            )}
          </div>

          {/* Type Selector (Big Touch Targets for One-Handed Use) */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
              Uri ng Gastos (Type)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALLOWED_EXPENSE_TYPES.map((typeOption) => {
                const selected = entryType === typeOption;
                return (
                  <button
                    key={typeOption}
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      setEntryType(typeOption);
                      setFormError(null);
                    }}
                    className={`py-3 px-3 rounded-2xl text-xs font-extrabold border text-left transition-all flex items-center justify-between cursor-pointer ${
                      selected
                        ? 'bg-[#FF6B00] text-white border-[#FF6B00] shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="truncate">{typeOption}</span>
                    {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Motorcycle & Date Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="expense-bike-select"
                className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1"
              >
                Motor (Motorcycle)
              </label>
              <select
                id="expense-bike-select"
                value={formBikeId}
                onChange={(e) => {
                  setFormBikeId(e.target.value);
                  saveLastUsedExpenseBikeId(userId, e.target.value);
                }}
                className="w-full h-12 px-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-[#FF6B00]"
              >
                {motorcycles.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nickname ? `${b.nickname} — ` : ''}
                    {b.year} {b.brand} {b.model}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="expense-date-input"
                className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1"
              >
                Petsa (Manila Time)
              </label>
              <input
                id="expense-date-input"
                type="date"
                required
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full h-12 px-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-bold font-mono text-slate-900 focus:outline-none focus:border-[#FF6B00]"
              />
            </div>
          </div>

          {/* Amount in Pesos */}
          <div>
            <label
              htmlFor="expense-amount-input"
              className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1"
            >
              Halaga sa Piso (₱) *
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-extrabold text-slate-400 font-mono">
                ₱
              </span>
              <input
                id="expense-amount-input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                placeholder="hal. 250"
                value={amountPhpStr}
                onChange={(e) => setAmountPhpStr(e.target.value)}
                className="w-full h-13 pl-9 pr-4 rounded-2xl bg-slate-50 border border-slate-200 text-lg font-extrabold font-mono text-slate-900 focus:outline-none focus:border-[#FF6B00]"
              />
            </div>
          </div>

          {/* Gas-Only Fields: Liters, Odometer KM, and Full Tank Toggle */}
          {entryType === 'Gas' && (
            <div className="p-3.5 rounded-2xl bg-orange-50/60 border border-orange-200/80 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="expense-liters-input"
                    className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1"
                  >
                    Liters na Naikarga (L) *
                  </label>
                  <input
                    id="expense-liters-input"
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0.01"
                    required
                    placeholder="hal. 4.15"
                    value={litersStr}
                    onChange={(e) => setLitersStr(e.target.value)}
                    className="w-full h-12 px-3.5 rounded-2xl bg-white border border-slate-200 text-base font-extrabold font-mono text-slate-900 focus:outline-none focus:border-[#FF6B00]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="expense-odo-input"
                    className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1"
                  >
                    Odometer Reading (km) *
                  </label>
                  <input
                    id="expense-odo-input"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="1"
                    required
                    placeholder={`hal. ${(motorcycles.find((b) => b.id === formBikeId)?.odometer || 1000) + 120}`}
                    value={odometerKmStr}
                    onChange={(e) => setOdometerKmStr(e.target.value)}
                    className="w-full h-12 px-3.5 rounded-2xl bg-white border border-slate-200 text-base font-extrabold font-mono text-slate-900 focus:outline-none focus:border-[#FF6B00]"
                  />
                </div>
              </div>

              {/* Full Tank Toggle (Default ON) */}
              <button
                type="button"
                role="switch"
                aria-checked={isFullTank}
                onClick={() => setIsFullTank((v) => !v)}
                className="w-full p-3 rounded-2xl bg-white border border-slate-200 flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="text-left">
                  <div className="text-xs font-extrabold text-slate-900">
                    Full tank ba ang karga?
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Kailangan naka-Full tank para maisama sa eksaktong km/L calculation
                  </div>
                </div>
                <div
                  className={`w-13 h-7 rounded-full p-1 transition-colors flex items-center ${
                    isFullTank ? 'bg-[#FF6B00] justify-end' : 'bg-slate-300 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
                </div>
              </button>
            </div>
          )}

          {/* Optional Short Note (Max 100 chars) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="expense-note-input"
                className="text-[11px] font-bold text-slate-600 uppercase tracking-wider"
              >
                Maikling Note (Opsyonal)
              </label>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                {note.length}/100
              </span>
            </div>
            <input
              id="expense-note-input"
              type="text"
              maxLength={100}
              placeholder="hal. Shell V-Power, change oil, o parking sa BGC"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 100))}
              className="w-full h-12 px-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            />
          </div>

          {formError && (
            <div
              role="alert"
              className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{formError}</span>
            </div>
          )}

          {formSuccessMsg && (
            <div
              role="status"
              className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2"
            >
              <Check className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{formSuccessMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full h-13 rounded-2xl bg-[#FF6B00] hover:bg-[#EA580C] disabled:opacity-60 text-white font-extrabold text-sm shadow-md shadow-[#FF6B00]/25 transition-all active:scale-98 cursor-pointer"
          >
            {isSaving
              ? 'Sine-save...'
              : editingEntry
              ? 'I-save ang Pagbabago'
              : 'I-save ang Gastos'}
          </button>
        </form>
      )}

      {/* 2. FUEL STATS (PER BIKE) */}
      <div
        data-testid="fuel-stats-card"
        className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200/80 shadow-sm space-y-3.5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#FF6B00]" />
            <h3 className="text-sm font-extrabold text-slate-900">
              Fuel Stats (Kada Motor)
            </h3>
          </div>

          {motorcycles.length > 1 && (
            <select
              aria-label="Pumili ng motor para sa Fuel Stats"
              value={currentBikeForStats?.id || ''}
              onChange={(e) => setStatsBikeId(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            >
              {motorcycles.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nickname ? `${b.nickname} (${b.model})` : `${b.brand} ${b.model}`}
                </option>
              ))}
            </select>
          )}
        </div>

        {fuelStats && fuelStats.hasEnoughData && fuelStats.kmPerLiter !== null && fuelStats.costPerKmPhp !== null ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                Km per Liter
              </div>
              <div
                data-testid="fuel-km-per-liter"
                className="text-xl font-extrabold font-mono text-slate-900 mt-0.5"
              >
                {fuelStats.kmPerLiter.toFixed(1)} km/L
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Mula sa {fuelStats.fullTankCount} Full-tank fill-ups ({fuelStats.totalDistanceKm.toLocaleString()} km)
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-orange-50/60 border border-orange-100">
              <div className="text-[10px] font-bold text-[#FF6B00] uppercase tracking-wide">
                Gastos kada Kilometro
              </div>
              <div
                data-testid="fuel-cost-per-km"
                className="text-xl font-extrabold font-mono text-[#FF6B00] mt-0.5"
              >
                ₱{fuelStats.costPerKmPhp.toFixed(2)} / km
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                ₱{fuelStats.totalFuelSpendPhp.toLocaleString()} gas sa {fuelStats.totalDistanceKm.toLocaleString()} km
              </div>
            </div>
          </div>
        ) : (
          <div
            data-testid="fuel-not-enough-data"
            className="p-4 rounded-2xl bg-slate-50 border border-slate-200/70 text-center space-y-1"
          >
            <div className="text-sm font-extrabold text-slate-800">Kulang pa ang data</div>
            <p className="text-xs text-slate-500">
              Mag-log ng kahit <strong>2 magkasunod na Full tank</strong> gas entries na may odometer
              para makwenta ang eksaktong <strong>Km per liter</strong> at{' '}
              <strong>Gastos kada kilometro</strong>.
            </p>
          </div>
        )}

        {fuelStats?.skippedReasonText && (
          <div
            data-testid="fuel-skipped-explanation"
            className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-[11px] font-semibold text-amber-900 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>{fuelStats.skippedReasonText}</span>
          </div>
        )}
      </div>

      {/* 3. MONTHLY EXPENSE REPORT */}
      <div
        data-testid="monthly-expense-report"
        className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200/80 shadow-sm space-y-4"
      >
        {/* Month Selector & Bike Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center justify-between sm:justify-start gap-2">
            <button
              type="button"
              aria-label="Nakaraang buwan"
              onClick={() => {
                sounds.playClick();
                setSelectedMonthKey((prev) => shiftManilaMonthKey(prev, -1));
              }}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="px-3 text-center">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                BUWANANG ULAT (MANILA TIME)
              </div>
              <div
                data-testid="selected-month-label"
                className="text-sm font-extrabold text-slate-900"
              >
                {formatManilaMonthLabel(selectedMonthKey)}
              </div>
            </div>

            <button
              type="button"
              aria-label="Susunod na buwan"
              onClick={() => {
                sounds.playClick();
                setSelectedMonthKey((prev) => shiftManilaMonthKey(prev, 1));
              }}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Filter by One Bike or All Bikes */}
          <div className="flex items-center gap-2">
            <Bike className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              aria-label="I-filter ayon sa motor"
              value={bikeFilter}
              onChange={(e) => setBikeFilter(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 focus:outline-none focus:border-[#FF6B00]"
            >
              <option value="all">Lahat ng Motor ({motorcycles.length})</option>
              {motorcycles.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nickname ? `${b.nickname} (${b.model})` : `${b.brand} ${b.model}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Total Spent & Comparison to Last Month */}
        <div className="p-4 rounded-2xl bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Kabuuang Gastos ngayong {formatManilaMonthLabel(selectedMonthKey)}
            </div>
            <div
              data-testid="monthly-total-spent"
              className="text-2xl sm:text-3xl font-extrabold font-mono text-white mt-0.5"
            >
              ₱{totalSpentThisMonth.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div
            data-testid="month-over-month-comparison"
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border self-start sm:self-center ${
              monthDiffPhp > 0
                ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                : monthDiffPhp < 0
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            {monthDiffPhp > 0
              ? `Mas mataas ng ₱${Math.abs(monthDiffPhp).toLocaleString('en-PH', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })} kaysa nakaraang buwan`
              : monthDiffPhp < 0
              ? `Mas mababa ng ₱${Math.abs(monthDiffPhp).toLocaleString('en-PH', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })} kaysa nakaraang buwan`
              : 'Mas mababa ng ₱0 kaysa nakaraang buwan'}
          </div>
        </div>

        {/* Breakdown by Type (Simple Horizontal Bars) */}
        <div className="space-y-2.5 pt-1">
          <div className="text-xs font-extrabold text-slate-800">
            Breakdown ayon sa Uri ng Gastos
          </div>
          <div className="space-y-2">
            {breakdownByType.map(({ type, amount, percent }) => (
              <div key={type} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">{type}</span>
                  <span className="font-mono font-bold text-slate-900">
                    ₱{amount.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}{' '}
                    <span className="text-slate-400 font-normal">({Math.round(percent)}%)</span>
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${EXPENSE_TYPE_COLORS[type].bar}`}
                    style={{ width: `${Math.max(amount > 0 ? 4 : 0, Math.min(100, percent))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {fetchError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700">
            {fetchError}
          </div>
        )}

        {/* List of Entries for the Selected Month */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
              Listahan ng Gastos ({filteredMonthEntries.length})
            </h4>
          </div>

          {loadingMonth ? (
            <div className="p-6 text-center text-xs font-bold text-slate-400">
              Niloload ang buwanang gastos...
            </div>
          ) : filteredMonthEntries.length === 0 ? (
            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-1.5">
              <FileText className="w-6 h-6 text-slate-300 mx-auto" />
              <div className="text-xs font-bold text-slate-700">
                Walang naka-log na gastos para sa buwang ito.
              </div>
              <p className="text-[11px] text-slate-500">
                Gamitin ang form sa itaas para mag-record ng gas, maintenance, o LTO gastos.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMonthEntries.map((entry) => (
                <div
                  key={entry.id}
                  data-testid={`expense-entry-row-${entry.id}`}
                  className="p-3.5 rounded-2xl bg-slate-50/80 border border-slate-200/80 flex items-start justify-between gap-3"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${
                          EXPENSE_TYPE_COLORS[entry.type]?.badge ||
                          'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {entry.type}
                      </span>
                      <span className="text-[11px] font-bold font-mono text-slate-500">
                        {formatManilaDateLabel(entry.date)}
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="text-[11px] font-bold text-slate-700 truncate">
                        {getBikeLabel(entry.bikeId)}
                      </span>
                    </div>

                    {entry.type === 'Gas' && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-600">
                        {entry.liters != null && <span>{entry.liters} L</span>}
                        {entry.odometerKm != null && (
                          <>
                            <span>•</span>
                            <span>{Number(entry.odometerKm).toLocaleString()} km</span>
                          </>
                        )}
                        <span>•</span>
                        <span
                          className={
                            entry.isFullTank
                              ? 'text-emerald-700 font-bold'
                              : 'text-amber-700 font-semibold'
                          }
                        >
                          {entry.isFullTank ? 'Full tank' : 'Partial fill'}
                        </span>
                      </div>
                    )}

                    {entry.note && (
                      <p className="text-xs text-slate-600 break-words">{entry.note}</p>
                    )}
                  </div>

                  <div className="text-right shrink-0 space-y-1.5">
                    <div className="text-sm font-extrabold font-mono text-slate-900">
                      ₱{Number(entry.amountPhp).toLocaleString('en-PH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>

                    {confirmDeleteId === entry.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-[10px] font-bold text-red-600">Burahin?</span>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => void handleConfirmDelete(entry)}
                          className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-extrabold cursor-pointer"
                        >
                          Oo
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label="Kanselahin ang pagbura"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        {isPro && (
                          <button
                            type="button"
                            onClick={() => handleStartEdit(entry)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[#FF6B00] hover:bg-white transition-colors cursor-pointer"
                            title="I-edit ang entry"
                            aria-label="I-edit ang entry"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(entry.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-white transition-colors cursor-pointer"
                          title="Burahin ang entry"
                          aria-label="Burahin ang entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Spark-Plan Pagination: Load More Button */}
          {hasMoreEntries && (
            <div className="pt-2 text-center">
              <button
                type="button"
                data-testid="expenses-load-more-btn"
                disabled={loadingMore}
                onClick={() => void handleLoadMoreEntries()}
                className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                {loadingMore ? 'Niloload pa...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
