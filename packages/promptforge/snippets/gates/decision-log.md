Append one line per ambiguous-or-resolved row to the DECISION LOG block:

```
DECISION LOG
============
row <N>: LEADBAY_ID=<id|blank>  evidence=<which signals agreed>  rejected=<why other candidates were not chosen>
row <N>: LEADBAY_ID=<id|blank>  evidence=<...>                   rejected=<...>
============
```

For rows where no resolution was possible, write `LEADBAY_ID=blank evidence=insufficient` and explain in `rejected=` why the available signals were not enough.
