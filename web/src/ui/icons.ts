import { Boxes, Briefcase, Calculator, FileText, Globe2, Layers3, Megaphone, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
// Persona icons by name so the roster stays plain data. Lucide only; no pictographs.
export const personaIcons: Record<string, LucideIcon> = { Boxes, Briefcase, Calculator, FileText, Globe2, Layers3, Megaphone, Search, ShieldCheck };
export const iconFor = (name: string): LucideIcon => personaIcons[name] ?? Briefcase;
