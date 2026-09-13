import { CreditCard, Database, LogIn, LogOut, MessageSquare, PanelLeftClose, PanelLeftOpen, Settings2, Users } from 'lucide-react';
import type { AuthUser } from '../lib/store';
export type Page = 'workspace' | 'roster' | 'knowledge' | 'pricing' | 'settings';
const items: { id: Page; label: string; icon: typeof MessageSquare }[] = [
  { id: 'workspace', label: 'Workspace', icon: MessageSquare },
  { id: 'roster', label: 'Agent roster', icon: Users },
  { id: 'knowledge', label: 'Knowledge hub', icon: Database },
  { id: 'pricing', label: 'Plans', icon: CreditCard },
  { id: 'settings', label: 'Settings and model hub', icon: Settings2 },
];
export default function Rail({ page, setPage, collapsed, toggle, badge, authUser, googleEnabled }: { page: Page; setPage: (p: Page) => void; collapsed: boolean; toggle: () => void; badge: Partial<Record<Page, number>>; authUser?: AuthUser | null; googleEnabled?: boolean }) {
  return <aside className={collapsed ? 'rail collapsed' : 'rail'} aria-label="Primary">
    <button className="rail-brand" onClick={() => setPage('workspace')} aria-label="Hey Buddy home"><img src="icons/icon-192.png" alt="" width={26} height={26} /><span>Hey Buddy</span></button>
    <nav>{items.map(n => <button key={n.id} className={page === n.id ? 'rail-item active' : 'rail-item'} title={collapsed ? n.label : undefined} aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}><n.icon size={17} strokeWidth={1.75} /><span>{n.label}</span>{badge[n.id] ? <em className="rail-badge">{badge[n.id]}</em> : null}</button>)}</nav>
    <div className="rail-foot">
      {authUser
        ? <div className="rail-user" title={collapsed ? authUser.email : undefined}>
            {authUser.picture ? <img src={authUser.picture} alt="" className="rail-avatar" referrerPolicy="no-referrer" /> : <div className="rail-avatar rail-avatar-initial">{authUser.name[0]?.toUpperCase()}</div>}
            <span className="rail-user-info"><strong>{authUser.name}</strong><small>{authUser.email}</small></span>
            <a href="/auth/logout" className="rail-item rail-signout" title="Sign out" aria-label="Sign out"><LogOut size={14} strokeWidth={1.75} /></a>
          </div>
        : googleEnabled
          ? <a href="/auth/google" className="rail-item" title={collapsed ? 'Sign in with Google' : undefined}><LogIn size={17} strokeWidth={1.75} /><span>Sign in</span></a>
          : null}
      <button className="rail-item rail-toggle" onClick={toggle} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? <PanelLeftOpen size={17} strokeWidth={1.75} /> : <PanelLeftClose size={17} strokeWidth={1.75} />}<span>Collapse</span></button>
    </div>
  </aside>;
}
