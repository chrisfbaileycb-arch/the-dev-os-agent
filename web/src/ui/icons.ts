import { Boxes, Briefcase, Calculator, Code2, FileText, Globe2, Layers3, Megaphone, MessageSquare, Search, ShieldCheck, Sparkles, Wand2, type LucideIcon } from 'lucide-react';
// Persona icons by name so the roster stays plain data. Lucide only; no pictographs.
export const personaIcons: Record<string, LucideIcon> = { Boxes, Briefcase, Calculator, Code2, FileText, Globe2, Layers3, Megaphone, MessageSquare, Search, ShieldCheck, Sparkles, Wand2 };
// Sparkles is the default rather than Briefcase: an unknown persona is likelier to be a custom
// agent than a business one, and a briefcase is the wrong promise to make about it.
export const iconFor = (name: string): LucideIcon => personaIcons[name] ?? Sparkles;
