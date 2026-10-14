# Implementation ownership

The product specification is read-only. Internal development name: Lifts Coach.

- UI agent owns `src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/components/**`.
- Core agent owns `shared/domain.ts`, `shared/catalog.ts`, `src/lib/store.ts`, `tests/core.test.ts`.
- Orchestrator owns other configuration, Worker, evidence, documentation, integration and review.

Shared types are in `shared/types.ts`. All persisted loads use pounds internally; `toDisplayWeight` / `fromDisplayWeight` convert when kg is selected.

Core exports: `catalog`, `emptyData()`, `createRoutine(name, position?)`, `createPrescription(exerciseId)`, `startWorkout(data, routineId) -> AppData`, `repeatWorkout(data, workoutId) -> AppData`, `completeSet(data, workoutId, exerciseId, setId) -> AppData`, `finishWorkout(data, workoutId, feeling?, notes?) -> AppData`, `applyProposal(data, proposalId, selectedIndices) -> AppData`, `applyEdits(prescriptions, edits, exercises) -> Prescription[]`, `progressionProposals(data, workoutId) -> Proposal[]`, `validateBackup(unknown) -> AppData`, `toDisplayWeight`, `fromDisplayWeight`. Exercise action identifiers refer to Prescription.id when possible; resolve exerciseId fallback only if unambiguous.

Store exports: `useAppStore() -> { data: AppData | null, update(updater: (data: AppData) => AppData): Promise<void>, syncStatus: 'local'|'syncing'|'synced'|'offline'|'conflict'|'error', conflict: {revision:number,data:AppData}|null, resolveConflict(choice:'local'|'remote'):Promise<void>, exportData():Promise<string>, importData(data:unknown):Promise<void> }`. Local Dexie transaction commits the new AppData and durable outbox before render. No automatic merging. Server endpoints GET /api/state returns {data,revision}; PUT /api/state accepts SyncRequest returns {revision}, 409 returns {data,revision}. GET /api/providers returns [{id,models}]. POST /api/coach/chat body {message, context:{routineId?,workoutId?,exerciseId?},provider,model} returns {text, proposals:Proposal[], evidence:Evidence[]}.

UI performs all manual edits through shared domain operations; keeps an undo snapshot for ordinary training actions. Agent may add domain/store exports if communicated. Do not create fake seeded user history or routines; first-run must be usable with Create routine and Ask Coach. Coach disabled message when no provisioned provider, no fake model replies.
