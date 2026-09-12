import { CreditCard, Database, MessageSquare, PanelLeftClose, PanelLeftOpen, Settings2, Users } from 'lucide-react';
export type Page = 'workspace' | 'roster' | 'knowledge' | 'pricing' | 'settings';
const items: { id: Page; label: string; icon: typeof MessageSquare }[] = [
  { id: 'workspace', label: 'Workspace', icon: MessageSquare },
  { id: 'roster', label: 'Agent roster', icon: Users },
  { id: 'knowledge', label: 'Knowledge hub', icon: Database },
  { id: 'pricing', label: 'Plans', icon: CreditCard },
  { id: 'settings', label: 'Settings and model hub', icon: Settings2 },
];
export default function Rail({ page, setPage, collapsed, toggle, badge }: { page: Page; setPage: (p: Page) => void; collapsed: boolean; toggle: () => void; badge: Partial<Record<Page, number>> }) {
  return <aside className={collapsed ? 'rail collapsed' : 'rail'} aria-label="Primary">
    <button className="rail-brand" onClick={() => setPage('workspace')} aria-label="Hey Buddy home"><img src="icons/icon-192.png" alt="" width={26} height={26} /><span>Hey Buddy</span></button>
    <nav>{items.map(n => <button key={n.id} className={page === n.id ? 'rail-item active' : 'rail-item'} title={collapsed ? n.label : undefined} aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}><n.icon size={17} strokeWidth={1.75} /><span>{n.label}</span>{badge[n.id] ? <em className="rail-badge">{badge[n.id]}</em> : null}</button>)}</nav>
    <button className="rail-item rail-toggle" onClick={toggle} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? <PanelLeftOpen size={17} strokeWidth={1.75} /> : <PanelLeftClose size={17} strokeWidth={1.75} />}<span>Collapse</span></button>
  </aside>;
}
