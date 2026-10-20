import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  ChevronDown,
  BarChart3,
  CheckCircle2,
  Clock3,
  Dumbbell,
  FileDown,
  FileUp,
  History,
  Play,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  SkipForward,
  Sparkles,
  Undo2,
  X,
  Trash2,
  Users,
  UserRound,
} from 'lucide-react';
import {
  startWorkout,
  repeatWorkout,
  setDone,
  addWorkoutSet,
  updateSet,
  finishWorkout,
  discardWorkout,
  applyProposal,
  rejectProposal,
  progressionProposals,
  toDisplayWeight,
  fromDisplayWeight,
  id,
  replaceWorkoutExercise,
  deleteRoutine,
  updateWorkoutFeedback,
  previousExerciseNote,
  previousWorkoutNote,
} from '../shared/domain';
import { catalog } from '../shared/catalog';
import { coachSelection } from '../shared/coachSelection';
import { evidence as evidenceRecords } from '../evidence/records';
import type {
  AppData,
  Exercise,
  Proposal,
  Routine,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '../shared/types';
import { useAppStore } from './lib/store';
import { Button } from './components/ui/Button';
import { ProgressCalendar } from './components/ProgressCalendar';
import { Sheet as Dialog } from './components/ui/Sheet';
import { ProposalCard } from './components/ProposalCard';
import { Sheet } from './components/ui/Sheet';
import { RoutineEditor } from './components/RoutineEditor';
import { ProfileSetup } from './components/ProfileSetup';
import { SetTable } from './components/SetTable';
import { SearchPicker } from './components/SearchPicker';
import { FirstRunOnboarding } from './components/FirstRunOnboarding';
import { formatLoadValue } from './components/LoadSemantics';
import { SyncDetails } from './components/SyncDetails';
import { CommunityScreen, OwnProfileScreen } from './components/CommunityScreen';
import { WorkoutSummary } from './components/WorkoutSummary';
import {
  ExerciseStats,
  WorkoutHistory,
  TrainingLinks,
  historyItemsFromWorkouts,
} from './components/TrainingHistory';
import { exerciseStatsFromWorkouts } from '../shared/trainingStats';
import { WorkoutVisibilityControl } from './components/WorkoutVisibilityControl';
import type { AccountSession } from '../shared/community';
import { mondayOfDate, recentMondayDates, trainingDateAt } from '../shared/trainingDates';
import './shell.css';
import { addSampleRoutine } from './lib/sampleRoutine';
import {
  applyInspectedRoutineProposal,
  commitRoutineDraft,
  createRoutineDraft,
  hasRoutineDraftChanges,
  type RoutineDraft,
} from './lib/routineDraft';
import { listenForRoutineEditorBack, pushRoutineEditorHistory } from './lib/editorNavigation';

type Tab = 'train' | 'progress' | 'community' | 'profile' | 'coach' | 'settings' | 'workout-detail';
const allExercises = (data: AppData) => [...catalog, ...data.exercises];
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const duration = (start: string, end?: string) =>
  Math.max(
    1,
    Math.round(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 60000),
  );
const totalSets = (w: Workout) =>
  w.exercises.reduce((n, e) => n + e.actualSets.filter((s) => s.kind === 'working').length, 0);
const completedSets = (w: Workout) =>
  w.exercises.reduce(
    (n, e) =>
      n + e.actualSets.filter((s) => s.kind === 'working' && s.status === 'completed').length,
    0,
  );
const scopeLabel = (s: string) =>
  s === 'current_workout'
    ? 'Today only'
    : s === 'next_workout'
      ? 'Next workout'
      : 'Routine going forward';
const applyDoneValues = (
  data: AppData,
  workoutId: string,
  exerciseId: string,
  setId: string,
  patch?: Partial<WorkoutSet>,
) => {
  const set = data.workouts
    .find((item) => item.id === workoutId)
    ?.exercises.find((item) => item.id === exerciseId)
    ?.actualSets.find((item) => item.id === setId);
  const changed =
    set &&
    patch &&
    (['weight', 'reps'] as const).some(
      (field) => patch[field] !== undefined && patch[field] !== set[field],
    );
  return changed
    ? updateSet(data, workoutId, exerciseId, setId, (current) => ({ ...current, ...patch }))
    : data;
};

function App() {
  const store = useAppStore();
  const data = store.data;
  const session = store.session ?? null;
  const canCoach = session?.coachEnabled ?? false;
  const [tab, setTab] = useState<Tab>('train');
  const [progressView, setProgressView] = useState<'overview' | 'stats' | 'history'>('overview');
  const [profileView, setProfileView] = useState<'overview' | 'stats' | 'history'>('overview');
  const [ownWorkoutId, setOwnWorkoutId] = useState<string | null>(null);
  const [ownWorkoutReturn, setOwnWorkoutReturn] = useState<Tab>('progress');
  const [legacyClaimRequested, setLegacyClaimRequested] = useState(false);
  const [legacyCounts, setLegacyCounts] = useState<{ workouts: number; routines: number } | null>(
    null,
  );
  const previousAccount = useRef<string | null>(null);
  const [modal, setModal] = useState('');
  const [editorDraft, setEditorDraft] = useState<RoutineDraft | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorName, setEditorName] = useState('');
  const [editorReturnTab, setEditorReturnTab] = useState<Tab>('train');
  const [discardRequested, setDiscardRequested] = useState(false);
  const [routineDeleteId, setRoutineDeleteId] = useState<string | null>(null);
  const [deleteDataRequested, setDeleteDataRequested] = useState(false);
  const [discardWorkoutRequested, setDiscardWorkoutRequested] = useState<string | null>(null);
  const [leaveEditorToWorkout, setLeaveEditorToWorkout] = useState(false);
  const editorBackCleanup = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState('');
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [currentEx, setCurrentEx] = useState(0);
  const [undo, setUndo] = useState<{ data: AppData; label: string } | null>(null);
  const [profileDraft, setProfileDraft] = useState<any>(null);
  const [settingsTab, setSettingsTab] = useState<'general' | 'profile' | 'coach'>('general');
  const [settingsReturnTab, setSettingsReturnTab] = useState<Tab>('train');
  const [availableProviders, setAvailableProviders] = useState<{ id: string; models: string[] }[]>(
    [],
  );
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [context, setContext] = useState<{
    routineId?: string;
    workoutId?: string;
    exerciseId?: string;
  }>({});
  const [timerNow, setTimerNow] = useState(Date.now());
  const [summaryWorkout, setSummaryWorkout] = useState<Workout | null>(null);
  const [proposalSelection, setProposalSelection] = useState<Record<string, number[]>>({});
  const [backupPreview, setBackupPreview] = useState<AppData | null>(null);
  const [correction, setCorrection] = useState<{
    workout: Workout;
    exercise: WorkoutExercise;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newExercise, setNewExercise] = useState<Partial<Exercise>>({
    name: '',
    muscles: [],
    equipment: '',
    instructions: '',
    loadMode: 'external',
    region: 'upper',
  });
  const active = data?.workouts.find((w: Workout) => w.status === 'active');
  const currentAccount = useRef(session?.accountId ?? null);
  currentAccount.current = session?.accountId ?? null;
  const coachRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const accountId = session?.accountId ?? null;
    if (previousAccount.current === accountId) return;
    previousAccount.current = accountId;
    coachRequest.current?.abort();
    setChatBusy(false);
    setModal('');
    setEditorDraft(null);
    setEditorVisible(false);
    setWorkoutId(null);
    setOwnWorkoutId(null);
    setProfileView('overview');
    setCorrection(null);
    setUndo(null);
    setContext({});
    setChatText('');
    setChatError('');
    setSummaryWorkout(null);
    setTab('train');
  }, [session?.accountId]);
  const workout = data?.workouts.find((w: Workout) => w.id === (workoutId || active?.id));
  useEffect(() => {
    if (editorVisible) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [editorVisible]);
  const lastTab = useRef(tab);
  useEffect(() => {
    if (lastTab.current !== tab) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    lastTab.current = tab;
  }, [tab]);
  useEffect(() => {
    if (active && !workoutId) {
      setWorkoutId(active.id);
      setCurrentEx(0);
    }
  }, [active?.id]);
  useEffect(() => {
    if (!canCoach && tab === 'coach') setTab('train');
    if (!canCoach && settingsTab === 'coach') setSettingsTab('general');
  }, [canCoach, tab, settingsTab]);
  useEffect(() => {
    const t = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setAvailableProviders([]);
    fetch('/api/providers', {
      signal: controller.signal,
      cache: 'no-store',
      headers: session ? { 'X-Lifts-Account': session.accountId } : {},
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((v) =>
        !controller.signal.aborted && Array.isArray(v) ? setAvailableProviders(v) : undefined,
      )
      .catch(() => {
        if (!controller.signal.aborted) setAvailableProviders([]);
      });
    return () => controller.abort();
  }, [session?.accountId, session?.coachEnabled]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 4500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const say = (message: string) => setNotice(message);
  const safeUpdate = async (fn: (d: AppData) => AppData) => {
    try {
      await store.update(fn);
      return true;
    } catch (e) {
      say((e as Error).message);
      return false;
    }
  };
  const mutate = (fn: (d: AppData) => AppData, label?: string) => {
    if (!data) return;
    let before: AppData | undefined;
    let changed = false;
    void safeUpdate((d) => {
      const next = fn(d);
      changed = next !== d;
      if (changed) before = d;
      return next;
    }).then((ok) => {
      if (ok && changed) setUndo(label && before ? { data: before, label } : null);
    });
  };
  const setChange = (fn: (d: AppData) => AppData, label = 'Set updated') => mutate(fn, label);
  const activeExercise =
    workout?.exercises[Math.min(currentEx, Math.max(0, (workout?.exercises.length || 1) - 1))];
  const exerciseById = (eid: string) => data && allExercises(data).find((e) => e.id === eid);
  const setInitialAudience = (next: AppData) => ({
    ...next,
    workouts: next.workouts.map((w) =>
      w.status === 'active'
        ? {
            ...w,
            trainingTimezone: session?.profile.trainingTimezone ?? w.trainingTimezone,
            trainingDate: trainingDateAt(
              w.startedAt,
              session?.profile.trainingTimezone ?? w.trainingTimezone ?? 'UTC',
            ),
            communityVisibility: {
              visibility: session?.sharing.autoPublishWorkouts
                ? ('community' as const)
                : ('private' as const),
              policyRevision: session?.sharing.policyRevision ?? 0,
            },
          }
        : w,
    ),
  });
  const openOwnWorkout = (id: string) => {
    setOwnWorkoutId(id);
    setOwnWorkoutReturn(tab);
    setTab('workout-detail');
    window.scrollTo({ top: 0 });
  };
  const onSessionChange = (_session: AccountSession) => {
    void store.refreshSession?.();
  };
  const openAccountSettings = () => {
    setProfileDraft(structuredClone(data?.settings));
    setSettingsTab('general');
    setModal('settings');
  };
  const start = (routineId: string) => {
    try {
      mutate((d) => setInitialAudience(startWorkout(d, routineId)));
      setWorkoutId(null);
      setTab('train');
      setNotice('');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const repeat = (id: string) => {
    try {
      mutate((d) => setInitialAudience(repeatWorkout(d, id)));
      setWorkoutId(null);
      setTab('train');
      setNotice('');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const closeEditor = () => {
    const consumeEditorEntry = window.history.state?.routineEditor;
    // Programmatic Save/discard exits must stop the dirty browser-Back guard
    // before history.back dispatches; effect cleanup can happen too late.
    editorBackCleanup.current?.();
    editorBackCleanup.current = null;
    setEditorDraft(null);
    setEditorVisible(false);
    setDiscardRequested(false);
    setTab(editorReturnTab);
    if (consumeEditorEntry) window.history.back();
  };
  const requestEditorExit = (resumeWorkout = false) => {
    setLeaveEditorToWorkout(resumeWorkout);
    if (editorDraft && hasRoutineDraftChanges(editorDraft, editorName)) setDiscardRequested(true);
    else {
      closeEditor();
      if (resumeWorkout && active) {
        setWorkoutId(active.id);
        setTab('train');
      }
    }
  };
  useEffect(() => {
    if (!editorDraft) return;
    if (!editorVisible) {
      const resumeDraft = () => {
        pushRoutineEditorHistory();
        setEditorVisible(true);
        setTab('train');
      };
      window.addEventListener('popstate', resumeDraft);
      return () => window.removeEventListener('popstate', resumeDraft);
    }
    const unlisten = listenForRoutineEditorBack({
      isDirty: () => hasRoutineDraftChanges(editorDraft, editorName),
      onDiscardRequest: () => setDiscardRequested(true),
      onCleanBack: closeEditor,
    });
    editorBackCleanup.current = unlisten;
    return () => {
      unlisten();
      if (editorBackCleanup.current === unlisten) editorBackCleanup.current = null;
    };
  }, [editorDraft, editorVisible, editorName, editorReturnTab]);
  const openDraftEditor = (proposal: Proposal) => {
    if (!proposal.routineDraft) return;
    if (editorDraft && hasRoutineDraftChanges(editorDraft, editorName)) {
      setChatError('Save or discard your current draft before reviewing another routine.');
      return;
    }
    const draft = createRoutineDraft(undefined, proposal.id);
    draft.routine = structuredClone(proposal.routineDraft);
    draft.initialDraftFingerprint = JSON.stringify(draft.routine);
    setEditorDraft(draft);
    setEditorVisible(true);
    setEditorName(draft.routine.name);
    if (!editorDraft) setEditorReturnTab(tab);
    setModal('');
    if (!editorDraft) pushRoutineEditorHistory();
  };
  const openRoutine = (r?: Routine) => {
    if (editorDraft && hasRoutineDraftChanges(editorDraft, editorName)) {
      setChatError('Save or discard your current draft before opening another routine.');
      return;
    }
    const draft = createRoutineDraft(r);
    setEditorDraft(draft);
    setEditorVisible(true);
    setEditorName(r?.name || '');
    if (!editorDraft) setEditorReturnTab(tab);
    setModal('');
    if (!editorDraft) pushRoutineEditorHistory();
  };
  const saveRoutine = () => {
    if (!data || !editorDraft) return;
    try {
      if (editorDraft.proposalId) {
        const proposalId = editorDraft.proposalId;
        const saved = {
          ...structuredClone(editorDraft.routine),
          name: editorName.trim(),
          updatedAt: new Date().toISOString(),
        };
        void safeUpdate((d) => {
          return applyInspectedRoutineProposal(
            d,
            proposalId,
            saved,
            editorDraft.customExercises,
            editorDraft.increments,
          );
        }).then((ok) => {
          if (ok) {
            closeEditor();
            say('Routine draft reviewed and saved');
          }
        });
      } else {
        void safeUpdate((d) => commitRoutineDraft(d, editorDraft, editorName)).then((ok) => {
          if (ok) {
            closeEditor();
            say('Routine saved');
          }
        });
      }
    } catch (e) {
      say((e as Error).message);
    }
  };
  const openCoach = (ctx: typeof context = {}) => {
    if (!canCoach) return;
    setContext(ctx);
    setModal('');
    setTab('coach');
  };
  const submitChat = async () => {
    if (!data || !chatText.trim() || chatBusy) return;
    if (!canCoach) {
      setChatError(
        'Coach is not enabled for this account. Your training and community remain available.',
      );
      return;
    }
    if (status !== 'synced') {
      setChatError(
        status === 'conflict'
          ? 'Resolve the sync conflict in Settings before asking Coach.'
          : status === 'offline'
            ? 'Coach needs a connection. Your local workout data is safe; try again when online.'
            : status === 'error'
              ? 'Your latest training context could not sync. Check Settings and try again.'
              : 'Coach can respond after your training data finishes syncing.',
      );
      return;
    }
    const message = chatText.trim();
    const selection = coachSelection(availableProviders, data.settings);
    if (!selection) {
      setChatError(
        'No Coach provider is available yet. Configure a provider on the server to enable chat.',
      );
      return;
    }
    const accountId = currentAccount.current;
    const controller = new AbortController();
    coachRequest.current = controller;
    const stillCurrent = () => !controller.signal.aborted && accountId === currentAccount.current;
    setChatText('');
    setChatBusy(true);
    setChatError('');
    const user = {
      id: id('msg'),
      role: 'user' as const,
      text: message,
      createdAt: new Date().toISOString(),
    };
    try {
      await store.update((d) => ({ ...d, messages: [...d.messages, user] }));
      if (!stillCurrent()) return;
      const response = await fetch('/api/coach/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(accountId ? { 'X-Lifts-Account': accountId } : {}),
        },
        body: JSON.stringify({
          message,
          context,
          ...selection,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: undefined }))) as {
          error?: string;
        };
        throw new Error(body.error || `Coach request failed (${response.status}).`);
      }
      const result = (await response.json()) as {
        text: string;
        proposals?: Proposal[];
        evidence?: any[];
      };
      if (!stillCurrent()) return;
      const reply = {
        id: id('msg'),
        role: 'assistant' as const,
        text: result.text,
        createdAt: new Date().toISOString(),
        proposalId: result.proposals?.[0]?.id,
        evidenceIds: result.evidence?.map((e: any) => e.id),
      };
      await store.update((d) => ({
        ...d,
        messages: [...d.messages, reply],
        proposals: [...d.proposals, ...(result.proposals || [])],
      }));
    } catch (e) {
      if (stillCurrent()) setChatError((e as Error).message);
    } finally {
      if (stillCurrent()) setChatBusy(false);
    }
  };
  const editSet = (exerciseId: string, set: WorkoutSet, patch: Partial<WorkoutSet>) => {
    if (!data || !workout) return;
    let changed = false;
    let before: AppData | undefined;
    void safeUpdate((d) => {
      if (!d.workouts.some((item) => item.id === workout.id && item.status === 'active')) return d;
      const next = updateSet(d, workout.id, exerciseId, set.id, (s) => ({ ...s, ...patch }));
      changed = next !== d;
      if (changed) before = d;
      return next;
    }).then((ok) => {
      if (ok && changed && before) setUndo({ data: before, label: 'Set updated' });
    });
  };
  const toggleSetDone = (
    targetWorkout: Workout,
    exerciseId: string,
    setId: string,
    done: boolean,
    patch?: Partial<WorkoutSet>,
  ) => {
    let changed = false;
    let before: AppData | undefined;
    void safeUpdate((d) => {
      if (!d.workouts.some((item) => item.id === targetWorkout.id && item.status === 'active'))
        return d;
      const edited = done ? applyDoneValues(d, targetWorkout.id, exerciseId, setId, patch) : d;
      const next = setDone(edited, targetWorkout.id, exerciseId, setId, done);
      changed = next !== d;
      if (changed && targetWorkout.status === 'active') before = d;
      return next;
    }).then((ok) => {
      if (ok && changed && targetWorkout.status === 'active' && before) {
        setUndo({ data: before, label: done ? 'Set completed' : 'Set restored' });
        say(done ? 'Set logged' : 'Set restored');
      }
    });
  };
  const skipRest = () => {
    if (!data || !workout) return;
    void safeUpdate((d) => ({
      ...d,
      workouts: d.workouts.map((w) =>
        w.id === workout.id ? { ...w, restEndsAt: undefined, restSetId: undefined } : w,
      ),
    }));
  };
  const undoLast = () => {
    if (!undo || !store.data) return;
    const targetId = workoutId || active?.id;
    const prior = targetId && undo.data.workouts.find((w) => w.id === targetId);
    if (!prior) {
      setUndo(null);
      return;
    }
    void safeUpdate((d) => ({
      ...d,
      workouts: d.workouts.map((w) =>
        w.id === targetId
          ? {
              ...prior,
              notes: w.notes,
              feeling: w.feeling,
              updatedAt: new Date().toISOString(),
              exercises: prior.exercises.map((e) => {
                const current = w.exercises.find((item) => item.id === e.id);
                return current
                  ? {
                      ...e,
                      notes: current.notes,
                      feeling: current.feeling,
                      repsInReserve: current.repsInReserve,
                    }
                  : e;
              }),
            }
          : w,
      ),
    }));
    setUndo(null);
    say('Undone');
  };
  const finish = () => {
    if (!data || !workout) return;
    let suggestions: Proposal[] = [];
    let finishedSnapshot: Workout | undefined;
    void safeUpdate((d) => {
      const finished = finishWorkout(d, workout.id);
      finishedSnapshot = finished.workouts.find((item) => item.id === workout.id);
      suggestions = progressionProposals(finished, workout.id);
      return { ...finished, proposals: [...finished.proposals, ...suggestions] };
    }).then((ok) => {
      if (ok) {
        setWorkoutId(null);
        setUndo(null);
        if (finishedSnapshot) setSummaryWorkout(finishedSnapshot);
        setModal('summary');
        say(
          suggestions.length
            ? 'A progression suggestion is ready in Progress → Exercise stats.'
            : 'Workout saved. Nice work.',
        );
      }
    });
  };
  const saveFinishedWorkoutFeedback = async (
    targetWorkoutId: string,
    feedback: { notes?: string; feeling?: string },
  ) => {
    let updatedWorkout: Workout | undefined;
    const ok = await safeUpdate((d) => {
      const next = updateWorkoutFeedback(d, targetWorkoutId, feedback);
      updatedWorkout = next.workouts.find((item) => item.id === targetWorkoutId);
      return next;
    });
    if (ok && updatedWorkout)
      setSummaryWorkout((current) => (current?.id === targetWorkoutId ? updatedWorkout! : current));
    return ok;
  };
  const discardActiveWorkout = () => {
    const targetId = discardWorkoutRequested;
    if (!targetId) return;
    let discarded = false;
    void safeUpdate((d) => {
      const next = discardWorkout(d, targetId);
      discarded = next !== d;
      return next;
    }).then((ok) => {
      if (!ok) return;
      setDiscardWorkoutRequested(null);
      if (!discarded) {
        say('This workout is no longer active');
        return;
      }
      setWorkoutId(null);
      setCurrentEx(0);
      setUndo(null);
      setSummaryWorkout(null);
      setContext((current) => (current.workoutId === targetId ? {} : current));
      setTab('train');
      say('Workout discarded');
    });
  };
  const saveProfile = () => {
    if (!data || !profileDraft) return;
    void safeUpdate((d) => ({
      ...d,
      settings: {
        ...d.settings,
        unit: profileDraft.unit,
        provider: (coachSelection(availableProviders, profileDraft)?.provider ||
          profileDraft.provider) as AppData['settings']['provider'],
        model: coachSelection(availableProviders, profileDraft)?.model || profileDraft.model,
        profile: profileDraft.profile,
        increments: profileDraft.increments,
      },
    }));
    setModal('');
    say('Settings saved');
  };
  const updateCorrectionSnapshot = (setId: string, patch: Partial<WorkoutSet>) =>
    setCorrection((prev) =>
      prev
        ? {
            ...prev,
            exercise: {
              ...prev.exercise,
              actualSets: prev.exercise.actualSets.map((s) =>
                s.id === setId ? { ...s, ...patch } : s,
              ),
            },
          }
        : prev,
    );
  const toggleCorrectionDone = (
    workout: Workout,
    exercise: WorkoutExercise,
    setId: string,
    done: boolean,
    patch?: Partial<WorkoutSet>,
  ) => {
    let updated: WorkoutSet | undefined;
    void safeUpdate((d) => {
      if (!d.workouts.some((item) => item.id === workout.id && item.status === 'finished'))
        return d;
      const edited = done ? applyDoneValues(d, workout.id, exercise.id, setId, patch) : d;
      const next = setDone(edited, workout.id, exercise.id, setId, done);
      if (next !== d)
        updated = next.workouts
          .find((item) => item.id === workout.id)
          ?.exercises.find((item) => item.id === exercise.id)
          ?.actualSets.find((item) => item.id === setId);
      return next;
    }).then((ok) => {
      if (ok && updated) updateCorrectionSnapshot(setId, updated);
    });
  };
  const editCorrectionSet = (
    workout: Workout,
    exercise: WorkoutExercise,
    setId: string,
    patch: Partial<WorkoutSet>,
  ) => {
    let updated: WorkoutSet | undefined;
    void safeUpdate((d) => {
      if (!d.workouts.some((item) => item.id === workout.id && item.status === 'finished'))
        return d;
      const next = updateSet(d, workout.id, exercise.id, setId, (current) => ({
        ...current,
        ...patch,
      }));
      updated = next.workouts
        .find((item) => item.id === workout.id)
        ?.exercises.find((item) => item.id === exercise.id)
        ?.actualSets.find((item) => item.id === setId);
      return next;
    }).then((ok) => {
      if (ok && updated) updateCorrectionSnapshot(setId, updated);
    });
  };
  const exportBackup = async () => {
    const json = await store.exportData();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `training-lab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const previewImport = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const { validateBackup } = await import('../shared/domain');
      setBackupPreview(validateBackup(parsed));
      setModal('import');
    } catch (e) {
      say(`Backup could not be validated: ${(e as Error).message}`);
    }
  };
  const confirmImport = async () => {
    if (!backupPreview) return;
    await store.importData(backupPreview);
    setBackupPreview(null);
    setModal('');
    say('Backup restored');
  };
  const applyPending = (proposal: Proposal) => {
    if (proposal.routineDraft) {
      openDraftEditor(proposal);
      return;
    }
    const selected =
      proposalSelection[proposal.id] ??
      (proposal.edits.length ? proposal.edits.map((_, i) => i) : [0]);
    try {
      void safeUpdate((d) => applyProposal(d, proposal.id, selected));
      say('Selected change applied');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const status = store.syncStatus;
  if (!data)
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">Lifts Coach</div>
          <span className="pill">
            <span className="status-dot" />
            Starting locally
          </span>
        </header>
        <main className="page">
          <div className="empty-state">
            <div className="empty-icon">
              <Dumbbell />
            </div>
            <h2>Setting up your training space</h2>
            <p className="muted">Your workouts will be saved on this device.</p>
          </div>
        </main>
      </div>
    );
  if (session?.profileSetupRequired && store.identityStatus === 'verified')
    return (
      <ProfileSetup
        key={session.accountId}
        session={session}
        onComplete={async () => {
          await store.refreshSession?.();
        }}
      />
    );
  const viewedWorkout =
    !!workout && workout.status === 'active' && tab === 'train' && !editorVisible;
  const showMini = !!active && (tab !== 'train' || editorVisible);

  return (
    <div
      className={`app-shell${showMini ? ' has-active-session' : ''}${editorVisible ? ' is-routine-editor' : ''}`}
    >
      {!editorVisible && (
        <header className="topbar">
          <button
            className="brand brand-home"
            onClick={() => setTab('train')}
            aria-label="Lifts Coach home"
          >
            <span className="brand-mark">
              <Dumbbell size={21} />
            </span>
            Lifts Coach
          </button>
          <div className="top-actions">
            <span className="pill desktop-only">
              <span className="status-dot" />
              {status === 'local'
                ? 'Saved on device'
                : status === 'syncing'
                  ? 'Syncing'
                  : status === 'conflict'
                    ? 'Sync conflict'
                    : status === 'offline'
                      ? 'Offline'
                      : status === 'error'
                        ? 'Sync issue'
                        : 'Synced'}
            </span>
            {canCoach && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ask Coach"
                onClick={() =>
                  openCoach(
                    active ? { workoutId: active.id, exerciseId: activeExercise?.exerciseId } : {},
                  )
                }
              >
                <Sparkles size={19} />
              </Button>
            )}
            <Button
              className="profile-avatar-button"
              variant="ghost"
              size="icon"
              aria-label="Your profile"
              onClick={() => {
                setProfileView('overview');
                setTab('profile');
              }}
            >
              {session?.profile.displayName?.trim() ? (
                <span aria-hidden="true">
                  {session.profile.displayName.trim().slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <UserRound size={19} />
              )}
            </Button>
          </div>
        </header>
      )}
      {editorVisible && editorDraft ? (
        <RoutineEditor
          data={data}
          draft={editorDraft}
          setDraft={setEditorDraft}
          name={editorName}
          setName={setEditorName}
          onBack={requestEditorExit}
          onSave={saveRoutine}
          canCoach={canCoach}
          onAskCoach={() => {
            setContext({});
            setChatText(
              `Help improve this unsaved routine draft: ${editorName || 'New routine'}\nExercises: ${editorDraft.routine.exercises.map((p) => allExercises(data).find((e) => e.id === p.exerciseId)?.name || p.exerciseId).join(', ') || 'none yet'}`,
            );
            setChatError('');
            setModal('');
            setEditorVisible(false);
            setTab('coach');
          }}
        />
      ) : (
        <>
          {tab === 'train' && (
            <main className="page">
              {!viewedWorkout ? (
                data.routines.length === 0 ? (
                  <FirstRunOnboarding
                    onCreateRoutine={() => openRoutine()}
                    onImportBackup={() => fileRef.current?.click()}
                    onTrySampleRoutine={() => {
                      void safeUpdate(addSampleRoutine).then((ok) => {
                        if (ok) say('Sample routine added');
                      });
                    }}
                  />
                ) : (
                  <>
                    {(() => {
                      const next =
                        data.routines[data.settings.rotationIndex % data.routines.length] ||
                        data.routines[0];
                      return (
                        <div className="dashboard-grid">
                          <section className="card card-pad next-session-card">
                            {active ? (
                              <>
                                <div className="eyebrow">Workout in progress</div>
                                <h1>{active.name}</h1>
                                <p className="muted session-summary">
                                  {completedSets(active)} of {totalSets(active)} sets <span>·</span>{' '}
                                  {duration(active.startedAt)} min
                                </p>
                              </>
                            ) : (
                              <>
                                <div className="eyebrow">Up next</div>
                                <h1>{next.name}</h1>
                                <p className="muted session-summary">
                                  {next.exercises.length} exercises <span>·</span>{' '}
                                  {next.exercises.reduce((a, e) => a + e.sets, 0)} sets{' '}
                                  <span>·</span>{' '}
                                  {Math.max(
                                    10,
                                    Math.round(
                                      next.exercises.reduce(
                                        (a, e) => a + e.sets * (e.restSeconds + 35),
                                        0,
                                      ) / 60,
                                    ),
                                  )}{' '}
                                  min
                                </p>
                                <p className="muted small session-exercises">
                                  {next.exercises
                                    .slice(0, 3)
                                    .map((p) => exerciseById(p.exerciseId)?.name || p.exerciseId)
                                    .join(' · ')}
                                  {next.exercises.length > 3 ? ' · …' : ''}
                                </p>
                              </>
                            )}
                            <Button
                              variant="primary"
                              size="lg"
                              className="session-start"
                              onClick={() => {
                                if (active) {
                                  setWorkoutId(active.id);
                                  setTab('train');
                                } else start(next.id);
                              }}
                              disabled={!active && !next.exercises.length}
                            >
                              <Play size={18} fill="currentColor" />{' '}
                              {active ? 'Resume workout' : 'Start workout'}
                            </Button>
                          </section>
                          <section className="routine-panel">
                            <div className="section-title">
                              <h2>Saved routines</h2>
                              <Button variant="ghost" size="sm" onClick={() => openRoutine()}>
                                <Plus size={15} /> New
                              </Button>
                            </div>
                            <div className="routine-list">
                              {data.routines.map((r, i) => (
                                <div className="routine-row" key={r.id}>
                                  <button
                                    className="routine-row-main"
                                    onClick={() => openRoutine(r)}
                                  >
                                    <span className="routine-row-name">{r.name}</span>
                                    <span className="muted small">
                                      {r.exercises.length} exercises ·{' '}
                                      {r.exercises.reduce((a, e) => a + e.sets, 0)} sets
                                      {i === data.settings.rotationIndex % data.routines.length
                                        ? ' · Up next'
                                        : ''}
                                    </span>
                                  </button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Start ${r.name}`}
                                    onClick={() => start(r.id)}
                                    disabled={!r.exercises.length}
                                  >
                                    <Play size={16} />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Delete ${r.name}`}
                                    onClick={() => setRoutineDeleteId(r.id)}
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </section>
                        </div>
                      );
                    })()}
                    <section className="train-history">
                      <div className="section-title">
                        <h2>Recent workouts</h2>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setProgressView('history');
                            setTab('progress');
                          }}
                        >
                          View history
                        </Button>
                      </div>
                      {data.workouts.filter((w) => w.status === 'finished').length === 0 ? (
                        <p className="muted small">Finished workouts will appear here.</p>
                      ) : (
                        data.workouts
                          .filter((w) => w.status === 'finished')
                          .slice()
                          .reverse()
                          .slice(0, 3)
                          .map((w) => (
                            <div className="history-item" key={w.id}>
                              <button
                                className="grow history-workout-link"
                                onClick={() => openOwnWorkout(w.id)}
                              >
                                <b>{w.name}</b>
                                <div className="muted small">
                                  {dateLabel(w.startedAt)} · {duration(w.startedAt, w.completedAt)}{' '}
                                  min · {completedSets(w)} sets
                                </div>
                              </button>
                              <Button size="sm" variant="primary" onClick={() => repeat(w.id)}>
                                <RotateCcw size={15} /> Repeat
                              </Button>
                            </div>
                          ))
                      )}
                    </section>
                  </>
                )
              ) : (
                <WorkoutScreen
                  data={data}
                  workout={workout!}
                  currentEx={currentEx}
                  setCurrentEx={setCurrentEx}
                  activeExercise={activeExercise}
                  editSet={editSet}
                  toggleDone={(
                    exerciseId: string,
                    setId: string,
                    done: boolean,
                    patch?: Partial<WorkoutSet>,
                  ) => toggleSetDone(workout!, exerciseId, setId, done, patch)}
                  timerNow={timerNow}
                  skipRest={skipRest}
                  finish={finish}
                  requestDiscard={() => setDiscardWorkoutRequested(workout!.id)}
                  setUndo={undoLast}
                  undo={undo}
                  say={say}
                  mutate={mutate}
                  saveFeedback={(
                    feedback: {
                      notes?: string;
                      feeling?: string;
                      repsInReserve?: '3+' | '1-2' | '0';
                    },
                    exerciseId?: string,
                  ) =>
                    safeUpdate((d) => updateWorkoutFeedback(d, workout!.id, feedback, exerciseId))
                  }
                />
              )}
            </main>
          )}
          {tab === 'progress' && (
            <ProgressScreen
              data={data}
              timezone={
                session?.profile.trainingTimezone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone ??
                'UTC'
              }
              view={progressView}
              setView={setProgressView}
              onWorkout={openOwnWorkout}
              onRepeat={repeat}
              onCorrection={(w: Workout, e: WorkoutExercise) =>
                setCorrection({ workout: w, exercise: e })
              }
              proposals={data.proposals.filter(
                (p: Proposal) => p.status === 'pending' && p.origin === 'progression',
              )}
              selection={proposalSelection}
              setSelection={setProposalSelection}
              apply={applyPending}
              reject={(p: Proposal) => mutate((d) => rejectProposal(d, p.id))}
            />
          )}
          {tab === 'coach' && canCoach && (
            <CoachScreen
              data={data}
              syncStatus={status}
              chatText={chatText}
              setChatText={setChatText}
              submit={submitChat}
              busy={chatBusy}
              error={chatError}
              proposals={data.proposals.filter((p: Proposal) => p.status === 'pending')}
              selection={proposalSelection}
              setSelection={setProposalSelection}
              apply={applyPending}
              reject={(p: Proposal) => mutate((d) => rejectProposal(d, p.id))}
              openRoutine={openRoutine}
            />
          )}
          {tab === 'community' && (
            <CommunityScreen
              key={session?.accountId ?? 'local'}
              session={session}
              unit={data.settings.unit}
              onSessionChange={onSessionChange}
              onSettings={openAccountSettings}
              onCoach={() => openCoach()}
            />
          )}
          {tab === 'profile' && (
            <OwnProfileScreen
              onRepeat={repeat}
              initialView={profileView}
              onViewChange={setProfileView}
              onWorkout={openOwnWorkout}
              key={session?.accountId ?? 'local'}
              session={session}
              unit={data.settings.unit}
              data={data}
              onSessionChange={onSessionChange}
              onSettings={openAccountSettings}
              onBack={() => setTab('train')}
              onSignOut={() => {
                void store
                  .signOut?.()
                  .then(() => {
                    setTab('train');
                    window.location.assign('/cdn-cgi/access/logout');
                  })
                  .catch((e: Error) => say(e.message));
              }}
              legacyAvailable={store.legacyAvailable}
              onClaimLegacy={() => {
                void store
                  .exportLegacyData?.()
                  .then((text) => {
                    const legacy = text ? (JSON.parse(text) as AppData) : null;
                    setLegacyCounts(
                      legacy
                        ? { workouts: legacy.workouts.length, routines: legacy.routines.length }
                        : null,
                    );
                    setLegacyClaimRequested(true);
                  })
                  .catch((e: Error) => say(e.message));
              }}
            />
          )}
          {tab === 'workout-detail' &&
            (() => {
              const historical = data.workouts.find(
                (w) => w.id === ownWorkoutId && w.status === 'finished',
              );
              return historical ? (
                <WorkoutSummary
                  workout={historical}
                  unit={data.settings.unit}
                  session={session}
                  synced={status === 'synced'}
                  onBack={() => setTab(ownWorkoutReturn)}
                  onRepeat={() => repeat(historical.id)}
                  onCorrection={(e) => setCorrection({ workout: historical, exercise: e })}
                />
              ) : (
                <main className="page">
                  <Button onClick={() => setTab('progress')}>Back to Progress</Button>
                  <p className="muted">This workout is no longer available.</p>
                </main>
              );
            })()}
          {tab === 'settings' && (
            <SettingsScreen
              data={data}
              status={status}
              openSettings={() => {
                setProfileDraft(structuredClone(data.settings));
                setSettingsTab('general');
                setModal('settings');
              }}
              onBack={() => setTab(settingsReturnTab)}
              exportBackup={exportBackup}
              importBackup={() => fileRef.current?.click()}
              conflict={store.conflict}
              pendingCount={store.pendingCount}
              lastSyncedAt={store.lastSyncedAt}
              retrySync={store.retrySync}
              resolveConflict={store.resolveConflict}
              onDeleteData={() => setDeleteDataRequested(true)}
            />
          )}
        </>
      )}
      {showMini && (
        <button
          className="mini-player"
          onClick={() => {
            if (editorVisible) {
              requestEditorExit(true);
              return;
            }
            setWorkoutId(active!.id);
            setTab('train');
          }}
        >
          <div className="grow">
            <b>{active!.name}</b>
            <div className="muted small">
              {completedSets(active!)} / {totalSets(active!)} sets · Return to workout
            </div>
          </div>
          <ArrowRight size={18} />
        </button>
      )}
      {!editorVisible && (
        <nav className="bottom-nav" aria-label="Main navigation">
          <div className="sidebar-brand">
            <span className="brand-mark">
              <Dumbbell size={21} />
            </span>
            Lifts Coach
          </div>
          <div className="sidebar-label eyebrow">Your space</div>
          {(
            [
              ['train', 'Train', Dumbbell],
              ['progress', 'Progress', BarChart3],
              ['community', 'Community', Users],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                if (key === 'train' && editorDraft) setEditorVisible(true);
                if (key === 'progress') setProgressView('overview');
              }}
              className={`nav-button ${tab === key ? 'active' : ''}`}
              aria-current={tab === key ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
          <div className="sidebar-account">
            <button
              className="sidebar-profile"
              onClick={() => {
                setProfileView('overview');
                setTab('profile');
              }}
            >
              <UserRound size={21} />
              <span>
                {session?.profile.displayName || 'Your profile'}
                <small>Profile & settings</small>
              </span>
            </button>
          </div>
        </nav>
      )}
      <Sheet
        open={legacyClaimRequested}
        onOpenChange={setLegacyClaimRequested}
        title="Move device data to your account?"
        description="This browser has older training data without an account owner. Nothing is uploaded until you choose to claim it. An independent legacy copy remains available for export."
      >
        <p>
          {legacyCounts
            ? `${legacyCounts.routines} routines and ${legacyCounts.workouts} workouts are on this device.`
            : 'Review and export the device data before claiming it.'}
        </p>
        <p className="muted small">
          The signed-in account must be empty. Restored workouts stay private until you explicitly
          review sharing.
        </p>
        <div className="sheet-actions">
          <Button onClick={() => setLegacyClaimRequested(false)}>Keep separate</Button>
          <Button
            onClick={() => {
              void store.exportLegacyData?.().then((text) => {
                if (!text) return;
                const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'lifts-coach-device-backup.json';
                a.click();
                URL.revokeObjectURL(url);
              });
            }}
          >
            Export device backup
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void store
                .claimLegacyData?.()
                .then(() => {
                  setLegacyClaimRequested(false);
                  say('Device data claimed for your account');
                })
                .catch((e: Error) => say(e.message));
            }}
          >
            Claim device data
          </Button>
        </div>
      </Sheet>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 className="toast-icon" size={17} />
          <span className="toast-message">{notice}</span>
          {undo && (
            <button onClick={undoLast}>
              <Undo2 size={14} style={{ verticalAlign: 'middle' }} /> Undo
            </button>
          )}
          <button
            aria-label="Dismiss"
            onClick={() => {
              setNotice('');
              setUndo(null);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void previewImport(e.target.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      <Sheet
        open={deleteDataRequested}
        onOpenChange={(open) => !open && setDeleteDataRequested(false)}
        title="Delete all data?"
        description="This permanently removes your routines, workout history, profile, Coach conversation, and settings from this device and Cloudflare. This cannot be undone."
      >
        <div className="sheet-actions">
          <Button onClick={() => setDeleteDataRequested(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              void store
                .deleteAllData()
                .then(() => {
                  setDeleteDataRequested(false);
                  setWorkoutId(null);
                  setTab('train');
                  say('Local and cloud data deleted');
                })
                .catch((error: Error) => say(error.message));
            }}
          >
            Delete all data
          </Button>
        </div>
      </Sheet>
      <Sheet
        open={discardWorkoutRequested !== null}
        onOpenChange={(open) => !open && setDiscardWorkoutRequested(null)}
        title="Discard this workout?"
        description="This removes the active session and all sets logged in it. Nothing from this workout will be saved to history."
      >
        <div className="sheet-actions">
          <Button onClick={() => setDiscardWorkoutRequested(null)}>Keep workout</Button>
          <Button variant="danger" onClick={discardActiveWorkout}>
            Discard workout
          </Button>
        </div>
      </Sheet>
      <Sheet
        open={routineDeleteId !== null}
        onOpenChange={(open) => !open && setRoutineDeleteId(null)}
        title="Delete routine?"
        description={`${data.routines.find((r) => r.id === routineDeleteId)?.name || 'This routine'} will be removed. Active and completed workouts will be kept.`}
      >
        <div className="sheet-actions">
          <Button onClick={() => setRoutineDeleteId(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              const target = routineDeleteId;
              if (!target || !data.routines.some((r) => r.id === target)) {
                setRoutineDeleteId(null);
                return;
              }
              void safeUpdate((d) => deleteRoutine(d, target)).then((ok) => {
                if (ok) setRoutineDeleteId(null);
              });
            }}
          >
            Yes, delete
          </Button>
        </div>
      </Sheet>
      <Sheet
        open={discardRequested}
        onOpenChange={(open) => !open && setDiscardRequested(false)}
        title="Discard routine changes?"
        description="Your routine draft and staged exercise changes will be discarded."
      >
        <div className="sheet-actions">
          <Button onClick={() => setDiscardRequested(false)}>Keep editing</Button>
          <Button
            variant="danger"
            onClick={() => {
              const resumeWorkout = leaveEditorToWorkout && active;
              closeEditor();
              if (resumeWorkout) {
                setWorkoutId(resumeWorkout.id);
                setTab('train');
              }
              setLeaveEditorToWorkout(false);
            }}
          >
            Discard changes
          </Button>
        </div>
      </Sheet>
      <Dialog
        open={modal === 'settings'}
        onOpenChange={(o) => !o && setModal('')}
        title="Settings"
        description="Tune your training context and app preferences."
      >
        {profileDraft && (
          <div className="stack">
            <div className="settings-tabs" role="tablist" aria-label="Settings sections">
              {(['general', 'profile', ...(canCoach ? (['coach'] as const) : [])] as const).map(
                (key) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={settingsTab === key}
                    className={`settings-tab${settingsTab === key ? ' active' : ''}`}
                    onClick={() => setSettingsTab(key)}
                  >
                    {key === 'general' ? 'General' : key === 'profile' ? 'Profile' : 'Coach'}
                  </button>
                ),
              )}
            </div>
            {settingsTab === 'general' && (
              <section className="settings-tab-panel" role="tabpanel">
                <div className="row space-between">
                  <div>
                    <b>Weight units</b>
                    <div className="muted small">
                      Saved weights stay consistent as you switch units.
                    </div>
                  </div>
                  <div className="toggle-row">
                    {['lb', 'kg'].map((u) => (
                      <button
                        key={u}
                        className={profileDraft.unit === u ? 'selected' : ''}
                        onClick={() => setProfileDraft({ ...profileDraft, unit: u })}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="divider" />
                <div className="row space-between">
                  <div>
                    <b>Data &amp; sync</b>
                    <div className="muted small">Backup, restore, and resolve sync status.</div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSettingsReturnTab(tab);
                      setModal('');
                      setTab('settings');
                    }}
                  >
                    Open
                  </Button>
                </div>
              </section>
            )}
            {settingsTab === 'profile' && (
              <section className="settings-tab-panel" role="tabpanel">
                <b>Training profile</b>
                <div className="profile-grid">
                  {(
                    [
                      'goals',
                      'equipment',
                      'schedule',
                      'constraints',
                      'preferences',
                      'notes',
                    ] as const
                  ).map((k) => (
                    <div className="form-field" key={k}>
                      <label>
                        {
                          (
                            {
                              goals: 'Goals',
                              equipment: 'Available equipment',
                              schedule: 'Schedule',
                              constraints: 'Constraints',
                              preferences: 'Preferences',
                              notes: 'Notes',
                            } as any
                          )[k]
                        }
                      </label>
                      <textarea
                        className="textarea"
                        aria-label={k}
                        style={{ minHeight: 72 }}
                        value={profileDraft.profile[k]}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            profile: { ...profileDraft.profile, [k]: e.target.value },
                          })
                        }
                        placeholder="Optional"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
            {settingsTab === 'coach' && canCoach && (
              <section className="settings-tab-panel" role="tabpanel">
                <b>Coach provider</b>
                {availableProviders.length ? (
                  <div className="profile-grid">
                    <div className="form-field">
                      <label>Provider</label>
                      <select
                        className="select"
                        value={coachSelection(availableProviders, profileDraft)?.provider || ''}
                        onChange={(e) => {
                          const models =
                            availableProviders.find((p) => p.id === e.target.value)?.models || [];
                          setProfileDraft({
                            ...profileDraft,
                            provider: e.target.value,
                            model: models[0] || '',
                          });
                        }}
                      >
                        {availableProviders.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.id === 'openai'
                              ? 'OpenAI'
                              : p.id === 'anthropic'
                                ? 'Anthropic'
                                : p.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Model</label>
                      <select
                        className="select"
                        value={coachSelection(availableProviders, profileDraft)?.model || ''}
                        onChange={(e) =>
                          setProfileDraft({
                            ...profileDraft,
                            ...coachSelection(availableProviders, profileDraft),
                            model: e.target.value,
                          })
                        }
                      >
                        {(
                          availableProviders.find(
                            (p) =>
                              p.id === coachSelection(availableProviders, profileDraft)?.provider,
                          )?.models || []
                        ).map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <p className="muted small">No AI provider is configured on the server yet.</p>
                )}
              </section>
            )}
            <div className="dialog-footer">
              <Button onClick={() => setModal('')}>Cancel</Button>
              <Button variant="primary" onClick={saveProfile}>
                Save settings
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog
        open={modal === 'summary'}
        onOpenChange={(o) => !o && setModal('')}
        title="Workout saved"
        description={
          summaryWorkout
            ? `${summaryWorkout.name} · ${completedSets(summaryWorkout)} sets · ${duration(summaryWorkout.startedAt, summaryWorkout.completedAt)} minutes`
            : ''
        }
      >
        <div className="stack">
          <div className="row">
            <span
              className="empty-icon"
              style={{ margin: 0, background: 'var(--green-soft)', color: 'var(--green)' }}
            >
              <CheckCircle2 />
            </span>
            <div>
              <b>Session complete</b>
              <div className="muted small">Your completed sets are now in history.</div>
            </div>
          </div>
          {session && summaryWorkout && (
            <WorkoutVisibilityControl
              session={session}
              workout={summaryWorkout}
              synced={status === 'synced'}
              onLocalChange={async () => false}
            />
          )}
          {summaryWorkout && (
            <WorkoutFeeling
              key={summaryWorkout.id}
              workout={summaryWorkout}
              onSave={(feeling) => saveFinishedWorkoutFeedback(summaryWorkout.id, { feeling })}
            />
          )}
          {summaryWorkout && (
            <WorkoutNote
              key={`${summaryWorkout.id}:notes`}
              workout={summaryWorkout}
              previousNote={data ? previousWorkoutNote(data, summaryWorkout.id) : undefined}
              onSave={(notes) => saveFinishedWorkoutFeedback(summaryWorkout.id, { notes })}
            />
          )}
          <div className="dialog-footer">
            <Button
              onClick={() => {
                setModal('');
                setSummaryWorkout(null);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={modal === 'import'}
        onOpenChange={(o) => !o && setModal('')}
        title="Restore backup?"
        description="This replaces the training data saved on this device."
      >
        <div className="stack">
          <div className="notice">
            Validated backup · {backupPreview?.routines.length || 0} routines ·{' '}
            {backupPreview?.workouts.length || 0} workouts · {backupPreview?.exercises.length || 0}{' '}
            custom exercises
          </div>
          <p className="muted small">Your current data will be replaced after you confirm.</p>
          <div className="dialog-footer">
            <Button onClick={() => setModal('')}>Cancel</Button>
            <Button variant="primary" onClick={() => void confirmImport()}>
              <FileUp size={16} />
              Restore backup
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={!!correction}
        onOpenChange={(o) => !o && setCorrection(null)}
        title={correction?.exercise.name || 'Correct workout'}
        description="Corrections update your saved history and strength trends."
      >
        {correction && (
          <div className="stack">
            <div className="muted small">
              {dateLabel(correction.workout.startedAt)} · {correction.workout.name}
            </div>
            <SetTable
              exercise={correction.exercise}
              unit={data.settings.unit}
              onEdit={(set, patch) => {
                editCorrectionSet(correction.workout, correction.exercise, set.id, patch);
              }}
              onDone={(setId, done, patch) =>
                toggleCorrectionDone(correction.workout, correction.exercise, setId, done, patch)
              }
            />
            <Button variant="primary" onClick={() => setCorrection(null)}>
              Done
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function WorkoutScreen({
  data,
  workout,
  currentEx,
  setCurrentEx,
  activeExercise,
  editSet,
  toggleDone,
  timerNow,
  skipRest,
  finish,
  requestDiscard,
  setUndo,
  undo,
  say,
  mutate,
  saveFeedback,
}: any) {
  const unit = data.settings.unit;
  const ex = activeExercise as WorkoutExercise | undefined;
  const elapsedSeconds = Math.max(0, Math.floor((timerNow - Date.parse(workout.startedAt)) / 1000));
  const restLeft = workout.restEndsAt
    ? Math.max(0, Math.ceil((workout.restEndsAt - timerNow) / 1000))
    : 0;
  const replaceToday = (replacementId: string) => {
    const replacement = allExercises(data).find((e) => e.id === replacementId);
    if (!replacement || !ex) return;
    mutate(
      (d: AppData) => replaceWorkoutExercise(d, workout.id, ex.id, replacementId),
      'Exercise replaced for today',
    );
    say(`${replacement.name} substituted for today`);
  };
  const restChange = (seconds: number) =>
    mutate((d: AppData) => ({
      ...d,
      workouts: d.workouts.map((w: Workout) =>
        w.id === workout.id ? { ...w, restEndsAt: Date.now() + seconds * 1000 } : w,
      ),
    }));
  const priorExerciseNote = ex ? previousExerciseNote(data, workout.id, ex.id) : undefined;
  const saveExerciseFeedback = (feedback: {
    notes?: string;
    feeling?: string;
    repsInReserve?: '3+' | '1-2' | '0';
  }) => {
    if (!ex) return;
    void saveFeedback(feedback, ex.id);
  };
  return (
    <div className="workout-focus">
      <div className="page-heading">
        <div>
          <h1>{workout.name}</h1>
        </div>
        <div className="row">
          <div className="row workout-completion-actions">
            <Button variant="primary" onClick={finish}>
              Finish workout
            </Button>
            <Button
              className="workout-discard-button"
              variant="ghost"
              size="icon"
              aria-label="Discard workout"
              title="Discard workout"
              onClick={requestDiscard}
            >
              <Trash2 size={17} />
            </Button>
          </div>
        </div>
      </div>
      <div className="row space-between small muted">
        <span>
          {completedSets(workout)} of {totalSets(workout)} working sets
        </span>
        <span role="timer" aria-label="Workout elapsed time">
          {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="workout-progress">
        <span
          style={{
            width: `${totalSets(workout) ? (completedSets(workout) / totalSets(workout)) * 100 : 0}%`,
          }}
        />
      </div>
      {ex ? (
        <>
          <div className="card card-pad workout-exercise-card" style={{ marginBottom: 14 }}>
            <div className="row space-between">
              <div>
                <div className="eyebrow">
                  Exercise {currentEx + 1} of {workout.exercises.length}
                </div>
                <SearchPicker
                  key={ex.id}
                  label="Replace exercise"
                  searchLabel="Search replacement exercises"
                  value={ex.exerciseId}
                  triggerLabel={ex.name}
                  triggerIcon={<ArrowLeftRight size={17} aria-hidden="true" />}
                  options={allExercises(data)
                    .filter((item) => item.id !== ex.exerciseId)
                    .map((item) => ({
                      value: item.id,
                      label: item.name,
                      description: `${item.muscles.join(', ')} · ${item.equipment}`,
                    }))}
                  description={`For today only.${ex.actualSets.some((set) => set.status === 'completed') ? ' Completed sets stay with the original exercise; the replacement is added next.' : ''}`}
                  onChange={replaceToday}
                  placeholder="Name, muscle, or equipment"
                  emptyMessage="No exercises found."
                />
                <span className="muted small">
                  {formatLoadValue(ex.loadMode, toDisplayWeight(ex.targetWeight, unit), unit)} ·{' '}
                  target {ex.sets} × {ex.repRange[0]}–{ex.repRange[1]}
                </span>
              </div>
            </div>
          </div>
          {workout.restEndsAt && (
            <div className="rest-box" style={{ marginBottom: 10 }}>
              <Clock3 size={19} />
              <div className="grow rest-timer-context">
                <div className="small">Rest</div>
                <div className="timer">
                  {Math.floor(restLeft / 60)}:{String(restLeft % 60).padStart(2, '0')}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => restChange(Math.max(0, restLeft) + 30)}
              >
                +30 sec
              </Button>
              <Button size="sm" variant="ghost" onClick={skipRest}>
                <SkipForward size={15} />
                Skip
              </Button>
            </div>
          )}
          <SetTable
            exercise={ex}
            unit={unit}
            onEdit={(set, patch) => editSet(ex.id, set, patch)}
            onDone={(setId, done, patch) => toggleDone(ex.id, setId, done, patch)}
            onAdd={() =>
              mutate(
                (d: AppData) => addWorkoutSet(d, workout.id, ex.id, 'working'),
                'Working set added',
              )
            }
          />
          <ExerciseFeedback
            key={`${workout.id}:${ex.id}:${ex.exerciseId}`}
            exercise={ex}
            previousNote={priorExerciseNote}
            onSave={saveExerciseFeedback}
          />
          <div className="row space-between mobile-workout-navigation">
            <Button
              variant="secondary"
              onClick={() => setCurrentEx(Math.max(0, currentEx - 1))}
              disabled={currentEx === 0}
            >
              <ArrowLeft size={16} />
              Previous
            </Button>
            <Button
              variant="secondary"
              onClick={() => setCurrentEx(Math.min(workout.exercises.length - 1, currentEx + 1))}
              disabled={currentEx >= workout.exercises.length - 1}
            >
              Next <ArrowRight size={16} />
            </Button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <h2>No exercises in this session</h2>
        </div>
      )}
    </div>
  );
}

function ExerciseFeedback({
  exercise,
  previousNote,
  onSave,
}: {
  exercise: WorkoutExercise;
  previousNote?: { notes: string; startedAt: string };
  onSave: (feedback: {
    notes?: string;
    feeling?: string;
    repsInReserve?: '3+' | '1-2' | '0';
  }) => void;
}) {
  const [notes, setNotes] = useState(exercise.notes ?? '');
  const [feeling, setFeeling] = useState(exercise.feeling ?? '');
  return (
    <section className="card card-pad workout-feedback" aria-label={`${exercise.name} feedback`}>
      <details className="exercise-notes">
        <summary aria-label="Notes (optional)">
          <span>
            Notes <span className="muted">(optional)</span>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="exercise-notes-content">
          <FeedbackRating
            label="How did this exercise feel?"
            ariaLabel="Exercise difficulty"
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'good', label: 'Good' },
              { value: 'hard', label: 'Hard' },
            ]}
            value={feeling}
            onChange={(next) => {
              setFeeling(next ?? '');
              onSave({ feeling: next, repsInReserve: undefined });
            }}
          />
          <label className="form-field">
            <span className="feedback-label">
              Exercise note <span className="muted">· optional</span>
            </span>
            <textarea
              className="textarea"
              rows={2}
              value={notes}
              onChange={(event) => {
                const next = event.target.value;
                setNotes(next);
                onSave({ notes: next });
              }}
              placeholder="Anything to remember next time?"
            />
          </label>
        </div>
      </details>
      {previousNote?.notes && (
        <p className="muted small previous-exercise-note">
          Last time · {new Date(previousNote.startedAt).toLocaleDateString()} — {previousNote.notes}
        </p>
      )}
    </section>
  );
}

function WorkoutNote({
  workout,
  previousNote,
  onSave,
}: {
  workout: Workout;
  previousNote?: { notes: string; startedAt: string };
  onSave: (notes: string) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState(workout.notes ?? '');
  return (
    <section className="card card-pad workout-feedback workout-note">
      <label className="form-field">
        <span className="feedback-label">
          Workout note <span className="muted">· optional</span>
        </span>
        <textarea
          className="textarea"
          rows={2}
          value={notes}
          onChange={(event) => {
            const next = event.target.value;
            setNotes(next);
            void onSave(next);
          }}
          placeholder="How did the full session go?"
        />
      </label>
      {previousNote?.notes && (
        <p className="muted small previous-exercise-note">
          Last workout · {new Date(previousNote.startedAt).toLocaleDateString()} —{' '}
          {previousNote.notes}
        </p>
      )}
      <p className="muted small">Notes stay private, even when you share this workout.</p>
      <span className="muted small">Saves on this device as you type</span>
    </section>
  );
}

function WorkoutFeeling({
  workout,
  onSave,
}: {
  workout: Workout;
  onSave: (feeling?: string) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <FeedbackRating
      label="How did the workout feel?"
      ariaLabel="Workout difficulty"
      options={[
        { value: 'easy', label: 'Easy' },
        { value: 'good', label: 'Good' },
        { value: 'hard', label: 'Hard' },
      ]}
      value={workout.feeling ?? ''}
      disabled={saving}
      onChange={(next) => {
        setSaving(true);
        void onSave(next).finally(() => setSaving(false));
      }}
    />
  );
}

function FeedbackRating({
  label,
  ariaLabel,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  ariaLabel: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value?: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="form-field">
      <span className="feedback-label">{label}</span>
      <div className="feedback-rating-options" role="group" aria-label={ariaLabel}>
        {options.map((rating) => (
          <button
            key={rating.value}
            className={`feedback-rating-button${value === rating.value ? ' selected' : ''}`}
            type="button"
            disabled={disabled}
            aria-pressed={value === rating.value}
            onClick={() => onChange(value === rating.value ? undefined : rating.value)}
          >
            {rating.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProgressScreen({
  data,
  timezone,
  view,
  setView,
  onWorkout,
  onRepeat,
  proposals,
  selection,
  setSelection,
  apply,
  reject,
}: any) {
  const openView = (next: 'overview' | 'stats' | 'history') => {
    setView(next);
    window.scrollTo({ top: 0 });
  };
  const finished = (data.workouts as Workout[]).filter((w) => w.status === 'finished');
  const stats = useMemo(() => exerciseStatsFromWorkouts(data.workouts), [data.workouts]);
  const history = useMemo(() => historyItemsFromWorkouts(data.workouts), [data.workouts]);
  const weeks = recentMondayDates(timezone).map((start) => ({
    label: `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))}`,
    count: finished
      .filter(
        (w) =>
          mondayOfDate(
            w.trainingDate ?? trainingDateAt(w.startedAt, w.trainingTimezone ?? timezone),
          ) === start,
      )
      .reduce((total, w) => total + completedSets(w), 0),
  }));
  const max = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <main className="page">
      {view !== 'overview' && (
        <Button className="back-button" variant="ghost" onClick={() => openView('overview')}>
          <ArrowLeft size={16} /> Back to Progress
        </Button>
      )}
      <div className="page-heading">
        <div>
          <h1>
            {view === 'overview'
              ? 'Progress'
              : view === 'stats'
                ? 'Exercise stats'
                : 'Workout history'}
          </h1>
        </div>
      </div>
      {view === 'overview' && (
        <>
          <div className="grid two-col progress-overview">
            <ProgressCalendar workouts={finished} onWorkout={onWorkout} />
            <section className="card card-pad">
              <h2>Weekly volume</h2>
              <p className="muted small">Completed working sets · Monday–Sunday</p>
              {finished.length ? (
                <>
                  <div
                    className="chart"
                    role="img"
                    aria-label={`Completed working sets per week: ${weeks.map((w) => `${w.label}: ${w.count}`).join(', ')}`}
                  >
                    {weeks.map((w) => (
                      <div className="chart-col" key={w.label}>
                        <span className="small tabular">{w.count}</span>
                        <div
                          className="chart-bar"
                          style={{
                            height: `${w.count ? Math.max(8, (w.count / max) * 67) : 2}%`,
                            opacity: w.count ? 1 : 0.18,
                          }}
                        />
                        <span className="chart-label">{w.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="row space-between" style={{ marginTop: 13 }}>
                    <span className="muted small">Last 8 weeks · week of</span>
                    <span className="small">{weeks.at(-1)?.count} sets this week</span>
                  </div>
                </>
              ) : (
                <p className="progress-empty muted small">
                  Weekly volume will appear after your first completed workout.
                </p>
              )}
            </section>
          </div>
          <TrainingLinks onStats={() => openView('stats')} onHistory={() => openView('history')} />
        </>
      )}
      {view === 'stats' && (
        <>
          {proposals?.length > 0 && (
            <section className="stack" style={{ marginBottom: 20 }}>
              <div>
                <h2 style={{ marginTop: 4 }}>Progression suggestions</h2>
              </div>
              {proposals.map((p: Proposal) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  data={data}
                  selected={
                    selection[p.id] ??
                    (p.edits.length ? p.edits.map((_: unknown, i: number) => i) : [0])
                  }
                  setSelected={(v: number[]) => setSelection((s: any) => ({ ...s, [p.id]: v }))}
                  apply={() => apply(p)}
                  reject={() => reject(p)}
                />
              ))}
            </section>
          )}
          <ExerciseStats stats={stats} unit={data.settings.unit} timeZone={timezone} />
        </>
      )}
      {view === 'history' && (
        <WorkoutHistory
          items={history}
          timeZone={timezone}
          onWorkout={onWorkout}
          onRepeat={onRepeat}
        />
      )}
    </main>
  );
}
function CoachScreen({
  data,
  syncStatus,
  chatText,
  setChatText,
  submit,
  busy,
  error,
  proposals,
  selection,
  setSelection,
  apply,
  reject,
  openRoutine,
}: any) {
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!composer.current) return;
    composer.current.style.height = 'auto';
    composer.current.style.height = `${Math.max(48, Math.min(140, composer.current.scrollHeight))}px`;
  }, [chatText]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
  }, [data.messages.length, busy]);
  const evidence = evidenceRecords;
  return (
    <div
      className="page coach-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: data.workouts.some((w: Workout) => w.status === 'active')
          ? 'calc(100dvh - 240px)'
          : 'calc(100dvh - 150px)',
        maxWidth: 850,
        margin: '0 auto',
      }}
    >
      <div className="page-heading">
        <div>
          <h1>Coach</h1>
        </div>
        <Button variant="secondary" onClick={() => openRoutine()}>
          <Plus size={16} />
          Build a routine
        </Button>
      </div>
      {syncStatus !== 'synced' && (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          {syncStatus === 'conflict'
            ? 'Resolve the sync conflict in Settings to give Coach current context.'
            : syncStatus === 'offline'
              ? 'Coach is unavailable offline. Your workout logging is saved locally.'
              : syncStatus === 'error'
                ? 'Coach is waiting for your data to sync. Check Settings for sync status.'
                : 'Coach will be ready when your data finishes syncing.'}
        </div>
      )}
      <div
        ref={scroll}
        className="coach-thread"
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'grid',
          alignContent: 'start',
          gap: 12,
          paddingBottom: 16,
        }}
      >
        {data.messages.length === 0 && (
          <div className="coach-empty">
            <h2>What would you like help with?</h2>
            <div className="coach-prompts">
              {[
                ['Build routine', 'Help me build a simple routine'],
                ['Progress a lift', 'How should I progress my squat?'],
                ['Shorten today', 'Make today’s workout shorter'],
              ].map(([label, prompt]) => (
                <button className="coach-prompt" key={label} onClick={() => setChatText(prompt)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {data.messages.map((m: any) => (
          <div
            key={m.id}
            className={`card card-pad coach-message ${m.role === 'user' ? 'coach-message-user' : 'coach-message-assistant'}`}
            style={{
              maxWidth: '90%',
              justifySelf: m.role === 'user' ? 'end' : 'start',
            }}
          >
            <div className={`eyebrow ${m.role === 'user' ? '' : 'coach-origin'}`}>
              {m.role === 'user' ? 'You' : 'Coach'}
            </div>
            <div className="multiline" style={{ marginTop: 7 }}>
              {m.text}
            </div>
            {m.evidenceIds?.length > 0 && (
              <details style={{ marginTop: 12, color: 'var(--sub)' }}>
                <summary className="small" style={{ cursor: 'pointer' }}>
                  Evidence and limitations
                </summary>
                <div className="stack" style={{ marginTop: 9 }}>
                  {m.evidenceIds.map((eid: string) => {
                    const ev = evidence.find((e: any) => e.id === eid);
                    return (
                      ev && (
                        <div key={eid} className="small">
                          <b>
                            {ev.title} ({ev.year})
                          </b>
                          <div>{ev.claim}</div>
                          <div>
                            Confidence: {ev.confidence}. {ev.limitations}
                          </div>
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: 'inherit' }}
                          >
                            Source ↗
                          </a>
                        </div>
                      )
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        ))}
        {busy && (
          <div className="card card-pad muted small" style={{ justifySelf: 'start' }}>
            Coach is thinking…
          </div>
        )}
        {proposals.length > 0 && (
          <div className="stack" style={{ marginBottom: 14 }}>
            {proposals.map((p: Proposal) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                data={data}
                selected={selection[p.id] ?? (p.edits.length ? p.edits.map((_, i) => i) : [0])}
                setSelected={(v: number[]) => setSelection((s: any) => ({ ...s, [p.id]: v }))}
                apply={() => apply(p)}
                reject={() => reject(p)}
              />
            ))}
          </div>
        )}
      </div>
      {error && (
        <div className="notice" style={{ marginBottom: 10 }} role="alert">
          {error}
        </div>
      )}
      <div className="card coach-composer">
        <textarea
          ref={composer}
          className="textarea"
          aria-label="Message Coach"
          placeholder={
            syncStatus === 'synced'
              ? 'Ask Coach about your training…'
              : 'Coach is waiting for synced training context'
          }
          disabled={syncStatus !== 'synced'}
          rows={1}
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          variant="ai"
          size="icon"
          aria-label="Send message"
          disabled={busy || syncStatus !== 'synced' || !chatText.trim()}
          onClick={() => void submit()}
        >
          <ArrowRight size={18} />
        </Button>
      </div>
    </div>
  );
}

function SettingsScreen({
  data,
  status,
  openSettings,
  onBack,
  exportBackup,
  importBackup,
  conflict,
  pendingCount,
  lastSyncedAt,
  resolveConflict,
  retrySync,
  onDeleteData,
}: any) {
  return (
    <main className="page data-settings-page">
      <div className="page-heading">
        <Button
          className="back-button"
          variant="ghost"
          onClick={onBack}
          aria-label="Back to previous screen"
        >
          <ArrowLeft size={17} /> Back
        </Button>
        <div>
          <h1>Data &amp; privacy</h1>
        </div>
        <Button variant="secondary" onClick={openSettings}>
          <SettingsIcon size={17} />
          Edit profile
        </Button>
      </div>
      <div className="grid two-col">
        <section className="card card-pad">
          <div>
            <h2 style={{ marginBottom: 2 }}>Training profile</h2>
            <div className="muted small">Used to personalize Coach context.</div>
          </div>
          <div className="stack" style={{ marginTop: 17 }}>
            {Object.entries(data.settings.profile)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <div className="eyebrow">{k}</div>
                  <div className="small multiline" style={{ marginTop: 4 }}>
                    {v as string}
                  </div>
                </div>
              ))}
            {!Object.values(data.settings.profile).some(Boolean) && (
              <p className="muted small">
                Add goals, equipment, schedule, or preferences when you’re ready.
              </p>
            )}
          </div>
          <div className="divider" />
          <div className="row space-between">
            <span className="muted small">Units</span>
            <b>{data.settings.unit === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)'}</b>
          </div>
          <div className="row space-between" style={{ marginTop: 10 }}>
            <span className="muted small">Coach provider</span>
            <b>
              {data.settings.provider} {data.settings.model && `· ${data.settings.model}`}
            </b>
          </div>
        </section>
        <section className="card card-pad">
          <div>
            <h2 style={{ marginBottom: 2 }}>Backup and restore</h2>
            <div className="muted small">Keep a portable copy of your training data.</div>
          </div>
          <div className="stack" style={{ marginTop: 18 }}>
            <Button variant="primary" onClick={() => void exportBackup()}>
              <FileDown size={17} />
              Export all data as JSON
            </Button>
            <Button onClick={importBackup}>
              <FileUp size={17} />
              Import a backup
            </Button>
            <p className="muted small" style={{ margin: 0 }}>
              Imports are validated and require confirmation before replacing data.
            </p>
          </div>
        </section>
      </div>
      <section className="card card-pad" style={{ marginTop: 16 }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Privacy</h2>
          <div className="muted small">A plain summary of where your information goes.</div>
        </div>
        <div className="stack privacy-summary" style={{ marginTop: 16 }}>
          <p>
            Workout data is stored on this device and in your authenticated Cloudflare database so
            it can sync between your devices.
          </p>
          <p>
            When you send a Coach message, relevant routines, recent workout history, profile, and
            conversation context are sent to the AI provider selected in Settings. Provider keys
            stay on the server.
          </p>
          <p>No advertising pixels or third-party product analytics are included.</p>
        </div>
        <div className="divider" />
        <div className="row space-between data-delete-row">
          <div>
            <b>Delete your data</b>
            <div className="muted small">Removes both the local copy and cloud copy.</div>
          </div>
          <Button variant="danger" onClick={onDeleteData}>
            <Trash2 size={17} /> Delete all data
          </Button>
        </div>
      </section>
      <section className="card card-pad" style={{ marginTop: 16 }}>
        <div className="row space-between">
          <div>
            <div className="row">
              <span
                className="status-dot"
                style={{
                  background:
                    status === 'error'
                      ? 'var(--red)'
                      : status === 'offline'
                        ? '#bd8b23'
                        : undefined,
                }}
              />
              <b>Sync status</b>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              {status === 'local'
                ? 'Your changes are stored on this device.'
                : status === 'synced'
                  ? 'Your changes are up to date.'
                  : status === 'syncing'
                    ? 'Saving recent changes.'
                    : status === 'offline'
                      ? 'Offline · changes will sync when connection returns.'
                      : status === 'conflict'
                        ? 'Another device changed this data. Choose which copy to keep.'
                        : 'Could not sync right now.'}
            </div>
          </div>
        </div>
        <div className="divider" />
        <SyncDetails
          syncStatus={status}
          pendingCount={pendingCount}
          lastSyncedAt={lastSyncedAt}
          localData={data}
          conflict={conflict}
          onRetry={() => void retrySync()}
          onResolveConflict={resolveConflict}
        />
      </section>
    </main>
  );
}

export default App;
