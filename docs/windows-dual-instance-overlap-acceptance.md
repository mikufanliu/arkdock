# Windows Dual-instance Overlap Acceptance

Scope: Windows + Spine model path only.

Pass criteria:
- 30 consecutive menu-initiated character switches with 0 reproductions of dual-instance overlap.
- Split is fixed: 15 tray menu switches + 15 in-window context menu switches.

## Preconditions

- Use a Windows build that includes this patch set.
- Ensure at least 2 Spine characters are available.
- Start with a clean app launch.

## Test A: Tray menu (15)

1. Open tray menu.
2. Switch to a different Spine character.
3. Observe render area for overlap (same character/mode drawn twice).
4. Repeat until 15 total switches.

Expected:
- No duplicated layered character at any step.

## Test B: In-window context menu (15)

1. Right-click model area to open context menu.
2. Use `切换模型` to switch to a different Spine character.
3. Observe render area for overlap.
4. Repeat until 15 total switches.

Expected:
- No duplicated layered character at any step.

## Record Template

| Path | Attempts | Reproductions | Result |
| --- | ---: | ---: | --- |
| Tray menu | 15 | 0 | PASS/FAIL |
| Context menu | 15 | 0 | PASS/FAIL |

Overall result is PASS only when both rows are PASS.
