import { lazy, Suspense, useState } from 'react'

import EntryScreen from './EntryScreen'

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

  return (
    <>
      {view === 'entry' && (
        <EntryScreen
          onKaimahi={() => setView('kaimahi')}
          onSupervisor={() => setView('supervisor')}
        />
      )}
      {view !== 'entry' && (
        <Suspense fallback={<RoleLoadingScreen />}>
          {view === 'kaimahi' && <KaimahiApp onBack={() => setView('entry')} />}
          {view === 'supervisor' && <SupervisorApp onBack={() => setView('entry')} />}
        </Suspense>
      )}
    </>
  )
}
