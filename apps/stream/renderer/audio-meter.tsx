import { METER_FLOOR_DB, METER_ZONES, dbToFraction } from './audio-meter-model';
import './audio-meter.css';

export interface AudioMeterProps {
  /** Current level in dB (e.g. `linearToDb(meterLevels[sourceId])`). */
  levelDb: number;
  /** Current peak-hold marker position in dB (e.g. `peakHold.peakDb`). */
  peakDb: number;
  orientation?: 'horizontal' | 'vertical';
  /** Render -60/-40/-20/-9/0 tick labels alongside the meter. */
  ticks?: boolean;
  /** Accessible name; defaults to "Audio level". */
  label?: string;
}

const HORIZONTAL_TICK_VALUES_DB = [-60, -55, -50, -45, -40, -35, -30, -25, -20, -15, -10, -5, 0] as const;
const VERTICAL_TICK_VALUES_DB = [-60, -54, -48, -42, -36, -30, -24, -18, -12, -6, 0] as const;

function formatTickLabel(value: number): string {
  return value === 0 ? '0' : `−${Math.abs(value)}`;
}

function clampDb(db: number): number {
  return Math.max(METER_FLOOR_DB, Math.min(0, db));
}

/** How much of a single zone's own span is filled at the given (already clamped) level. */
function zoneFillFraction(levelDb: number, fromDb: number, toDb: number): number {
  if (levelDb <= fromDb) return 0;
  if (levelDb >= toDb) return 1;
  return (levelDb - fromDb) / (toDb - fromDb);
}

export function AudioMeter({ levelDb, peakDb, orientation = 'horizontal', ticks = false, label }: AudioMeterProps) {
  const clampedLevel = clampDb(levelDb);
  const clampedPeak = clampDb(peakDb);
  const peakPercent = dbToFraction(clampedPeak) * 100;
  const sizeProperty: 'width' | 'height' = orientation === 'horizontal' ? 'width' : 'height';
  const positionProperty: 'left' | 'bottom' = orientation === 'horizontal' ? 'left' : 'bottom';
  const tickValues = orientation === 'horizontal' ? HORIZONTAL_TICK_VALUES_DB : VERTICAL_TICK_VALUES_DB;

  return (
    <div className={`audio-meter audio-meter--${orientation}`}>
      <div
        className="audio-meter-track"
        role="meter"
        aria-valuenow={clampedLevel}
        aria-valuemin={METER_FLOOR_DB}
        aria-valuemax={0}
        aria-label={label ?? 'Audio level'}
      >
        {METER_ZONES.map((zone) => {
          const spanPercent = (dbToFraction(zone.toDb) - dbToFraction(zone.fromDb)) * 100;
          const fillPercent = zoneFillFraction(clampedLevel, zone.fromDb, zone.toDb) * 100;
          return (
            <div
              key={zone.tone}
              className={`audio-meter-zone audio-meter-zone--${zone.tone}`}
              style={{ flexBasis: `${spanPercent}%` }}
            >
              <div className="audio-meter-zone-fill" style={{ [sizeProperty]: `${fillPercent}%` }} />
            </div>
          );
        })}
        <div className="audio-meter-peak" style={{ [positionProperty]: `${peakPercent}%` }} />
      </div>
      {ticks && (
        <div className="audio-meter-ticks" aria-hidden="true">
          {tickValues.map((value) => (
            <span
              key={value}
              className="audio-meter-tick"
              style={{ [positionProperty]: `${dbToFraction(value) * 100}%` }}
            >
              {formatTickLabel(value)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
