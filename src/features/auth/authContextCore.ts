// Canonical auth context moved to src/lib/auth/AuthProvider.tsx
// This file is kept so any direct import of AuthContextValue from here
// continues to resolve during the migration period.
export type { AuthContextValue } from '../../lib/auth/AuthProvider'
