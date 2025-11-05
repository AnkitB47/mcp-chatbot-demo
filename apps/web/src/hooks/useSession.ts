import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
    staleTime: 5 * 60 * 1000,
  });
}
