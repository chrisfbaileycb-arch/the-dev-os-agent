import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { localStore } from "./localStore";
import { NOTES_QUERY_KEY } from "./useNotes";

export const RUNS_QUERY_KEY = ["runs"] as const;

export function useRuns() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: RUNS_QUERY_KEY, queryFn: localStore.runs, placeholderData: (previous) => previous });
  const save = useMutation({ mutationFn: localStore.saveRun, onSuccess: () => queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY }) });
  const clearWorkspace = useMutation({
    mutationFn: localStore.clearAll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
    },
  });
  return { query, save, clearWorkspace, runs: query.data ?? [] };
}
