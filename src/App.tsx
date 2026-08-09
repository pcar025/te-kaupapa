import { lazy, Suspense, useState } from 'react'

import EntryScreen from './EntryScreen'
import { useAuthState } from './auth'

const KaimahiApp = lazy(() => import('./KaimahiApp'))
const SupervisorApp = lazy(() => import('./SupervisorApp'))

type RootView = 'entry' | 'kaimahi' | 'supervisor'

function RoleLoadingScreen() {
  return (
    <div
      role="status"
      aria-label="Loading application"
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-ground)' }}
    >
      <div
        aria-hidden="true"
        style={{ width: 48, height: 2, backgroundColor: 'var(--color-ridge)', opacity: 0.45 }}
      />
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<RootView>('entry')
  const { state, beginSignIn, signOut } = useAuthState()

  if (state.kind === 'checking') return <RoleLoadingScreen />

  if (state.kind !== 'authenticated') {
    const messages = {
      unauthenticated: 'Please sign in to continue.',
      unprovisioned: 'This sign-in is not yet provisioned for Te Kaupapa.',
      inactive: 'This Te Kaupapa account is inactive.',
      error: 'Te Kaupapa is unable to confirm your sign-in right now. Please try again.',
    }
    return (
      <EntryScreen
        onKaimahi={beginSignIn}
        onSupervisor={beginSignIn}
        onSignIn={beginSignIn}
        authMessage={messages[state.kind]}
      />
    )
  }

  const profile = state.profile

  return (
    <>
      {view === 'entry' && (
        <EntryScreen
          onKaimahi={() => setView('kaimahi')}
          onSupervisor={() => setView('supervisor')}
          profile={profile}
          onSignOut={() => {
            setView('entry')
            void signOut()
          }}
        />
      )}
      {view !== 'entry' && (
        <Suspense fallback={<RoleLoadingScreen />}>
          {view === 'kaimahi' && <KaimahiApp profile={profile} onBack={() => setView('entry')} />}
          {view === 'supervisor' && <SupervisorApp profile={profile} onBack={() => setView('entry')} />}
        </Suspense>
      )}
    </>
  )
}
