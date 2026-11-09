import React from 'react';
import {
  LegacyMigrationDryRun,
  SyncConflictItem,
  Motorcycle,
} from '../types';
import {
  ShieldCheck,
  Download,
  AlertTriangle,
  Bike,
  Wrench,
  Clock,
  CheckCircle2,
  GitCompare,
  X,
} from 'lucide-react';
import { downloadPreMigrationBackupJson } from '../utils/storage';

export interface ConflictFieldDiffRow {
  fieldKey: string;
  label: string;
  cloudValue: string;
  localValue: string;
  isDifferent: boolean;
  deltaLabel?: string;
}

function formatConflictTimestamp(iso?: string, fallback: string = 'Unscoped Legacy'): string {
  if (!iso) return fallback;
  return iso.slice(0, 16).replace('T', ' ');
}

export function buildConflictFieldDiffs(
  localBike: Motorcycle,
  cloudBike: Motorcycle
): ConflictFieldDiffRow[] {
  const odoDiff = (localBike.odometer || 0) - (cloudBike.odometer || 0);
  const odoDeltaLabel =
    odoDiff === 0
      ? undefined
      : odoDiff > 0
      ? `+${odoDiff.toLocaleString()} km local`
      : `${odoDiff.toLocaleString()} km local`;

  const cloudModel = `${cloudBike.brand || ''} ${cloudBike.model || ''}`.trim();
  const localModel = `${localBike.brand || ''} ${localBike.model || ''}`.trim();

  const cloudNick = (cloudBike.nickname || '').trim() || '—';
  const localNick = (localBike.nickname || '').trim() || '—';

  const cloudPlate = (cloudBike.licensePlate || '').trim() || 'Unregistered';
  const localPlate = (localBike.licensePlate || '').trim() || 'Unregistered';

  const cloudUpdated = formatConflictTimestamp(cloudBike.updatedAt, 'Server Canonical');
  const localUpdated = formatConflictTimestamp(localBike.updatedAt, 'Unscoped Legacy');

  const cloudSource = cloudBike.timestampSource || 'server';
  const localSource = localBike.timestampSource || (localBike.updatedAt ? 'local_cached' : 'unscoped_legacy');

  return [
    {
      fieldKey: 'odometer',
      label: 'Odometer',
      cloudValue: `${(cloudBike.odometer || 0).toLocaleString()} km`,
      localValue: `${(localBike.odometer || 0).toLocaleString()} km`,
      isDifferent: (localBike.odometer || 0) !== (cloudBike.odometer || 0),
      deltaLabel: odoDeltaLabel,
    },
    {
      fieldKey: 'brandModel',
      label: 'Brand & Model',
      cloudValue: cloudModel || '—',
      localValue: localModel || '—',
      isDifferent: cloudModel.toLowerCase() !== localModel.toLowerCase(),
    },
    {
      fieldKey: 'year',
      label: 'Year',
      cloudValue: String(cloudBike.year || '—'),
      localValue: String(localBike.year || '—'),
      isDifferent: cloudBike.year !== localBike.year,
    },
    {
      fieldKey: 'nickname',
      label: 'Nickname',
      cloudValue: cloudNick,
      localValue: localNick,
      isDifferent: cloudNick.toLowerCase() !== localNick.toLowerCase(),
    },
    {
      fieldKey: 'licensePlate',
      label: 'License Plate',
      cloudValue: cloudPlate,
      localValue: localPlate,
      isDifferent: cloudPlate.toLowerCase() !== localPlate.toLowerCase(),
    },
    {
      fieldKey: 'updatedAt',
      label: 'Last Updated',
      cloudValue: cloudUpdated,
      localValue: localUpdated,
      isDifferent: cloudUpdated !== localUpdated,
    },
    {
      fieldKey: 'timestampSource',
      label: 'Timestamp Source',
      cloudValue: cloudSource,
      localValue: localSource,
      isDifferent: cloudSource !== localSource,
    },
  ];
}

interface ConflictFieldDiffCardProps {
  conflict: SyncConflictItem;
  showDiffsOnly: boolean;
  onResolveConflict?: (conflictId: string, resolution: 'keep_cloud' | 'use_local') => Promise<void>;
}

const ConflictFieldDiffCard: React.FC<ConflictFieldDiffCardProps> = ({
  conflict,
  showDiffsOnly,
  onResolveConflict,
}) => {
  const localBike = conflict.localRecord as Motorcycle;
  const cloudBike = conflict.cloudRecord as Motorcycle;
  const rows = buildConflictFieldDiffs(localBike, cloudBike);
  const diffCount = rows.filter((r) => r.isDifferent).length;
  const visibleRows = showDiffsOnly ? rows.filter((r) => r.isDifferent) : rows;

  const reasonLabel =
    conflict.reason === 'ambiguous_odometer'
      ? 'Ambiguous Odometer vs Timestamp'
      : conflict.reason === 'divergent_timestamps'
      ? 'Divergent Timestamps'
      : 'Concurrent Record Edit';

  return (
    <div
      data-testid={`conflict-diff-card-${conflict.id}`}
      className="rounded-2xl border border-amber-300 bg-white overflow-hidden shadow-sm"
    >
      {/* Card Header */}
      <div className="px-3.5 py-2.5 bg-amber-50/90 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
            <GitCompare className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>
              {cloudBike.year} {cloudBike.brand} {cloudBike.model} (
              {cloudBike.nickname || cloudBike.licensePlate || cloudBike.id})
            </span>
          </div>
          <div className="text-[10px] text-amber-800 font-medium mt-0.5">
            Reason: <strong>{reasonLabel}</strong> • Document ID: <code className="font-mono">{conflict.targetId}</code>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-950 font-mono font-bold text-[10px] uppercase">
          {diffCount} {diffCount === 1 ? 'Field Differs' : 'Fields Differ'}
        </span>
      </div>

      {/* Side-by-Side Diff Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-600">
              <th className="py-2 px-3 w-[26%]">Field</th>
              <th className="py-2 px-3 w-[37%] text-emerald-800 bg-emerald-50/60 border-l border-slate-200">
                Cloud Record (Protected)
              </th>
              <th className="py-2 px-3 w-[37%] text-amber-800 bg-amber-50/60 border-l border-slate-200">
                Local Device Record
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((row) => (
              <tr
                key={row.fieldKey}
                data-testid={`diff-row-${row.fieldKey}`}
                className={row.isDifferent ? 'bg-amber-50/35' : 'bg-white text-slate-500'}
              >
                <td className="py-2 px-3 font-bold text-slate-700 align-top">
                  <div className="flex items-center justify-between gap-1">
                    <span>{row.label}</span>
                    {row.isDifferent ? (
                      <span className="px-1.5 py-0.2 rounded bg-amber-200 text-amber-950 font-mono text-[9px] font-black uppercase">
                        DIFF
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono text-slate-400 uppercase">MATCH</span>
                    )}
                  </div>
                </td>
                <td
                  className={`py-2 px-3 font-mono border-l border-slate-100 align-top ${
                    row.isDifferent
                      ? 'bg-emerald-50/50 text-emerald-950 font-bold'
                      : 'text-slate-600'
                  }`}
                >
                  {row.cloudValue}
                </td>
                <td
                  className={`py-2 px-3 font-mono border-l border-slate-100 align-top ${
                    row.isDifferent
                      ? 'bg-amber-100/50 text-amber-950 font-bold'
                      : 'text-slate-600'
                  }`}
                >
                  <div>{row.localValue}</div>
                  {row.deltaLabel && (
                    <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-amber-200/80 text-amber-900 text-[9px] font-bold">
                      {row.deltaLabel}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Resolution Action Bar */}
      {onResolveConflict && (
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => onResolveConflict(conflict.id, 'keep_cloud')}
            className="flex-1 py-2 px-3 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Keep Cloud ({cloudBike.odometer.toLocaleString()} km)
          </button>
          <button
            type="button"
            onClick={() => onResolveConflict(conflict.id, 'use_local')}
            className="flex-1 py-2 px-3 rounded-xl bg-white border border-slate-300 text-slate-800 font-bold text-xs hover:bg-amber-50 hover:border-amber-400 transition-colors cursor-pointer"
          >
            Use Local ({localBike.odometer.toLocaleString()} km)
          </button>
        </div>
      )}
    </div>
  );
};

interface LegacyMigrationModalProps {
  isOpen: boolean;
  dryRun: LegacyMigrationDryRun | null;
  activeConflicts?: SyncConflictItem[];
  isSyncing: boolean;
  onConfirmMigrate: (selectedBikeIds?: string[]) => Promise<void>;
  onSkipMigration: () => void;
  onResolveConflict?: (conflictId: string, resolution: 'keep_cloud' | 'use_local') => Promise<void>;
  onClose?: () => void;
}

export const LegacyMigrationModal: React.FC<LegacyMigrationModalProps> = ({
  isOpen,
  dryRun,
  activeConflicts = [],
  isSyncing,
  onConfirmMigrate,
  onSkipMigration,
  onResolveConflict,
  onClose,
}) => {
  const [ownershipConfirmed, setOwnershipConfirmed] = React.useState(false);
  const [selectedBikeId, setSelectedBikeId] = React.useState<string>('');
  const [showDiffsOnly, setShowDiffsOnly] = React.useState<boolean>(false);

  React.useEffect(() => {
    setOwnershipConfirmed(false);
    if (dryRun && dryRun.eligibleMotorcycles.length > 0) {
      setSelectedBikeId(dryRun.eligibleMotorcycles[0].id);
    }
  }, [dryRun]);

  if (!isOpen || (!dryRun && activeConflicts.length === 0)) return null;

  const conflictsToShow =
    activeConflicts.length > 0 ? activeConflicts : dryRun?.conflictsDetected || [];

  // Conflict-only review mode if no dryRun pending
  if (!dryRun && conflictsToShow.length > 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
        <div className="w-full max-w-2xl bg-white rounded-3xl p-6 space-y-4 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Sync Conflict Review — Side-by-Side Field Diff
                </h3>
                <p className="text-xs text-slate-500">
                  Compare every field between the protected Cloud record and your Local device record before choosing which version to keep.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowDiffsOnly((prev) => !prev)}
                className={`px-2.5 py-1 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer ${
                  showDiffsOnly
                    ? 'bg-amber-100 border-amber-300 text-amber-900'
                    : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {showDiffsOnly ? 'Showing Changes Only' : 'Show All Fields'}
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {conflictsToShow.map((conflict) => (
              <ConflictFieldDiffCard
                key={conflict.id}
                conflict={conflict}
                showDiffsOnly={showDiffsOnly}
                onResolveConflict={onResolveConflict}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!dryRun) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-white rounded-3xl p-6 space-y-4 shadow-2xl border border-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-orange-50 text-[#FF6B00] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Local Garage Cloud Migration Preview
              </h3>
              <p className="text-xs text-slate-500">
                Existing local records were found on this browser. Review and confirm ownership before syncing to <strong className="text-slate-800">{dryRun.userEmail}</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Immutable Backup Banner & Download Action */}
        <div className="p-3 rounded-2xl bg-emerald-50/80 border border-emerald-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              <strong>Immutable Local Backup Created.</strong> Original browser keys are preserved untouched.
            </span>
          </div>
          <button
            type="button"
            onClick={() => downloadPreMigrationBackupJson(dryRun.userId, dryRun.userEmail)}
            className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[11px] flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Backup JSON</span>
          </button>
        </div>

        {/* Dry-Run Summary Counts */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <Bike className="w-4 h-4 text-[#FF6B00] mx-auto mb-1" />
            <div className="text-sm font-black text-slate-900">
              {dryRun.eligibleMotorcycles.length}
            </div>
            <div className="text-[10px] font-bold text-slate-500 uppercase">Motorcycles</div>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <Clock className="w-4 h-4 text-blue-600 mx-auto mb-1" />
            <div className="text-sm font-black text-slate-900">
              {dryRun.eligibleReminders.length}
            </div>
            <div className="text-[10px] font-bold text-slate-500 uppercase">Reminders</div>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <Wrench className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
            <div className="text-sm font-black text-slate-900">
              {dryRun.eligibleServiceRecords.length}
            </div>
            <div className="text-[10px] font-bold text-slate-500 uppercase">Service Logs</div>
          </div>
        </div>

        {/* Preview of Legacy Records */}
        <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
          {dryRun.eligibleMotorcycles.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                Motorcycles in Local Storage
              </div>
              {dryRun.eligibleMotorcycles.map((bike) => (
                <label
                  key={bike.id}
                  className={`flex items-center justify-between p-2.5 rounded-2xl border text-xs cursor-pointer transition-colors ${
                    dryRun.requiresQuotaSelection && selectedBikeId === bike.id
                      ? 'border-[#FF6B00] bg-orange-50/50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {dryRun.requiresQuotaSelection && (
                      <input
                        type="radio"
                        name="freeQuotaSelectedBike"
                        checked={selectedBikeId === bike.id}
                        onChange={() => setSelectedBikeId(bike.id)}
                        className="accent-[#FF6B00]"
                      />
                    )}
                    <div>
                      <div className="font-bold text-slate-900">
                        {bike.year} {bike.brand} {bike.model}{' '}
                        {bike.nickname ? `"${bike.nickname}"` : ''}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Plate: {bike.licensePlate || 'Unregistered'} • Odometer: {bike.odometer.toLocaleString()} km
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600">
                    Local
                  </span>
                </label>
              ))}
            </div>
          )}

          {dryRun.requiresQuotaSelection && (
            <div className="p-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
              <strong>Free Plan 1-Motorcycle Selection:</strong> Your Free plan allows 1 active cloud motorcycle. Select which motorcycle above to synchronize to cloud now. Any unselected local motorcycles remain safely preserved in your local backup.
            </div>
          )}
        </div>

        {/* Side-by-Side Field Diff View when Conflicts are Detected */}
        {conflictsToShow.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{conflictsToShow.length} Odometer/Timestamp Conflict(s) Detected — Side-by-Side Diff</span>
              </div>
              <button
                type="button"
                onClick={() => setShowDiffsOnly((prev) => !prev)}
                className="px-2 py-0.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-[10px] cursor-pointer"
              >
                {showDiffsOnly ? 'Show All Fields' : 'Changes Only'}
              </button>
            </div>
            <p className="text-[11px] text-amber-800">
              Existing newer cloud records are protected by default. Review the side-by-side field comparison below to choose which version to keep:
            </p>
            <div className="space-y-3">
              {conflictsToShow.map((conflict) => (
                <ConflictFieldDiffCard
                  key={conflict.id}
                  conflict={conflict}
                  showDiffsOnly={showDiffsOnly}
                  onResolveConflict={onResolveConflict}
                />
              ))}
            </div>
          </div>
        )}

        {/* Explicit Ownership Confirmation Checkbox */}
        <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={ownershipConfirmed}
            onChange={(e) => setOwnershipConfirmed(e.target.checked)}
            className="mt-0.5 accent-[#FF6B00] w-4 h-4 rounded"
          />
          <span className="text-xs text-slate-700 leading-snug">
            I confirm that these legacy local motorcycle, reminder, and service records belong to my signed-in account (<strong>{dryRun.userEmail}</strong>).
          </span>
        </label>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={isSyncing}
            onClick={onSkipMigration}
            className="flex-1 py-2.5 px-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            Skip Migration
          </button>
          <button
            type="button"
            disabled={!ownershipConfirmed || isSyncing}
            onClick={() =>
              onConfirmMigrate(
                dryRun.requiresQuotaSelection && selectedBikeId
                  ? [selectedBikeId]
                  : undefined
              )
            }
            className="flex-1 py-2.5 px-3 rounded-2xl bg-[#FF6B00] hover:bg-[#EA580C] text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSyncing ? 'Syncing to Cloud...' : 'Confirm & Sync to Cloud'}
          </button>
        </div>
      </div>
    </div>
  );
};

