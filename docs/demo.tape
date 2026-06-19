# vhs tape — SlopAudit happy path.
# Render in CI via .github/workflows/demo.yml, or locally:
#   npm run build && npm link   (puts `slopaudit` on PATH)
#   vhs docs/demo.tape
Output assets/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1100
Set Height 680
Set Theme "Dracula"
Set Padding 18

Type "# 1) List every JS/TS source file + line counts (m1 inventory, no scoring)"
Enter
Sleep 600ms
Type "slopaudit src --list"
Enter
Sleep 2.5s

Type "# 2) Full audit — SlopScore + ranked offender-file heatmap"
Enter
Sleep 600ms
Type "slopaudit src"
Enter
Sleep 3s

Type "# 3) Machine-readable score for CI (nothing written to disk)"
Enter
Sleep 600ms
Type "slopaudit src --json --no-html --no-badge"
Enter
Sleep 3s

Type "# → wrote slopaudit-report.html + slopaudit-badge.svg in the full run above"
Enter
Sleep 2s
