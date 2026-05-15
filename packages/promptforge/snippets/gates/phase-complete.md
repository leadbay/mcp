Render the FINAL REPORT block VERBATIM as your byproduct:

```
FINAL REPORT
============
rows read:                 <n>
rows skipped (blank/dup):  <n>
deterministic matches:     <n>
ambiguous left unresolved: <n>
contacts imported:         <n>
notes written or staged:   <n>
custom fields created:     <n>
custom fields reused:      <n>
import IDs / handle IDs:   <list>
leads imported now:        <list-or-count>
needs later polling:       <yes/no, via leadbay_import_status>
============
```

If any field is N/A for this run, render the row with `n/a` instead of dropping it.
