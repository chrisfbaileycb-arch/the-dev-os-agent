import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { localStore } from "./localStore";

export const NOTES_QUERY_KEY = ["notes"] as const;

export function useNotes() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: localStore.notes, placeholderData: (previous) => previous });
  const save = useMutation({ mutationFn: localStore.saveNote, onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY }) });
  const remove = useMutation({ mutationFn: (input: { id: string }) => localStore.removeNote(input.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY }) });
  return { query, save, remove, notes: query.data ?? [] };
}
