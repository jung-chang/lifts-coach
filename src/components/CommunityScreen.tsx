import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Users, RefreshCw, Shield, Search, Settings, UserRound } from 'lucide-react';
import type {
  AccountSession,
  FeedItem,
  ProfileDetail,
  PublicProfile,
  SharedWorkout,
} from '../../shared/community';
import type { AppData, LoadMode, Unit } from '../../shared/types';
import { catalog } from '../../shared/catalog';
import { Button } from './ui/Button';
import { formatLoadValue } from './LoadSemantics';
import {
  blockProfile,
  getFeed,
  getProfile,
  getWorkout,
  hideWorkouts,
  patchProfile,
  patchSharing,
  searchPeople,
} from '../lib/communityApi';
import { toDisplayWeight } from '../../shared/domain';
import { mondayOfDate, recentMondayDates, trainingDateAt } from '../../shared/trainingDates';
import '../community.css';

type CommunityProps = {
  session: AccountSession | null;
  unit: Unit;
  onSessionChange: (s: AccountSession) => void;
  onSettings: () => void;
  onCoach: () => void;
  initialProfileId?: string;
};
type View =
  | { kind: 'feed' }
  | { kind: 'people' }
  | { kind: 'profile'; id: string }
  | { kind: 'workout'; id: string }
  | { kind: 'compare'; id: string };
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';
const dateTime = (value: string, timezone?: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
const relative = (value: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
};
const displayLoad = (mode: LoadMode, pounds: number, unit: Unit) =>
  formatLoadValue(mode, toDisplayWeight(pounds, unit), unit);
const abortError = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

function Avatar({ profile, small = false }: { profile: PublicProfile; small?: boolean }) {
  return (
    <span
      className={`community-avatar${small ? ' community-avatar-small' : ''}`}
      aria-hidden="true"
    >
      {initials(profile.displayName)}
    </span>
  );
}

function Busy({ text = 'Loading…' }: { text?: string }) {
  return (
    <p className="community-status" role="status">
      {text}
    </p>
  );
}
function Failure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="community-status community-error" role="alert">
      <p>{message}</p>
      <Button onClick={retry}>
        <RefreshCw size={16} /> Retry
      </Button>
    </div>
  );
}

export function CommunityScreen({ session, unit, onSettings, initialProfileId }: CommunityProps) {
  const accountId = session?.accountId ?? '';
  const [view, setView] = useState<View>(
    initialProfileId ? { kind: 'profile', id: initialProfileId } : { kind: 'feed' },
  );
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedFetched, setFeedFetched] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [comparePeer, setComparePeer] = useState<ProfileDetail | null>(null);
  const [workout, setWorkout] = useState<SharedWorkout | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const feedScrollY = useRef(0);
  const feedRequest = useRef<AbortController | null>(null);
  const feedGeneration = useRef(0);
  const priorAccount = useRef(accountId);
  const accountIdRef = useRef(accountId);
  const viewRef = useRef(view);
  const queryRef = useRef(query);
  const viewKindRef = useRef(view.kind);
  const isOnlineRef = useRef(isOnline);
  accountIdRef.current = accountId;
  viewRef.current = view;
  queryRef.current = query;
  viewKindRef.current = view.kind;
  isOnlineRef.current = isOnline;
  const cancelFeedRequest = () => {
    feedGeneration.current += 1;
    feedRequest.current?.abort();
    feedRequest.current = null;
    setFeedLoading(false);
  };
  const go = (next: View) => {
    if (view.kind === 'feed' && next.kind !== 'feed') feedScrollY.current = window.scrollY;
    if (next.kind === 'feed' && view.kind !== 'feed') setFeedFetched(false);
    setBlocked(false);
    setView(next);
    setProfile(null);
    setComparePeer(null);
    setWorkout(null);
    setDetailError('');
  };

  const loadFeed = useCallback(
    async (more = false) => {
      if (!accountId) return;
      if (!isOnline) return;
      feedRequest.current?.abort();
      const controller = new AbortController();
      feedRequest.current = controller;
      const requestGeneration = ++feedGeneration.current;
      const requestAccount = accountId;
      if (!more) setCursor(null);
      setFeedLoading(true);
      setFeedError('');
      try {
        const page = await getFeed(accountId, more ? cursor : null, controller.signal);
        if (
          controller.signal.aborted ||
          requestGeneration !== feedGeneration.current ||
          accountIdRef.current !== requestAccount ||
          viewKindRef.current !== 'feed' ||
          !isOnlineRef.current
        )
          return;
        setFeed((previous) => {
          const items = more ? [...previous, ...page.items] : page.items;
          return [...new Map(items.map((item) => [item.id, item])).values()];
        });
        setCursor(page.nextCursor);
        setFeedFetched(true);
      } catch (error) {
        if (
          !abortError(error) &&
          requestGeneration === feedGeneration.current &&
          accountIdRef.current === requestAccount &&
          viewKindRef.current === 'feed' &&
          isOnlineRef.current
        )
          setFeedError(
            error instanceof Error ? error.message : 'Could not load community workouts.',
          );
      } finally {
        if (requestGeneration === feedGeneration.current) {
          feedRequest.current = null;
          setFeedLoading(false);
        }
      }
    },
    [accountId, cursor, isOnline],
  );

  useEffect(
    () => () => {
      feedGeneration.current += 1;
      feedRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (priorAccount.current === accountId) return;
    priorAccount.current = accountId;
    feedGeneration.current += 1;
    feedRequest.current?.abort();
    feedRequest.current = null;
    setFeed([]);
    setCursor(null);
    setFeedFetched(false);
    setFeedLoading(false);
    setFeedError('');
    setPeople([]);
    setPeopleLoading(false);
    setPeopleError('');
    setProfile(null);
    setComparePeer(null);
    setWorkout(null);
    setDetailLoading(false);
    setDetailError('');
    setQuery('');
    setBlocked(false);
    setView({ kind: 'feed' });
  }, [accountId]);
  useEffect(() => {
    if (view.kind !== 'feed' || !accountId || feedFetched) {
      if (view.kind !== 'feed') cancelFeedRequest();
      return;
    }
    void loadFeed(false);
    return () => {
      if (feedRequest.current) {
        feedGeneration.current += 1;
        feedRequest.current.abort();
        feedRequest.current = null;
      }
    };
  }, [accountId, view.kind, feedFetched, isOnline, loadFeed]);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => {
      feedGeneration.current += 1;
      feedRequest.current?.abort();
      feedRequest.current = null;
      setIsOnline(false);
      setFeed([]);
      setCursor(null);
      setFeedFetched(false);
      setFeedLoading(false);
      setFeedError('');
      setPeople([]);
      setPeopleLoading(false);
      setProfile(null);
      setComparePeer(null);
      setWorkout(null);
      setDetailLoading(false);
      setDetailError('');
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
  useEffect(() => {
    if (view.kind !== 'people' || !accountId || !isOnline) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!isOnline) {
        setPeopleError('Connect to search people.');
        return;
      }
      setPeopleLoading(true);
      setPeopleError('');
      try {
        const result = await searchPeople(accountId, query.trim(), controller.signal);
        if (
          !controller.signal.aborted &&
          accountIdRef.current === accountId &&
          viewRef.current.kind === 'people' &&
          queryRef.current === query &&
          isOnlineRef.current
        )
          setPeople(result.items);
      } catch (error) {
        if (
          !abortError(error) &&
          !controller.signal.aborted &&
          accountIdRef.current === accountId &&
          viewRef.current.kind === 'people' &&
          queryRef.current === query
        )
          setPeopleError(error instanceof Error ? error.message : 'Could not find people.');
      } finally {
        if (!controller.signal.aborted) setPeopleLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accountId, view.kind, query, isOnline]);
  useEffect(() => {
    if (
      !accountId ||
      !isOnline ||
      (view.kind !== 'profile' && view.kind !== 'workout' && view.kind !== 'compare')
    )
      return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError('');
    setProfile(null);
    setComparePeer(null);
    setWorkout(null);
    const isCurrent = () =>
      !controller.signal.aborted &&
      accountIdRef.current === accountId &&
      viewRef.current === view &&
      isOnlineRef.current;
    const request =
      view.kind === 'workout'
        ? getWorkout(accountId, view.id, controller.signal).then((value) => {
            if (isCurrent()) setWorkout(value);
          })
        : view.kind === 'compare'
          ? Promise.all([
              getProfile(accountId, view.id, controller.signal),
              getProfile(accountId, session!.profile.publicId, controller.signal),
            ]).then(([other, mine]) => {
              if (isCurrent()) {
                setProfile(other);
                setComparePeer(mine);
              }
            })
          : getProfile(accountId, view.id, controller.signal).then((value) => {
              if (isCurrent()) setProfile(value);
            });
    void request
      .catch((error) => {
        if (!abortError(error) && isCurrent())
          setDetailError(error instanceof Error ? error.message : 'Could not load this profile.');
      })
      .finally(() => {
        if (isCurrent()) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [accountId, view, session, isOnline]);
  useEffect(() => {
    if (view.kind !== 'feed' || feedScrollY.current <= 0) return;
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: feedScrollY.current, behavior: 'instant' as ScrollBehavior }),
    );
  }, [view.kind]);

  const openWorkout = (id: string) => go({ kind: 'workout', id });
  const onBlock = async () => {
    if (!accountId || view.kind !== 'profile' || !profile) return;
    try {
      await blockProfile(accountId, view.id, true);
      setBlocked(true);
      setProfile(null);
      setFeed((items) => items.filter((item) => item.profile.publicId !== view.id));
      setPeople((items) => items.filter((person) => person.publicId !== view.id));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Could not block this profile.');
    }
  };
  const back = () => {
    if (view.kind === 'workout') {
      setWorkout(null);
      go({ kind: 'feed' });
    } else if (view.kind === 'compare') go({ kind: 'profile', id: view.id });
    else go({ kind: 'feed' });
  };

  if (!session)
    return (
      <main className="page community-page">
        <header className="page-heading">
          <div>
            <span className="eyebrow">Community</span>
            <h1>Sign in to continue</h1>
          </div>
        </header>
        <p className="muted">Your community access is tied to your Lifts Coach account.</p>
        <Button onClick={onSettings}>
          <Settings size={16} /> Account settings
        </Button>
      </main>
    );

  return (
    <main className="page community-page">
      <header className="page-heading community-heading">
        <div>
          <span className="eyebrow">Lifts Coach</span>
          <h1>
            {view.kind === 'feed'
              ? 'Community'
              : view.kind === 'people'
                ? 'People'
                : view.kind === 'workout'
                  ? 'Workout'
                  : view.kind === 'compare'
                    ? 'Compare training'
                    : 'Profile'}
          </h1>
        </div>
        <div className="row community-heading-actions">
          {view.kind !== 'feed' && (
            <Button variant="ghost" onClick={back} aria-label="Back to previous view">
              <ArrowLeft size={17} /> Back
            </Button>
          )}
          {(view.kind === 'feed' || view.kind === 'people') && (
            <Button
              variant={view.kind === 'people' ? 'primary' : 'secondary'}
              onClick={() => {
                setQuery('');
                go({ kind: view.kind === 'people' ? 'feed' : 'people' });
              }}
            >
              <Users size={17} /> {view.kind === 'people' ? 'Feed' : 'People'}
            </Button>
          )}
        </div>
      </header>

      {view.kind === 'feed' && (
        <section aria-label="Community workout feed">
          {!isOnline && (
            <p className="community-notice" role="status">
              Connect to view community workouts.
            </p>
          )}
          {isOnline && (
            <div className="community-feed-actions">
              <Button variant="ghost" disabled={feedLoading} onClick={() => void loadFeed(false)}>
                <RefreshCw size={16} /> {feedLoading ? 'Refreshing…' : 'Refresh feed'}
              </Button>
            </div>
          )}
          {feedLoading && !feed.length && <Busy text="Loading workouts…" />}
          {feedError && (
            <Failure
              message={feedError}
              retry={() => void loadFeed(feed.length > 0 && cursor !== null)}
            />
          )}
          {isOnline && !feedLoading && !feedError && feed.length === 0 && (
            <p className="community-empty">
              Finished workouts from the community will appear here.
            </p>
          )}
          <div className="community-feed">
            {feed.map((item) => (
              <article key={item.id} className="community-feed-item">
                <div className="community-owner">
                  <button
                    className="community-profile-link"
                    onClick={() => go({ kind: 'profile', id: item.profile.publicId })}
                  >
                    <Avatar profile={item.profile} small />
                    <span>{item.profile.displayName}</span>
                  </button>
                  <time
                    dateTime={item.activityAt}
                    title={dateTime(item.activityAt, item.profile.trainingTimezone)}
                  >
                    {relative(item.activityAt)}
                  </time>
                </div>
                <button
                  className="community-workout-link"
                  onClick={() => openWorkout(item.id)}
                  aria-label={`View ${item.title} workout by ${item.profile.displayName}`}
                >
                  <h2>{item.title}</h2>
                  <p>
                    {item.exerciseCount} exercises · {item.setCount} working sets
                    {item.durationMinutes != null ? ` · ${item.durationMinutes} min` : ''}
                  </p>
                  {item.exerciseNames.length > 0 && (
                    <span className="community-exercise-preview">
                      {item.exerciseNames.slice(0, 2).join(', ')}
                      {item.exerciseNames.length > 2 ? ` +${item.exerciseNames.length - 2}` : ''}
                    </span>
                  )}
                </button>
              </article>
            ))}
          </div>
          {feedLoading && feed.length > 0 && <Busy text="Loading more workouts…" />}
          {cursor && !feedLoading && (
            <Button className="community-load-more" onClick={() => void loadFeed(true)}>
              Load more
            </Button>
          )}
        </section>
      )}

      {view.kind === 'people' && (
        <section aria-label="Find people">
          <label className="community-search">
            <Search size={17} />
            <span className="sr-only">Search by display name</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by display name"
            />
          </label>
          {peopleLoading && <Busy text="Searching…" />}
          {peopleError && <Failure message={peopleError} retry={() => setQuery((q) => `${q} `)} />}
          {isOnline && !peopleLoading && !peopleError && !people.length && (
            <p className="community-empty">No profiles found.</p>
          )}
          <div className="community-people">
            {people.map((person) => (
              <button
                key={person.publicId}
                className="community-person-row"
                onClick={() => go({ kind: 'profile', id: person.publicId })}
              >
                <Avatar profile={person} />
                <span>{person.displayName}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(view.kind === 'profile' || view.kind === 'compare') && (
        <section>
          {!isOnline && (
            <p className="community-notice" role="status">
              Connect to view community profiles.
            </p>
          )}
          {detailLoading && <Busy text="Loading profile…" />}
          {detailError && <Failure message={detailError} retry={() => setView({ ...view })} />}
          {blocked && (
            <p className="community-note" role="status">
              This profile is blocked. Its community details have been cleared from this view.
            </p>
          )}
          {profile && (
            <ProfileContent
              detail={profile}
              comparePeer={comparePeer}
              unit={unit}
              onWorkout={openWorkout}
              own={view.kind === 'compare'}
              onCompare={
                view.kind === 'profile' && view.id !== session.profile.publicId
                  ? () => go({ kind: 'compare', id: view.id })
                  : undefined
              }
              onBlock={
                view.kind === 'profile' && view.id !== session.profile.publicId && !blocked
                  ? onBlock
                  : undefined
              }
              blocked={blocked}
              compare={view.kind === 'compare'}
              myName={session.profile.displayName}
            />
          )}
        </section>
      )}

      {view.kind === 'workout' && (
        <section>
          {!isOnline && (
            <p className="community-notice" role="status">
              Connect to view community workouts.
            </p>
          )}
          {detailLoading && <Busy text="Loading workout…" />}
          {detailError && <Failure message={detailError} retry={() => setView({ ...view })} />}
          {workout && (
            <SharedWorkoutContent
              workout={workout}
              unit={unit}
              onProfile={() => go({ kind: 'profile', id: workout.profile.publicId })}
            />
          )}
        </section>
      )}
    </main>
  );
}

function ProfileContent({
  detail,
  comparePeer,
  unit,
  onWorkout,
  own,
  onCompare,
  onBlock,
  blocked,
  compare,
  myName,
}: {
  detail: ProfileDetail;
  comparePeer: ProfileDetail | null;
  unit: Unit;
  onWorkout: (id: string) => void;
  own: boolean;
  onCompare?: () => void;
  onBlock?: () => void;
  blocked: boolean;
  compare: boolean;
  myName: string;
}) {
  const visibleWeeks = recentMondayDates(detail.profile.trainingTimezone).map((startDate) => ({
    startDate,
    sets: detail.weeks.find((week) => week.startDate === startDate)?.sets ?? 0,
  }));
  const latestWeek = visibleWeeks.at(-1);
  const scope = detail.scope === 'all-history' ? 'All-history summary' : 'Shared workouts only';
  const matched = useMemo(() => {
    if (!comparePeer) return [];
    const mine = new Map(
      comparePeer.records.map((r) => [`${r.exerciseId}|${r.loadMode}|${r.reps}`, r]),
    );
    const canonicalIds = new Set(catalog.map((exercise) => exercise.id));
    return detail.records
      .filter((record) => canonicalIds.has(record.exerciseId))
      .flatMap((record) => {
        const match = mine.get(`${record.exerciseId}|${record.loadMode}|${record.reps}`);
        return match ? [{ other: record, mine: match }] : [];
      });
  }, [comparePeer, detail.records]);
  return (
    <div className="community-profile">
      <div className="community-profile-identity">
        <Avatar profile={detail.profile} />
        <div>
          <h2>{detail.profile.displayName}</h2>
          <p>{compare ? `Compared with ${myName}` : scope}</p>
        </div>
      </div>
      {compare ? (
        <CompareContent
          detail={detail}
          peer={comparePeer}
          matched={matched}
          unit={unit}
          myName={myName}
        />
      ) : (
        <>
          {detail.scope === 'all-history' && (
            <div className="community-stat">
              <span>Current week{latestWeek ? ` · ${latestWeek.startDate}` : ''}</span>
              <strong>{latestWeek?.sets ?? 0}</strong>
              <small>Completed working sets · all-history scope</small>
            </div>
          )}
          {detail.scope === 'shared-workouts' && (
            <p className="community-note">Totals and records use shared workouts only.</p>
          )}
          <section className="community-section">
            <h3>Weekly volume</h3>
            <WeeklyBars weeks={visibleWeeks} />
          </section>
          {detail.records.length > 0 && (
            <section className="community-section">
              <div className="community-section-title">
                <h3>Qualified lift records</h3>
                <span className="muted small">Actual completed sets</span>
              </div>
              <div className="community-records">
                {detail.records.map((record, index) => (
                  <div
                    className="community-record"
                    key={`${record.exerciseId}-${record.loadMode}-${record.date}-${index}`}
                  >
                    <span>
                      {record.name}
                      <small>
                        {record.reps} reps · {dateTime(record.date)}
                      </small>
                    </span>
                    <strong>{displayLoad(record.loadMode, record.weight, unit)}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="community-section">
            <h3>Recent shared workouts</h3>
            {detail.workouts.length ? (
              detail.workouts.map((item) => (
                <button
                  key={item.id}
                  className="community-recent-row"
                  onClick={() => onWorkout(item.id)}
                >
                  <span>
                    <b>{item.title}</b>
                    <small>
                      {dateTime(item.activityAt)} · {item.setCount} working sets
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="community-empty">No shared workouts yet.</p>
            )}
          </section>
          {!own && (
            <section className="community-options">
              <h3>Options</h3>
              {onCompare && <Button onClick={onCompare}>Compare training</Button>}
              {onBlock && (
                <Button variant="danger" onClick={onBlock}>
                  Block profile
                </Button>
              )}
              {blocked && <p role="status">Profile blocked.</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function WeeklyBars({ weeks }: { weeks: ProfileDetail['weeks'] }) {
  const values = [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(-8);
  const maximum = Math.max(1, ...values.map((week) => week.sets));
  if (!values.length)
    return <p className="community-empty">No weekly volume is available for this sharing scope.</p>;
  return (
    <div className="community-weekly-chart" role="img" aria-label="Completed working sets by week">
      {values.map((week) => (
        <div
          className="community-weekly-column"
          key={week.startDate}
          title={`${week.startDate}: ${week.sets} working sets`}
        >
          <span style={{ height: `${Math.max(4, (82 * week.sets) / maximum)}px` }} />
          <strong>{week.sets}</strong>
          <small>{week.startDate.slice(5)}</small>
        </div>
      ))}
    </div>
  );
}

function OwnWeeklyBars({ weeks }: { weeks: Array<readonly [string, number]> }) {
  const maximum = Math.max(1, ...weeks.map(([, sets]) => sets));
  return (
    <div
      className="community-weekly-chart"
      role="img"
      aria-label="Completed working sets by week from local workout history"
    >
      {weeks.map(([date, sets]) => (
        <div className="community-weekly-column" key={date} title={`${date}: ${sets} working sets`}>
          <span style={{ height: `${Math.max(4, (82 * sets) / maximum)}px` }} />
          <strong>{sets}</strong>
          <small>{date.slice(5)}</small>
        </div>
      ))}
    </div>
  );
}

function CompareContent({
  detail,
  peer,
  matched,
  unit,
  myName,
}: {
  detail: ProfileDetail;
  peer: ProfileDetail | null;
  matched: Array<{
    other: ProfileDetail['records'][number];
    mine: ProfileDetail['records'][number];
  }>;
  unit: Unit;
  myName: string;
}) {
  const [mode, setMode] = useState<'volume' | 'lifts'>('volume');
  const allWeeks = useMemo(() => {
    if (!peer) return [];
    const mine = new Map(peer.weeks.map((w) => [w.startDate, w.sets]));
    const other = new Map(detail.weeks.map((w) => [w.startDate, w.sets]));
    return recentMondayDates(peer.profile.trainingTimezone).map((date) => ({
      date,
      other: other.get(date) ?? 0,
      mine: mine.get(date) ?? 0,
    }));
  }, [detail.weeks, peer]);
  const weeks = allWeeks.slice(-8);
  const globalMaximum = Math.max(1, ...weeks.flatMap((week) => [week.mine, week.other]));
  return (
    <div className="community-compare">
      <div className="community-compare-controls">
        <div className="community-segment" role="group" aria-label="Comparison view">
          <button aria-pressed={mode === 'volume'} onClick={() => setMode('volume')}>
            Weekly volume
          </button>
          <button aria-pressed={mode === 'lifts'} onClick={() => setMode('lifts')}>
            Matched lifts
          </button>
        </div>
      </div>
      {mode === 'volume' ? (
        <>
          <p className="community-note">
            Same Monday weeks for both people. Showing the current eight weeks; scopes are labeled
            per person.
          </p>
          <div className="community-compare-volume">
            <div>
              <span>
                {myName} · {peer?.scope === 'all-history' ? 'all-history' : 'shared workouts'}
              </span>
              <strong>{peer ? 'Working sets' : 'Unavailable'}</strong>
            </div>
            <div>
              <span>
                {detail.profile.displayName} ·{' '}
                {detail.scope === 'all-history' ? 'all-history' : 'shared workouts'}
              </span>
              <strong>Working sets</strong>
            </div>
          </div>
          {peer ? (
            <div
              className="community-volume-chart"
              role="img"
              aria-label={`Weekly working sets for ${myName} and ${detail.profile.displayName}`}
            >
              {weeks.length ? (
                weeks.map((week) => (
                  <div className="community-volume-week" key={week.date}>
                    <div className="community-volume-pair">
                      <span
                        className="community-volume-bar mine"
                        style={{ height: `${Math.max(4, (56 * week.mine) / globalMaximum)}px` }}
                        title={`${myName}: ${week.mine} sets`}
                      />
                      <span
                        className="community-volume-bar other"
                        style={{ height: `${Math.max(4, (56 * week.other) / globalMaximum)}px` }}
                        title={`${detail.profile.displayName}: ${week.other} sets`}
                      />
                    </div>
                    <small>{week.date.slice(5)}</small>
                  </div>
                ))
              ) : (
                <p className="community-empty">
                  No shared Monday weeks are available for both profiles.
                </p>
              )}
            </div>
          ) : (
            <p className="community-empty">Your profile summary is unavailable.</p>
          )}
        </>
      ) : (
        <section className="community-section">
          <h3>Matched lifts</h3>
          {matched.length ? (
            <div className="community-records">
              {matched.map(({ other, mine }) => (
                <div
                  className="community-record"
                  key={`${other.exerciseId}-${other.loadMode}-${other.reps}`}
                >
                  <span>
                    {other.name}
                    <small>
                      {other.reps} reps · {other.loadMode} · {myName} / {detail.profile.displayName}
                    </small>
                  </span>
                  <strong>
                    {displayLoad(mine.loadMode, mine.weight, unit)} /{' '}
                    {displayLoad(other.loadMode, other.weight, unit)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="community-empty">
              No lift comparison is available for matching canonical exercises, load modes and rep
              counts.
            </p>
          )}
        </section>
      )}
      <p className="community-note">
        Lift matches use the same canonical exercise, load mode and rep count. Records use actual
        completed sets; no estimated one-rep max is used.
      </p>
    </div>
  );
}

function SharedWorkoutContent({
  workout,
  unit,
  onProfile,
}: {
  workout: SharedWorkout;
  unit: Unit;
  onProfile: () => void;
}) {
  const duration = Math.max(
    0,
    Math.round(
      (new Date(workout.completedAt).getTime() - new Date(workout.startedAt).getTime()) / 60000,
    ),
  );
  const exercises = workout.exercises.filter((exercise) => exercise.sets.length > 0);
  return (
    <div className="community-workout-detail">
      <button className="community-profile-link community-workout-owner" onClick={onProfile}>
        <Avatar profile={workout.profile} small />
        <span>{workout.profile.displayName}</span>
      </button>
      <h2>{workout.title}</h2>
      <p className="muted">
        {dateTime(workout.completedAt, workout.profile.trainingTimezone)}
        {duration > 0 ? ` · ${duration} min` : ''}
      </p>
      <div className="community-workout-summary">
        <div>
          <strong>{exercises.length}</strong>
          <span>Exercises</span>
        </div>
        <div>
          <strong>
            {exercises.reduce(
              (sum, e) => sum + e.sets.filter((s) => s.kind === 'working').length,
              0,
            )}
          </strong>
          <span>Working sets</span>
        </div>
        <div>
          <strong>
            {exercises.reduce(
              (sum, e) => sum + e.sets.filter((s) => s.kind === 'warmup').length,
              0,
            )}
          </strong>
          <span>Warm-ups</span>
        </div>
      </div>
      {exercises.map((exercise) => (
        <section key={exercise.id} className="community-exercise">
          <div className="community-exercise-heading">
            <h3>{exercise.name}</h3>
            <span>
              {exercise.loadMode === 'per-dumbbell'
                ? 'Per dumbbell'
                : exercise.loadMode === 'bodyweight'
                  ? 'Bodyweight'
                  : exercise.loadMode === 'assistance'
                    ? 'Assistance'
                    : 'Total load'}
            </span>
          </div>
          <table className="community-set-table">
            <thead>
              <tr>
                <th>Set</th>
                <th>Load</th>
                <th>Reps</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {exercise.sets.map((set, index) => {
                const mode =
                  (set as typeof set & { loadMode?: LoadMode }).loadMode ?? exercise.loadMode;
                return (
                  <tr key={set.id}>
                    <td>{index + 1}</td>
                    <td>{displayLoad(mode, set.weight, unit)}</td>
                    <td>{set.reps}</td>
                    <td>{set.kind === 'warmup' ? 'Warm-up' : 'Working'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

type OwnProps = {
  session: AccountSession | null;
  unit: Unit;
  data: AppData;
  onSessionChange: (s: AccountSession) => void;
  onSettings: () => void;
  onBack: () => void;
  onSignOut: () => void;
  onClaimLegacy?: () => void;
  legacyAvailable?: boolean;
  onWorkout?: (workoutId: string) => void;
};
export function OwnProfileScreen({
  session,
  unit,
  data,
  onSessionChange,
  onSettings,
  onBack,
  onSignOut,
  onClaimLegacy,
  legacyAvailable = false,
  onWorkout,
}: OwnProps) {
  const [name, setName] = useState(session?.profile.displayName ?? '');
  const [timezone, setTimezone] = useState(
    session?.profile.trainingTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [summary, setSummary] = useState(session?.sharing.summaryEnabled ?? false);
  const [automatic, setAutomatic] = useState(session?.sharing.autoPublishWorkouts ?? false);
  const [audienceReviewed, setAudienceReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hideStatus, setHideStatus] = useState('');
  const completed = data.workouts.filter((w) => w.status === 'finished');
  const weeks = useMemo(() => {
    const totals = new Map<string, number>();
    for (const workout of completed)
      for (const exercise of workout.exercises)
        for (const set of exercise.actualSets) {
          if (set.kind !== 'working' || set.status !== 'completed') continue;
          const timezone = session?.profile.trainingTimezone ?? 'UTC';
          const trainingDate =
            workout.trainingDate ??
            trainingDateAt(set.completedAt ?? workout.completedAt ?? workout.startedAt, timezone);
          const key = mondayOfDate(trainingDate);
          totals.set(key, (totals.get(key) ?? 0) + 1);
        }
    const timezone = session?.profile.trainingTimezone ?? 'UTC';
    return recentMondayDates(timezone).map((date) => [date, totals.get(date) ?? 0] as const);
  }, [completed, session?.profile.trainingTimezone]);
  const records = useMemo(() => {
    const best = new Map<
      string,
      {
        exerciseId: string;
        name: string;
        loadMode: LoadMode;
        weight: number;
        reps: number;
        date: string;
      }
    >();
    for (const workout of completed)
      for (const exercise of workout.exercises)
        for (const set of exercise.actualSets) {
          if (set.kind !== 'working' || set.status !== 'completed') continue;
          const key = `${exercise.exerciseId}|${set.loadMode}|${set.reps}`;
          const old = best.get(key);
          if (
            !old ||
            (set.loadMode === 'assistance' ? set.weight < old.weight : set.weight > old.weight)
          )
            best.set(key, {
              exerciseId: exercise.exerciseId,
              name: exercise.name,
              loadMode: set.loadMode,
              weight: set.weight,
              reps: set.reps,
              date: set.completedAt ?? workout.completedAt ?? workout.startedAt,
            });
        }
    return [...best.values()].sort((a, b) => a.name.localeCompare(b.name) || a.reps - b.reps);
  }, [completed]);
  useEffect(() => {
    setName(session?.profile.displayName ?? '');
    setTimezone(
      session?.profile.trainingTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    setSummary(session?.sharing.summaryEnabled ?? false);
    setAutomatic(session?.sharing.autoPublishWorkouts ?? false);
  }, [session]);
  const save = async () => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      let next = session;
      if (
        name.trim() !== session.profile.displayName ||
        timezone !== session.profile.trainingTimezone
      )
        next = await patchProfile(session.accountId, {
          displayName: name.trim(),
          trainingTimezone: timezone,
        });
      if (
        summary !== session.sharing.summaryEnabled ||
        automatic !== session.sharing.autoPublishWorkouts
      ) {
        const expanding =
          (summary && !session.sharing.summaryEnabled) ||
          (automatic && !session.sharing.autoPublishWorkouts);
        if (expanding && !audienceReviewed)
          throw new Error('Review the audience notice before changing sharing settings.');
        next = await patchSharing(session.accountId, {
          summaryEnabled: summary,
          autoPublishWorkouts: automatic,
          policyRevision: session.sharing.policyRevision,
          audienceAcknowledged: audienceReviewed,
        });
      }
      onSessionChange(next);
      setAudienceReviewed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile settings.');
    } finally {
      setBusy(false);
    }
  };
  if (!session)
    return (
      <main className="page own-profile-page">
        <p>Sign in to view your profile.</p>
        <Button onClick={onBack}>Back</Button>
      </main>
    );
  return (
    <main className="page own-profile-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Your account</span>
          <h1>Profile</h1>
        </div>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={17} /> Back
        </Button>
      </header>
      <section className="community-own-identity">
        <Avatar profile={session.profile} />
        <div>
          <h2>{session.profile.displayName}</h2>
          <p>{session.email}</p>
        </div>
      </section>
      <section className="community-section">
        <div className="community-section-title">
          <h2>Weekly volume</h2>
          <span className="muted small">Completed working sets</span>
        </div>
        <div className="community-stat">
          <span>Current week</span>
          <strong>{weeks.at(-1)?.[1] ?? 0}</strong>
          <small>Local completed history · {session.profile.trainingTimezone}</small>
        </div>
        <OwnWeeklyBars weeks={weeks} />
      </section>
      <section className="community-section">
        <div className="community-section-title">
          <h2>Best completed sets</h2>
          <span className="muted small">Grouped by exercise, load mode and reps</span>
        </div>
        {records.length ? (
          <div className="community-records">
            {records.map((record) => (
              <div
                key={`${record.exerciseId}-${record.loadMode}-${record.reps}`}
                className="community-record"
              >
                <span>
                  {record.name}
                  <small>
                    {record.reps} reps · {dateTime(record.date)}
                  </small>
                </span>
                <strong>{displayLoad(record.loadMode, record.weight, unit)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="community-empty">Completed working sets will appear here.</p>
        )}
      </section>
      <section className="community-section">
        <h2>Recent workouts</h2>
        <div className="community-records">
          {completed
            .slice()
            .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
            .slice(0, 5)
            .map((w) => (
              <button
                key={w.id}
                className="community-recent-row"
                onClick={() => onWorkout?.(w.id)}
                disabled={!onWorkout}
              >
                <span>
                  <b>{w.name}</b>
                  <small>
                    {w.completedAt ? dateTime(w.completedAt) : 'Completed'} ·{' '}
                    {w.exercises.reduce(
                      (n, e) =>
                        n +
                        e.actualSets.filter((s) => s.kind === 'working' && s.status === 'completed')
                          .length,
                      0,
                    )}{' '}
                    working sets
                  </small>
                </span>
              </button>
            ))}
        </div>
        {!completed.length && <p className="community-empty">No completed workouts yet.</p>}
      </section>
      <section className="community-section community-profile-form">
        <h2>Profile details</h2>
        <label className="form-field">
          <span>Display name</span>
          <input
            className="input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Training timezone</span>
          <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </label>
      </section>
      <section className="community-section community-sharing">
        <h2>Sharing</h2>
        <p>Choose separately whether people can see your summaries and future finished workouts.</p>
        <div className="community-audience">
          <Shield size={18} />
          <div>
            <strong>Audience: admitted Lifts Coach accounts</strong>
            <p>
              A shared summary includes your display name, weekly volume and qualified lift records.
              A shared workout includes its approved title, completion time, duration and completed
              exercise sets. Notes, feelings, Coach data and email stay private. Older workouts
              remain private unless shared individually.
            </p>
          </div>
        </div>
        <label className="community-consent">
          <input
            type="checkbox"
            checked={audienceReviewed}
            onChange={(e) => setAudienceReviewed(e.target.checked)}
          />
          <span>I reviewed who can see shared profile summaries and workouts.</span>
        </label>
        <label className="community-consent">
          <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} />
          <span>Share all-history summary and qualified lift records</span>
        </label>
        <p className="community-scope">
          {summary
            ? 'Scope: all-history, including private workouts.'
            : 'Scope: summaries use shared workouts only.'}
        </p>
        <label className="community-consent">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(e) => setAutomatic(e.target.checked)}
          />
          <span>Automatically share future finished workouts</span>
        </label>
        <p className="community-scope">
          {automatic
            ? 'Applies to future workouts after this setting is saved.'
            : 'Future workouts remain private unless you choose to share them.'}
        </p>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            setHideStatus('');
            try {
              await hideWorkouts(session.accountId);
              setHideStatus('All currently shared workouts are hidden from the community.');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not hide shared workouts.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Hide all shared workouts
        </Button>
        {hideStatus && (
          <p className="community-note" role="status">
            {hideStatus}
          </p>
        )}
      </section>
      {error && (
        <p role="alert" className="community-error-text">
          {error}
        </p>
      )}
      <div className="community-own-actions">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
        <Button onClick={onSettings}>
          <Settings size={17} /> Settings
        </Button>
        <Button onClick={onSignOut}>Sign out</Button>
        {legacyAvailable && onClaimLegacy && (
          <Button onClick={onClaimLegacy}>
            <UserRound size={17} /> Claim legacy history
          </Button>
        )}
      </div>
    </main>
  );
}
