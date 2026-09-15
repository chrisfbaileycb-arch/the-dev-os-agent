import { Check, MonitorCog } from 'lucide-react';
import { THEMES, type ThemeChoice } from '../lib/theme';

// The palette picker, shown in Settings.
//
// Four named palettes and a "match my system" card, each drawn as a three-bar swatch — surface,
// hairline, accent — so the choice is recognisable by eye before the label is read. The cards are
// real buttons with aria-pressed, not a select: the point is that the visitor can see all five
// options and their colours at once rather than opening a dropdown to find out what is on offer.

export interface ThemePickerProps {
  value: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
}

export default function ThemePicker({ value, onChange }: ThemePickerProps) {
  return <div className="theme-grid" role="group" aria-label="Colour palette">
    <button type="button" className={value === 'system' ? 'theme-card selected' : 'theme-card'} aria-pressed={value === 'system'} onClick={() => onChange('system')}>
      <MonitorCog size={15} strokeWidth={1.75} />
      <span className="theme-card-body">
        <strong>System<span className="theme-swatch"><i style={{ background: '#ffffff' }} /><i style={{ background: '#e4e4ec' }} /><i style={{ background: '#ff6a5c' }} /></span></strong>
        <small>Follow the OS. Dark after sunset, light during the day.</small>
      </span>
      {value === 'system' && <Check size={13} className="theme-check" />}
    </button>
    {THEMES.map(theme => {
      const [surface, line, accent] = theme.swatch;
      const Icon = theme.icon;
      return <button key={theme.id} type="button" className={value === theme.id ? 'theme-card selected' : 'theme-card'} aria-pressed={value === theme.id} onClick={() => onChange(theme.id)}>
        <Icon size={15} strokeWidth={1.75} />
        <span className="theme-card-body">
          <strong>{theme.label}<span className="theme-swatch"><i style={{ background: surface }} /><i style={{ background: line }} /><i style={{ background: accent }} /></span></strong>
          <small>{theme.blurb}</small>
        </span>
        {value === theme.id && <Check size={13} className="theme-check" />}
      </button>;
    })}
  </div>;
}