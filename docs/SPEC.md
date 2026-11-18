# Functional spec

## Goal
Clock in and out with one button on iPhone or Mac, see past shifts by day with total hours, and export to CSV. Free, open source, for one user.

## Tabs
Bottom tab bar on iPhone (Timer · History · Settings). On Mac at ≥ 900 px wide, Timer sits in a left column and History fills the right; Settings opens from a gear button.

## 1. Timer tab

| State | Shows | Action |
| --- | --- | --- |
| Idle | `00:00:00`, "Tap start to clock in", orange START button, "Logged today: X.XX h" card | Tap START → Running |
| Running | Live counter (HH:MM:SS, updates every second), "Started 7:58 am", FINISH button (dark with orange ring, "HOLD 1 SEC"), hour-progress ring around the button | Press and hold FINISH 1 s → entry saved, toast "Logged · 9h 00m", back to Idle |
| Holding | Ring turns white and fills over 1 s | Release early → cancel |

Rules:
- Counter is computed from the stored start time, so it is correct after the app is closed, the phone sleeps, or the device restarts.
- Only one running timer at a time.
- Under 60 s: prompt "Keep or discard?".
- Optional Job / Employee chips above the button (hidden unless enabled in Settings). If shown, they apply to the next or current shift.

## 2. History tab
- Header: "History" + **Export CSV** button (orange outline).
- Column labels: DATE · CLOCK IN · CLOCK OUT · TOTAL.
- Grouped by week (Monday start), newest first. Week header: "WEEK OF 16 NOV" on the left, "26.75 h" in orange on the right.
- Row: `Mon 16 Nov | 8:00 am | 5:00 pm | 9.00 h`.
- Multiple shifts on a day: first row shows the date, later rows leave it blank, then a "Day total" row with the sum in orange.
- Tap a row → edit sheet. Swipe left → delete (soft) with Undo toast.
- Empty state: "No shifts yet. Tap Start on the Timer tab."

## 3. CSV export
- Range: This week · Last week · This month · All · Custom (date pickers).
- Format: see `samples/sample-export.csv` and CLAUDE.md.
- Only non-deleted, finished entries are exported.

## 4. Settings
| Setting | Options | Default |
| --- | --- | --- |
| Time format | 12-hour / 24-hour | 12-hour |
| Week starts | Monday / Sunday | Monday |
| Rounding (display + CSV) | None / nearest 5 / 15 min | None |
| Job & employee labels | Show / Hide | Hide |
| Device name | Text | "iPhone" or "Mac" (detected) |
| Google Sheets sync (Phase 3) | Endpoint URL, token, Sync now, last synced | Off |
| Export all data | CSV of everything | — |
| About | "Open source · MIT licence · Your data stays on your devices" | — |

## Edge cases
- Shift crossing midnight: it belongs to the start date; hours are the full duration.
- Clock or timezone changes: store ISO with offset; never recompute stored times.
- Storage cleared by iOS: show a one-time warning if the DB is empty but a "last export" date exists; recommend weekly CSV export or sync.
- Open shift older than 12 h: show a red "Still running?" banner on the Timer tab.
