export function pushRoutineEditorHistory(): void {
  window.history.pushState({ ...(window.history.state || {}), routineEditor: true }, '');
}

export function listenForRoutineEditorBack(options: {
  isDirty: () => boolean;
  onDiscardRequest: () => void;
  onCleanBack: () => void;
}): () => void {
  const onPopState = () => {
    if (options.isDirty()) {
      pushRoutineEditorHistory();
      options.onDiscardRequest();
    } else options.onCleanBack();
  };
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
}
