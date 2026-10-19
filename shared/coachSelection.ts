export interface CoachProvider {
  id: string;
  models: string[];
}

export function coachSelection(
  providers: CoachProvider[],
  saved: { provider: string; model: string },
) {
  const provider =
    providers.find((item) => item.id === saved.provider && item.models.length) ??
    providers.find((item) => item.models.length);
  if (!provider) return null;
  return {
    provider: provider.id,
    model: provider.models.includes(saved.model) ? saved.model : provider.models[0],
  };
}
