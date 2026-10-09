import { useMutation } from '@tanstack/react-query';
import type { User } from '@devday/contracts';
import { api } from '../../shared/api';

export function useRegistration(
  displayName: string,
  handle: string,
  onRegistered: (user: User) => void,
) {
  return useMutation({
    mutationFn: () => api.request('register', { body: { displayName, handle } }),
    onSuccess: onRegistered,
  });
}
