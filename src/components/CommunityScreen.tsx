import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Users, RefreshCw, Pencil, Search, Settings } from 'lucide-react';
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
import { TimezonePicker } from './TimezonePicker';
import { formatLoadValue } from './LoadSemantics';
import {
  blockProfile,
  getFeed,
  getProfile,
  getProfileWorkouts,
  getWorkout,
  hideWorkouts,
  patchProfile,
  patchSharing,
  searchPeople,
} from '../lib/communityApi';
import { toDisplayWeight } from '../../shared/domain';
import { recentMondayDates } from '../../shared/trainingDates';
import { exerciseStatsFromWorkouts } from '../../shared/trainingStats';
import {
  ExerciseStats,
  WorkoutHistory,
  TrainingLinks,
  historyItemsFromWorkouts,
} from './TrainingHistory';
import { Sheet } from './ui/Sheet';
import '../community.css';
import '../profile.css';

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
  | { kind: 'profile'; id: string; section?: 'overview' | 'stats' | 'history' }
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
  const workoutReturn = useRef<View>({ kind: 'feed' });
  const feedRequest = useRef<AbortController | null>(null);
  const feedGeneration = useRef(0);
  const feedPages = useRef(1);
  const feedRetry = useRef({ more: false, revalidate: false });
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
    async (more = false, revalidate = false) => {
      if (!accountId) return;
      if (!isOnline) return;
      feedRequest.current?.abort();
      const controller = new AbortController();
      feedRequest.current = controller;
      const requestGeneration = ++feedGeneration.current;
      const requestAccount = accountId;
      feedRetry.current = { more, revalidate };
      setFeedLoading(true);
      setFeedError('');
      try {
        const pageCount = revalidate ? feedPages.current : 1;
        const page = await getFeed(accountId, more ? cursor : null, controller.signal);
        let fetchedPages = 1;
        while (fetchedPages < pageCount && page.nextCursor && !controller.signal.aborted) {
          const next = await getFeed(accountId, page.nextCursor, controller.signal);
          page.items.push(...next.items);
          page.nextCursor = next.nextCursor;
          fetchedPages += 1;
        }
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
        feedPages.current = more ? feedPages.current + 1 : fetchedPages;
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
    feedPages.current = 1;
    feedScrollY.current = 0;
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
    void loadFeed(false, true);
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
      feedPages.current = 1;
      feedScrollY.current = 0;
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
    if (view.kind !== 'feed' || !feedFetched || feedScrollY.current <= 0) return;
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: feedScrollY.current, behavior: 'instant' as ScrollBehavior }),
    );
  }, [view.kind, feedFetched]);

  const openWorkout = (id: string) => {
    workoutReturn.current =
      view.kind === 'profile' ? { ...view, section: 'history' } : { kind: 'feed' };
    go({ kind: 'workout', id });
  };
  const onBlock = async () => {
    if (!accountId || view.kind !== 'profile' || !profile) return;
    const requestView = view;
    try {
      await blockProfile(accountId, view.id, true);
      if (accountIdRef.current !== accountId || !isOnlineRef.current) return;
      if (viewRef.current === requestView) {
        setBlocked(true);
        setProfile(null);
      }
      setFeed((items) => items.filter((item) => item.profile.publicId !== view.id));
      setPeople((items) => items.filter((person) => person.publicId !== view.id));
    } catch (error) {
      if (accountIdRef.current === accountId && viewRef.current === requestView)
        setDetailError(error instanceof Error ? error.message : 'Could not block this profile.');
    }
  };
  const back = () => {
    if (view.kind === 'workout') {
      setWorkout(null);
      go(workoutReturn.current);
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
        <div className="page-title-group">
          {view.kind !== 'feed' && (
            <Button size="icon" variant="ghost" onClick={back} aria-label="Back to previous view">
              <ArrowLeft size={18} />
            </Button>
          )}
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
              retry={() => void loadFeed(feedRetry.current.more, feedRetry.current.revalidate)}
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
              accountId={accountId}
              initialView={view.kind === 'profile' ? view.section : undefined}
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
  accountId,
  initialView = 'overview',
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
  accountId: string;
  initialView?: ProfileSection;
}) {
  const [section, setSection] = useState<ProfileSection>(initialView);
  const [items, setItems] = useState(detail.workouts);
  const [cursor, setCursor] = useState(detail.nextWorkoutCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    setItems(detail.workouts);
    setCursor(detail.nextWorkoutCursor ?? null);
  }, [detail]);
  const matched = useMemo(() => {
    if (!comparePeer) return [];
    const mine = new Map(
      comparePeer.records.map((r) => [`${r.exerciseId}|${r.loadMode}|${r.reps}`, r]),
    );
    const canonical = new Set(catalog.map((e) => e.id));
    return detail.records
      .filter((r) => canonical.has(r.exerciseId))
      .flatMap((other) => {
        const own = mine.get(`${other.exerciseId}|${other.loadMode}|${other.reps}`);
        return own ? [{ other, mine: own }] : [];
      });
  }, [detail.records, comparePeer]);
  const go = (next: ProfileSection) => {
    setSection(next);
    window.scrollTo({ top: 0 });
  };
  const more = async () => {
    if (!cursor || loading) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const page = await getProfileWorkouts(
        accountId,
        detail.profile.publicId,
        cursor,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setItems((prior) => [...new Map([...prior, ...page.items].map((w) => [w.id, w])).values()]);
        setCursor(page.nextCursor);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Could not load workouts.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  return (
    <div className="community-profile">
      <div className="community-profile-identity">
        <Avatar profile={detail.profile} />
        <div>
          <h2>{detail.profile.displayName}</h2>
          <p>
            {compare
              ? `Compared with ${myName}`
              : detail.scope === 'all-history'
                ? 'All-history summary'
                : 'Shared workouts only'}
          </p>
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
          {section !== 'overview' && (
            <>
              <Button className="back-button" variant="ghost" onClick={() => go('overview')}>
                <ArrowLeft size={16} /> Back to profile
              </Button>
              <h2 className="profile-section-heading">
                {section === 'stats' ? 'Exercise stats' : 'Workout history'}
              </h2>
            </>
          )}
          {section === 'overview' && (
            <TrainingLinks
              onStats={() => go('stats')}
              onHistory={() => go('history')}
              historyDescription="Shared completed workouts"
            />
          )}
          {section === 'stats' &&
            ((detail.statsVisible ?? detail.scope === 'all-history') ? (
              <ExerciseStats
                stats={detail.exerciseStats ?? []}
                unit={unit}
                timeZone={detail.profile.trainingTimezone}
              />
            ) : (
              <p className="community-empty">Profile stats are private.</p>
            ))}
          {section === 'history' && (
            <WorkoutHistory
              timeZone={detail.profile.trainingTimezone}
              items={items.map((w) => ({
                id: w.id,
                title: w.title,
                date: w.activityAt,
                durationMinutes: w.durationMinutes,
                setCount: w.setCount,
              }))}
              onWorkout={onWorkout}
              onLoadMore={cursor ? () => void more() : undefined}
              loading={loading}
              emptyMessage="No shared workouts yet."
            />
          )}
          {error && <p role="alert">{error}</p>}
          {section === 'overview' && !own && (
            <div className="community-options">
              {onCompare && (detail.statsVisible ?? detail.scope === 'all-history') && (
                <Button onClick={onCompare}>Compare training</Button>
              )}
              {onBlock && (
                <Button variant="ghost" onClick={onBlock}>
                  Block profile
                </Button>
              )}
              {blocked && <p role="status">Profile blocked.</p>}
            </div>
          )}
        </>
      )}
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
  if (detail.statsVisible === false || peer?.statsVisible === false)
    return <p className="community-empty">Both profiles must share stats to compare training.</p>;
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

type ProfileSection = 'overview' | 'stats' | 'history';
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
  onWorkout?: (id: string) => void;
  onRepeat?: (id: string) => void;
  initialView?: ProfileSection;
  onViewChange?: (view: ProfileSection) => void;
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
  onRepeat,
  initialView = 'overview',
  onViewChange,
}: OwnProps) {
  const [view, setView] = useState<ProfileSection>(initialView);
  const stats = useMemo(() => exerciseStatsFromWorkouts(data.workouts), [data.workouts]);
  const history = useMemo(() => historyItemsFromWorkouts(data.workouts), [data.workouts]);
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [name, setName] = useState(session?.profile.displayName ?? '');
  const [timezone, setTimezone] = useState(session?.profile.trainingTimezone ?? 'UTC');
  const [automatic, setAutomatic] = useState(session?.sharing.autoPublishWorkouts ?? false);
  const [shared, setShared] = useState(session?.sharing.summaryEnabled ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const account = useRef(session?.accountId);
  account.current = session?.accountId;
  useEffect(() => {
    setName(session?.profile.displayName ?? '');
    setTimezone(session?.profile.trainingTimezone ?? 'UTC');
    setAutomatic(session?.sharing.autoPublishWorkouts ?? false);
    setShared(session?.sharing.summaryEnabled ?? false);
  }, [session]);
  const go = (next: ProfileSection) => {
    setView(next);
    onViewChange?.(next);
    window.scrollTo({ top: 0 });
  };
  const run = async (action: () => Promise<AccountSession | void>) => {
    if (!session || busy) return;
    const id = session.accountId;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const next = await action();
      if (account.current === id && next) onSessionChange(next);
    } catch (e) {
      if (account.current === id)
        setError(e instanceof Error ? e.message : 'Could not save changes.');
    } finally {
      if (account.current === id) setBusy(false);
    }
  };
  if (!session)
    return (
      <main className="page own-profile-page">
        <p>Sign in to view your profile.</p>
        <Button onClick={onBack}>Back</Button>
      </main>
    );
  const toggleStats = () =>
    void run(async () => {
      const next = await patchSharing(session.accountId, {
        summaryEnabled: !shared,
        autoPublishWorkouts: session.sharing.autoPublishWorkouts,
        policyRevision: session.sharing.policyRevision,
        audienceAcknowledged: !shared,
      });
      if (account.current === session.accountId) setShared(next.sharing.summaryEnabled);
      return next;
    });
  return (
    <main className="page own-profile-page">
      <header className="page-heading">
        <div className="community-own-identity profile-identity">
          <Avatar profile={session.profile} />
          <h1>{session.profile.displayName}</h1>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit display name"
            onClick={() => {
              setName(session.profile.displayName);
              setError('');
              setEditing(true);
            }}
          >
            <Pencil size={17} />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Account settings"
          onClick={() => {
            setError('');
            setTimezone(session.profile.trainingTimezone);
            setAutomatic(session.sharing.autoPublishWorkouts);
            setSettings(true);
          }}
        >
          <Settings size={19} />
        </Button>
      </header>
      {view !== 'overview' && (
        <>
          <Button className="back-button" variant="ghost" onClick={() => go('overview')}>
            <ArrowLeft size={16} /> Back to profile
          </Button>
          <h2 className="profile-section-heading">
            {view === 'stats' ? 'Exercise stats' : 'Workout history'}
          </h2>
        </>
      )}
      {view === 'overview' && (
        <>
          <TrainingLinks onStats={() => go('stats')} onHistory={() => go('history')} />
          <div className="profile-share-setting">
            <div>
              <label htmlFor="share-profile-stats">
                Share profile stats with others in community
              </label>
              <p className="muted small">
                When on, members can see your all-history exercise stats and lift records, including
                private workouts. Workout sharing is separate. Notes and Coach conversations stay
                private.
              </p>
            </div>
            <button
              id="share-profile-stats"
              className="switch"
              role="switch"
              aria-label="Share profile stats with others in community"
              aria-checked={shared}
              data-on={shared}
              disabled={busy}
              onClick={toggleStats}
            >
              <span />
            </button>
          </div>
        </>
      )}
      {view === 'stats' && (
        <ExerciseStats stats={stats} unit={unit} timeZone={session.profile.trainingTimezone} />
      )}
      {view === 'history' && (
        <WorkoutHistory
          items={history}
          timeZone={session.profile.trainingTimezone}
          onWorkout={(id) => onWorkout?.(id)}
          onRepeat={onRepeat}
        />
      )}
      {error && (
        <p role="alert" className="community-error-text">
          {error}
        </p>
      )}
      <Sheet
        open={editing}
        onOpenChange={setEditing}
        title="Edit display name"
        description="This is the name other community members see."
      >
        <label className="form-field">
          <span>Display name</span>
          <input
            autoFocus
            className="input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="sheet-actions">
          <Button onClick={() => setEditing(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !name.trim()}
            onClick={() =>
              void run(async () => {
                const next = await patchProfile(session.accountId, {
                  displayName: name.trim(),
                  trainingTimezone: session.profile.trainingTimezone,
                });
                if (account.current === session.accountId) setEditing(false);
                return next;
              })
            }
          >
            Save name
          </Button>
        </div>
      </Sheet>
      <Sheet
        open={settings}
        onOpenChange={setSettings}
        title="Account settings"
        description={session.email}
      >
        <div className="form-field">
          <span className="muted small">Training timezone</span>
          <TimezonePicker value={timezone} onChange={setTimezone} />
        </div>
        <label className="community-consent">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(e) => setAutomatic(e.target.checked)}
          />
          <span>Automatically share future finished workouts</span>
        </label>
        <p className="muted small">
          All admitted members can see shared workout dates, exercise names, completed loads and
          reps. Older workouts remain private. Turning this off affects future workouts.
        </p>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              let next = session;
              if (timezone !== session.profile.trainingTimezone)
                next = await patchProfile(session.accountId, {
                  displayName: session.profile.displayName,
                  trainingTimezone: timezone,
                });
              if (automatic !== session.sharing.autoPublishWorkouts)
                next = await patchSharing(session.accountId, {
                  summaryEnabled: shared,
                  autoPublishWorkouts: automatic,
                  policyRevision: session.sharing.policyRevision,
                  audienceAcknowledged: automatic,
                });
              setStatus('Account settings saved.');
              return next;
            })
          }
        >
          Save account settings
        </Button>
        <div className="divider" />
        <div className="community-own-actions">
          <Button
            onClick={() => {
              setSettings(false);
              onSettings();
            }}
          >
            App settings
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await hideWorkouts(session.accountId);
                setStatus('All shared workouts are now hidden.');
              })
            }
          >
            Hide all shared workouts
          </Button>
          <Button onClick={onSignOut}>Sign out</Button>
          {legacyAvailable && onClaimLegacy && (
            <Button
              onClick={() => {
                setSettings(false);
                onClaimLegacy();
              }}
            >
              Claim device history
            </Button>
          )}
        </div>
        {status && <p role="status">{status}</p>}
        {error && <p role="alert">{error}</p>}
      </Sheet>
    </main>
  );
}
