# ThemeModeSwitch (seeded by Floot, one change applied)

The seeded `components/ThemeModeSwitch.tsx` rendered the active theme with a text tick character. Per the design principles (lucide icons only, no pictographs) the three occurrences were replaced:

```tsx
import { Sun, Moon, SunMoon, Check } from "lucide-react";
// ...
{mode === "light" && <Check size={14} className={styles.checkmark} aria-hidden="true" />}
```

The rest of the file is Floot's seed and is not mirrored here.
