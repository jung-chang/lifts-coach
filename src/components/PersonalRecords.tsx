import { Star } from 'lucide-react';
import type { LoadMode, Unit } from '../../shared/types';
import { toDisplayWeight } from '../../shared/domain';
import { formatLoadValue } from './LoadSemantics';

export function RecordStar({
  label = 'Personal record achieved in this workout',
}: {
  label?: string;
}) {
  return (
    <span className="record-star" role="img" aria-label={label} title={label}>
      <Star size={14} aria-hidden="true" />
    </span>
  );
}

export function WorkoutRecords({
  records,
  unit,
}: {
  records: { name: string; loadMode: LoadMode; weight: number }[];
  unit: Unit;
}) {
  if (!records.length) return null;
  return (
    <section className="workout-records" aria-label="Personal records achieved">
      <h3>Personal records</h3>
      <ul>
        {records.map((record, index) => (
          <li key={index}>
            <RecordStar />
            <span>
              {record.name}{' '}
              <span className="muted">
                — {formatLoadValue(record.loadMode, toDisplayWeight(record.weight, unit), unit)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
