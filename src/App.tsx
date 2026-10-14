import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Dumbbell,
  FileDown,
  FileUp,
  History,
  ListChecks,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  SkipForward,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  addRoutine,
  editRoutine,
  applyEdits,
  addCustomExercise,
  startWorkout,
  repeatWorkout,
  completeSet,
  updateSet,
  finishWorkout,
  applyProposal,
  rejectProposal,
  reorderExercises,
  progressionProposals,
  toDisplayWeight,
  fromDisplayWeight,
  id,
  proposalFingerprint,
  replaceWorkoutExercise,
} from '../shared/domain';
import { catalog } from '../shared/catalog';
import { evidence as evidenceRecords } from '../evidence/records';
import type {
  AppData,
  Exercise,
  Proposal,
  Routine,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  TrainingEdit,
} from '../shared/types';
import { useAppStore } from './lib/store';
import { Button } from './components/ui/Button';
import { Dialog } from './components/ui/Dialog';
import { ProposalCard } from './components/ProposalCard';

type Tab = 'train' | 'progress' | 'coach' | 'settings';
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
const weightLabel = (e: { loadMode: string }, unit: string) =>
  e.loadMode === 'per-dumbbell'
    ? `per dumbbell · ${unit}`
    : e.loadMode === 'bodyweight'
      ? 'bodyweight + optional load'
      : e.loadMode === 'assistance'
        ? 'assistance load'
        : unit;
const scopeLabel = (s: string) =>
  s === 'current_workout'
    ? 'Today only'
    : s === 'next_workout'
      ? 'Next workout'
      : 'Routine going forward';

function App() {
  const store = useAppStore();
  const data = store.data;
  const [tab, setTab] = useState<Tab>('train');
  const [modal, setModal] = useState('');
  const [selectedRoutine, setSelectedRoutine] = useState<string | null>(null);
  const [draftProposalId, setDraftProposalId] = useState<string | null>(null);
  const [draftRoutine, setDraftRoutine] = useState<Routine | null>(null);
  const [routineName, setRoutineName] = useState('');
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [custom, setCustom] = useState(false);
  const [notice, setNotice] = useState('');
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [currentEx, setCurrentEx] = useState(0);
  const [showTable, setShowTable] = useState(false);
  const [undo, setUndo] = useState<{ data: AppData; label: string } | null>(null);
  const [profileDraft, setProfileDraft] = useState<any>(null);
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
  const [finishFeeling, setFinishFeeling] = useState('');
  const [finishNotes, setFinishNotes] = useState('');
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
  const workout = data?.workouts.find((w: Workout) => w.id === (workoutId || active?.id));
  const routine =
    draftRoutine ||
    (selectedRoutine ? data?.routines.find((r: Routine) => r.id === selectedRoutine) : undefined);
  useEffect(() => {
    if (active && !workoutId) {
      setWorkoutId(active.id);
      setCurrentEx(0);
    }
  }, [active?.id]);
  useEffect(() => {
    const t = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    fetch('/api/providers')
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => (Array.isArray(v) ? setAvailableProviders(v) : undefined))
      .catch(() => setAvailableProviders([]));
  }, []);
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
    setUndo(label ? { data, label } : null);
    void safeUpdate(fn);
  };
  const setChange = (fn: (d: AppData) => AppData, label = 'Set updated') => mutate(fn, label);
  const activeExercise =
    workout?.exercises[Math.min(currentEx, Math.max(0, (workout?.exercises.length || 1) - 1))];
  const activeSet =
    activeExercise?.actualSets.find((s) => s.status === 'incomplete' && s.kind === 'warmup') ||
    activeExercise?.actualSets.find((s) => s.status === 'incomplete' && s.kind === 'working');
  const exerciseById = (eid: string) => data && allExercises(data).find((e) => e.id === eid);
  const start = (routineId: string) => {
    try {
      mutate((d) => startWorkout(d, routineId));
      setWorkoutId(null);
      setTab('train');
      setNotice('');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const repeat = (id: string) => {
    try {
      mutate((d) => repeatWorkout(d, id));
      setWorkoutId(null);
      setTab('train');
      setNotice('');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const saveRoutine = () => {
    if (!data) return;
    try {
      if (draftProposalId && draftRoutine) {
        const proposalId = draftProposalId;
        const saved = structuredClone(draftRoutine);
        saved.name = routineName.trim() || saved.name;
        saved.updatedAt = new Date().toISOString();
        void safeUpdate((d) => {
          const proposal = d.proposals.find((p) => p.id === proposalId);
          if (!proposal) throw new Error('This proposal is no longer available');
          const updated = { ...proposal, routineDraft: saved, edits: [] } as Proposal;
          updated.targetFingerprint = proposalFingerprint(d, updated);
          const withDraft = {
            ...d,
            proposals: d.proposals.map((p) => (p.id === proposalId ? updated : p)),
          };
          return applyProposal(withDraft, proposalId, [0]);
        }).then((ok) => {
          if (ok) {
            setModal('');
            setDraftProposalId(null);
            setDraftRoutine(null);
            say('Routine draft reviewed and saved');
          }
        });
      } else if (selectedRoutine) {
        void safeUpdate((d) => ({
          ...d,
          routines: d.routines.map((x) =>
            x.id === selectedRoutine
              ? { ...x, name: routineName.trim() || x.name, updatedAt: new Date().toISOString() }
              : x,
          ),
        }));
        setModal('');
        say('Routine saved');
      } else {
        let createdId = '';
        void safeUpdate((d) => {
          const next = addRoutine(d, routineName || 'New routine');
          createdId = next.routines[next.routines.length - 1].id;
          return next;
        }).then(() => {
          setSelectedRoutine(createdId);
          setRoutineName(routineName || 'New routine');
          setExerciseSearch('');
          setModal('routine');
        });
        say('Routine created');
      }
    } catch (e) {
      say((e as Error).message);
    }
  };
  const openDraftEditor = (proposal: Proposal) => {
    if (!proposal.routineDraft) return;
    setDraftProposalId(proposal.id);
    setDraftRoutine(structuredClone(proposal.routineDraft));
    setSelectedRoutine(null);
    setRoutineName(proposal.routineDraft.name);
    setExerciseSearch('');
    setModal('routine');
  };
  const openRoutine = (r?: Routine) => {
    setDraftProposalId(null);
    setDraftRoutine(null);
    setSelectedRoutine(r?.id || null);
    setRoutineName(r?.name || '');
    setExerciseSearch('');
    setModal('routine');
  };
  const applyRoutineEdits = (routineId: string, edits: TrainingEdit[]) => {
    if (draftRoutine && draftProposalId) {
      setDraftRoutine((prev) =>
        prev
          ? {
              ...prev,
              exercises: applyEdits(prev.exercises, edits, allExercises(data!)),
              updatedAt: new Date().toISOString(),
            }
          : prev,
      );
      return;
    }
    void safeUpdate((d) => editRoutine(d, routineId, edits));
  };
  const addExerciseToRoutine = (ex: Exercise) => {
    if (!data || !routine) return;
    try {
      applyRoutineEdits(routine.id, [
        { op: 'add_exercise', exerciseId: ex.id, sets: 3, repRange: [8, 12] },
      ]);
      say(`${ex.name} added`);
    } catch (e) {
      say((e as Error).message);
    }
  };
  const removePrescription = (routineId: string, prescriptionId: string) => {
    if (!data) return;
    try {
      applyRoutineEdits(routineId, [{ op: 'remove_exercise', exerciseId: prescriptionId }]);
      say('Exercise removed');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const updatePrescription = (
    routineId: string,
    prescriptionId: string,
    field: 'sets' | 'low' | 'high' | 'weight' | 'rest',
    value: number,
  ) => {
    if (!data) return;
    const p = routine?.exercises.find((x: any) => x.id === prescriptionId);
    if (!p) return;
    const edit: TrainingEdit = {
      op: 'update_exercise',
      exerciseId: prescriptionId,
      ...(field === 'sets'
        ? { sets: value }
        : field === 'low'
          ? { repRange: [value, Math.max(value, p.repRange[1])] }
          : field === 'high'
            ? { repRange: [Math.min(value, p.repRange[0]), value] }
            : field === 'weight'
              ? { targetWeight: fromDisplayWeight(value, data.settings.unit) }
              : { restSeconds: value }),
    };
    try {
      applyRoutineEdits(routineId, [edit]);
    } catch (e) {
      say((e as Error).message);
    }
  };
  const openCoach = (ctx: typeof context = {}, sheet = false) => {
    setContext(ctx);
    setModal(sheet ? 'coach-sheet' : '');
    if (!sheet) setTab('coach');
  };
  const submitChat = async () => {
    if (!data || !chatText.trim() || chatBusy) return;
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
    setChatText('');
    setChatBusy(true);
    setChatError('');
    const user = {
      id: id('msg'),
      role: 'user' as const,
      text: message,
      createdAt: new Date().toISOString(),
    };
    await store.update((d) => ({ ...d, messages: [...d.messages, user] }));
    try {
      const response = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          context,
          provider: data.settings.provider,
          model: data.settings.model,
        }),
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 503)
          throw new Error(
            'No Coach provider is available yet. Configure a provider on the server to enable chat.',
          );
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
      setChatError((e as Error).message);
    } finally {
      setChatBusy(false);
    }
  };
  const logActiveSet = () => {
    if (!data || !workout || !activeExercise || !activeSet) return;
    const before = data;
    void safeUpdate((d) => completeSet(d, workout.id, activeExercise.id, activeSet.id)).then(
      (ok) => {
        if (ok) {
          setUndo({ data: before, label: 'Set completed' });
          say('Set logged');
        }
      },
    );
  };
  const editSet = (exerciseId: string, set: WorkoutSet, patch: Partial<WorkoutSet>) => {
    if (!data || !workout) return;
    setChange(
      (d) => updateSet(d, workout.id, exerciseId, set.id, (s) => ({ ...s, ...patch })),
      'Set updated',
    );
  };
  const setState = (exerciseId: string, set: WorkoutSet, status: WorkoutSet['status']) => {
    if (!data || !workout) return;
    const before = data;
    void safeUpdate((d) =>
      updateSet(d, workout.id, exerciseId, set.id, (s) => ({
        ...s,
        status,
        completedAt: status === 'completed' ? new Date().toISOString() : undefined,
      })),
    );
    setUndo({ data: before, label: status === 'skipped' ? 'Set skipped' : 'Set restored' });
    say(status === 'skipped' ? 'Set skipped' : 'Set restored');
  };
  const skipRest = () => {
    if (!data || !workout) return;
    void safeUpdate((d) => ({
      ...d,
      workouts: d.workouts.map((w) => (w.id === workout.id ? { ...w, restEndsAt: undefined } : w)),
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
      workouts: d.workouts.map((w) => (w.id === targetId ? prior : w)),
    }));
    setUndo(null);
    say('Undone');
  };
  const finish = () => {
    if (!data || !workout) return;
    const suggestions = progressionProposals(data, workout.id);
    const completedAt = new Date().toISOString();
    void safeUpdate((d) => {
      const finished = finishWorkout(d, workout.id);
      return { ...finished, proposals: [...finished.proposals, ...suggestions] };
    }).then((ok) => {
      if (ok) {
        setWorkoutId(null);
        setFinishFeeling('');
        setFinishNotes('');
        setSummaryWorkout({ ...workout, status: 'finished', completedAt, restEndsAt: undefined });
        setModal('summary');
        say(
          suggestions.length
            ? 'A progression suggestion is ready to review in Coach.'
            : 'Workout saved. Nice work.',
        );
      }
    });
  };
  const addCustom = () => {
    if (!data) return;
    try {
      const ex: Exercise = {
        id: id('custom'),
        name: newExercise.name || '',
        muscles: (newExercise.muscles as string[]) || [],
        equipment: newExercise.equipment || '',
        instructions: newExercise.instructions || '',
        loadMode: (newExercise.loadMode as any) || 'external',
        region: (newExercise.region as any) || 'upper',
        custom: true,
      };
      void safeUpdate((d) => {
        const withExercise = addCustomExercise(d, ex);
        return selectedRoutine
          ? editRoutine(
              withExercise,
              selectedRoutine,
              [{ op: 'add_exercise', exerciseId: ex.id, sets: 3, repRange: [8, 12] }],
              routineName,
            )
          : withExercise;
      }).then((ok) => {
        if (ok && draftRoutine && draftProposalId)
          setDraftRoutine((prev) =>
            prev
              ? {
                  ...prev,
                  exercises: applyEdits(
                    prev.exercises,
                    [{ op: 'add_exercise', exerciseId: ex.id, sets: 3, repRange: [8, 12] }],
                    [...allExercises(data), ex],
                  ),
                }
              : prev,
          );
      });
      setNewExercise({
        name: '',
        muscles: [],
        equipment: '',
        instructions: '',
        loadMode: 'external',
        region: 'upper',
      });
      setCustom(false);
      say(routine ? 'Custom exercise added to routine' : 'Custom exercise created');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const saveProfile = () => {
    if (!data || !profileDraft) return;
    void safeUpdate((d) => ({
      ...d,
      settings: {
        ...d.settings,
        unit: profileDraft.unit,
        provider: profileDraft.provider,
        model: profileDraft.model,
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
          <div className="brand">
            <span className="brand-mark">
              <Activity size={18} />
            </span>
            Lifts Coach
          </div>
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
  const viewedWorkout = !!workout && workout.status === 'active' && tab === 'train';
  const showMini = !!active && tab !== 'train';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Activity size={18} />
          </span>
          Lifts Coach
        </div>
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
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            onClick={() => {
              setProfileDraft(structuredClone(data.settings));
              setModal('settings');
            }}
          >
            <SettingsIcon size={19} />
          </Button>
        </div>
      </header>
      {tab === 'train' && (
        <main className="page">
          {!viewedWorkout ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">Your training</div>
                  <h1>Train</h1>
                </div>
                <Button
                  variant="secondary"
                  aria-label="Open settings"
                  onClick={() => {
                    setProfileDraft(structuredClone(data.settings));
                    setModal('settings');
                  }}
                >
                  <SettingsIcon size={17} />
                  <span className="desktop-only">Settings</span>
                </Button>
              </div>
              {data.routines.length === 0 ? (
                <div className="card card-pad" style={{ padding: '32px 24px' }}>
                  <div className="empty-icon">
                    <Dumbbell size={22} />
                  </div>
                  <div style={{ textAlign: 'center', maxWidth: 440, margin: '0 auto' }}>
                    <div className="eyebrow">A fresh start</div>
                    <h2 style={{ marginTop: 6 }}>Build a routine that fits you</h2>
                    <p className="muted">
                      Keep it simple. Add exercises, set your targets, then get straight to
                      training.
                    </p>
                    <div className="stack" style={{ maxWidth: 340, margin: '22px auto 0' }}>
                      <Button variant="primary" size="lg" onClick={() => openRoutine()}>
                        <Plus size={19} />
                        Create routine
                      </Button>
                      <Button variant="ai" onClick={() => openCoach({}, false)}>
                        <Sparkles size={17} />
                        Ask Coach to create one
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {active && (
                    <div
                      className="card card-pad"
                      style={{ borderColor: '#cfe8dd', background: 'var(--surface)' }}
                    >
                      <div className="row space-between">
                        <div>
                          <span className="pill pill-green">Workout in progress</span>
                          <h2 style={{ marginTop: 12 }}>{active.name}</h2>
                          <p className="muted small">
                            Started {duration(active.startedAt)} min ago · {completedSets(active)}{' '}
                            of {totalSets(active)} sets complete
                          </p>
                        </div>
                        <Button
                          variant="primary"
                          onClick={() => {
                            setWorkoutId(active.id);
                            setTab('train');
                          }}
                        >
                          <Play size={17} />
                          Resume
                        </Button>
                      </div>
                    </div>
                  )}
                  <section className="section-title">
                    <div>
                      <div className="eyebrow">Up next</div>
                      <h2 style={{ marginTop: 4 }}>
                        {data.routines[
                          data.settings.rotationIndex % Math.max(data.routines.length, 1)
                        ]?.name || 'Choose a routine'}
                      </h2>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => openRoutine()}>
                      <Plus size={15} />
                      New
                    </Button>
                  </section>
                  {(() => {
                    const next =
                      data.routines[data.settings.rotationIndex % data.routines.length] ||
                      data.routines[0];
                    return (
                      <div className="card card-pad">
                        <div className="row space-between">
                          <div>
                            <div className="tag-row">
                              <span className="pill pill-blue">
                                <Dumbbell size={13} />
                                {next.exercises.length} exercises
                              </span>
                              <span className="pill">
                                {next.exercises.reduce((a, e) => a + e.sets, 0)} sets
                              </span>
                              <span className="pill">
                                <Clock3 size={13} />
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
                              </span>
                            </div>
                            <p className="muted small" style={{ margin: '13px 0 0' }}>
                              {next.exercises
                                .slice(0, 3)
                                .map((p) => exerciseById(p.exerciseId)?.name || p.exerciseId)
                                .join(' · ')}
                              {next.exercises.length > 3 ? ' · …' : ''}
                            </p>
                          </div>
                          <Button
                            variant="primary"
                            size="lg"
                            onClick={() => start(next.id)}
                            disabled={!next.exercises.length}
                          >
                            <Play size={18} fill="currentColor" />
                            Start workout
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="section-title">
                    <div>
                      <div className="eyebrow">Your plans</div>
                      <h2 style={{ marginTop: 4 }}>Saved routines</h2>
                    </div>
                  </div>
                  <div className="routine-list">
                    {data.routines.map((r, i) => (
                      <div className="routine-row" key={r.id}>
                        <div className="routine-icon">
                          <Dumbbell size={19} />
                        </div>
                        <div className="grow">
                          <div className="row" style={{ gap: 8 }}>
                            <h3 style={{ margin: 0 }}>{r.name}</h3>
                            {i === data.settings.rotationIndex % data.routines.length && (
                              <span className="pill pill-blue">Up next</span>
                            )}
                          </div>
                          <div className="muted small" style={{ marginTop: 5 }}>
                            {r.exercises.length} exercises ·{' '}
                            {r.exercises.reduce((a, e) => a + e.sets, 0)} sets
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${r.name}`}
                          onClick={() => openRoutine(r)}
                        >
                          <MoreHorizontal />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => start(r.id)}
                          disabled={!r.exercises.length}
                        >
                          <Play size={15} />
                          Start
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="section-title">
                    <div>
                      <div className="eyebrow">Recent sessions</div>
                      <h2 style={{ marginTop: 4 }}>History</h2>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setTab('progress')}>
                      View all <ArrowRight size={15} />
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
                          <div className="routine-icon">
                            <CheckCircle2 size={19} />
                          </div>
                          <div className="grow">
                            <b>{w.name}</b>
                            <div className="muted small" style={{ marginTop: 4 }}>
                              {dateLabel(w.startedAt)} · {duration(w.startedAt, w.completedAt)} min
                              · {completedSets(w)} sets
                            </div>
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => repeat(w.id)}>
                            <RotateCcw size={15} />
                            Repeat
                          </Button>
                        </div>
                      ))
                  )}
                </>
              )}
            </>
          ) : (
            <WorkoutScreen
              data={data}
              workout={workout!}
              currentEx={currentEx}
              setCurrentEx={setCurrentEx}
              showTable={showTable}
              setShowTable={setShowTable}
              activeExercise={activeExercise}
              activeSet={activeSet}
              logSet={logActiveSet}
              editSet={editSet}
              setState={setState}
              timerNow={timerNow}
              skipRest={skipRest}
              finish={finish}
              onCoach={() =>
                openCoach({ workoutId: workout!.id, exerciseId: activeExercise?.exerciseId }, true)
              }
              setUndo={undoLast}
              undo={undo}
              say={say}
              mutate={mutate}
            />
          )}
        </main>
      )}
      {tab === 'progress' && (
        <ProgressScreen
          data={data}
          onCoach={() => openCoach()}
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
      {tab === 'coach' && (
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
      {tab === 'settings' && (
        <SettingsScreen
          data={data}
          status={status}
          openSettings={() => {
            setProfileDraft(structuredClone(data.settings));
            setModal('settings');
          }}
          exportBackup={exportBackup}
          importBackup={() => fileRef.current?.click()}
          conflict={store.conflict}
          resolveConflict={store.resolveConflict}
        />
      )}
      {showMini && (
        <button
          className="mini-player"
          onClick={() => {
            setWorkoutId(active!.id);
            setTab('train');
          }}
        >
          <div
            className="routine-icon"
            style={{ background: '#ffffff1e', color: 'white', width: 38, height: 38 }}
          >
            <Dumbbell size={18} />
          </div>
          <div className="grow">
            <b>{active!.name}</b>
            <div className="muted small">
              {completedSets(active!)} / {totalSets(active!)} sets · Return to workout
            </div>
          </div>
          <ArrowRight size={18} />
        </button>
      )}
      <nav className="bottom-nav" aria-label="Main navigation">
        {(
          [
            ['train', 'Train', Dumbbell],
            ['progress', 'Progress', BarChart3],
            ['coach', 'Coach', Sparkles],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`nav-button ${tab === key ? 'active' : ''}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
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
      <Dialog
        open={modal === 'routine'}
        onOpenChange={(o) => !o && setModal('')}
        title={
          draftProposalId
            ? 'Review Coach routine draft'
            : selectedRoutine
              ? 'Edit routine'
              : 'Create routine'
        }
        description={
          draftProposalId
            ? 'Inspect and edit this proposed plan before saving it.'
            : 'Your plan stays flexible. You can adjust it any time.'
        }
      >
        <div className="stack">
          <div className="form-field">
            <label htmlFor="routine-name">Routine name</label>
            <input
              id="routine-name"
              className="input"
              value={routineName}
              onChange={(e) => setRoutineName(e.target.value)}
              placeholder="e.g. Full body A"
            />
          </div>
          {routine && (
            <>
              <div className="divider" />
              <div className="row space-between">
                <div>
                  <b>Exercises</b>
                  <div className="muted small">Set targets or open an exercise to adjust it.</div>
                </div>
                <Button size="sm" variant="ai" onClick={() => openCoach({ routineId: routine.id })}>
                  <Sparkles size={15} />
                  Ask Coach
                </Button>
              </div>
              <div className="routine-list">
                {routine.exercises.map((p, i) => {
                  const ex = exerciseById(p.exerciseId);
                  return (
                    <div className="card" key={p.id} style={{ padding: '12px 14px' }}>
                      <div className="row">
                        <span className="pill">{String(i + 1).padStart(2, '0')}</span>
                        <div className="grow">
                          <b>{ex?.name || p.exerciseId}</b>
                          <div className="muted small">
                            {p.sets} × {p.repRange[0]}–{p.repRange[1]} ·{' '}
                            {p.targetWeight
                              ? `${toDisplayWeight(p.targetWeight, data.settings.unit)} ${data.settings.unit}`
                              : 'No target weight'}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move ${ex?.name} up`}
                          disabled={i === 0}
                          onClick={() => {
                            const ids = routine.exercises.map((x) => x.id);
                            [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                            applyRoutineEdits(routine.id, [
                              { op: 'reorder_exercises', exerciseIds: ids },
                            ]);
                          }}
                        >
                          <ArrowUp size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move ${ex?.name} down`}
                          disabled={i === routine.exercises.length - 1}
                          onClick={() => {
                            const ids = routine.exercises.map((x) => x.id);
                            [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                            applyRoutineEdits(routine.id, [
                              { op: 'reorder_exercises', exerciseIds: ids },
                            ]);
                          }}
                        >
                          <ArrowDown size={16} />
                        </Button>
                        <button
                          className="icon-button"
                          aria-label={`Remove ${ex?.name}`}
                          onClick={() => removePrescription(routine.id, p.id)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                      <details style={{ marginTop: 9 }}>
                        <summary
                          className="small muted"
                          style={{
                            cursor: 'pointer',
                            minHeight: 44,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          Prescription and exercise options
                        </summary>
                        <div className="profile-grid" style={{ marginTop: 8 }}>
                          {(
                            [
                              ['Sets', p.sets, 'sets', 1, 30],
                              ['Min reps', p.repRange[0], 'low', 1, 100],
                              ['Max reps', p.repRange[1], 'high', 1, 100],
                              [
                                'Target weight (' + data.settings.unit + ')',
                                toDisplayWeight(p.targetWeight, data.settings.unit),
                                'weight',
                                0,
                                2000,
                              ],
                              ['Rest (sec)', p.restSeconds, 'rest', 0, 3600],
                            ] as const
                          ).map(([label, value, field, min, max]) => (
                            <div className="form-field" key={field}>
                              <label>{label}</label>
                              <input
                                className="input input-sm"
                                type="number"
                                min={min}
                                max={max}
                                value={value}
                                onChange={(e) =>
                                  updatePrescription(
                                    routine.id,
                                    p.id,
                                    field,
                                    Number(e.target.value) || 0,
                                  )
                                }
                              />
                            </div>
                          ))}
                          <div className="form-field">
                            <label htmlFor={`replace-${p.id}`}>Replace exercise</label>
                            <select
                              id={`replace-${p.id}`}
                              className="select input-sm"
                              value={p.exerciseId}
                              onChange={(e) =>
                                applyRoutineEdits(routine.id, [
                                  {
                                    op: 'replace_exercise',
                                    exerciseId: p.id,
                                    replacementId: e.target.value,
                                  },
                                ])
                              }
                            >
                              {allExercises(data).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="form-field">
                            <label htmlFor={`increment-${p.id}`}>
                              Progress increment ({data.settings.unit})
                            </label>
                            <input
                              id={`increment-${p.id}`}
                              className="input input-sm"
                              type="number"
                              min="0"
                              step="0.5"
                              value={toDisplayWeight(
                                data.settings.increments[p.exerciseId] ??
                                  (ex?.region === 'lower' ? 10 : 5),
                                data.settings.unit,
                              )}
                              onChange={(e) =>
                                mutate(
                                  (d: AppData) => ({
                                    ...d,
                                    settings: {
                                      ...d.settings,
                                      increments: {
                                        ...d.settings.increments,
                                        [p.exerciseId]: fromDisplayWeight(
                                          Number(e.target.value) || 0,
                                          d.settings.unit,
                                        ),
                                      },
                                    },
                                  }),
                                  'Increment updated',
                                )
                              }
                            />
                          </div>
                        </div>
                      </details>
                    </div>
                  );
                })}
                {!routine.exercises.length && (
                  <p className="muted small">Add your first exercise below.</p>
                )}
              </div>
              <div className="search-wrap">
                <Search size={17} />
                <input
                  className="input"
                  value={exerciseSearch}
                  onChange={(e) => setExerciseSearch(e.target.value)}
                  placeholder="Search 100+ exercises"
                  aria-label="Search exercises"
                />
              </div>
              {custom ? (
                <div className="stack">
                  <div className="profile-grid">
                    <div className="form-field">
                      <label>Exercise name</label>
                      <input
                        className="input"
                        value={newExercise.name}
                        onChange={(e) => setNewExercise({ ...newExercise, name: e.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Equipment</label>
                      <input
                        className="input"
                        value={newExercise.equipment}
                        onChange={(e) =>
                          setNewExercise({ ...newExercise, equipment: e.target.value })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label>Primary muscles</label>
                      <input
                        className="input"
                        value={(newExercise.muscles || []).join(', ')}
                        onChange={(e) =>
                          setNewExercise({
                            ...newExercise,
                            muscles: e.target.value
                              .split(',')
                              .map((x) => x.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Chest, triceps"
                      />
                    </div>
                    <div className="form-field">
                      <label>Load type</label>
                      <select
                        className="select"
                        value={newExercise.loadMode as string}
                        onChange={(e) =>
                          setNewExercise({ ...newExercise, loadMode: e.target.value as any })
                        }
                      >
                        <option value="external">External load</option>
                        <option value="per-dumbbell">Per dumbbell</option>
                        <option value="bodyweight">Bodyweight</option>
                        <option value="assistance">Assistance</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-field">
                    <label>Instructions</label>
                    <textarea
                      className="textarea"
                      value={newExercise.instructions}
                      onChange={(e) =>
                        setNewExercise({ ...newExercise, instructions: e.target.value })
                      }
                    />
                  </div>
                  <div className="row">
                    <Button variant="secondary" onClick={() => setCustom(false)}>
                      Back to library
                    </Button>
                    <Button variant="primary" onClick={addCustom}>
                      Save exercise
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="exercise-results">
                    {allExercises(data)
                      .filter(
                        (e) =>
                          !exerciseSearch ||
                          e.name.toLowerCase().includes(exerciseSearch.toLowerCase()) ||
                          e.muscles.some((m) =>
                            m.toLowerCase().includes(exerciseSearch.toLowerCase()),
                          ),
                      )
                      .slice(0, 45)
                      .map((e) => (
                        <button
                          className="exercise-result"
                          key={e.id}
                          onClick={() => addExerciseToRoutine(e)}
                        >
                          <div className="nav-mini">
                            <Plus size={16} />
                          </div>
                          <span className="grow">
                            <b>{e.name}</b>
                            <span
                              className="muted small"
                              style={{ display: 'block', marginTop: 3 }}
                            >
                              {e.muscles.slice(0, 2).join(', ')} · {e.equipment}
                            </span>
                          </span>
                        </button>
                      ))}
                  </div>
                  <Button variant="secondary" onClick={() => setCustom(true)}>
                    <Plus size={16} />
                    Create a custom exercise
                  </Button>
                </>
              )}
            </>
          )}
          <div className="dialog-footer">
            <Button variant="secondary" onClick={() => setModal('')}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveRoutine}>
              {draftProposalId
                ? 'Approve and save draft'
                : selectedRoutine
                  ? 'Save changes'
                  : 'Create routine'}
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={modal === 'settings'}
        onOpenChange={(o) => !o && setModal('')}
        title="Settings"
        description="Tune your training context and app preferences."
      >
        {profileDraft && (
          <div className="stack">
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
            <b>Training profile</b>
            <div className="profile-grid">
              {(
                ['goals', 'equipment', 'schedule', 'constraints', 'preferences', 'notes'] as const
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
            <div className="divider" />
            <b>Coach provider</b>
            <div className="notice">
              API keys are provisioned on the server. Settings only selects a configured
              provider/model.
            </div>
            {availableProviders.length ? (
              <div className="profile-grid">
                <div className="form-field">
                  <label>Provider</label>
                  <select
                    className="select"
                    value={profileDraft.provider}
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
                        {p.id === 'openai' ? 'OpenAI' : p.id === 'anthropic' ? 'Anthropic' : p.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>Model</label>
                  <select
                    className="select"
                    value={profileDraft.model}
                    onChange={(e) => setProfileDraft({ ...profileDraft, model: e.target.value })}
                  >
                    {(
                      availableProviders.find((p) => p.id === profileDraft.provider)?.models || []
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
          <div className="form-field">
            <label>
              How did it feel? <span className="muted">(optional)</span>
            </label>
            <div className="toggle-row">
              {['Easy', 'Good', 'Hard'].map((x) => (
                <button
                  key={x}
                  className={finishFeeling === x ? 'selected' : ''}
                  onClick={() => setFinishFeeling(finishFeeling === x ? '' : x)}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
          <div className="form-field">
            <label>
              Notes <span className="muted">(optional)</span>
            </label>
            <textarea
              className="textarea"
              value={finishNotes}
              onChange={(e) => setFinishNotes(e.target.value)}
              placeholder="Anything to remember next time?"
            />
          </div>
          <div className="dialog-footer">
            <Button
              onClick={() => {
                setModal('');
                setSummaryWorkout(null);
              }}
            >
              Done
            </Button>
            <Button
              variant="success"
              onClick={() => {
                if (summaryWorkout)
                  void safeUpdate((d) => ({
                    ...d,
                    workouts: d.workouts.map((w) =>
                      w.id === summaryWorkout.id
                        ? {
                            ...w,
                            feeling: finishFeeling || undefined,
                            notes: finishNotes || undefined,
                          }
                        : w,
                    ),
                  }));
                setModal('');
                setSummaryWorkout(null);
              }}
            >
              Save feedback
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
            <div style={{ overflowX: 'auto' }}>
              <table className="set-table">
                <thead>
                  <tr>
                    <th>Set</th>
                    <th>Load ({data.settings.unit})</th>
                    <th>Reps</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {correction.exercise.actualSets.map((s, i) => (
                    <tr key={s.id} className={s.status === 'completed' ? 'set-row-completed' : ''}>
                      <td>{s.kind === 'warmup' ? 'W' : i + 1}</td>
                      <td>
                        <input
                          className="input"
                          aria-label={`Correct set ${i + 1} weight`}
                          type="number"
                          min="0"
                          value={toDisplayWeight(s.weight, data.settings.unit)}
                          onChange={(e) => {
                            const weight = fromDisplayWeight(
                              Number(e.target.value) || 0,
                              data.settings.unit,
                            );
                            void safeUpdate((d) =>
                              updateSet(
                                d,
                                correction.workout.id,
                                correction.exercise.id,
                                s.id,
                                (x) => ({ ...x, weight }),
                              ),
                            );
                            updateCorrectionSnapshot(s.id, { weight });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          aria-label={`Correct set ${i + 1} reps`}
                          type="number"
                          min="0"
                          value={s.reps}
                          onChange={(e) => {
                            const reps = Number(e.target.value) || 0;
                            void safeUpdate((d) =>
                              updateSet(
                                d,
                                correction.workout.id,
                                correction.exercise.id,
                                s.id,
                                (x) => ({ ...x, reps }),
                              ),
                            );
                            updateCorrectionSnapshot(s.id, { reps });
                          }}
                        />
                      </td>
                      <td>
                        <select
                          className="select input-sm"
                          aria-label={`Correct set ${i + 1} status`}
                          value={s.status}
                          onChange={(e) => {
                            const status = e.target.value as WorkoutSet['status'];
                            void safeUpdate((d) =>
                              updateSet(
                                d,
                                correction.workout.id,
                                correction.exercise.id,
                                s.id,
                                (x) => ({
                                  ...x,
                                  status,
                                  completedAt:
                                    status === 'completed' ? new Date().toISOString() : undefined,
                                }),
                              ),
                            );
                            updateCorrectionSnapshot(s.id, {
                              status,
                              completedAt:
                                status === 'completed' ? new Date().toISOString() : undefined,
                            });
                          }}
                        >
                          <option value="incomplete">Planned</option>
                          <option value="completed">Done</option>
                          <option value="skipped">Skipped</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="primary" onClick={() => setCorrection(null)}>
              Done
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog
        open={modal === 'coach-sheet'}
        onOpenChange={(o) => !o && setModal('')}
        title="Coach"
        description="Workout context included"
      >
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
      </Dialog>
    </div>
  );
}

function WorkoutScreen({
  data,
  workout,
  currentEx,
  setCurrentEx,
  showTable,
  setShowTable,
  activeExercise,
  activeSet,
  logSet,
  editSet,
  setState,
  timerNow,
  skipRest,
  finish,
  onCoach,
  setUndo,
  undo,
  say,
  mutate,
}: any) {
  const unit = data.settings.unit;
  const ex = activeExercise as WorkoutExercise | undefined;
  const restLeft = workout.restEndsAt
    ? Math.max(0, Math.ceil((workout.restEndsAt - timerNow) / 1000))
    : 0;
  const selectedEx = (id: string) =>
    workout.exercises.findIndex((e: WorkoutExercise) => e.id === id);
  const replaceToday = (replacementId: string) => {
    const replacement = allExercises(data).find((e) => e.id === replacementId);
    if (!replacement || !ex) return;
    mutate(
      (d: AppData) => replaceWorkoutExercise(d, workout.id, ex.id, replacementId),
      'Exercise replaced for today',
    );
    say(`${replacement.name} substituted for today`);
  };
  const adjust = (field: 'weight' | 'reps', delta: number) => {
    if (!ex || !activeSet) return;
    editSet(ex.id, activeSet, { [field]: Math.max(0, (activeSet[field] || 0) + delta) });
  };
  const restChange = (seconds: number) =>
    mutate((d: AppData) => ({
      ...d,
      workouts: d.workouts.map((w: Workout) =>
        w.id === workout.id ? { ...w, restEndsAt: Date.now() + seconds * 1000 } : w,
      ),
    }));
  const markExerciseSkipped = () => {
    if (!ex) return;
    const before = data;
    mutate(
      (d: AppData) => ({
        ...d,
        workouts: d.workouts.map((w: Workout) =>
          w.id === workout.id
            ? {
                ...w,
                exercises: w.exercises.map((e: WorkoutExercise) =>
                  e.id !== ex.id
                    ? e
                    : {
                        ...e,
                        actualSets: e.actualSets.map((s: WorkoutSet) =>
                          s.status === 'incomplete' ? { ...s, status: 'skipped' } : s,
                        ),
                      },
                ),
              }
            : w,
        ),
      }),
      'Exercise skipped',
    );
    say('Exercise skipped');
  };
  return (
    <div className="workout-focus">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Workout in progress</div>
          <h1>{workout.name}</h1>
        </div>
        <div className="row">
          <Button
            variant="ai"
            size="sm"
            aria-label="Ask Coach about this workout"
            onClick={onCoach}
          >
            <Sparkles size={16} />
            <span className="desktop-only">Coach</span>
          </Button>
          <Button variant="ghost" size="icon" aria-label="Finish workout" onClick={finish}>
            <MoreHorizontal />
          </Button>
        </div>
      </div>
      <div className="row space-between small muted">
        <span>
          {completedSets(workout)} of {totalSets(workout)} working sets
        </span>
        <span>{duration(workout.startedAt)} min</span>
      </div>
      <div className="workout-progress">
        <span
          style={{
            width: `${totalSets(workout) ? (completedSets(workout) / totalSets(workout)) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="row" style={{ overflowX: 'auto', paddingBottom: 5, marginBottom: 13 }}>
        {workout.exercises.map((e: WorkoutExercise, i: number) => (
          <button
            key={e.id}
            className={`pill ${i === currentEx ? 'pill-blue' : ''}`}
            onClick={() => setCurrentEx(i)}
            style={{ minHeight: 44, whiteSpace: 'nowrap' }}
          >
            {i + 1}. {e.name}
          </button>
        ))}
      </div>
      {ex ? (
        <>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="row space-between">
              <div>
                <div className="eyebrow">
                  Exercise {currentEx + 1} of {workout.exercises.length}
                </div>
                <h2 style={{ marginTop: 5 }}>{ex.name}</h2>
                <span className="muted small">
                  {weightLabel(ex, unit)} · target {ex.sets} × {ex.repRange[0]}–{ex.repRange[1]}
                </span>
              </div>
              <button className="icon-button" aria-label="Exercise details">
                <MoreHorizontal size={20} />
              </button>
            </div>
            {ex.actualSets.filter((s: WorkoutSet) => s.kind === 'working').length > 0 && (
              <div className="row" style={{ gap: 6, marginTop: 15 }}>
                {ex.actualSets
                  .filter((s: WorkoutSet) => s.kind === 'working')
                  .map((s: WorkoutSet, i: number) => (
                    <span
                      key={s.id}
                      className={`pill ${s.status === 'completed' ? 'pill-green' : s.status === 'skipped' ? 'pill-red' : ''}`}
                    >
                      {s.status === 'completed' ? <Check size={12} /> : null}S{i + 1}
                    </span>
                  ))}
              </div>
            )}
          </div>
          {workout.restEndsAt && (
            <div className="rest-box" style={{ marginBottom: 14 }}>
              <Clock3 size={19} />
              <div className="grow">
                <div className="small">Rest timer</div>
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
          {activeSet ? (
            <div className="card set-focus">
              <div className="row space-between">
                <div>
                  <div className="set-number">
                    {activeSet.kind === 'warmup' ? 'Warm-up set' : 'Next working set'}
                  </div>
                  <div className="muted small" style={{ marginTop: 5 }}>
                    Set{' '}
                    {ex.actualSets.filter((s: WorkoutSet) => s.status === 'completed').length + 1} ·
                    target {ex.repRange[0]}–{ex.repRange[1]} reps
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setShowTable(!showTable)}>
                  {showTable ? 'Hide sets' : 'All sets'} <ChevronDown size={14} />
                </Button>
              </div>
              {ex.loadMode === 'bodyweight' && (
                <div className="form-field" style={{ marginTop: 16 }}>
                  <label htmlFor="bodyweight-mode">Record this set as</label>
                  <select
                    id="bodyweight-mode"
                    className="select"
                    value={activeSet.loadMode || 'bodyweight'}
                    onChange={(e) =>
                      editSet(ex.id, activeSet, {
                        loadMode: e.target.value as WorkoutSet['loadMode'],
                      })
                    }
                  >
                    <option value="bodyweight">Added weight</option>
                    <option value="assistance">Assistance weight</option>
                  </select>
                </div>
              )}
              <div className="profile-grid set-entry-grid" style={{ marginTop: 16 }}>
                {(['weight', 'reps'] as const).map((field) => (
                  <div key={field}>
                    <div className="field-label" style={{ textAlign: 'center', marginBottom: 8 }}>
                      {field === 'weight'
                        ? ex.loadMode === 'per-dumbbell'
                          ? 'Per dumbbell'
                          : ex.loadMode === 'assistance'
                            ? 'Assistance'
                            : `Weight (${unit})`
                        : 'Reps'}
                    </div>
                    <div className="number-control">
                      <Button
                        size="icon"
                        aria-label={`Decrease ${field}`}
                        onClick={() => adjust(field, -(field === 'weight' ? 2.5 : 1))}
                      >
                        −
                      </Button>
                      <input
                        aria-label={field}
                        className="input"
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step={field === 'weight' ? '0.5' : '1'}
                        value={
                          field === 'weight'
                            ? toDisplayWeight(activeSet.weight, unit)
                            : activeSet.reps
                        }
                        onChange={(e) =>
                          editSet(ex.id, activeSet, {
                            [field]:
                              field === 'weight'
                                ? fromDisplayWeight(Number(e.target.value) || 0, unit)
                                : Number(e.target.value) || 0,
                          })
                        }
                      />
                      <Button
                        size="icon"
                        aria-label={`Increase ${field}`}
                        onClick={() => adjust(field, field === 'weight' ? 2.5 : 1)}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row space-between" style={{ marginTop: 13 }}>
                <span className="muted small">
                  {data.workouts.some(
                    (w: Workout) =>
                      w.status === 'finished' &&
                      w.exercises.some(
                        (item: WorkoutExercise) =>
                          item.exerciseId === ex.exerciseId &&
                          item.actualSets.some((s: WorkoutSet) => s.status === 'completed'),
                      ),
                  )
                    ? 'Prefilled from your latest set'
                    : 'Routine targets · edit for today'}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setShowTable(!showTable)}>
                  <ListChecks size={15} />
                  Edit table
                </Button>
              </div>
              <Button
                variant="success"
                size="lg"
                style={{ width: '100%', marginTop: 18 }}
                onClick={logSet}
              >
                <CheckCircle2 size={19} />
                Complete set
              </Button>
              <div className="row space-between" style={{ marginTop: 10 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const s = ex.actualSets.find((x: WorkoutSet) => x.status === 'incomplete');
                    if (s) setState(ex.id, s, 'skipped');
                  }}
                >
                  <SkipForward size={15} />
                  Skip set
                </Button>
                <Button variant="ghost" size="sm" onClick={markExerciseSkipped}>
                  Skip exercise
                </Button>
              </div>
            </div>
          ) : (
            <div className="card card-pad" style={{ textAlign: 'center' }}>
              <div className="empty-icon">
                <CheckCircle2 />
              </div>
              <h3>Exercise complete</h3>
              <p className="muted small">All planned sets are logged.</p>
              <Button
                onClick={() => setCurrentEx(Math.min(currentEx + 1, workout.exercises.length - 1))}
              >
                Next exercise <ArrowRight size={16} />
              </Button>
            </div>
          )}
          {showTable && (
            <div className="card card-pad" style={{ marginTop: 14 }}>
              <div className="row space-between">
                <div>
                  <h3>Set table</h3>
                  <div className="muted small">Edit any set, including completed sets.</div>
                </div>
                <div className="row">
                  <Button
                    size="sm"
                    onClick={() =>
                      mutate(
                        (d: AppData) => ({
                          ...d,
                          workouts: d.workouts.map((w: Workout) =>
                            w.id === workout.id
                              ? {
                                  ...w,
                                  exercises: w.exercises.map((e: WorkoutExercise) =>
                                    e.id === ex.id
                                      ? {
                                          ...e,
                                          actualSets: [
                                            ...e.actualSets,
                                            {
                                              id: id('set'),
                                              weight: e.targetWeight,
                                              reps: e.repRange[0],
                                              kind: 'working',
                                              status: 'incomplete',
                                              updatedAt: new Date().toISOString(),
                                              loadMode: e.loadMode,
                                            },
                                          ],
                                        }
                                      : e,
                                  ),
                                }
                              : w,
                          ),
                        }),
                        'Set added',
                      )
                    }
                  >
                    <Plus size={15} />
                    Add set
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      mutate(
                        (d: AppData) => ({
                          ...d,
                          workouts: d.workouts.map((w: Workout) =>
                            w.id === workout.id
                              ? {
                                  ...w,
                                  exercises: w.exercises.map((e: WorkoutExercise) =>
                                    e.id === ex.id
                                      ? {
                                          ...e,
                                          actualSets: [
                                            {
                                              id: id('set'),
                                              weight: e.targetWeight,
                                              reps: e.repRange[0],
                                              kind: 'warmup',
                                              status: 'incomplete',
                                              updatedAt: new Date().toISOString(),
                                              loadMode: e.loadMode,
                                            },
                                            ...e.actualSets,
                                          ],
                                        }
                                      : e,
                                  ),
                                }
                              : w,
                          ),
                        }),
                        'Warm-up set added',
                      )
                    }
                  >
                    <Plus size={15} />
                    Warm-up
                  </Button>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="set-table">
                  <thead>
                    <tr>
                      <th>Set</th>
                      <th>Load ({unit})</th>
                      <th>Reps</th>
                      <th>State</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ex.actualSets.map((s: WorkoutSet, i: number) => (
                      <tr
                        key={s.id}
                        className={
                          s.status === 'completed'
                            ? 'set-row-completed'
                            : s.status === 'skipped'
                              ? 'set-row-skipped'
                              : ''
                        }
                      >
                        <td>{s.kind === 'warmup' ? 'W' : i + 1}</td>
                        <td>
                          <input
                            className="input"
                            aria-label={`Set ${i + 1} weight`}
                            type="number"
                            min="0"
                            value={toDisplayWeight(s.weight, unit)}
                            onChange={(e) =>
                              editSet(ex.id, s, {
                                weight: fromDisplayWeight(Number(e.target.value) || 0, unit),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            aria-label={`Set ${i + 1} reps`}
                            type="number"
                            min="0"
                            value={s.reps}
                            onChange={(e) =>
                              editSet(ex.id, s, { reps: Number(e.target.value) || 0 })
                            }
                          />
                        </td>
                        <td>
                          <select
                            className="select input-sm"
                            aria-label={`Set ${i + 1} status`}
                            value={s.status}
                            onChange={(e) => setState(ex.id, s, e.target.value)}
                          >
                            <option value="incomplete">Planned</option>
                            <option value="completed">Done</option>
                            <option value="skipped">Skipped</option>
                          </select>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label="Toggle warm-up"
                            title="Toggle warm-up"
                            onClick={() =>
                              editSet(ex.id, s, {
                                kind: s.kind === 'warmup' ? 'working' : 'warmup',
                              })
                            }
                          >
                            <span style={{ fontSize: 11, fontWeight: 700 }}>
                              {s.kind === 'warmup' ? 'W' : '·'}
                            </span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="row space-between" style={{ marginTop: 17 }}>
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
              Next exercise <ArrowRight size={16} />
            </Button>
          </div>
          <details className="card card-pad workout-options" style={{ marginTop: 16 }}>
            <summary>
              <b>Make today’s workout yours</b>
              <span className="muted small">Reorder or substitute for today</span>
            </summary>
            <div style={{ marginTop: 14 }}>
              <div className="row">
                <Button
                  size="icon"
                  aria-label="Move exercise up"
                  disabled={currentEx === 0}
                  onClick={() => {
                    const ids = workout.exercises.map((e: WorkoutExercise) => e.id);
                    [ids[currentEx - 1], ids[currentEx]] = [ids[currentEx], ids[currentEx - 1]];
                    mutate(
                      (d: AppData) => reorderExercises(d, workout.id, ids),
                      'Exercise order updated',
                    );
                    setCurrentEx(currentEx - 1);
                    say('Exercise order updated');
                  }}
                >
                  <ArrowUp size={16} />
                </Button>
                <Button
                  size="icon"
                  aria-label="Move exercise down"
                  disabled={currentEx >= workout.exercises.length - 1}
                  onClick={() => {
                    const ids = workout.exercises.map((e: WorkoutExercise) => e.id);
                    [ids[currentEx + 1], ids[currentEx]] = [ids[currentEx], ids[currentEx + 1]];
                    mutate(
                      (d: AppData) => reorderExercises(d, workout.id, ids),
                      'Exercise order updated',
                    );
                    setCurrentEx(currentEx + 1);
                    say('Exercise order updated');
                  }}
                >
                  <ArrowDown size={16} />
                </Button>
              </div>
            </div>
            <div className="form-field" style={{ marginTop: 14 }}>
              <label htmlFor="replace-today">Replace current exercise for today</label>
              <select
                id="replace-today"
                className="select"
                value={ex.exerciseId}
                onChange={(e) => replaceToday(e.target.value)}
              >
                {allExercises(data).map((item: Exercise) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </details>
        </>
      ) : (
        <div className="empty-state">
          <h2>No exercises in this session</h2>
          <Button onClick={finish}>Finish workout</Button>
        </div>
      )}
      <div className="row space-between" style={{ marginTop: 23 }}>
        <span className="muted small">Saved automatically on this device</span>
        <Button variant="success" onClick={finish}>
          <Check size={17} />
          Finish workout
        </Button>
      </div>
    </div>
  );
}

function ProgressScreen({
  data,
  onCoach,
  onRepeat,
  onCorrection,
  proposals,
  selection,
  setSelection,
  apply,
  reject,
}: any) {
  const [exerciseId, setExerciseId] = useState('');
  const finished = (data.workouts as Workout[])
    .filter((w) => w.status === 'finished')
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const byExercise = new Map<
    string,
    { name: string; points: { date: string; weight: number; reps: number }[] }
  >();
  finished
    .slice()
    .reverse()
    .forEach((w: Workout) =>
      w.exercises.forEach((e) => {
        const sets = e.actualSets.filter((s) => s.status === 'completed' && s.kind === 'working');
        if (!sets.length) return;
        const best = sets.reduce((a, b) => (b.weight * b.reps > a.weight * a.reps ? b : a));
        const item = byExercise.get(e.exerciseId) || { name: e.name, points: [] };
        item.points.push({ date: w.startedAt, weight: best.weight, reps: best.reps });
        byExercise.set(e.exerciseId, item);
      }),
    );
  const entries = [...byExercise.entries()].sort((a, b) => b[1].points.length - a[1].points.length);
  const selected = byExercise.get(exerciseId) || entries[0]?.[1];
  const selectedId = byExercise.has(exerciseId) ? exerciseId : entries[0]?.[0];
  const loadMode = allExercises(data).find((x) => x.id === selectedId)?.loadMode;
  const repsOnly = loadMode === 'assistance' || loadMode === 'bodyweight';
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = new Date();
    start.setDate(start.getDate() - (7 - i) * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const count = finished.filter(
      (w: Workout) => new Date(w.startedAt) >= start && new Date(w.startedAt) < end,
    ).length;
    return { label: `${start.getMonth() + 1}/${start.getDate()}`, count };
  });
  const max = Math.max(1, ...weeks.map((x) => x.count));
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your training, over time</div>
          <h1>Progress</h1>
        </div>
        <Button variant="ai" onClick={onCoach}>
          <Sparkles size={16} />
          Ask Coach
        </Button>
      </div>
      {proposals?.length > 0 && (
        <section className="stack" style={{ marginBottom: 20 }}>
          <div>
            <div className="eyebrow">Ready to review</div>
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
      <div className="grid two-col">
        <section className="card card-pad">
          <div className="row space-between">
            <div>
              <div className="eyebrow">Strength trend</div>
              <h2 style={{ marginTop: 4 }}>{selected?.name || 'Exercise progress'}</h2>
            </div>
            {selected && <span className="pill pill-blue">{selected.points.length} sessions</span>}
          </div>
          {entries.length > 0 && (
            <div className="form-field" style={{ marginTop: 12 }}>
              <label htmlFor="progress-exercise">Choose an exercise</label>
              <select
                id="progress-exercise"
                className="select"
                value={selectedId || ''}
                onChange={(e) => setExerciseId(e.target.value)}
              >
                {entries.map(([id, item]) => (
                  <option key={id} value={id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {selected && selected.points.length > 1 ? (
            <>
              <div className="chart" role="img" aria-label={`Progress trend for ${selected.name}`}>
                {selected.points.slice(-8).map((p, i, arr) => {
                  const value = repsOnly ? p.reps : toDisplayWeight(p.weight, data.settings.unit);
                  const maxValue = Math.max(
                    1,
                    ...arr.map((x) =>
                      repsOnly ? x.reps : toDisplayWeight(x.weight, data.settings.unit),
                    ),
                  );
                  return (
                    <div className="chart-col" key={p.date}>
                      <span className="small tabular">
                        {value}
                        {repsOnly ? ' reps' : ''}
                      </span>
                      <div
                        className="chart-bar"
                        style={{ height: `${Math.max(12, (value / maxValue) * 68)}%` }}
                      />
                      <span className="chart-label">{dateLabel(p.date)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="muted small" style={{ margin: '12px 0 0' }}>
                {repsOnly
                  ? 'Best completed working-set reps · assistance is excluded'
                  : `Best working-set load · values shown in ${data.settings.unit}`}
              </p>
            </>
          ) : (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <div className="empty-icon">
                <BarChart3 />
              </div>
              <b>Strength trends will build here</b>
              <p className="muted small" style={{ margin: '6px 0 0' }}>
                Complete a few workouts to see how your lifts change.
              </p>
            </div>
          )}
        </section>
        <section className="card card-pad">
          <div className="eyebrow">Consistency</div>
          <h2 style={{ marginTop: 4 }}>Training weeks</h2>
          <div className="chart" aria-label="Workouts per week">
            {weeks.map((w, i) => (
              <div className="chart-col" key={i}>
                <span className="small tabular">{w.count || ''}</span>
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
            <span className="muted small">Last 8 weeks</span>
            <b>{finished.length} completed workouts</b>
          </div>
        </section>
      </div>
      <div className="section-title">
        <div>
          <div className="eyebrow">Completed sessions</div>
          <h2 style={{ marginTop: 4 }}>Workout history</h2>
        </div>
      </div>
      {finished.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <History />
          </div>
          <h3>Your training history starts with the first workout</h3>
          <p className="muted small">Strength trends and consistency will appear as you train.</p>
        </div>
      ) : (
        <div className="card card-pad">
          {finished.map((w: Workout) => (
            <div key={w.id} className="history-item" style={{ alignItems: 'flex-start' }}>
              <div className="routine-icon">
                <CheckCircle2 size={19} />
              </div>
              <div className="grow">
                <div className="row space-between">
                  <div>
                    <b>{w.name}</b>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {dateLabel(w.startedAt)} · {duration(w.startedAt, w.completedAt)} min ·{' '}
                      {completedSets(w)} sets
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => onRepeat(w.id)}>
                    <RotateCcw size={14} />
                    Repeat
                  </Button>
                </div>
                <div className="tag-row" style={{ marginTop: 11 }}>
                  {w.exercises.map((e) => (
                    <button key={e.id} className="pill" onClick={() => onCorrection(w, e)}>
                      {e.name}
                    </button>
                  ))}
                </div>
                {(w.feeling || w.notes) && (
                  <p className="muted small" style={{ margin: '10px 0 0' }}>
                    {w.feeling && <b>{w.feeling}. </b>}
                    {w.notes}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
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
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
  }, [data.messages.length, busy]);
  const evidence = evidenceRecords;
  return (
    <div
      className="page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 180px)',
        maxWidth: 850,
        margin: '0 auto',
      }}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">Training partner</div>
          <h1>Coach</h1>
        </div>
        <Button variant="secondary" onClick={() => openRoutine()}>
          <Plus size={16} />
          Build a routine
        </Button>
      </div>
      <div
        className="notice"
        style={{ background: 'var(--purple-soft)', color: '#75519a', marginBottom: 14 }}
      >
        Coach considers your routines and training profile. Program edits always wait for your
        review.
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
          <div className="empty-state">
            <div
              className="empty-icon"
              style={{ background: 'var(--purple-soft)', color: 'var(--purple)' }}
            >
              <Sparkles />
            </div>
            <h3>What would you like to work on?</h3>
            <p className="muted small">Ask about a lift, a plateau, or adapting your plan.</p>
            <div className="tag-row" style={{ justifyContent: 'center', marginTop: 14 }}>
              {[
                'Help me build a simple routine',
                'How should I progress my squat?',
                'Make today’s workout shorter',
              ].map((q) => (
                <button className="pill" key={q} onClick={() => setChatText(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {data.messages.map((m: any) => (
          <div
            key={m.id}
            className="card card-pad"
            style={{
              maxWidth: '90%',
              justifySelf: m.role === 'user' ? 'end' : 'start',
              background: m.role === 'user' ? 'var(--blue)' : 'white',
              color: m.role === 'user' ? 'white' : 'var(--text)',
              borderColor: m.role === 'user' ? 'var(--blue)' : 'var(--border)',
            }}
          >
            <div
              className="eyebrow"
              style={{ color: m.role === 'user' ? '#dbe6ff' : 'var(--purple)' }}
            >
              {m.role === 'user' ? 'You' : 'Coach'}
            </div>
            <div className="multiline" style={{ marginTop: 7 }}>
              {m.text}
            </div>
            {m.evidenceIds?.length > 0 && (
              <details style={{ marginTop: 12, color: m.role === 'user' ? 'white' : 'var(--sub)' }}>
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
      </div>
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
      {error && (
        <div className="notice" style={{ marginBottom: 10 }} role="alert">
          {error}
        </div>
      )}
      <div
        className="card card-pad"
        style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'end' }}
      >
        <textarea
          className="textarea"
          aria-label="Message Coach"
          placeholder={
            syncStatus === 'synced'
              ? 'Ask Coach about your training…'
              : 'Coach is waiting for synced training context'
          }
          disabled={syncStatus !== 'synced'}
          style={{ border: 0, minHeight: 48, maxHeight: 140, resize: 'vertical' }}
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
      <p className="muted small" style={{ textAlign: 'center', margin: '8px 0 0' }}>
        AI advice can be uncertain. You decide what changes.
      </p>
    </div>
  );
}

function SettingsScreen({
  data,
  status,
  openSettings,
  exportBackup,
  importBackup,
  conflict,
  resolveConflict,
}: any) {
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your data and preferences</div>
          <h1>Settings</h1>
        </div>
        <Button variant="secondary" onClick={openSettings}>
          <SettingsIcon size={17} />
          Edit profile
        </Button>
      </div>
      <div className="grid two-col">
        <section className="card card-pad">
          <div className="row">
            <div className="routine-icon">
              <Activity />
            </div>
            <div>
              <h2 style={{ marginBottom: 2 }}>Training profile</h2>
              <div className="muted small">Used to personalize Coach context.</div>
            </div>
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
          <div className="row">
            <div className="routine-icon">
              <FileDown />
            </div>
            <div>
              <h2 style={{ marginBottom: 2 }}>Backup and restore</h2>
              <div className="muted small">Keep a portable copy of your training data.</div>
            </div>
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
          {status === 'conflict' && (
            <div className="row">
              <Button size="sm" onClick={() => resolveConflict('local')}>
                Keep this device
              </Button>
              <Button size="sm" variant="primary" onClick={() => resolveConflict('remote')}>
                Use other copy
              </Button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
