import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRunsList } from "../endpoints/runs/list_GET.schema";
import { postRunsSave } from "../endpoints/runs/save_POST.schema";
import { postWorkspaceClear } from "../endpoints/workspace/clear_POST.schema";
import { NOTES_QUERY_KEY } from "./useNotes";

export const RUNS_QUERY_KEY = ["runs"] as const;

export function useRuns() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: RUNS_QUERY_KEY, queryFn: async () => (await getRunsList()).runs, placeholderData: (previous) => previous });
  const save = useMutation({ mutationFn: postRunsSave, onSuccess: () => queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY }) });
  const clearWorkspace = useMutation({
    mutationFn: () => postWorkspaceClear({ confirm: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
    },
  });
  return { query, save, clearWorkspace, runs: query.data ?? [] };
}
