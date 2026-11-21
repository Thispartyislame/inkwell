# Decisions

Choices not dictated by `docs/BUILD_PROMPT.md`. Newest at the bottom.

1. **Rates in basis points.** Tax, deposit, discount percent, markup percent are integers
   (`825` = 8.25%), so no floats anywhere in money math.
2. **Combined quantities by design key.** Lines combine for quantity breaks when their full set
   of imprints is identical (same location, method, colors, underbase, specialty, size). Lines
   that share only one imprint (same front, different back) do not combine. Simple and
   predictable; can be refined per imprint later.
3. **Screens are counted per unique design, not per line.** Three shirt colors with the same
   3-color front need 3 screens, not 9. Underbase counts as a screen.
4. **Discount is allocated pro-rata** across taxable and non-taxable amounts before tax.
5. **Rush applies after discount** and is taxable when the underlying items are (pro-rata).
6. **Shipping is added after tax** and is untaxed unless its fee is marked taxable.
7. **Expired exempt certificate**: the quote is still treated as exempt (the flag is the
   user's decision), but a prominent warning shows on the quote and a one-click toggle charges
   tax. Nothing is silently changed.
8. **Quantity below the first matrix break** is priced at the first break and triggers the
   below-minimum fee if one is set.
9. **Rounding to $0.05 / $0.25** rounds the unit price to the nearest step, half up.
10. **Revisions** keep the base number: `Q-1001` → `Q-1001-R2`. The old revision becomes
    `superseded` and read-only. Revisions don't consume a new number.
11. **Overdue and Expired** are computed from dates. Expired is also persisted by a sweep so
    reports and filters stay simple; Overdue is never stored.
12. **Garment snapshot on line items.** Catalog edits never change existing quotes or invoices.
13. **Branch**: work is pushed to `claude/busy-turing-2vebl1`. On a brand-new repo the first
    pushed branch becomes GitHub's default branch; rename or set `main` as you like.
