import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getNotesList } from "../endpoints/notes/list_GET.schema";
import { postNotesSave } from "../endpoints/notes/save_POST.schema";
import { postNotesDelete } from "../endpoints/notes/delete_POST.schema";

export const NOTES_QUERY_KEY = ["notes"] as const;

export function useNotes() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: async () => (await getNotesList()).notes, placeholderData: (previous) => previous });
  const save = useMutation({ mutationFn: postNotesSave, onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY }) });
  const remove = useMutation({ mutationFn: postNotesDelete, onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY }) });
  return { query, save, remove, notes: query.data ?? [] };
}
