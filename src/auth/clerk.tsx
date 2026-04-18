import { useAuth } from '@clerk/clerk-react';
import { useCallback } from 'react';

/**
 * Returns a getter that resolves a fresh Clerk session token. Clerk handles
 * refresh internally, so calling this on every API request keeps long-lived
 * sessions valid without manual refresh logic.
 */
export function useClerkToken(): () => Promise<string | null> {
  const { getToken } = useAuth();
  return useCallback(async () => {
    try {
      return await getToken();
    } catch {
      return null;
    }
  }, [getToken]);
}
